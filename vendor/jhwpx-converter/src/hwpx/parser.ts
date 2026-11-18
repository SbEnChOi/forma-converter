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

export class HwpxParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser(xmlParserOptions);
  }

  async parse(hwpxBuffer: Buffer | ArrayBuffer | Uint8Array): Promise<DocxDocumentModel> {
    const zip = await JSZip.loadAsync(hwpxBuffer);

    // 1. 메타데이터 (Contents/content.hpf) 파싱
    let title: string | undefined;
    let creator: string | undefined;
    const hpfFile = zip.file("Contents/content.hpf");
    if (hpfFile) {
      try {
        const hpfText = await hpfFile.async("string");
        const hpfObj = this.parser.parse(hpfText);
        const meta = hpfObj["opf:package"]?.["opf:metadata"] || hpfObj["package"]?.["metadata"];
        if (meta) {
          title = meta["dc:title"]?.["#text"] || meta["dc:title"];
          creator = meta["dc:creator"]?.["#text"] || meta["dc:creator"];
        }
      } catch {
        // ignore
      }
    }

    // 2. header.xml 파싱 (글꼴, charPr, paraPr 사전)
    const fontMap = new Map<number, string>();
    const charPrMap = new Map<number, DocxCharStyle>();
    const paraPrMap = new Map<number, DocxParaStyle>();

    const headerFile = zip.file("Contents/header.xml");
    if (headerFile) {
      const headerText = await headerFile.async("string");
      const headerObj = this.parser.parse(headerText);
      const head = headerObj["hh:head"] || headerObj["head"];
      const refList = head?.["hh:refList"] || head?.["refList"];

      if (refList) {
        // 글꼴 (fontfaces)
        const fontfaces = refList["hh:fontfaces"] || refList["fontfaces"];
        const fontfaceList = this.toArray(fontfaces?.["hh:fontface"] || fontfaces?.["fontface"]);
        for (const ff of fontfaceList) {
          const fonts = this.toArray(ff?.["hh:font"] || ff?.["font"]);
          for (const f of fonts) {
            const id = parseInt(f["@_hh:id"] || f["@_id"], 10);
            const name = f["@_hh:name"] || f["@_name"];
            if (!isNaN(id) && name) {
              fontMap.set(id, name);
            }
          }
        }

        // charProperties
        const charProps = refList["hh:charProperties"] || refList["charProperties"];
        const charPrList = this.toArray(charProps?.["hh:charPr"] || charProps?.["charPr"]);
        for (const cp of charPrList) {
          const id = parseInt(cp["@_hh:id"] || cp["@_id"], 10);
          if (!isNaN(id)) {
            charPrMap.set(id, this.parseCharPr(cp, fontMap));
          }
        }

        // paraProperties
        const paraProps = refList["hh:paraProperties"] || refList["paraProperties"];
        const paraPrList = this.toArray(paraProps?.["hh:paraPr"] || paraProps?.["paraPr"]);
        for (const pp of paraPrList) {
          const id = parseInt(pp["@_hh:id"] || pp["@_id"], 10);
          if (!isNaN(id)) {
            paraPrMap.set(id, this.parseParaPr(pp));
          }
        }
      }
    }

    // 3. section0.xml 파싱 (본문)
    const body: DocxBlockElement[] = [];
    const sectionFile = zip.file("Contents/section0.xml");
    if (sectionFile) {
      const sectionText = await sectionFile.async("string");
      const sectionObj = this.parser.parse(sectionText);
      const sec = sectionObj["hs:sec"] || sectionObj["sec"];
      if (sec) {
        const paragraphs = this.toArray(sec["hp:p"] || sec["p"]);
        for (const p of paragraphs) {
          this.parseParagraphOrTable(p, charPrMap, paraPrMap, body);
        }
      }
    }

    return {
      title,
      creator,
      body,
    };
  }

  private parseCharPr(cp: any, fontMap: Map<number, string>): DocxCharStyle {
    const style: DocxCharStyle = {};

    // height: 100 pt = 10,000 HwpUnit (즉, / 100)
    const height = parseInt(cp["@_hh:height"] || cp["@_height"], 10);
    if (!isNaN(height)) {
      style.fontSizePt = height / 100;
    }

    // bold
    const bold = cp["@_hh:bold"] || cp["@_bold"];
    if (bold === "1" || bold === 1 || bold === "true") {
      style.bold = true;
    }

    // italic
    const italic = cp["@_hh:italic"] || cp["@_italic"];
    if (italic === "1" || italic === 1 || italic === "true") {
      style.italic = true;
    }

    // strike
    const strike = cp["@_hh:strike"] || cp["@_strike"];
    if (strike && strike !== "NONE") {
      style.strike = true;
    }

    // underline
    const underlineType = cp["@_hh:underlineType"] || cp["@_underlineType"];
    if (underlineType && underlineType !== "NONE") {
      style.underline = true;
    }

    // color
    const textColor = cp["@_hh:textColor"] || cp["@_textColor"];
    if (textColor && textColor !== "none" && textColor !== "auto") {
      style.color = textColor.startsWith("#") ? textColor : `#${textColor}`;
    }

    // fontRef
    const fontRef = cp["hh:fontRef"] || cp["fontRef"];
    if (fontRef) {
      const hangulId = parseInt(fontRef["@_hh:hangul"] || fontRef["@_hangul"], 10);
      const latinId = parseInt(fontRef["@_hh:latin"] || fontRef["@_latin"], 10);
      const fontName = fontMap.get(hangulId) || fontMap.get(latinId);
      if (fontName) {
        style.fontFamily = fontName;
      }
    }

    return style;
  }

  private parseParaPr(pp: any): DocxParaStyle {
    const style: DocxParaStyle = {};

    const alignObj = pp["hh:align"] || pp["align"];
    if (alignObj) {
      const horz = alignObj["@_hh:horizontal"] || alignObj["@_horizontal"];
      if (horz === "CENTER") style.align = "center";
      else if (horz === "RIGHT") style.align = "right";
      else if (horz === "JUSTIFY") style.align = "justify";
      else if (horz === "LEFT") style.align = "left";
    }

    const lineSpacingObj = pp["hh:lineSpacing"] || pp["lineSpacing"];
    if (lineSpacingObj) {
      const val = parseInt(lineSpacingObj["@_hh:value"] || lineSpacingObj["@_value"], 10);
      if (!isNaN(val)) {
        style.lineSpacingPercent = val;
      }
    }

    const margin = pp["hh:margin"] || pp["margin"];
    if (margin) {
      const left = margin["hh:left"] || margin["left"];
      if (left && (left["@_hh:value"] || left["@_value"])) {
        style.marginLeftPt = parseInt(left["@_hh:value"] || left["@_value"], 10) / 100;
      }
      const right = margin["hh:right"] || margin["right"];
      if (right && (right["@_hh:value"] || right["@_value"])) {
        style.marginRightPt = parseInt(right["@_hh:value"] || right["@_value"], 10) / 100;
      }
      const prev = margin["hh:prev"] || margin["prev"];
      if (prev && (prev["@_hh:value"] || prev["@_value"])) {
        style.marginTopPt = parseInt(prev["@_hh:value"] || prev["@_value"], 10) / 100;
      }
      const next = margin["hh:next"] || margin["next"];
      if (next && (next["@_hh:value"] || next["@_value"])) {
        style.marginBottomPt = parseInt(next["@_hh:value"] || next["@_value"], 10) / 100;
      }
      const intent = margin["hh:intent"] || margin["intent"];
      if (intent && (intent["@_hh:value"] || intent["@_value"])) {
        style.firstLineIndentPt = parseInt(intent["@_hh:value"] || intent["@_value"], 10) / 100;
      }
    }

    return style;
  }

  private parseParagraphOrTable(
    pObj: any,
    charPrMap: Map<number, DocxCharStyle>,
    paraPrMap: Map<number, DocxParaStyle>,
    outElements: DocxBlockElement[]
  ): void {
    const runs = this.toArray(pObj["hp:run"] || pObj["run"]);

    // 이 문단 안에 hp:tbl 이 포함되어 있는지 확인
    for (const r of runs) {
      const tbl = r["hp:tbl"] || r["tbl"];
      if (tbl) {
        outElements.push(this.parseTable(tbl, charPrMap, paraPrMap));
        return;
      }
    }

    // 일반 문단 처리
    const paraPrId = parseInt(pObj["@_hp:paraPrIDRef"] || pObj["@_paraPrIDRef"] || "0", 10);
    const paraStyle = paraPrMap.get(paraPrId) || {};

    const children: (DocxRun | { type: "break"; breakType: "line" | "page" })[] = [];

    for (const r of runs) {
      const charPrId = parseInt(r["@_hp:charPrIDRef"] || r["@_charPrIDRef"] || "0", 10);
      const charStyle = charPrMap.get(charPrId) || {};

      const texts = this.toArray(r["hp:t"] || r["t"]);
      for (const t of texts) {
        const textVal = typeof t === "object" ? t["#text"] ?? "" : String(t);
        if (textVal) {
          children.push({
            type: "run",
            text: textVal,
            style: { ...charStyle },
          });
        }
      }

      if (r["hp:lineBreak"] || r["lineBreak"]) {
        children.push({ type: "break", breakType: "line" });
      }
    }

    outElements.push({
      type: "paragraph",
      style: paraStyle,
      children,
    });
  }

  private parseTable(
    tblObj: any,
    charPrMap: Map<number, DocxCharStyle>,
    paraPrMap: Map<number, DocxParaStyle>
  ): DocxTable {
    const trList = this.toArray(tblObj["hp:tr"] || tblObj["tr"]);
    const rows: DocxTableRow[] = [];

    for (const tr of trList) {
      const tcList = this.toArray(tr["hp:tc"] || tr["tc"]);
      const cells: DocxTableCell[] = [];

      for (const tc of tcList) {
        const cellSpan = tc["hp:cellSpan"] || tc["cellSpan"];
        const colSpan = cellSpan ? parseInt(cellSpan["@_hp:colSpan"] || cellSpan["@_colSpan"] || "1", 10) : 1;
        const rowSpan = cellSpan ? parseInt(cellSpan["@_hp:rowSpan"] || cellSpan["@_rowSpan"] || "1", 10) : 1;

        const cellSz = tc["hp:cellSz"] || tc["cellSz"];
        let widthPt: number | undefined;
        if (cellSz) {
          const w = parseInt(cellSz["@_hp:width"] || cellSz["@_width"], 10);
          if (!isNaN(w)) {
            widthPt = w / 100;
          }
        }

        const paragraphs: DocxParagraph[] = [];
        const subList = tc["hp:subList"] || tc["subList"];
        const rawParas = subList
          ? this.toArray(subList["hp:p"] || subList["p"])
          : this.toArray(tc["hp:p"] || tc["p"]);
        for (const p of rawParas) {
          const paraElements: DocxBlockElement[] = [];
          this.parseParagraphOrTable(p, charPrMap, paraPrMap, paraElements);
          for (const el of paraElements) {
            if (el.type === "paragraph") paragraphs.push(el);
          }
        }

        cells.push({
          paragraphs,
          colSpan,
          rowSpan,
          widthPt,
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
