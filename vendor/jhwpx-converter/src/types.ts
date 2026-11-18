/**
 * docx2hwpx Intermediate Document Model
 */

export interface DocxCharStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSizePt?: number; // point 단위 (예: 10, 11, 12)
  fontFamily?: string;
  color?: string; // 6자리 hex (#RRGGBB)
  backgroundColor?: string;
}

export interface DocxParaStyle {
  align?: "left" | "center" | "right" | "justify";
  lineSpacingPercent?: number; // e.g. 160%
  marginTopPt?: number;
  marginBottomPt?: number;
  marginLeftPt?: number;
  marginRightPt?: number;
  firstLineIndentPt?: number;
}

export interface DocxRun {
  type: "run";
  text: string;
  style: DocxCharStyle;
}

export interface DocxBreak {
  type: "break";
  breakType: "line" | "page";
}

export interface DocxParagraph {
  type: "paragraph";
  style: DocxParaStyle;
  children: (DocxRun | DocxBreak)[];
}

export interface DocxTableCell {
  paragraphs: DocxParagraph[];
  colSpan?: number;
  rowSpan?: number;
  widthPt?: number;
  backgroundColor?: string;
}

export interface DocxTableRow {
  cells: DocxTableCell[];
  isHeader?: boolean;
}

export interface DocxTable {
  type: "table";
  rows: DocxTableRow[];
}

export type DocxBlockElement = DocxParagraph | DocxTable;

export interface DocxDocumentModel {
  title?: string;
  creator?: string;
  body: DocxBlockElement[];
}

export interface ConversionOptions {
  title?: string;
  creator?: string;
  defaultFont?: string;
  defaultFontSizePt?: number;
}
