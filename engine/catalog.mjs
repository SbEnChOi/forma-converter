import path from 'node:path';

const imageOutputs = ['jpg', 'png', 'webp', 'avif', 'tiff', 'pdf'];
export const pageSizeValues = Object.freeze(['original', 'a3', 'a4', 'a5', 'b4', 'b5', 'letter', 'legal']);
const definitions = {
  jpg: ['image', imageOutputs, 'png'], jpeg: ['image', imageOutputs, 'png'],
  png: ['image', imageOutputs, 'jpg'], webp: ['image', imageOutputs, 'png'],
  avif: ['image', imageOutputs, 'jpg'], tif: ['image', imageOutputs, 'png'],
  tiff: ['image', imageOutputs, 'png'], bmp: ['image', imageOutputs, 'png'],
  gif: ['image', imageOutputs, 'png'], heic: ['image', imageOutputs, 'jpg'],
  heif: ['image', imageOutputs, 'jpg'], svg: ['image', imageOutputs, 'png'],
  hwp: ['document', ['pdf', 'docx', 'hwpx', 'txt', 'md'], 'pdf'],
  hwpx: ['document', ['pdf', 'docx', 'txt', 'md'], 'pdf'],
  doc: ['document', ['pdf', 'docx', 'txt', 'html', 'md'], 'pdf'],
  docx: ['document', ['pdf', 'hwpx', 'txt', 'html', 'md'], 'pdf'],
  rtf: ['document', ['pdf', 'docx', 'txt', 'html', 'md'], 'pdf'],
  odt: ['document', ['pdf', 'docx', 'txt', 'html', 'md'], 'pdf'],
  txt: ['document', ['pdf', 'docx', 'html', 'md'], 'pdf'],
  xls: ['spreadsheet', ['pdf', 'xlsx', 'csv'], 'pdf'],
  xlsx: ['spreadsheet', ['pdf', 'csv'], 'pdf'],
  csv: ['spreadsheet', ['pdf', 'xlsx'], 'xlsx'],
  ppt: ['presentation', ['pdf', 'pptx', 'png', 'jpg'], 'pdf'],
  pptx: ['presentation', ['pdf', 'png', 'jpg'], 'pdf'],
  pdf: ['pdf', ['pdf', 'png', 'jpg', 'txt', 'docx', 'md'], 'png'],
};

export const supportedExtensions = Object.keys(definitions);
export const defaultSettings = Object.freeze({
  destination: null, quality: 90, maxWidth: null, maxHeight: null,
  background: '#ffffff', theme: 'system', combineImages: false, pageSize: 'original',
});

export function getFormatInfo(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  const definition = definitions[extension];
  if (!definition) return null;
  const [category, outputs, defaultOutput] = definition;
  const normalized = { jpeg: 'jpg', tif: 'tiff' }[extension] ?? extension;
  return { extension, category, outputs: outputs.filter((f) => f !== normalized || (extension === 'pdf' && f === 'pdf')), defaultOutput };
}

export function normalizeOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('변환 설정을 확인해 주세요.');
  const options = {};
  if (value.quality != null) {
    if (!Number.isInteger(value.quality) || value.quality < 1 || value.quality > 100) throw new Error('품질은 1부터 100 사이로 입력해 주세요.');
    options.quality = value.quality;
  }
  for (const key of ['maxWidth', 'maxHeight']) {
    if (value[key] == null || value[key] === '') continue;
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 20000) throw new Error('사진 크기는 1부터 20,000 픽셀 사이로 입력해 주세요.');
    options[key] = value[key];
  }
  if (value.background != null) {
    if (typeof value.background !== 'string' || !/^#[\da-f]{6}$/i.test(value.background)) throw new Error('배경색을 확인해 주세요.');
    options.background = value.background;
  }
  if (value.pages != null) {
    if (typeof value.pages !== 'string' || value.pages.length > 2000) throw new Error('페이지 범위를 확인해 주세요.');
    options.pages = value.pages.trim();
  }
  if (value.pageSize != null) {
    if (!pageSizeValues.includes(value.pageSize)) throw new Error('PDF 용지 크기를 확인해 주세요.');
    options.pageSize = value.pageSize;
  }
  return options;
}

export function normalizeSettings(value, current = defaultSettings) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('앱 설정을 확인해 주세요.');
  const next = { ...current };
  const options = normalizeOptions(value);
  Object.assign(next, options);
  for (const key of ['maxWidth', 'maxHeight']) if (value[key] === null) next[key] = null;
  if (value.theme != null) {
    if (!['system', 'light', 'dark'].includes(value.theme)) throw new Error('화면 모드를 확인해 주세요.');
    next.theme = value.theme;
  }
  if (value.combineImages != null) next.combineImages = value.combineImages === true;
  if ('destination' in value) {
    if (value.destination !== null && (typeof value.destination !== 'string' || !path.isAbsolute(value.destination))) throw new Error('저장 폴더를 다시 선택해 주세요.');
    next.destination = value.destination;
  }
  delete next.pages;
  return next;
}
