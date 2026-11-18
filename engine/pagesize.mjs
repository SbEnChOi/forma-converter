import { PDFDocument } from 'pdf-lib';
import { checkCancelled } from './files.mjs';

// Portrait short/long side in PDF points. B4/B5 use the Korean/Japanese 257×364 mm / 182×257 mm sizes.
const dimensions = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  b4: [728.5, 1031.8],
  b5: [515.91, 728.5],
  letter: [612, 792],
  legal: [612, 1008],
};
const labels = { a3: 'A3', a4: 'A4', a5: 'A5', b4: 'B4', b5: 'B5', letter: 'Letter', legal: 'Legal' };

export function pageSizeLabel(name) { return labels[name] ?? String(name).toUpperCase(); }

/** Fits every page into the chosen paper size, keeping the page's orientation and content ratio. */
export async function fitPdfToPageSize(bytes, pageSize, signal, onProgress) {
  const size = dimensions[pageSize];
  if (!size) return { bytes, changed: false };
  checkCancelled(signal);
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = source.getPages();
  if (!pages.length) return { bytes, changed: false };
  const targets = pages.map((page) => {
    const { width, height } = page.getSize();
    const landscape = width > height;
    const [targetWidth, targetHeight] = landscape ? [size[1], size[0]] : size;
    return {
      page, width, height, targetWidth, targetHeight,
      changed: Math.abs(width - targetWidth) > 1 || Math.abs(height - targetHeight) > 1,
    };
  });
  if (!targets.some((target) => target.changed)) return { bytes, changed: false };

  const output = await PDFDocument.create();
  const title = source.getTitle();
  if (title) output.setTitle(title);
  output.setProducer('Forma');
  output.setCreator('Forma');
  for (let index = 0; index < targets.length; index++) {
    checkCancelled(signal);
    onProgress?.(`PDF 용지 크기 맞추는 중 ${index + 1}/${targets.length}`);
    const target = targets[index];
    const embedded = await output.embedPage(target.page);
    const page = output.addPage([target.targetWidth, target.targetHeight]);
    const scale = Math.min(target.targetWidth / target.width, target.targetHeight / target.height);
    const width = target.width * scale, height = target.height * scale;
    page.drawPage(embedded, {
      x: (target.targetWidth - width) / 2,
      y: (target.targetHeight - height) / 2,
      width, height,
    });
  }
  checkCancelled(signal);
  return { bytes: await output.save(), changed: true };
}
