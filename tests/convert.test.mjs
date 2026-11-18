import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import bmp from 'bmp-js';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { convertFile } from '../engine/convert.mjs';
import { loadHangul } from '../engine/hangul.mjs';
import { openPdf, parsePages } from '../engine/pdf.mjs';
import { createFixtures } from './fixtures.mjs';

let directory, fixtures;
before(async () => {
  await fs.mkdir(path.resolve('output'), { recursive: true });
  directory = await fs.mkdtemp(path.resolve('output/engine-check-'));
  fixtures = await createFixtures(path.join(directory, '원본 파일'));
});

const run = (source, format, options = {}, extras = {}) => convertFile({ source, format, options, destination: path.join(directory, '변환 결과'), ...extras });

test('photos convert to real JPG, PNG, WEBP, AVIF and TIFF with correct dimensions', async () => {
  const original = await fs.readFile(fixtures.photo);
  for (const format of ['jpg', 'webp', 'avif', 'tiff']) {
    const { paths } = await run(fixtures.photo, format, { maxWidth: 120, quality: 85 });
    const meta = await sharp(paths[0]).metadata();
    assert.equal(meta.width, 120); assert.equal(meta.height, 80);
    assert.ok(meta.format === format || (format === 'jpg' && meta.format === 'jpeg') || (format === 'avif' && meta.format === 'heif'));
    const { paths: png } = await run(paths[0], 'png');
    assert.equal((await sharp(png[0]).metadata()).width, 120);
  }
  assert.deepEqual(await fs.readFile(fixtures.photo), original);
});

test('BMP, GIF and SVG input preserve color and open as PNG', async () => {
  const raw = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#ff0000' } }).ensureAlpha().raw().toBuffer();
  const abgr = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i += 4) { abgr[i] = 0; abgr[i + 1] = raw[i + 2]; abgr[i + 2] = raw[i + 1]; abgr[i + 3] = raw[i]; }
  const bitmap = path.join(directory, '빨간 사진.bmp');
  await fs.writeFile(bitmap, bmp.encode({ data: abgr, width: 24, height: 16 }).data);
  const { paths } = await run(bitmap, 'png');
  const pixel = await sharp(paths[0]).raw().toBuffer();
  assert.ok(pixel[0] > 240 && pixel[1] < 10 && pixel[2] < 10);
  const gif = path.join(directory, '사진.gif');
  await sharp(fixtures.photo).gif().toFile(gif);
  assert.ok((await fs.stat((await run(gif, 'png')).paths[0])).size > 0);
  const svg = path.join(directory, '도형.svg');
  await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><circle cx="25" cy="25" r="20" fill="blue"/></svg>');
  assert.equal((await sharp((await run(svg, 'png')).paths[0]).metadata()).width, 80);
});

test('photos create one-page PDF and a combined two-page PDF', async () => {
  const single = await run(fixtures.photo, 'pdf');
  assert.equal((await PDFDocument.load(await fs.readFile(single.paths[0]))).getPageCount(), 1);
  const merged = await run(fixtures.photo, 'pdf', {}, { sources: [fixtures.photo, fixtures.photo2], sourceOptions: [{ maxWidth: 100 }, {}] });
  assert.equal((await PDFDocument.load(await fs.readFile(merged.paths[0]))).getPageCount(), 2);
});

test('real HEIC and HEIF photos decode locally', async () => {
  const original = path.resolve('tests/fixtures/example.heic');
  const { paths } = await run(original, 'jpg');
  const metadata = await sharp(paths[0]).metadata();
  assert.equal(metadata.format, 'jpeg'); assert.ok(metadata.width > 100 && metadata.height > 100);
  const heif = path.join(directory, '아이폰 사진.heif');
  await fs.copyFile(original, heif);
  const png = await run(heif, 'png');
  assert.equal((await sharp(png.paths[0]).metadata()).width, metadata.width);
});

test('PDF page selection extracts real images and selected text', async () => {
  const png = await run(fixtures.pdf, 'png', { pages: '1, 3' });
  assert.equal(png.paths.length, 2);
  assert.equal(path.dirname(png.paths[0]), path.dirname(png.paths[1]));
  assert.match(path.basename(png.paths[1]), /003\.png$/);
  assert.ok((await sharp(png.paths[0]).metadata()).width > 800);
  const jpg = await run(fixtures.pdf, 'jpg', { pages: '2' });
  assert.equal((await sharp(jpg.paths[0]).metadata()).format, 'jpeg');
  const txt = await run(fixtures.pdf, 'txt', { pages: '2-3' });
  const text = await fs.readFile(txt.paths[0], 'utf8');
  assert.match(text, /Forma page 2/); assert.match(text, /Forma page 3/); assert.doesNotMatch(text, /Forma page 1/);
  assert.deepEqual(parsePages('3, 1-2, 2', 3), [1, 2, 3]);
  await assert.rejects(run(fixtures.pdf, 'png', { pages: '0-8' }), /페이지/);
});

test('HWPX to DOCX preserves Korean text, a real table and an embedded image', async () => {
  const { paths } = await run(fixtures.hwpx, 'docx');
  const zip = unzipSync(new Uint8Array(await fs.readFile(paths[0])));
  const xml = new TextDecoder().decode(zip['word/document.xml']);
  assert.match(xml, /한글 본문과 English 123/);
  assert.match(xml, /<w:tbl>/);
  assert.ok(Object.keys(zip).some((name) => name.startsWith('word/media/') && zip[name].length > 0), 'embedded image must survive');
});

test('DOCX to HWPX preserves Korean text, a table and an embedded image', async () => {
  const { paths } = await run(fixtures.docx, 'hwpx');
  const zip = unzipSync(new Uint8Array(await fs.readFile(paths[0])));
  const sections = Object.keys(zip).filter((name) => /section\d+\.xml$/.test(name)).map((name) => new TextDecoder().decode(zip[name])).join('');
  assert.match(sections, /한글 본문과 English 123/); assert.match(sections, /<(?:hp:)?tbl\b/);
  assert.ok(Object.keys(zip).some((name) => /^(?:Contents\/)?BinData\//.test(name)), 'embedded image must survive');
  const document = await loadHangul(await fs.readFile(paths[0]));
  assert.ok(document.pageCount() > 0); document.free();
});

test('HWP and HWPX create readable text without JSON escapes', async () => {
  for (const [source, expected] of [[fixtures.hwpx, 'Forma 변환 확인'], [path.resolve('vendor/jhwpx-converter/samples/sample_basic.hwp'), '리포트의 제목']]) {
    const { paths } = await run(source, 'txt');
    const text = await fs.readFile(paths[0], 'utf8');
    assert.match(text, new RegExp(expected));
    assert.ok(!text.includes('\\r\\n'), 'line breaks must be real, not JSON escapes');
    assert.ok(!text.replace(/^\ufeff/, '').startsWith('"'), 'text must not be JSON quoted');
  }
});

test('HWP converts to HWPX and DOCX with Korean body text', async () => {
  const source = path.resolve('vendor/jhwpx-converter/samples/sample_basic.hwp');
  const hwpx = await run(source, 'hwpx');
  const document = await loadHangul(await fs.readFile(hwpx.paths[0]));
  assert.match(document.getTextFileText(), /리포트의 제목/); document.free();
  const docx = await run(source, 'docx');
  const zip = unzipSync(new Uint8Array(await fs.readFile(docx.paths[0])));
  assert.match(new TextDecoder().decode(zip['word/document.xml']), /리포트의 제목/);
});

test('PDF output fits the chosen paper size while keeping page orientation', async () => {
  const a3 = await run(fixtures.photo, 'pdf', { pageSize: 'a3' });
  assert.match(a3.warnings.join(' '), /PDF 용지 크기를 A3/);
  const a3Document = await PDFDocument.load(await fs.readFile(a3.paths[0]));
  const a3Size = a3Document.getPage(0).getSize();
  assert.ok(Math.abs(a3Size.width - 1190.55) < 1.5 && Math.abs(a3Size.height - 841.89) < 1.5, JSON.stringify(a3Size));
  assert.equal(a3Document.getPageCount(), 1);

  const b4 = await run(fixtures.hwpx, 'pdf', { pageSize: 'b4' });
  const b4Document = await PDFDocument.load(await fs.readFile(b4.paths[0]));
  const b4Size = b4Document.getPage(0).getSize();
  assert.ok(Math.abs(Math.min(b4Size.width, b4Size.height) - 728.5) < 1.5 && Math.abs(Math.max(b4Size.width, b4Size.height) - 1031.8) < 1.5, JSON.stringify(b4Size));

  const original = await run(fixtures.photo, 'pdf', { pageSize: 'a4' });
  assert.ok(!original.warnings.some((warning) => warning.includes('PDF 용지 크기를')), 'matching paper sizes need no rewrite');
  await assert.rejects(run(fixtures.photo, 'pdf', { pageSize: 'a2' }), /용지/);
});

test('HWPX and HWP PDFs contain searchable Korean text and render', async () => {
  for (const source of [fixtures.hwpx, path.resolve('vendor/jhwpx-converter/samples/sample_basic.hwp')]) {
    const { paths } = await run(source, 'pdf');
    const document = await openPdf(paths[0]);
    try {
      assert.ok(document.numPages >= 1);
      let text = '';
      for (let i = 1; i <= document.numPages; i++) { const page = await document.getPage(i); text += (await page.getTextContent()).items.map((item) => item.str ?? '').join(''); page.cleanup(); }
      assert.match(text, source === fixtures.hwpx ? /한글 본문과 English 123/ : /리포트/);
    } finally { await document.loadingTask.destroy(); }
    const raster = await run(paths[0], 'png', { pages: '1' });
    assert.ok((await sharp(raster.paths[0]).metadata()).width > 500);
  }
});

test('Word documents become Markdown with headings, emphasis, lists, links, tables and images', async () => {
  const { paths } = await run(fixtures.markdownDoc, 'md');
  const markdown = await fs.readFile(paths[0], 'utf8');
  assert.match(markdown, /^# 문서 개요/m);
  assert.match(markdown, /^## 세부 항목/m);
  assert.match(markdown, /\*\*굵은 글씨\*\*와 \*기울임\* 그리고 \[링크\]\(https:\/\/example\.com\/forma\)/);
  assert.match(markdown, /^- 첫 번째 항목$/m);
  assert.match(markdown, /^- 두 번째 항목$/m);
  assert.match(markdown, /\| 항목 \| 값 \|/);
  assert.match(markdown, /\| 변환 \| 정상 \|/);
  assert.match(markdown, /!\[이미지\]\(image-1\.png\)/);
  const image = paths.find((file) => file.endsWith('.png'));
  assert.ok(image && (await fs.stat(image)).size > 0, 'referenced images must be written next to the Markdown file');
});

test('HWPX and HWP become Markdown with Korean text, tables and images', async () => {
  const hwpx = await run(fixtures.hwpx, 'md');
  const hwpxMarkdown = await fs.readFile(hwpx.paths[0], 'utf8');
  assert.match(hwpxMarkdown, /Forma 변환 확인/);
  assert.match(hwpxMarkdown, /한글 본문과 English 123/);
  assert.match(hwpxMarkdown, /\| 항목 \| 값 \|/);
  assert.match(hwpxMarkdown, /!\[이미지\]\(image-1\.png\)/);
  assert.ok(hwpx.paths.some((file) => file.endsWith('.png')));
  const hwp = await run(path.resolve('vendor/jhwpx-converter/samples/sample_basic.hwp'), 'md');
  assert.match(await fs.readFile(hwp.paths[0], 'utf8'), /리포트의 제목/);
});

test('PDF and plain text become Markdown', async () => {
  const pdf = await run(fixtures.pdf, 'md', { pages: '2-3' });
  const markdown = await fs.readFile(pdf.paths[0], 'utf8');
  assert.match(markdown, /Forma page 2/); assert.match(markdown, /Forma page 3/);
  assert.doesNotMatch(markdown, /Forma page 1/);
  const memo = await run(fixtures.memo, 'md');
  assert.equal(await fs.readFile(memo.paths[0], 'utf8'), '첫 문단입니다.\n\n둘째 문단입니다.\n');
});

test('PDF pages can be resized to another paper size', async () => {
  const result = await run(fixtures.pdf, 'pdf', { pageSize: 'b4' });
  assert.match(result.warnings.join(' '), /PDF 용지 크기를 B4/);
  const document = await PDFDocument.load(await fs.readFile(result.paths[0]));
  assert.equal(document.getPageCount(), 3);
  const size = document.getPage(0).getSize();
  assert.ok(Math.abs(Math.min(size.width, size.height) - 728.5) < 1.5 && Math.abs(Math.max(size.width, size.height) - 1031.8) < 1.5, JSON.stringify(size));
  const opened = await openPdf(result.paths[0]);
  try {
    let text = '';
    for (let page = 1; page <= opened.numPages; page++) {
      const current = await opened.getPage(page);
      text += (await current.getTextContent()).items.map((item) => item.str ?? '').join('');
      current.cleanup();
    }
    assert.match(text, /Forma page 1/);
  } finally { await opened.loadingTask.destroy(); }
  const original = await fs.readFile(fixtures.pdf);
  const copy = await run(fixtures.pdf, 'pdf');
  assert.equal((await PDFDocument.load(await fs.readFile(copy.paths[0]))).getPageCount(), 3);
  assert.deepEqual(await fs.readFile(fixtures.pdf), original, 'resizing must never modify the source PDF');
});

test('PDF input offers PDF output for paper size changes', async () => {
  const { getFormatInfo } = await import('../engine/catalog.mjs');
  assert.ok(getFormatInfo('문서.pdf').outputs.includes('pdf'));
});

test('Markdown output is listed for documents but not photos', async () => {
  const { getFormatInfo } = await import('../engine/catalog.mjs');
  for (const name of ['문서.hwp', '문서.hwpx', '문서.docx', '문서.doc', '문서.rtf', '문서.odt', '문서.txt', '문서.pdf']) {
    assert.ok(getFormatInfo(name).outputs.includes('md'), `${name} must offer Markdown`);
  }
  assert.ok(!getFormatInfo('사진.png').outputs.includes('md'));
});

test('broken input fails without creating a successful empty result', async () => {
  const broken = path.join(directory, '손상된 파일.png');
  await fs.writeFile(broken, 'this is not a photo');
  await assert.rejects(run(broken, 'jpg'), /변환하지 못/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(fixtures.photo, 'jpg', {}, { signal: controller.signal }), { name: 'AbortError' });
});

test('Hangul PDF cancellation is handled between pages', async () => {
  const controller = new AbortController();
  let rendered = 0;
  await assert.rejects(convertFile({ source: path.resolve('vendor/jhwpx-converter/samples/sample_basic.hwp'), format: 'pdf', options: {}, destination: path.join(directory, '취소된 결과'), signal: controller.signal }, (phase) => {
    if (phase.startsWith('페이지')) { rendered++; setImmediate(() => controller.abort()); }
  }), { name: 'AbortError' });
  assert.equal(rendered, 1, 'cancellation must be received before rendering the next page');
});
