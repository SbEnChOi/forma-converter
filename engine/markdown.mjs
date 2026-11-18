import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocx } from '../vendor/handoc.mjs';
import { checkCancelled, resultName } from './files.mjs';

const imageExtensions = { png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', bmp: 'bmp', svg: 'svg', webp: 'webp' };
const mimeExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

function headingLevel(styleId) {
  if (!styleId) return 0;
  const value = styleId.trim();
  if (/^(?:title|제목)$/i.test(value)) return 1;
  const match = value.match(/^(?:heading|제목)\s*([1-6])$/i);
  return match ? Number(match[1]) : 0;
}

function sameStyle(first = {}, second = {}) {
  return Boolean(first.bold) === Boolean(second.bold)
    && Boolean(first.italic) === Boolean(second.italic)
    && Boolean(first.strike) === Boolean(second.strike)
    && Boolean(first.underline) === Boolean(second.underline);
}

/** Adjacent runs with the same formatting become one span, not `**a****b**`. */
function mergeRuns(runs) {
  const merged = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && !previous.image && !run.image && previous.link === run.link && sameStyle(previous.style, run.style)) {
      previous.text += run.text;
    } else {
      merged.push({ ...run, style: { ...run.style } });
    }
  }
  return merged;
}

function emphasize(text, style = {}) {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, leading, core, trailing] = match;
  if (!core) return text;
  let value = core;
  if (style.strike) value = `~~${value}~~`;
  if (style.italic) value = `*${value}*`;
  if (style.bold) value = `**${value}**`;
  return leading + value + trailing;
}

class Images {
  constructor(warnings) {
    this.warnings = warnings;
    this.byPath = new Map();
    this.items = [];
  }

  add(image) {
    if (this.byPath.has(image.path)) return this.byPath.get(image.path);
    const extension = imageExtensions[path.extname(image.path).slice(1).toLowerCase()] ?? mimeExtensions[image.mimeType];
    if (!extension) {
      this.warnings.add('Markdown에 넣을 수 없는 그림(EMF·WMF 등)은 건너뛰었습니다.');
      this.byPath.set(image.path, null);
      return null;
    }
    const name = `image-${this.items.length + 1}.${extension}`;
    this.byPath.set(image.path, name);
    this.items.push({ name, data: image.data });
    return name;
  }
}

function inlineText(runs, images) {
  const parts = [];
  for (const run of mergeRuns(runs)) {
    if (run.image) {
      const name = images.add(run.image);
      if (name) parts.push(`![이미지](${name})`);
    }
    if (!run.text) continue;
    let text = run.text.replace(/\r\n?/g, '\n');
    if (!text) continue;
    text = emphasize(text, run.style);
    if (run.link) text = `[${text}](${run.link.replace(/\s/g, '%20')})`;
    parts.push(text);
  }
  return parts.join('');
}

function paragraphMarkdown(paragraph, images) {
  const text = inlineText(paragraph.runs, images).trim();
  if (!text) return '';
  const level = paragraph.headingLevel ?? headingLevel(paragraph.styleId);
  if (level) return `${'#'.repeat(level)} ${text.replace(/\n+/g, ' ')}`;
  if (paragraph.numPr) {
    const level = Math.max(0, Math.min(8, paragraph.numPr.ilvl || 0));
    return `${'  '.repeat(level)}- ${text.replace(/\n+/g, ' ')}`;
  }
  return text.replace(/\n/g, '  \n');
}

function cellText(cell, images) {
  return cell.paragraphs
    .map((paragraph) => inlineText(paragraph.runs, images).trim())
    .filter(Boolean)
    .join('<br>')
    .replace(/\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function tableMarkdown(table, images, warnings) {
  const rows = [];
  for (const row of table.rows) {
    const cells = [];
    for (const cell of row.cells) {
      if ((cell.gridSpan ?? 1) > 1 || cell.vMerge) warnings.add('병합된 표는 칸을 나눈 단순한 표로 바뀝니다. 결과를 확인해 주세요.');
      cells.push(cellText(cell, images));
      for (let index = 1; index < (cell.gridSpan ?? 1); index++) cells.push('');
    }
    rows.push(cells);
  }
  if (!rows.length) return '';
  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (cells) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function renderDocument(parsed) {
  const warnings = new Set(['Markdown에는 쪽 나눔, 머리글·바닥글, 복잡한 도형·수식이 포함되지 않습니다.']);
  const images = new Images(warnings);
  const blocks = [];
  for (const entry of parsed.body) {
    const block = entry.type === 'table' ? tableMarkdown(entry.item, images, warnings) : paragraphMarkdown(entry.item, images);
    if (block) blocks.push(block);
  }
  const markdown = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!markdown) throw new Error('문서에서 옮길 내용을 찾지 못했습니다. 빈 문서인지 확인해 주세요.');
  return { markdown: markdown + '\n', images: images.items, warnings: [...warnings] };
}

async function writeMarkdown(source, directory, rendered, signal) {
  checkCancelled(signal);
  const markdownPath = path.join(directory, resultName(source, 'md'));
  await fs.writeFile(markdownPath, rendered.markdown, 'utf8');
  const paths = [markdownPath];
  for (const image of rendered.images) {
    const target = path.join(directory, image.name);
    await fs.writeFile(target, image.data);
    paths.push(target);
  }
  checkCancelled(signal);
  return { paths, warnings: rendered.warnings };
}

/** Convert DOCX bytes (from a real DOCX or HWPX→DOCX) into Markdown and extracted images. */
export async function docxBytesToMarkdown(bytes, source, directory, signal, onProgress) {
  checkCancelled(signal);
  let parsed;
  try { parsed = await parseDocx(bytes); }
  catch (error) { throw new Error('문서 구조를 읽지 못했습니다. 파일이 정상적으로 열리는지 확인해 주세요.', { cause: error }); }
  checkCancelled(signal);
  onProgress?.('Markdown으로 정리 중');
  return writeMarkdown(source, directory, renderDocument(parsed), signal);
}

export async function convertDocxToMarkdown(source, directory, signal, onProgress) {
  checkCancelled(signal);
  onProgress?.('문서 구조 읽는 중');
  const bytes = new Uint8Array(await fs.readFile(source));
  return docxBytesToMarkdown(bytes, source, directory, signal, onProgress);
}

function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('euc-kr').decode(bytes); }
}

export async function convertTextToMarkdown(source, directory, signal, onProgress) {
  checkCancelled(signal);
  onProgress?.('텍스트 읽는 중');
  const text = decodeText(await fs.readFile(source))
    .replace(/^\ufeff/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('텍스트를 찾지 못했습니다. 빈 파일인지 확인해 주세요.');
  checkCancelled(signal);
  const target = path.join(directory, resultName(source, 'md'));
  await fs.writeFile(target, text + '\n', 'utf8');
  return { paths: [target], warnings: [] };
}
