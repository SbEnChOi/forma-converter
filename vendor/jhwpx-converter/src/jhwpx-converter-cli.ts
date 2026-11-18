#!/usr/bin/env node
import { convertFileAuto } from "./converter.js";
import * as fs from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
jhwpx-converter - Unified Document Converter (HWP / HWPX / DOCX / ODT)

Usage:
  jhwpx-converter <input-file> [output-file]

Supported Formats:
  - HWP  (한글 5.0 바이너리)
  - HWPX (한글 표준 개방형 문서 OWPML)
  - DOCX (Microsoft Word Office Open XML)
  - ODT  (OpenOffice / LibreOffice OpenDocument Text)

Examples:
  jhwpx-converter report.docx              # report.hwpx 생성
  jhwpx-converter report.hwpx              # report.docx 생성
  jhwpx-converter report.docx report.odt   # DOCX -> ODT 변환
  jhwpx-converter document.odt             # document.hwpx 생성
  jhwpx-converter old_doc.hwp output.odt   # HWP -> ODT 변환
`);
    process.exit(0);
  }

  const inputFile = args[0];
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  const outputFile = args[1] && !args[1].startsWith("-") ? args[1] : undefined;

  console.log(`Processing: ${inputFile}...`);
  const startTime = Date.now();

  try {
    const finalOutput = await convertFileAuto(inputFile, outputFile);
    const elapsed = Date.now() - startTime;
    console.log(`Success! Created: ${finalOutput} (${elapsed}ms)`);
  } catch (err: any) {
    console.error(`Failed to convert: ${err?.message || err}`);
    process.exit(1);
  }
}

main();
