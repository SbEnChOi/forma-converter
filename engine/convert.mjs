import fs from 'node:fs/promises';
import path from 'node:path';
import { getFormatInfo, normalizeOptions } from './catalog.mjs';
import { checkCancelled, commitResults, makeStage, removeStage, safeStem } from './files.mjs';
import { convertImage, imagesToPdf } from './images.mjs';
import { convertPdf } from './pdf.mjs';
import { convertHangul } from './hangul.mjs';
import { convertOffice } from './office.mjs';
import { convertDocxToMarkdown, convertTextToMarkdown } from './markdown.mjs';
import { fitPdfToPageSize, pageSizeLabel } from './pagesize.mjs';

async function verifySource(source) {
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('파일을 다시 선택해 주세요.');
  const info = getFormatInfo(source);
  if (!info) throw new Error('아직 지원하지 않는 파일 형식입니다.');
  const stat = await fs.stat(source);
  if (!stat.isFile()) throw new Error('폴더 대신 파일을 선택해 주세요.');
  if (!stat.size) throw new Error('파일이 비어 있습니다. 원본을 확인해 주세요.');
  const limit = info.category === 'image' ? 512 : 256;
  if (stat.size > limit * 1024 * 1024) throw new Error(`${limit}MB 이하의 파일을 선택해 주세요.`);
  return info;
}

export async function convertFile(input, onProgress) {
  const { source, format, signal } = input;
  checkCancelled(signal);
  const info = await verifySource(source);
  if (!info.outputs.includes(format)) throw new Error('선택한 파일에서 지원하지 않는 출력 형식입니다.');
  const options = normalizeOptions(input.options);
  const destination = input.destination || path.join(path.dirname(source), '변환된 파일');
  if (!path.isAbsolute(destination)) throw new Error('저장 폴더를 다시 선택해 주세요.');
  const stage = await makeStage();
  try {
    onProgress?.('변환 중');
    let result;
    if (Array.isArray(input.sources) && input.sources.length > 1) {
      if (format !== 'pdf' || input.sources.length > 500) throw new Error('사진 묶기 설정을 확인해 주세요.');
      for (const file of input.sources) {
        const sourceInfo = await verifySource(file);
        if (sourceInfo.category !== 'image') throw new Error('PDF로 묶을 사진을 다시 선택해 주세요.');
      }
      result = await imagesToPdf(input.sources, options, stage, signal, onProgress, input.sourceOptions?.map(normalizeOptions));
    } else if (info.category === 'image') result = await convertImage(source, format, options, stage, signal);
    else if (['hwp', 'hwpx'].includes(info.extension) || (info.extension === 'docx' && format === 'hwpx')) result = await convertHangul(source, format, options, stage, signal, onProgress);
    else if (info.extension === 'pdf' && format !== 'docx') result = await convertPdf(source, format, options, stage, signal, onProgress);
    else if (format === 'md' && info.extension === 'docx') result = await convertDocxToMarkdown(source, stage, signal, onProgress);
    else if (format === 'md' && info.extension === 'txt') result = await convertTextToMarkdown(source, stage, signal, onProgress);
    else result = await convertOffice(source, format, options, stage, signal);
    if (format === 'pdf' && options.pageSize && options.pageSize !== 'original') {
      const warnings = new Set(result.warnings ?? []);
      const resizedPaths = [];
      try {
        for (const file of result.paths) {
          const resized = await fitPdfToPageSize(await fs.readFile(file), options.pageSize, signal, onProgress);
          if (resized.changed) {
            await fs.writeFile(file, resized.bytes);
            warnings.add(`PDF 용지 크기를 ${pageSizeLabel(options.pageSize)}로 맞추면서 내용의 비율을 유지해 확대·축소했습니다. PDF 링크·주석은 결과에서 빠질 수 있습니다.`);
          }
          resizedPaths.push(file);
        }
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        throw new Error('PDF 용지 크기를 바꾸지 못했습니다. 원본 문서의 PDF 구조를 확인해 주세요.', { cause: error });
      }
      result = { paths: resizedPaths, warnings: [...warnings] };
    }
    checkCancelled(signal);
    onProgress?.('결과 저장 중');
    const paths = await commitResults(result.paths, destination, {
      stage, signal, groupName: result.paths.length > 1 ? `${safeStem(source)} (${format.toUpperCase()})` : undefined,
    });
    return { paths, warnings: result.warnings ?? [] };
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw new DOMException('변환을 취소했습니다.', 'AbortError');
    if (error.code === 'ENOENT') throw new Error('파일을 찾지 못했습니다. 이동하거나 삭제되었는지 확인해 주세요.');
    if (['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw new Error('파일 또는 저장 폴더에 접근할 수 없습니다. 다른 앱에서 닫거나 저장 위치를 바꿔 주세요.');
    if (error.code === 'ENOSPC') throw new Error('저장 공간이 부족합니다. 여유 공간이 있는 폴더를 선택해 주세요.');
    if (/[가-힣]/.test(String(error.message))) throw error;
    throw new Error('변환하지 못했습니다. 원본이 정상적으로 열리는지, 암호나 문서 보호가 설정되어 있는지 확인해 주세요.', { cause: error });
  } finally { await removeStage(stage).catch(() => {}); }
}
