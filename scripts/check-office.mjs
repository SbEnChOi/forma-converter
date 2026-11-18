import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { convertOffice } from '../engine/office.mjs';

const execute = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('../output/check-office/', import.meta.url)), new Date().toISOString().replaceAll(':', '-'));
await mkdir(root, { recursive: true });
const results = [];
const outputDir = async name => {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  return directory;
};
const rtf = value => [...value].map(character => character.charCodeAt(0) > 127 ? `\\u${character.charCodeAt(0)}?` : character.replace(/[\\{}]/g, '\\$&')).join('');
const png = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#007aff' } }).png().toBuffer();
const readZipText = async (file, name) => new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(file)))[name]);
const source = path.join(root, '한글 표와 그림 문서.rtf');
await writeFile(source, `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Arial;}}\\uc1\\f0\\fs28 ${rtf('Forma 한글 변환 확인')}\\par\\fs22 ${rtf('승빈의 문서: 사진, 표, 한글을 확인합니다.')}\\par
\\trowd\\cellx3500\\cellx7000\\intbl ${rtf('이름')}\\cell ${rtf('점수')}\\cell\\row
\\trowd\\cellx3500\\cellx7000\\intbl ${rtf('승빈')}\\cell 95\\cell\\row
\\pard\\par{\\pict\\pngblip\\picw120\\pich60\\picwgoal1800\\pichgoal900 ${png.toString('hex')}}\\par}`);

for (const format of ['docx', 'pdf', 'txt', 'html', 'md']) {
  const started = Date.now();
  const result = await convertOffice(source, format, {}, await outputDir(`word-${format}`));
  assert.ok(result.paths.length >= 1);
  if (format !== 'md') assert.equal(result.paths.length, 1);
  if (format === 'docx') {
    assert.match(await readZipText(result.paths[0], 'word/document.xml'), /승빈/);
  } else if (format === 'pdf') {
    const pdf = await PDFDocument.load(await readFile(result.paths[0]));
    assert.ok(pdf.getPageCount() >= 1);
  } else if (format === 'txt') {
    assert.match(await readFile(result.paths[0], 'utf8'), /승빈/);
  } else if (format === 'md') {
    const markdown = await readFile(result.paths[0], 'utf8');
    assert.match(markdown, /승빈/);
    assert.match(markdown, /\| 이름 \| 점수 \|/);
    assert.ok(result.paths.some((file) => file.endsWith('.png')), 'RTF picture must be extracted for Markdown');
  } else {
    const html = await readFile(result.paths[0], 'utf8');
    assert.match(html, /승빈/);
    assert.match(html, /data:image\/(?:png|jpeg);base64,/);
  }
  results.push({ test: `RTF → ${format.toUpperCase()}`, milliseconds: Date.now() - started, paths: result.paths, warnings: result.warnings });
}

const pdfSource = results.find(item => item.test === 'RTF → PDF').paths[0];
const reflow = await convertOffice(pdfSource, 'docx', {}, await outputDir('pdf-docx'));
assert.match(await readZipText(reflow.paths[0], 'word/document.xml'), /승빈/);
results.push({ test: 'PDF → DOCX', paths: reflow.paths, warnings: reflow.warnings });

const csv = path.join(root, '한글 점수표.csv');
await writeFile(csv, '\ufeff이름,점수\r\n승빈,95\r\n지민,88\r\n', 'utf8');
const xlsx = await convertOffice(csv, 'xlsx', {}, await outputDir('csv-xlsx'));
assert.match(await readZipText(xlsx.paths[0], 'xl/sharedStrings.xml'), /승빈/);
results.push({ test: 'CSV → XLSX', paths: xlsx.paths });
for (const format of ['pdf', 'csv']) {
  const converted = await convertOffice(xlsx.paths[0], format, {}, await outputDir(`xlsx-${format}`));
  if (format === 'pdf') assert.ok((await PDFDocument.load(await readFile(converted.paths[0]))).getPageCount() >= 1);
  else assert.match(await readFile(converted.paths[0], 'utf8'), /승빈/);
  results.push({ test: `XLSX → ${format.toUpperCase()}`, paths: converted.paths, warnings: converted.warnings });
}

const pptxSource = path.join(root, '한글 슬라이드.pptx');
const fixtureScript = path.join(root, 'create-slides.ps1');
const fixture = `param([string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class FixtureWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId); }
'@
$before = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$app = $null; $presentation = $null; $own = $false
try {
  $app = New-Object -ComObject PowerPoint.Application
  $appPid = [uint32]0; [void][FixtureWindow]::GetWindowThreadProcessId([IntPtr][long]$app.HWND, [ref]$appPid)
  $own = $before -notcontains $appPid
  $presentation = $app.Presentations.Add(0)
  $slide = $presentation.Slides.Add(1, 1)
  $slide.Shapes.Title.TextFrame.TextRange.Text = 'Forma 한글 슬라이드'
  $slide.Shapes.Item(2).TextFrame.TextRange.Text = '승빈의 프레젠테이션'
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide)
  $slide = $presentation.Slides.Add(2, 2)
  $slide.Shapes.Title.TextFrame.TextRange.Text = '변환 결과 확인'
  $slide.Shapes.Item(2).TextFrame.TextRange.Text = "사진과 문서\r\n한글과 표"
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide)
  $presentation.SaveAs($Destination, 24)
} finally {
  if ($null -ne $presentation) { $presentation.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) }
  if ($null -ne $app) { if ($own -and $app.Presentations.Count -eq 0) { $app.Quit() }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}`;
await writeFile(fixtureScript, '\ufeff' + fixture, 'utf8');
await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', fixtureScript, '-Destination', pptxSource], { windowsHide: true, timeout: 45_000 });
for (const format of ['pdf', 'png', 'jpg']) {
  const converted = await convertOffice(pptxSource, format, {}, await outputDir(`pptx-${format}`));
  if (format === 'pdf') assert.equal((await PDFDocument.load(await readFile(converted.paths[0]))).getPageCount(), 2);
  else {
    assert.equal(converted.paths.length, 2);
    for (const image of converted.paths) assert.equal((await sharp(image).metadata()).width, 1920);
  }
  results.push({ test: `PPTX → ${format.toUpperCase()}`, paths: converted.paths });
}
const ranged = await convertOffice(pptxSource, 'png', { pages: '2' }, await outputDir('pptx-range'));
assert.equal(ranged.paths.length, 1);
assert.match(ranged.paths[0], /002\.png$/);
results.push({ test: 'PPTX → PNG (2쪽만)', paths: ranged.paths });

const controller = new AbortController();
controller.abort();
await assert.rejects(convertOffice(source, 'pdf', {}, await outputDir('cancelled'), controller.signal), { name: 'AbortError' });
results.push({ test: '이미 취소된 작업은 Office를 시작하지 않음' });

const activeDirectory = await outputDir('cancel-active');
const activeController = new AbortController();
const active = convertOffice(source, 'pdf', {}, activeDirectory, activeController.signal);
let activeMetadata;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    activeMetadata = JSON.parse(await readFile(path.join(activeDirectory, 'forma-office-process.json'), 'utf8'));
    if (activeMetadata.pid > 0 && activeMetadata.ownsSession) break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert.ok(activeMetadata?.ownsSession, 'The cancellation test must identify its own Office process first.');
activeController.abort();
await assert.rejects(active, { name: 'AbortError' });
await new Promise(resolve => setTimeout(resolve, 250));
assert.throws(() => process.kill(activeMetadata.pid, 0), 'The cancelled, job-owned Word process must exit.');
results.push({ test: '실행 중 취소는 확인된 작업용 Word 프로세스만 종료', pid: activeMetadata.pid });

await writeFile(path.join(root, 'results.json'), JSON.stringify({ ok: true, results }, null, 2));
console.log(JSON.stringify({ ok: true, count: results.length, root, results }, null, 2));
