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

export class OdtParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser(xmlParserOptions);
  }

  async parse(odtBuffer: Buffer | ArrayBuffer | Uint8Array): Promise<DocxDocumentModel> {
    const zip = await JSZip.loadAsync(odtBuffer);

    let title: string | undefined;
    let creator: string | undefined;

    // meta.xml
    const metaFile = zip.file("meta.xml");
    if (metaFile) {
      try {
        const metaText = await metaFile.async("string");
        const metaObj = this.parser.parse(metaText);
        const meta = metaObj["office:document-meta"]?.["office:meta"];
        if (meta) {
          title = meta["dc:title"]?.["#text"] || meta["dc:title"];
          creator = meta["dc:creator"]?.["#text"] || meta["dc:creator"];
        }
      } catch {
        // ignore
      }
    }

    // styles.xml & content.xml automatic-styles
    const charStyles = new Map<string, DocxCharStyle>();
    const paraStyles = new Map<string, DocxParaStyle>();

    const contentFile = zip.file("content.xml");
    if (!contentFile) {
      throw new Error("Invalid ODT: missing content.xml");
    }
    const contentText = await contentFile.async("string");
    const contentObj = this.parser.parse(contentText);

    const docContent = contentObj["office:document-content"] || contentObj;
    const autoStyles = docContent["office:automatic-styles"] || docContent["automatic-styles"];

    if (autoStyles) {
      const styles = this.toArray(autoStyles["style:style"] || autoStyles["style"]);
      for (const s of styles) {
        const name = s["@_style:name"] || s["@_name"];
        const family = s["@_style:family"] || s["@_family"];

        if (family === "text") {
          const textProps = s["style:text-properties"] || s["text-properties"];
          if (textProps) {
            charStyles.set(name, this.parseTextProps(textProps));
          }
        } else if (family === "paragraph") {
          const paraProps = s["style:paragraph-properties"] || s["paragraph-properties"];
          if (paraProps) {
            paraStyles.set(name, this.parseParaProps(paraProps));
          }
        }
      }
    }

    const bodyObj = docContent["office:body"]?.["office:text"] || docContent["body"]?.["text"];
    const elements: DocxBlockElement[] = [];

    if (bodyObj) {
      const rawParas = this.toArray(bodyObj["text:p"] || bodyObj["p"]);
      const rawTables = this.toArray(bodyObj["table:table"] || bodyObj["table"]);

      for (const p of rawParas) {
        elements.push(this.parseParagraph(p, charStyles, paraStyles));
      }
      for (const t of rawTables) {
        elements.push(this.parseTable(t, charStyles, paraStyles));
      }
    }

    return {
      title,
      creator,
      body: elements,
    };
  }

  private parseTextProps(tp: any): DocxCharStyle {
    const style: DocxCharStyle = {};
    if (tp["@_fo:font-weight"] === "bold") style.bold = true;
    if (tp["@_fo:font-style"] === "italic") style.italic = true;
    if (tp["@_style:text-underline-style"]) style.underline = true;
    if (tp["@_style:text-line-through-style"]) style.strike = true;

    if (tp["@_fo:font-size"]) {
      const ptMatch = String(tp["@_fo:font-size"]).match(/([0-9.]+)pt/);
      if (ptMatch) style.fontSizePt = parseFloat(ptMatch[1]);
    }
    if (tp["@_fo:color"]) {
      style.color = tp["@_fo:color"];
    }
    if (tp["@_style:font-name"]) {
      style.fontFamily = tp["@_style:font-name"];
    }
    return style;
  }

  private parseParaProps(pp: any): DocxParaStyle {
    const style: DocxParaStyle = {};
    const align = pp["@_fo:text-align"];
    if (align === "center") style.align = "center";
    else if (align === "end" || align === "right") style.align = "right";
    else if (align === "justify") style.align = "justify";
    else if (align === "start" || align === "left") style.align = "left";

    if (pp["@_fo:line-height"]) {
      const m = String(pp["@_fo:line-height"]).match(/([0-9.]+)%/);
      if (m) style.lineSpacingPercent = parseFloat(m[1]);
    }
    return style;
  }

  private parseParagraph(
    pObj: any,
    charStyles: Map<string, DocxCharStyle>,
    paraStyles: Map<string, DocxParaStyle>
  ): DocxParagraph {
    const styleName = pObj["@_text:style-name"] || pObj["@_style-name"];
    const style = styleName ? paraStyles.get(styleName) || {} : {};

    const children: (DocxRun | { type: "break"; breakType: "line" | "page" })[] = [];

    // spans
    const spans = this.toArray(pObj["text:span"] || pObj["span"]);
    for (const span of spans) {
      const sName = span["@_text:style-name"] || span["@_style-name"];
      const charStyle = sName ? charStyles.get(sName) || {} : {};
      const txt = typeof span === "object" ? span["#text"] ?? "" : String(span);
      if (txt) {
        children.push({
          type: "run",
          text: txt,
          style: { ...charStyle },
        });
      }
    }

    // 직접 들어있는 텍스트
    if (spans.length === 0 && pObj["#text"]) {
      children.push({
        type: "run",
        text: pObj["#text"],
        style: {},
      });
    }

    return {
      type: "paragraph",
      style,
      children,
    };
  }

  private parseTable(
    tblObj: any,
    charStyles: Map<string, DocxCharStyle>,
    paraStyles: Map<string, DocxParaStyle>
  ): DocxTable {
    const rawRows = this.toArray(tblObj["table:table-row"] || tblObj["table-row"]);
    const rows: DocxTableRow[] = [];

    for (const tr of rawRows) {
      const rawCells = this.toArray(tr["table:table-cell"] || tr["table-cell"]);
      const cells: DocxTableCell[] = [];

      for (const tc of rawCells) {
        const colSpan = parseInt(tc["@_table:number-columns-spanned"] || "1", 10) || 1;
        const paragraphs: DocxParagraph[] = [];
        const rawParas = this.toArray(tc["text:p"] || tc["p"]);

        for (const p of rawParas) {
          paragraphs.push(this.parseParagraph(p, charStyles, paraStyles));
        }

        cells.push({
          paragraphs,
          colSpan,
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
