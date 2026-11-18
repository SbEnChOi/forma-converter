import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeCanvas, createCanvas } from './native.mjs';
import { checkCancelled, resultName, safeStem } from './files.mjs';

let pdfModule;
export async function openPdf(source) {
  initializeCanvas();
  pdfModule ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const resource = (name) => path.join(root, name).replace(/\\/g, '/') + '/';
  const data = new Uint8Array(await fs.readFile(source));
  return pdfModule.getDocument({
    data, isEvalSupported: false, enableXfa: false, useSystemFonts: true,
    useWorkerFetch: false, standardFontDataUrl: resource('standard_fonts'),
    cMapUrl: resource('cmaps'), cMapPacked: true,
    wasmUrl: resource('wasm'),
    verbosity: 0,
  }).promise;
}

export function parsePages(value, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('PDF에 페이지가 없습니다.');
  if (!value || !value.trim()) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of value.replace(/\s/g, '').split(',')) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error('페이지는 1-3, 5처럼 입력해 주세요.');
    const [first, last = first] = part.split('-').map(Number);
    if (first < 1 || last < first || last > pageCount) throw new Error(`페이지 범위는 1부터 ${pageCount} 사이여야 합니다.`);
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export async function convertPdf(source, format, options, directory, signal, onProgress) {
  const document = await openPdf(source);
  try {
    if (format === 'pdf') {
      checkCancelled(signal);
      onProgress?.('PDF 확인 중');
      if (!document.numPages) throw new Error('PDF에 페이지가 없습니다.');
      const output = path.join(directory, resultName(source, 'pdf'));
      await fs.copyFile(source, output);
      checkCancelled(signal);
      return { paths: [output], warnings: [] };
    }
    const pages = parsePages(options.pages, document.numPages);
    const paths = [], text = [], markdownPages = [];
    for (let index = 0; index < pages.length; index++) {
      checkCancelled(signal);
      onProgress?.(`페이지 ${index + 1}/${pages.length} 처리 중`);
      const number = pages[index], page = await document.getPage(number);
      try {
        if (format === 'txt' || format === 'md') {
          const content = await page.getTextContent();
          if (format === 'txt') {
            text.push(content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim());
          } else {
            const lines = content.items
              .map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')
              .join('')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);
            markdownPages.push(lines.join('\n'));
          }
        } else {
          const viewport = page.getViewport({ scale: 150 / 72 });
          if (viewport.width * viewport.height > 100_000_000) throw new Error('PDF 페이지가 너무 큽니다. 작은 페이지로 나눈 뒤 다시 시도해 주세요.');
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          const render = page.render({ canvasContext: context, canvas, viewport, intent: 'print', background: options.background ?? '#ffffff' });
          const abort = () => render.cancel();
          signal?.addEventListener('abort', abort, { once: true });
          try { await render.promise; }
          finally { signal?.removeEventListener('abort', abort); }
          checkCancelled(signal);
          const output = path.join(directory, `${safeStem(source)}_${String(number).padStart(3, '0')}.${format}`);
          const bytes = format === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg', options.quality ?? 90);
          await fs.writeFile(output, bytes);
          canvas.width = 1; canvas.height = 1;
          paths.push(output);
        }
      } finally { page.cleanup(); }
    }
    if (format === 'txt') {
      const output = path.join(directory, resultName(source, 'txt'));
      const content = text.join('\n\n');
      if (!content.trim()) throw new Error('텍스트를 찾지 못했습니다. 스캔 PDF는 사진으로 변환해 주세요.');
      await fs.writeFile(output, '\ufeff' + content, 'utf8');
      paths.push(output);
    }
    if (format === 'md') {
      const output = path.join(directory, resultName(source, 'md'));
      const content = markdownPages.filter(Boolean).join('\n\n');
      if (!content.trim()) throw new Error('텍스트를 찾지 못했습니다. 스캔 PDF는 사진으로 변환해 주세요.');
      await fs.writeFile(output, content + '\n', 'utf8');
      paths.push(output);
    }
    return { paths, warnings: format === 'md' ? ['PDF에는 제목·목록 구조 정보가 없어 글자만 옮겼습니다. 스캔 PDF의 문자 인식(OCR)은 지원하지 않습니다.'] : [] };
  } finally { await document.loadingTask.destroy(); }
}
