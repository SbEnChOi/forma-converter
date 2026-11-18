import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, HeadingLevel, ExternalHyperlink } from 'docx';
import { HwpxBuilder } from '../vendor/handoc.mjs';

export async function createFixtures(directory) {
  await fs.mkdir(directory, { recursive: true });
  const image = await sharp({ create: { width: 240, height: 160, channels: 4, background: '#3267f6' } }).composite([{ input: Buffer.from('<svg width="240" height="160"><rect x="24" y="24" width="80" height="80" rx="18" fill="#f7b950"/></svg>') }]).png().toBuffer();
  const photo = path.join(directory, '여행 사진 원본.png');
  await fs.writeFile(photo, image);
  const photo2 = path.join(directory, '두 번째 사진.jpg');
  await sharp(image).jpeg().toFile(photo2);
  const hwpx = path.join(directory, '한글 표와 그림.hwpx');
  const hwpxBytes = HwpxBuilder.create()
    .addHeading(1, 'Forma 변환 확인')
    .addParagraph('한글 본문과 English 123을 확인합니다.', { fontFamily: '맑은 고딕', fontSize: 12 })
    .addTable([['항목', '값'], ['변환', '정상']])
    .addImage(new Uint8Array(image), 'png', 14400, 9600)
    .addSectionBreak().addParagraph('두 번째 구역의 본문입니다.').build();
  await fs.writeFile(hwpx, hwpxBytes);
  const docx = path.join(directory, '워드 표와 그림.docx');
  const document = new Document({
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'Forma 한글 테스트', bold: true })] }),
      new Paragraph('한글 본문과 English 123을 확인합니다.'),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('항목')] }), new TableCell({ children: [new Paragraph('값')] })] }), new TableRow({ children: [new TableCell({ children: [new Paragraph('변환')] }), new TableCell({ children: [new Paragraph('정상')] })] })] }),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: image, transformation: { width: 240, height: 160 } })] }),
    ] }],
  });
  await fs.writeFile(docx, await Packer.toBuffer(document));
  const markdownDoc = path.join(directory, 'Markdown 문서.docx');
  const markdownDocument = new Document({
    sections: [{ children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('문서 개요')] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('세부 항목')] }),
      new Paragraph({ children: [
        new TextRun({ text: '굵은 글씨', bold: true }),
        new TextRun('와 '),
        new TextRun({ text: '기울임', italics: true }),
        new TextRun(' 그리고 '),
        new ExternalHyperlink({ link: 'https://example.com/forma', children: [new TextRun('링크')] }),
      ] }),
      new Paragraph({ text: '첫 번째 항목', bullet: { level: 0 } }),
      new Paragraph({ text: '두 번째 항목', bullet: { level: 0 } }),
      new Table({ rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('항목')] }), new TableCell({ children: [new Paragraph('값')] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('변환')] }), new TableCell({ children: [new Paragraph('정상')] })] }),
      ] }),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: image, transformation: { width: 120, height: 80 } })] }),
    ] }],
  });
  await fs.writeFile(markdownDoc, await Packer.toBuffer(markdownDocument));
  const memo = path.join(directory, '메모.txt');
  await fs.writeFile(memo, '첫 문단입니다.\n\n둘째 문단입니다.\n', 'utf8');
  const pdf = path.join(directory, '세 페이지.pdf');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page++) pdfDoc.addPage([400, 300]).drawText(`Forma page ${page}`, { x: 30, y: 210, font, size: 24 });
  await fs.writeFile(pdf, await pdfDoc.save());
  return { photo, photo2, hwpx, docx, pdf, markdownDoc, memo };
}
