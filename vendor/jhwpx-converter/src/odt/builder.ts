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

export class OdtBuilder {
  private textStyles: DocxCharStyle[] = [];
  private paraStyles: DocxParaStyle[] = [];

  private getTextStyleName(style: DocxCharStyle): string {
    const idx = this.textStyles.findIndex(
      (s) =>
        s.bold === style.bold &&
        s.italic === style.italic &&
        s.underline === style.underline &&
        s.strike === style.strike &&
        s.fontSizePt === style.fontSizePt &&
        s.color === style.color &&
        s.fontFamily === style.fontFamily
    );
    if (idx >= 0) return `T${idx + 1}`;
    this.textStyles.push(style);
    return `T${this.textStyles.length}`;
  }

  private getParaStyleName(style: DocxParaStyle): string {
    const idx = this.paraStyles.findIndex(
      (s) =>
        s.align === style.align &&
        s.lineSpacingPercent === style.lineSpacingPercent &&
        s.marginLeftPt === style.marginLeftPt &&
        s.marginRightPt === style.marginRightPt &&
        s.marginTopPt === style.marginTopPt &&
        s.marginBottomPt === style.marginBottomPt
    );
    if (idx >= 0) return `P${idx + 1}`;
    this.paraStyles.push(style);
    return `P${this.paraStyles.length}`;
  }

  async build(doc: DocxDocumentModel, options?: ConversionOptions): Promise<Uint8Array> {
    const zip = new JSZip();

    // 1. mimetype (STORED)
    zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });

    // 2. META-INF/manifest.xml
    const manifestXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">\n` +
      `  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>\n` +
      `  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>\n` +
      `  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>\n` +
      `  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>\n` +
      `</manifest:manifest>`;
    zip.file("META-INF/manifest.xml", manifestXml);

    // 3. meta.xml
    const title = options?.title || doc.title || "";
    const creator = options?.creator || doc.creator || "jhwpx-converter";
    const metaXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3">\n` +
      `  <office:meta>\n` +
      `    <dc:title>${escapeXml(title)}</dc:title>\n` +
      `    <dc:creator>${escapeXml(creator)}</dc:creator>\n` +
      `  </office:meta>\n` +
      `</office:document-meta>`;
    zip.file("meta.xml", metaXml);

    // 4. styles.xml
    const stylesXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
      `xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.3">\n` +
      `</office:document-styles>`;
    zip.file("styles.xml", stylesXml);

    // 5. content.xml 본문 빌드
    const bodyContent = this.renderBody(doc.body);
    const automaticStyles = this.renderAutomaticStyles();

    const contentXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
      `xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ` +
      `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ` +
      `xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ` +
      `xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ` +
      `office:version="1.3">\n` +
      `  <office:automatic-styles>\n` +
      automaticStyles +
      `  </office:automatic-styles>\n` +
      `  <office:body>\n` +
      `    <office:text>\n` +
      bodyContent +
      `    </office:text>\n` +
      `  </office:body>\n` +
      `</office:document-content>`;
    zip.file("content.xml", contentXml);

    return await zip.generateAsync({ type: "uint8array" });
  }

  private renderAutomaticStyles(): string {
    let xml = "";

    // Text Styles
    for (let i = 0; i < this.textStyles.length; i++) {
      const s = this.textStyles[i];
      let textProps = "";

      if (s.bold) textProps += ` fo:font-weight="bold"`;
      if (s.italic) textProps += ` fo:font-style="italic"`;
      if (s.underline) textProps += ` style:text-underline-style="solid"`;
      if (s.strike) textProps += ` style:text-line-through-style="solid"`;
      if (s.fontSizePt) textProps += ` fo:font-size="${s.fontSizePt}pt"`;
      if (s.color) textProps += ` fo:color="${s.color}"`;
      if (s.fontFamily) textProps += ` style:font-name="${escapeXml(s.fontFamily)}"`;

      xml += `    <style:style style:name="T${i + 1}" style:family="text">\n`;
      xml += `      <style:text-properties${textProps}/>\n`;
      xml += `    </style:style>\n`;
    }

    // Paragraph Styles
    for (let i = 0; i < this.paraStyles.length; i++) {
      const p = this.paraStyles[i];
      let paraProps = "";

      if (p.align) {
        let alignVal = "start";
        if (p.align === "center") alignVal = "center";
        else if (p.align === "right") alignVal = "end";
        else if (p.align === "justify") alignVal = "justify";
        paraProps += ` fo:text-align="${alignVal}"`;
      }
      if (p.marginTopPt) paraProps += ` fo:margin-top="${p.marginTopPt}pt"`;
      if (p.marginBottomPt) paraProps += ` fo:margin-bottom="${p.marginBottomPt}pt"`;
      if (p.marginLeftPt) paraProps += ` fo:margin-left="${p.marginLeftPt}pt"`;
      if (p.marginRightPt) paraProps += ` fo:margin-right="${p.marginRightPt}pt"`;
      if (p.lineSpacingPercent) paraProps += ` fo:line-height="${p.lineSpacingPercent}%"`;

      xml += `    <style:style style:name="P${i + 1}" style:family="paragraph">\n`;
      xml += `      <style:paragraph-properties${paraProps}/>\n`;
      xml += `    </style:style>\n`;
    }

    return xml;
  }

  private renderBody(elements: DocxBlockElement[]): string {
    let xml = "";
    for (const el of elements) {
      if (el.type === "paragraph") {
        xml += this.renderParagraph(el);
      } else if (el.type === "table") {
        xml += this.renderTable(el);
      }
    }
    return xml;
  }

  private renderParagraph(p: DocxParagraph): string {
    const styleName = this.getParaStyleName(p.style);
    let runsXml = "";

    for (const child of p.children) {
      if (child.type === "run") {
        const textStyle = this.getTextStyleName(child.style);
        runsXml += `<text:span text:style-name="${textStyle}">${escapeXml(child.text)}</text:span>`;
      } else if (child.type === "break") {
        runsXml += `<text:line-break/>`;
      }
    }

    return `      <text:p text:style-name="${styleName}">${runsXml}</text:p>\n`;
  }

  private renderTable(t: DocxTable): string {
    let xml = `      <table:table table:name="Table">\n`;

    for (const row of t.rows) {
      xml += `        <table:table-row>\n`;
      for (const cell of row.cells) {
        const spanAttr = cell.colSpan && cell.colSpan > 1 ? ` table:number-columns-spanned="${cell.colSpan}"` : "";
        xml += `          <table:table-cell${spanAttr}>\n`;
        for (const p of cell.paragraphs) {
          xml += this.renderParagraph(p);
        }
        xml += `          </table:table-cell>\n`;
      }
      xml += `        </table:table-row>\n`;
    }

    xml += `      </table:table>\n`;
    return xml;
  }
}
