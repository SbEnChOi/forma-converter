import { spawn } from 'node:child_process';
import { readFile, writeFile, stat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import CFB from 'cfb';
import { docxBytesToMarkdown } from './markdown.mjs';

const scriptSource = fileURLToPath(new URL('./office.ps1', import.meta.url));
const wordInputs = new Set(['doc', 'docx', 'rtf', 'odt', 'txt', 'pdf']);
const excelInputs = new Set(['xls', 'xlsx', 'csv']);
const slideInputs = new Set(['ppt', 'pptx']);
const powerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function cancelled(message = '변환을 취소했습니다.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function stemOf(source) {
  const stem = path.parse(source).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 110);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `파일_${stem}` : stem || '문서';
}

function officeError(message) {
  if (/password|암호|비밀번호|EncryptedPackage|decrypt/i.test(message)) return new Error('암호가 걸린 문서는 변환할 수 없습니다. 암호를 해제한 사본을 추가해 주세요.');
  if (/80040154|class not registered|클래스가 등록|프로그램을 시작할 수 없습니다/i.test(message)) return new Error('이 변환에는 설치된 Microsoft Office가 필요합니다. Office 설치와 첫 실행 설정을 확인해 주세요.');
  if (/corrupt|손상|파일 형식|열 수 없|읽을 수 없/i.test(message)) return new Error(`Office에서 문서를 열지 못했습니다. 파일이 정상적으로 열리는지 확인해 주세요.\n${message}`);
  return new Error(message || 'Office에서 문서를 변환하지 못했습니다. 원본 파일을 Office에서 열어 확인해 주세요.');
}

async function prepareInput(source, extension, directory) {
  const bytes = await readFile(source);
  if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) {
    const compound = CFB.read(bytes, { type: 'buffer' });
    if (compound.FileIndex.some(entry => /^(EncryptionInfo|EncryptedPackage|EncryptedSummary)$/i.test(entry.name))) {
      throw officeError('암호화된 문서입니다.');
    }
    if (extension === 'xls') {
      const workbook = compound.FileIndex.find(entry => /^(Workbook|Book)$/i.test(entry.name));
      const data = workbook?.content;
      if (data) {
        for (let offset = 0; offset + 4 <= data.length;) {
          const record = data.readUInt16LE(offset);
          const length = data.readUInt16LE(offset + 2);
          if (record === 0x002f) throw officeError('암호화된 스프레드시트입니다.');
          if (offset + 4 + length > data.length) break;
          offset += 4 + length;
        }
      }
    }
  }
  const prepared = path.join(directory, `forma-office-input.${extension}`);
  if (extension !== 'txt') {
    // A unique copy also prevents singleton Office apps from reusing a document the user already has open.
    await writeFile(prepared, bytes, { flag: 'wx' });
    return prepared;
  }
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('euc-kr').decode(bytes); }
  }
  await writeFile(prepared, '\ufeff' + text, { encoding: 'utf8', flag: 'wx' });
  return prepared;
}

async function runCleanup(script, processPath) {
  await new Promise(resolve => {
    const cleaner = spawn(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', 'Cleanup', '-ProcessPath', processPath], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { cleaner.kill(); resolve(); }, 5000);
    cleaner.once('error', () => { clearTimeout(timer); resolve(); });
    cleaner.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

async function embedHtmlAssets(filename, directory) {
  let html = await readFile(filename, 'utf8');
  const replacements = new Map();
  const pattern = /(?:\bsrc\s*=\s*["']([^"']+)["']|url\(\s*["']?([^)'"\s]+)["']?\s*\))/gi;
  const root = await realpath(directory);
  for (const match of html.matchAll(pattern)) {
    const reference = match[1] || match[2];
    if (/^(?:data:|https?:|file:|\/\/|#)/i.test(reference) || replacements.has(reference)) continue;
    try {
      const local = await realpath(path.resolve(directory, decodeURIComponent(reference.replaceAll('&amp;', '&'))));
      if (!local.startsWith(root + path.sep)) continue;
      const extension = path.extname(local).slice(1).toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', wmf: 'image/wmf', emf: 'image/emf' }[extension];
      if (mime) replacements.set(reference, `data:${mime};base64,${(await readFile(local)).toString('base64')}`);
    } catch { /* An inaccessible source asset is not read from outside the job directory. */ }
  }
  for (const [reference, encoded] of replacements) html = html.replaceAll(reference, encoded);
  html = html.replace(/<link\b[^>]*\brel=["']?(?:File-List|Edit-Time-Data|OLE-Object-Data)["']?[^>]*>/gi, '');
  await writeFile(filename, html, 'utf8');
}

/** Convert one Office document using the installed desktop applications. */
export async function convertOffice(source, format, options = {}, directory, signal) {
  if (process.platform !== 'win32') throw new Error('Microsoft Office 문서 변환은 Windows에서 사용할 수 있습니다.');
  if (signal?.aborted) throw cancelled();
  if (!path.isAbsolute(source) || !path.isAbsolute(directory)) throw new Error('문서와 작업 폴더의 경로가 올바르지 않습니다.');
  const extension = path.extname(source).slice(1).toLowerCase();
  const allowed = wordInputs.has(extension) ? ['pdf', 'docx', 'txt', 'html', 'md'] : excelInputs.has(extension) ? ['pdf', 'xlsx', 'csv'] : slideInputs.has(extension) ? ['pdf', 'pptx', 'png', 'jpg'] : [];
  if (!allowed.includes(format)) throw new Error('이 문서의 출력 형식을 지원하지 않습니다.');
  const sourceInfo = await stat(source);
  if (!sourceInfo.isFile()) throw new Error('원본 파일을 찾을 수 없습니다.');
  const preparedSource = await prepareInput(source, extension, directory);

  const script = path.join(directory, 'forma-office.ps1');
  const requestPath = path.join(directory, 'forma-office-request.json');
  const responsePath = path.join(directory, 'forma-office-response.json');
  const processPath = path.join(directory, 'forma-office-process.json');
  const scriptBytes = await readFile(scriptSource);
  // Windows PowerShell 5.1 requires a BOM to reliably read Korean strings.
  await writeFile(script, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), scriptBytes]));
  // Word cannot save Markdown, so it saves a DOCX that we turn into Markdown locally.
  const officeFormat = format === 'md' ? 'docx' : format;
  await writeFile(requestPath, JSON.stringify({ source: preparedSource, format: officeFormat, directory, stem: stemOf(source), options: { pages: typeof options.pages === 'string' ? options.pages : '' } }), 'utf8');

  const response = await new Promise((resolve, reject) => {
    const child = spawn(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, '-RequestPath', requestPath, '-ResponsePath', responsePath, '-ProcessPath', processPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let diagnostic = '';
    let stopReason;
    let stopping;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const stop = reason => {
      if (stopReason) return;
      stopReason = reason;
      stopping = (async () => {
        await writeFile(processPath + '.cancel', '').catch(() => {});
        // Let startup notice cancellation before creating Office, or finish recording its exact PID.
        for (let attempt = 0; attempt < 15 && child.exitCode === null; attempt++) {
          try {
            const metadata = JSON.parse(await readFile(processPath, 'utf8'));
            if (metadata.pid > 0 && metadata.startTimeTicks && metadata.ownsSession) break;
          } catch {}
          await delay(100);
        }
        child.kill();
        await runCleanup(script, processPath);
      })();
    };
    const onAbort = () => stop(cancelled());
    const timer = setTimeout(() => stop(new Error('Office 변환 시간이 초과되었습니다. 문서가 정상적으로 열리는지, Office에 확인 창이 떠 있는지 확인해 주세요.')), 120_000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString('utf8')).slice(-8000); });
    child.once('error', error => finish(officeError(error.message)));
    child.once('close', async code => {
      if (stopping) await stopping;
      if (stopReason) return finish(stopReason);
      try {
        const result = JSON.parse(await readFile(responsePath, 'utf8'));
        if (!result.ok) return finish(officeError(result.error));
        if (code !== 0) return finish(officeError(diagnostic));
        finish(null, result);
      } catch (error) { finish(officeError(diagnostic || error.message)); }
    });
  });

  if (signal?.aborted) throw cancelled();
  const root = await realpath(directory);
  const paths = Array.isArray(response.paths) ? response.paths : [response.paths].filter(Boolean);
  if (paths.length === 0) throw new Error('Office에서 변환 결과를 저장하지 못했습니다.');
  for (const output of paths) {
    const actual = await realpath(output);
    if (!actual.startsWith(root + path.sep) || actual.toLowerCase() === source.toLowerCase() || (await stat(actual)).size === 0) throw new Error('Office 변환 결과가 올바르지 않습니다.');
    if (format === 'html') await embedHtmlAssets(actual, directory);
  }
  if (format === 'md') {
    const markdownPaths = [], markdownWarnings = [];
    const officeWarnings = Array.isArray(response.warnings) ? response.warnings : [response.warnings].filter(Boolean);
    for (const output of paths) {
      const converted = await docxBytesToMarkdown(new Uint8Array(await readFile(output)), source, directory, signal);
      markdownPaths.push(...converted.paths);
      markdownWarnings.push(...converted.warnings);
      await unlink(output).catch(() => {});
    }
    return { paths: markdownPaths, warnings: [...new Set([...officeWarnings, ...markdownWarnings])] };
  }
  return { paths, warnings: Array.isArray(response.warnings) ? response.warnings : [response.warnings].filter(Boolean) };
}
