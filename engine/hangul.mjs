import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { HwpDocument, initSync } from '@rhwp/core';
import { installRhwpCanvasHost } from './native.mjs';
import { checkCancelled, resultName } from './files.mjs';
import { parsePages } from './pdf.mjs';
import { HanDoc, docxToHwpx, hwpxToDocx } from '../vendor/handoc.mjs';
import { docxBytesToMarkdown } from './markdown.mjs';

let initialized = false;
export async function loadHangul(bytes) {
  if (!initialized) {
    installRhwpCanvasHost();
    const wasm = new URL('./rhwp_bg.wasm', import.meta.resolve('@rhwp/core'));
    initSync({ module: await fs.readFile(wasm) });
    initialized = true;
  }
  return new HwpDocument(new Uint8Array(bytes));
}

function fontPath(family, bold, italic) {
  const root = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const gothic = /고딕|돋움|굴림|gothic|dotum|gulim|sans|arial|segoe/i.test(family);
  const candidates = gothic
    ? [bold ? 'malgunbd.ttf' : 'malgun.ttf']
    : [bold ? 'HANBatangB.ttf' : 'HANBatang.ttf', 'malgun.ttf'];
  return candidates.map((file) => path.join(root, file)).find(existsSync) ?? 'Helvetica';
}

async function renderPdf(document, output, title, pages, signal, onProgress) {
  const pdf = new PDFDocument({ autoFirstPage: false, font: fontPath('맑은 고딕', false, false), compress: true, info: { Title: title, Producer: 'Forma', Creator: 'Forma' } });
  const chunks = [];
  const bytes = new Promise((resolve, reject) => {
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  void bytes.catch(() => {});
  const warnings = new Set();
  try {
    for (let index = 0; index < pages.length; index++) {
      checkCancelled(signal);
      onProgress?.(`페이지 ${index + 1}/${pages.length} 처리 중`);
      const svg = document.renderPageSvgWithProfile(pages[index] - 1, 'print');
      const viewBox = svg.match(/\bviewBox="([\d.\s+-]+)"/i)?.[1].trim().split(/\s+/).map(Number);
      const width = viewBox?.[2] || Number(svg.match(/\bwidth="([\d.]+)/)?.[1]) || 793.7;
      const height = viewBox?.[3] || Number(svg.match(/\bheight="([\d.]+)/)?.[1]) || 1122.5;
      pdf.addPage({ size: [width * 0.75, height * 0.75], margin: 0 });
      SVGtoPDF(pdf, svg, 0, 0, {
        width: width * 0.75, height: height * 0.75, preserveAspectRatio: 'xMinYMin meet',
        fontCallback: fontPath,
        imageCallback: (link) => /^data:image\/(?:png|jpe?g|gif);base64,/i.test(link) ? link : undefined,
        warningCallback: (warning) => {
          if (/unsupported|not supported|failed|could not/i.test(warning)) warnings.add('일부 복잡한 도형은 원본과 다르게 보일 수 있습니다. 결과를 확인해 주세요.');
        },
      });
      // Worker cancellation arrives as a message; allow it to run between pages.
      await new Promise((resolve) => setImmediate(resolve));
    }
    pdf.end();
    await fs.writeFile(output, await bytes);
    checkCancelled(signal);
    return [...warnings];
  } catch (error) {
    pdf.destroy();
    throw error;
  }
}

function exportHwpx(document, warnings) {
  const result = document.exportHwpxWithReport();
  try {
    const report = JSON.parse(result.contentLoss());
    if (report?.hasLoss || report?.lossy || report?.entries?.length || report?.warnings?.length) warnings.push('한글 형식을 옮기면서 일부 개체의 표현이 달라질 수 있습니다. 결과를 확인해 주세요.');
    return result.takeBytes();
  } finally { result.free(); }
}

export async function convertHangul(source, format, options, directory, signal, onProgress) {
  checkCancelled(signal);
  const input = new Uint8Array(await fs.readFile(source));
  const output = path.join(directory, resultName(source, format));
  const extension = path.extname(source).toLowerCase();
  const warnings = [];
  const paths = [];
  if (extension === '.docx') {
    await fs.writeFile(output, await docxToHwpx(input));
    warnings.push('HWPX는 문단·표·그림을 기준으로 변환합니다. 복잡한 배치와 문단 안의 세부 서식은 달라질 수 있습니다.');
    checkCancelled(signal);
    return { paths: [output], warnings };
  }
  const document = await loadHangul(input);
  try {
    checkCancelled(signal);
    if (format === 'txt') {
      const raw = document.getTextFileText();
      let text = raw;
      try { const decoded = JSON.parse(raw); if (typeof decoded === 'string') text = decoded; } catch {}
      await fs.writeFile(output, '\ufeff' + text, 'utf8');
      paths.push(output);
    } else if (format === 'md') {
      const hwpx = extension === '.hwpx' ? input : exportHwpx(document, warnings);
      const converted = await docxBytesToMarkdown(await hwpxToDocx(hwpx), source, directory, signal, onProgress);
      paths.push(...converted.paths);
      warnings.push(...converted.warnings);
    } else if (format === 'pdf') {
      const pages = parsePages(options.pages, document.pageCount());
      warnings.push(...await renderPdf(document, output, path.parse(source).name, pages, signal, onProgress));
      paths.push(output);
    } else if (format === 'hwpx') {
      await fs.writeFile(output, exportHwpx(document, warnings));
      paths.push(output);
    } else if (format === 'docx') {
      const hwpx = extension === '.hwpx' ? input : exportHwpx(document, warnings);
      const parsed = await HanDoc.open(hwpx);
      if (parsed.equations?.length || parsed.shapes?.length) warnings.push('일부 수식·도형은 DOCX에서 생략되거나 다르게 표시될 수 있습니다. PDF로도 저장해 원본과 비교해 주세요.');
      await fs.writeFile(output, await hwpxToDocx(hwpx));
      warnings.push('한글과 Word의 쪽 나눔·글꼴이 달라질 수 있습니다. 변환한 문서를 확인해 주세요.');
      paths.push(output);
    } else throw new Error('한글 문서의 출력 형식을 확인해 주세요.');
    checkCancelled(signal);
    return { paths, warnings: [...new Set(warnings)] };
  } finally { document.free(); }
}
