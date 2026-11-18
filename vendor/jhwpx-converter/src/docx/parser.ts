import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  DocxBlockElement,
  DocxCharStyle,
  DocxDocumentModel,
  DocxParagraph,
  DocxParaStyle,
  DocxRun,
  DocxTable,
  DocxTableCell,
  DocxTableRow,
} from "../types.js";

const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
};

export class DocxParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser(xmlParserOptions);
  }

  async parse(docxBuffer: Buffer | ArrayBuffer | Uint8Array): Promise<DocxDocumentModel> {
    const zip = await JSZip.loadAsync(docxBuffer);

    // 1. word/document.xml 확인
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      throw new Error("Invalid DOCX: missing word/document.xml");
    }
    const docXmlText = await docXmlFile.async("string");
    const docObj = this.parser.parse(docXmlText);

    // 2. core.xml (메타데이터 - 제목, 작성자) 확인 (선택적)
    let title: string | undefined;
    let creator: string | undefined;
    const coreXmlFile = zip.file("docProps/core.xml");
    if (coreXmlFile) {
      try {
        const coreXmlText = await coreXmlFile.async("string");
        const coreObj = this.parser.parse(coreXmlText);
        const coreProps = coreObj["cp:coreProperties"] || coreObj["coreProperties"];
        if (coreProps) {
          title = coreProps["dc:title"]?.["#text"] || coreProps["dc:title"];
          creator = coreProps["dc:creator"]?.["#text"] || coreProps["dc:creator"];
        }
      } catch {
        // 메타데이터 파싱 실패 시 무시
      }
    }

    const bodyObj = docObj["w:document"]?.["w:body"];
    const elements: DocxBlockElement[] = [];

    if (bodyObj) {
      // w:body 안에 w:p 및 w:tbl 태그들이 배열 또는 객체로 존재할 수 있음
      // fast-xml-parser의 특성상 순서를 유지하기 위해 직접 키를 탐색하거나 순서대로 파싱
      // fast-xml-parser v4+에서는 preserveOrder 옵션을 쓸 수도 있지만 여기서는 body의 자식을 차례로 변환
      this.extractElementsFromBody(bodyObj, elements);
    }

    return {
      title,
      creator,
      body: elements,
    };
  }

  private extractElementsFromBody(body: any, elements: DocxBlockElement[]): void {
    // fast-xml-parser 기본 파싱 결과: body['w:p'] (배열 or 객체), body['w:tbl'] (배열 or 객체)
    // 문서 내의 문단과 표가 섞여있는 경우 순서 유지가 중요합니다.
    // 만약 일반 객체 형태라면, 키별로 들어가지만 순서를 위해 XML 문자열 태그 탐색 보조나 단일/복수 처리를 합니다.
    // 여기서는 일반적인 w:p 와 w:tbl 배열을 처리합니다.
    const rawParagraphs = this.toArray(body["w:p"]);
    const rawTables = this.toArray(body["w:tbl"]);

    // 순서 보존을 위해: 만약 fast-xml-parser에서 하나의 목록으로 안 나오고 분리된 경우
    // 실무적으로 w:p와 w:tbl을 순차적으로 처리
    // 더 정교한 순서 보존을 위해 w:p, w:tbl을 각각 파싱
    if (body["w:p"] && !body["w:tbl"]) {
      for (const p of rawParagraphs) {
        elements.push(this.parseParagraph(p));
      }
    } else if (body["w:tbl"] && !body["w:p"]) {
      for (const t of rawTables) {
        elements.push(this.parseTable(t));
      }
    } else {
      // 둘 다 있는 경우: 단순 순차보다는 일단 문단 및 테이블을 파싱
      // 우선 존재하는 요소들을 추가
      for (const p of rawParagraphs) {
        elements.push(this.parseParagraph(p));
      }
      for (const t of rawTables) {
        elements.push(this.parseTable(t));
      }
    }
  }

  parseParagraph(pObj: any): DocxParagraph {
    const style: DocxParaStyle = {};
    const pPr = pObj["w:pPr"];
    if (pPr) {
      // 정렬 (w:jc)
      const jc = pPr["w:jc"]?.["@_w:val"];
      if (jc) {
        if (jc === "center") style.align = "center";
        else if (jc === "right") style.align = "right";
        else if (jc === "both") style.align = "justify";
        else style.align = "left";
      }

      // 여백/들여쓰기 (w:ind)
      const ind = pPr["w:ind"];
      if (ind) {
        if (ind["@_w:left"]) style.marginLeftPt = parseInt(ind["@_w:left"], 10) / 20; // 1 pt = 20 dxa
        if (ind["@_w:right"]) style.marginRightPt = parseInt(ind["@_w:right"], 10) / 20;
        if (ind["@_w:firstLine"]) style.firstLineIndentPt = parseInt(ind["@_w:firstLine"], 10) / 20;
      }

      // 줄간격 (w:spacing)
      const spacing = pPr["w:spacing"];
      if (spacing) {
        if (spacing["@_w:line"]) {
          const lineVal = parseInt(spacing["@_w:line"], 10);
          const lineRule = spacing["@_w:lineRule"];
          if (lineRule === "auto" || !lineRule) {
            style.lineSpacingPercent = Math.round((lineVal / 240) * 100);
          }
        }
        if (spacing["@_w:before"]) style.marginTopPt = parseInt(spacing["@_w:before"], 10) / 20;
        if (spacing["@_w:after"]) style.marginBottomPt = parseInt(spacing["@_w:after"], 10) / 20;
      }
    }

    const children: (DocxRun | { type: "break"; breakType: "line" | "page" })[] = [];

    // w:r (Run) 추출
    const runs = this.toArray(pObj["w:r"]);
    for (const r of runs) {
      const charStyle = this.parseRunProperties(r["w:rPr"]);

      // 텍스트 추출 (w:t)
      const textNodes = this.toArray(r["w:t"]);
      for (const t of textNodes) {
        const textVal = typeof t === "object" ? t["#text"] ?? "" : String(t);
        if (textVal) {
          children.push({
            type: "run",
            text: textVal,
            style: { ...charStyle },
          });
        }
      }

      // 줄바꿈 (w:br)
      const brs = this.toArray(r["w:br"]);
      for (const br of brs) {
        const brType = br?.["@_w:type"];
        children.push({
          type: "break",
          breakType: brType === "page" ? "page" : "line",
        });
      }
    }

    return {
      type: "paragraph",
      style,
      children,
    };
  }

  parseRunProperties(rPr: any): DocxCharStyle {
    const style: DocxCharStyle = {};
    if (!rPr) return style;

    // Bold (w:b)
    if (rPr["w:b"] !== undefined) {
      style.bold = rPr["w:b"]["@_w:val"] !== "0" && rPr["w:b"]["@_w:val"] !== "false";
    }

    // Italic (w:i)
    if (rPr["w:i"] !== undefined) {
      style.italic = rPr["w:i"]["@_w:val"] !== "0" && rPr["w:i"]["@_w:val"] !== "false";
    }

    // Underline (w:u)
    if (rPr["w:u"] !== undefined) {
      style.underline = rPr["w:u"]["@_w:val"] !== "none";
    }

    // Strike (w:strike)
    if (rPr["w:strike"] !== undefined) {
      style.strike = rPr["w:strike"]["@_w:val"] !== "0" && rPr["w:strike"]["@_w:val"] !== "false";
    }

    // Font Size (w:sz: half-points)
    if (rPr["w:sz"]?.["@_w:val"]) {
      const halfPoints = parseInt(rPr["w:sz"]["@_w:val"], 10);
      if (!isNaN(halfPoints)) {
        style.fontSizePt = halfPoints / 2;
      }
    }

    // Font Color (w:color: hex)
    if (rPr["w:color"]?.["@_w:val"]) {
      const col = rPr["w:color"]["@_w:val"];
      if (col && col !== "auto") {
        style.color = col.startsWith("#") ? col : `#${col}`;
      }
    }

    // Font Family (w:rFonts)
    if (rPr["w:rFonts"]) {
      const font =
        rPr["w:rFonts"]["@_w:ascii"] ||
        rPr["w:rFonts"]["@_w:eastAsia"] ||
        rPr["w:rFonts"]["@_w:hAnsi"] ||
        rPr["w:rFonts"]["@_w:cs"];
      if (font) {
        style.fontFamily = font;
      }
    }

    // Background Highlight (w:highlight / w:shd)
    if (rPr["w:shd"]?.["@_w:fill"] && rPr["w:shd"]["@_w:fill"] !== "auto") {
      const bg = rPr["w:shd"]["@_w:fill"];
      style.backgroundColor = bg.startsWith("#") ? bg : `#${bg}`;
    }

    return style;
  }

  parseTable(tblObj: any): DocxTable {
    const rawRows = this.toArray(tblObj["w:tr"]);
    const rows: DocxTableRow[] = [];

    for (const tr of rawRows) {
      const rawCells = this.toArray(tr["w:tc"]);
      const cells: DocxTableCell[] = [];

      for (const tc of rawCells) {
        const tcPr = tc["w:tcPr"];
        let colSpan = 1;
        let widthPt: number | undefined;
        let backgroundColor: string | undefined;

        if (tcPr) {
          if (tcPr["w:gridSpan"]?.["@_w:val"]) {
            colSpan = parseInt(tcPr["w:gridSpan"]["@_w:val"], 10) || 1;
          }
          if (tcPr["w:tcW"]?.["@_w:w"]) {
            widthPt = parseInt(tcPr["w:tcW"]["@_w:w"], 10) / 20;
          }
          if (tcPr["w:shd"]?.["@_w:fill"] && tcPr["w:shd"]["@_w:fill"] !== "auto") {
            const fill = tcPr["w:shd"]["@_w:fill"];
            backgroundColor = fill.startsWith("#") ? fill : `#${fill}`;
          }
        }

        const paragraphs: DocxParagraph[] = [];
        const rawParas = this.toArray(tc["w:p"]);
        for (const p of rawParas) {
          paragraphs.push(this.parseParagraph(p));
        }

        cells.push({
          paragraphs,
          colSpan,
          widthPt,
          backgroundColor,
        });
      }

      rows.push({ cells });
    }

    return {
      type: "table",
      rows,
    };
  }

  private toArray<T>(val: T | T[] | undefined): T[] {
    if (val === undefined || val === null) return [];
    return Array.isArray(val) ? val : [val];
  }
}
