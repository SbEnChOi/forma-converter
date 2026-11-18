import { createCanvas, DOMMatrix, ImageData, Path2D, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

let initialized = false;
export function initializeCanvas() {
  if (initialized) return;
  const fonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const aliases = [
    ['malgun.ttf', '맑은 고딕'], ['malgun.ttf', 'Malgun Gothic'],
    ['malgunbd.ttf', '맑은 고딕 Bold'], ['HANBatang.ttf', '한컴바탕'],
    ['HANBatang.ttf', '함초롬바탕'], ['HANBatang.ttf', '바탕'],
  ];
  for (const [file, alias] of aliases) {
    const target = path.join(fonts, file);
    if (fs.existsSync(target)) GlobalFonts.registerFromPath(target, alias);
  }
  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.Path2D ??= Path2D;
  initialized = true;
}

export function installRhwpCanvasHost() {
  initializeCanvas();
  const sample = createCanvas(8, 8);
  globalThis.HTMLCanvasElement ??= sample.constructor;
  globalThis.CanvasRenderingContext2D ??= sample.getContext('2d').constructor;
  globalThis.Window ??= Object;
  globalThis.window ??= globalThis;
  globalThis.document ??= {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error('지원하지 않는 문서 리소스입니다.');
      return createCanvas(8, 8);
    },
  };
}

export { createCanvas };
