/**
 * HwpDocument IR → HWPX/Text 변환기.
 */

import { buildHwpxFromDocument } from "./hwpxBuilder.js";
import type { HwpDocument, HwpParagraph } from "./types.js";

export interface HwpToTextOptions {
  paragraphSeparator?: string;
  sectionSeparator?: string;
}

export function hwpDocumentToText(doc: HwpDocument, options?: HwpToTextOptions): string {
  const paraSep = options?.paragraphSeparator ?? "\n";
  const sectSep = options?.sectionSeparator ?? "\n\n";
  return doc.sections
    .map((s) => s.paragraphs.map((p) => flattenParagraphText(p)).join(paraSep))
    .join(sectSep);
}

function flattenParagraphText(p: HwpParagraph): string {
  const parts: string[] = [];
  if (p.text.length > 0) parts.push(p.text);
  for (const ctrl of p.controls) {
    if (ctrl.kind === "table") {
      const cellTexts = ctrl.cells.map((cell) =>
        cell.paragraphs.map((q) => flattenParagraphText(q)).join("\n")
      );
      parts.push(cellTexts.join("\n"));
    } else if (
      ctrl.kind === "header" ||
      ctrl.kind === "footer" ||
      ctrl.kind === "footnote"
    ) {
      parts.push(ctrl.paragraphs.map((q) => flattenParagraphText(q)).join("\n"));
    } else if (ctrl.kind === "equation" && ctrl.script.length > 0) {
      parts.push(ctrl.script);
    }
  }
  return parts.join("\n");
}

export interface HwpToHwpxOptions {
  title?: string;
  creator?: string;
}

export async function hwpDocumentToHwpx(
  doc: HwpDocument,
  options?: HwpToHwpxOptions
): Promise<Uint8Array> {
  return await buildHwpxFromDocument(doc, options);
}
