import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import bmp from 'bmp-js';
import { PDFDocument } from 'pdf-lib';
import { checkCancelled, resultName } from './files.mjs';

const pixelLimit = 100_000_000;
sharp.concurrency(2);
sharp.cache({ memory: 64, files: 0, items: 50 });

export async function openImage(source) {
  const extension = path.extname(source).toLowerCase();
  if (['.heic', '.heif'].includes(extension)) {
    const { default: convert } = await import('heic-convert');
    const input = await fs.readFile(source);
    const result = await convert({ buffer: input, format: 'PNG' });
    return sharp(Buffer.from(result), { limitInputPixels: pixelLimit });
  }
  if (extension === '.bmp') {
    const data = await fs.readFile(source);
    if (data.length < 54 || data.toString('ascii', 0, 2) !== 'BM') throw new Error('올바른 BMP 사진이 아닙니다.');
    const width = data.readInt32LE(18), height = Math.abs(data.readInt32LE(22));
    if (width < 1 || height < 1 || width * height > pixelLimit) throw new Error('사진이 너무 큽니다. 1억 픽셀 이하의 사진을 선택해 주세요.');
    const decoded = bmp.decode(data);
    const rgba = Buffer.alloc(decoded.width * decoded.height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = decoded.data[i + 3]; rgba[i + 1] = decoded.data[i + 2];
      rgba[i + 2] = decoded.data[i + 1]; rgba[i + 3] = 255;
    }
    return sharp(rgba, { raw: { width: decoded.width, height: decoded.height, channels: 4 }, limitInputPixels: pixelLimit });
  }
  return sharp(source, { failOn: 'error', limitInputPixels: pixelLimit, page: 0 });
}

function prepare(pipeline, options) {
  return pipeline.rotate().resize({
    width: options.maxWidth || undefined, height: options.maxHeight || undefined,
    fit: 'inside', withoutEnlargement: true,
  }).toColourspace('srgb');
}

export async function convertImage(source, format, options, directory, signal) {
  checkCancelled(signal);
  const image = await openImage(source);
  const metadata = await image.metadata();
  const warnings = [];
  if (metadata.pages > 1) warnings.push('여러 프레임·페이지 중 첫 번째 이미지를 변환했습니다.');
  const output = path.join(directory, resultName(source, format));
  const quality = options.quality ?? 90;
  let pipeline = prepare(image, options);
  if (format === 'pdf') return imagesToPdf([source], options, directory, signal);
  if (format === 'jpg') pipeline = pipeline.flatten({ background: options.background ?? '#ffffff' }).jpeg({ quality, mozjpeg: true });
  else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 8 });
  else if (format === 'webp') pipeline = pipeline.webp({ quality, effort: 4 });
  else if (format === 'avif') pipeline = pipeline.avif({ quality, effort: 3 });
  else if (format === 'tiff') pipeline = pipeline.tiff({ quality, compression: 'lzw' });
  else throw new Error('이 사진의 출력 형식을 확인해 주세요.');
  await pipeline.toFile(output);
  checkCancelled(signal);
  return { paths: [output], warnings };
}

export async function imagesToPdf(sources, options, directory, signal, onProgress, sourceOptions) {
  const document = await PDFDocument.create();
  document.setProducer('Forma');
  document.setTitle(sources.length === 1 ? path.parse(sources[0]).name : '사진 모음');
  const warnings = new Set();
  for (let index = 0; index < sources.length; index++) {
    checkCancelled(signal);
    onProgress?.(`사진 ${index + 1}/${sources.length} 처리 중`);
    const image = await openImage(sources[index]);
    const metadata = await image.metadata();
    const imageOptions = sourceOptions?.[index] ?? options;
    if (metadata.pages > 1) warnings.add('여러 프레임·페이지가 있는 사진은 첫 번째 이미지를 사용했습니다.');
    const bytes = await prepare(image, imageOptions).flatten({ background: imageOptions.background ?? '#ffffff' }).jpeg({ quality: imageOptions.quality ?? 90 }).toBuffer();
    const embedded = await document.embedJpg(bytes);
    const landscape = embedded.width > embedded.height;
    const [width, height] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    const page = document.addPage([width, height]);
    const ratio = Math.min((width - 48) / embedded.width, (height - 48) / embedded.height);
    const drawWidth = embedded.width * ratio, drawHeight = embedded.height * ratio;
    page.drawImage(embedded, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
  }
  checkCancelled(signal);
  const output = path.join(directory, sources.length === 1 ? resultName(sources[0], 'pdf') : '사진 모음.pdf');
  await fs.writeFile(output, await document.save());
  return { paths: [output], warnings: [...warnings] };
}

export async function makeThumbnail(source) {
  try {
    const ext = path.extname(source).toLowerCase();
    if (['.heic', '.heif', '.bmp'].includes(ext)) return undefined;
    const bytes = await sharp(source, { failOn: 'error', limitInputPixels: pixelLimit, page: 0 }).rotate().resize(96, 96, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#f2f2f4' }).jpeg({ quality: 65 }).toBuffer();
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch { return undefined; }
}
