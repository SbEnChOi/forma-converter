import JSZip from "jszip";
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
  ConversionOptions,
} from "../types.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// pt to dxa (1 pt = 20 dxa)
function ptToDxa(pt: number): number {
  return Math.round(pt * 20);
}

// pt to half-points (1 pt = 2 half-points)
function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2);
}

export class DocxBuilder {
  async build(doc: DocxDocumentModel, options?: ConversionOptions): Promise<Uint8Array> {
    const zip = new JSZip();

    // 1. [Content_Types].xml
    const contentTypesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`;
    zip.file("[Content_Types].xml", contentTypesXml);

    // 2. _rels/.rels
    const rootRelsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`;
    zip.file("_rels/.rels", rootRelsXml);

    // 3. word/_rels/document.xml.rels
    const docRelsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `</Relationships>`;
    zip.file("word/_rels/document.xml.rels", docRelsXml);

    // 4. docProps/core.xml
    const title = options?.title || doc.title || "";
    const creator = options?.creator || doc.creator || "hwpx2docx";
    const coreXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">` +
      `<dc:title>${escapeXml(title)}</dc:title>` +
      `<dc:creator>${escapeXml(creator)}</dc:creator>` +
      `</cp:coreProperties>`;
    zip.file("docProps/core.xml", coreXml);

    // 5. word/document.xml
    const documentXml = this.buildDocumentXml(doc.body);
    zip.file("word/document.xml", documentXml);

    return await zip.generateAsync({ type: "uint8array" });
  }

  private buildDocumentXml(elements: DocxBlockElement[]): string {
    let bodyContent = "";

    for (const el of elements) {
      if (el.type === "paragraph") {
        bodyContent += this.renderParagraph(el);
      } else if (el.type === "table") {
        bodyContent += this.renderTable(el);
      }
    }

    if (!bodyContent) {
      bodyContent = `<w:p/>`;
    }

    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<w:body>` +
      bodyContent +
      `<w:sectPr>` +
      `<w:pgSz w:w="11906" w:h="16838"/>` + // A4 크기 (dxa)
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>` +
      `</w:sectPr>` +
      `</w:body>` +
      `</w:document>`
    );
  }

  private renderParagraph(p: DocxParagraph): string {
    let pPrXml = "";
    const pPrParts: string[] = [];

    // 정렬 (w:jc)
    if (p.style.align) {
      let jc = "left";
      if (p.style.align === "center") jc = "center";
      else if (p.style.align === "right") jc = "right";
      else if (p.style.align === "justify") jc = "both";
      pPrParts.push(`<w:jc w:val="${jc}"/>`);
    }

    // 여백/들여쓰기 (w:ind)
    const leftDxa = p.style.marginLeftPt ? ptToDxa(p.style.marginLeftPt) : 0;
    const rightDxa = p.style.marginRightPt ? ptToDxa(p.style.marginRightPt) : 0;
    const firstLineDxa = p.style.firstLineIndentPt ? ptToDxa(p.style.firstLineIndentPt) : 0;
    if (leftDxa || rightDxa || firstLineDxa) {
      let indAttr = "";
      if (leftDxa) indAttr += ` w:left="${leftDxa}"`;
      if (rightDxa) indAttr += ` w:right="${rightDxa}"`;
      if (firstLineDxa) indAttr += ` w:firstLine="${firstLineDxa}"`;
      pPrParts.push(`<w:ind${indAttr}/>`);
    }

    // 줄간격 (w:spacing)
    const topDxa = p.style.marginTopPt ? ptToDxa(p.style.marginTopPt) : 0;
    const bottomDxa = p.style.marginBottomPt ? ptToDxa(p.style.marginBottomPt) : 0;
    const lineVal = p.style.lineSpacingPercent
      ? Math.round((p.style.lineSpacingPercent / 100) * 240)
      : 240;

    let spacingAttr = ` w:line="${lineVal}" w:lineRule="auto"`;
    if (topDxa) spacingAttr += ` w:before="${topDxa}"`;
    if (bottomDxa) spacingAttr += ` w:after="${bottomDxa}"`;
    pPrParts.push(`<w:spacing${spacingAttr}/>`);

    if (pPrParts.length > 0) {
      pPrXml = `<w:pPr>${pPrParts.join("")}</w:pPr>`;
    }

    let runsXml = "";
    for (const child of p.children) {
      if (child.type === "run") {
        runsXml += this.renderRun(child);
      } else if (child.type === "break") {
        if (child.breakType === "page") {
          runsXml += `<w:r><w:br w:type="page"/></w:r>`;
        } else {
          runsXml += `<w:r><w:br/></w:r>`;
        }
      }
    }

    return `<w:p>${pPrXml}${runsXml}</w:p>`;
  }

  private renderRun(r: DocxRun): string {
    const rPrParts: string[] = [];

    if (r.style.bold) rPrParts.push(`<w:b/>`);
    if (r.style.italic) rPrParts.push(`<w:i/>`);
    if (r.style.underline) rPrParts.push(`<w:u w:val="single"/>`);
    if (r.style.strike) rPrParts.push(`<w:strike/>`);

    if (r.style.fontSizePt) {
      const halfPoints = ptToHalfPoints(r.style.fontSizePt);
      rPrParts.push(`<w:sz w:val="${halfPoints}"/>`);
      rPrParts.push(`<w:szCs w:val="${halfPoints}"/>`);
    }

    if (r.style.color) {
      const hex = r.style.color.replace("#", "");
      rPrParts.push(`<w:color w:val="${hex}"/>`);
    }

    if (r.style.fontFamily) {
      const f = escapeXml(r.style.fontFamily);
      rPrParts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`);
    }

    const rPrXml = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";
    return `<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
  }

  private renderTable(table: DocxTable): string {
    let rowsXml = "";

    for (const row of table.rows) {
      let cellsXml = "";

      for (const cell of row.cells) {
        let tcPrParts: string[] = [];

        if (cell.colSpan && cell.colSpan > 1) {
          tcPrParts.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
        }

        if (cell.widthPt) {
          tcPrParts.push(`<w:tcW w:w="${ptToDxa(cell.widthPt)}" w:type="dxa"/>`);
        }

        if (cell.backgroundColor) {
          const hex = cell.backgroundColor.replace("#", "");
          tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
        }

        const tcPrXml = tcPrParts.length > 0 ? `<w:tcPr>${tcPrParts.join("")}</w:tcPr>` : "";

        let cellParasXml = "";
        if (cell.paragraphs.length > 0) {
          for (const p of cell.paragraphs) {
            cellParasXml += this.renderParagraph(p);
          }
        } else {
          cellParasXml = `<w:p/>`;
        }

        cellsXml += `<w:tc>${tcPrXml}${cellParasXml}</w:tc>`;
      }

      rowsXml += `<w:tr>${cellsXml}</w:tr>`;
    }

    return (
      `<w:tbl>` +
      `<w:tblPr>` +
      `<w:tblW w:w="0" w:type="auto"/>` +
      `<w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `</w:tblBorders>` +
      `</w:tblPr>` +
      rowsXml +
      `</w:tbl>`
    );
  }
}
