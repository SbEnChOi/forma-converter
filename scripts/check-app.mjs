import { chromium } from 'playwright';
import electronPath from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { fileURLToPath } from 'node:url';
import { createFixtures } from '../tests/fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output', 'playwright', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, { recursive: true });
const fixtures = await createFixtures(path.join(output, '시험 파일'));
const longName = path.join(path.dirname(fixtures.photo), '2026년_가족여행_부산과_제주도의_가장_좋았던_순간을_모아둔_사진_최종_수정본_03.png');
await fs.copyFile(fixtures.photo, longName);
const broken = path.join(path.dirname(fixtures.photo), '열리지 않는 사진.png');
await fs.writeFile(broken, 'broken image');
const pdfCopy = path.join(path.dirname(fixtures.pdf), '크기 변경할 PDF.pdf');
await fs.copyFile(fixtures.pdf, pdfCopy);
const destination = path.join(output, '변환 결과');
await fs.mkdir(destination);

async function waitForState(page, predicate, label) {
  const deadline = Date.now() + 120000;
  let state;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => window.forma.getState());
    if (!state.running && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out: ` + JSON.stringify(state?.jobs?.map((job) => ({ name: job.name, status: job.status }))));
}
const environment = { ...process.env, FORMA_TEST_PROFILE: path.join(output, 'profile') };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.FORMA_TEST_HIDDEN;
const packaged = process.env.FORMA_EXECUTABLE;
const child = spawn(packaged || electronPath, [...(packaged ? [] : [root]), '--remote-debugging-port=0'], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error('App startup timed out: ' + buffer)), 30000);
  const output = (chunk) => {
    buffer = (buffer + chunk.toString()).slice(-16000);
    const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  };
  child.stdout.on('data', output); child.stderr.on('data', output);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code) => { clearTimeout(timer); reject(new Error('App exited: ' + code + '\n' + buffer)); });
});
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.waitForEvent('page');
page.setDefaultTimeout(15000);
const errors = [];
let oldSettings;
try {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '파일 변환', exact: true }).waitFor();
  const capabilities = await page.evaluate(() => window.forma.getCapabilities());
  console.log('Capabilities', JSON.stringify(capabilities));
  oldSettings = await page.evaluate(() => window.forma.getSettings());
  await page.evaluate(() => window.forma.saveSettings({ theme: 'light', destination: null, combineImages: false }));
  await page.screenshot({ path: path.join(output, '01-empty.png') });
  const inputs = [longName, fixtures.hwpx, fixtures.pdf, broken, path.join(root, 'vendor/jhwpx-converter/samples/sample_basic.hwp'), fixtures.markdownDoc];
  if (capabilities.word) inputs.push(fixtures.docx);
  await page.evaluate((paths) => window.forma.addPaths(paths), inputs);
  assert.equal((await page.evaluate(() => window.forma.getState())).jobs.length, inputs.length);
  await page.evaluate((file) => window.forma.addPaths([file], 'pdf'), pdfCopy);
  assert.equal((await page.evaluate(() => window.forma.getState())).jobs.length, inputs.length + 1);
  const jobs = await page.evaluate(() => window.forma.getState().then((state) => state.jobs));
  await page.getByLabel(`${path.basename(longName)} 출력 형식`, { exact: true }).selectOption('webp');
  await page.getByLabel(`${path.basename(fixtures.markdownDoc)} 출력 형식`, { exact: true }).selectOption('md');
  await page.getByRole('button', { name: `${path.basename(longName)} 변환 설정`, exact: true }).click();
  await page.getByLabel('최대 너비', { exact: false }).fill('120');
  await page.getByRole('button', { name: '설정 적용', exact: true }).click();
  await page.getByRole('button', { name: `${path.basename(fixtures.pdf)} 변환 설정`, exact: true }).click();
  await page.getByLabel('변환할 페이지').fill('1, 3');
  await page.getByRole('button', { name: '설정 적용', exact: true }).click();
  await page.getByRole('button', { name: `${path.basename(fixtures.hwpx)} 변환 설정`, exact: true }).click();
  await page.getByLabel('PDF 용지 크기').selectOption('b4');
  await page.getByRole('button', { name: '설정 적용', exact: true }).click();
  await page.getByRole('button', { name: /PDF 크기/ }).click();
  await page.getByLabel('PDF 용지 크기 한 번에 바꾸기').selectOption('b4');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, '02-ready.png') });
  await page.evaluate((directory) => window.forma.saveSettings({ destination: directory }), destination);
  await page.getByRole('button', { name: /변환 시작/ }).click();
  let state = await waitForState(page, (snapshot) => snapshot.jobs.filter((job) => job.category === 'pdf').every((job) => ['completed', 'failed'].includes(job.status)), 'PDF batch');
  assert.equal(state.jobs.filter((job) => job.category === 'pdf' && job.status === 'completed').length, 2);
  assert.equal(state.jobs.filter((job) => job.status === 'pending').length, state.jobs.length - 2, 'the PDF tab must only convert its own pending files');
  const resizedJob = state.jobs.find((job) => job.name === path.basename(pdfCopy));
  assert.equal(resizedJob.format, 'pdf');
  const resizedPdf = await PDFDocument.load(await fs.readFile(resizedJob.outputs[0]));
  const resizedSize = resizedPdf.getPage(0).getSize();
  assert.ok(Math.abs(Math.min(resizedSize.width, resizedSize.height) - 728.5) < 1.5 && Math.abs(Math.max(resizedSize.width, resizedSize.height) - 1031.8) < 1.5, JSON.stringify(resizedSize));

  await page.getByRole('button', { name: /전체 파일/ }).click();
  await page.getByRole('button', { name: /변환 시작/ }).click();
  state = await waitForState(page, (snapshot) => snapshot.jobs.every((job) => ['completed', 'failed'].includes(job.status)), 'full batch');
  assert.equal(state.jobs.filter((job) => job.status === 'completed').length, inputs.length, JSON.stringify(state.jobs.map((job) => ({ name: job.name, status: job.status, error: job.error }))));
  assert.equal(state.jobs.find((job) => job.name === path.basename(broken)).status, 'failed');
  for (const job of state.jobs.filter((job) => job.status === 'completed')) for (const result of job.outputs) assert.ok((await fs.stat(result)).size > 0);
  assert.equal(state.jobs.find((job) => job.name === path.basename(fixtures.pdf)).outputs.length, 2);
  const hwpxJob = state.jobs.find((job) => job.name === path.basename(fixtures.hwpx));
  const hwpxPdf = await PDFDocument.load(await fs.readFile(hwpxJob.outputs[0]));
  const hwpxSize = hwpxPdf.getPage(0).getSize();
  assert.ok(Math.abs(Math.min(hwpxSize.width, hwpxSize.height) - 728.5) < 1.5 && Math.abs(Math.max(hwpxSize.width, hwpxSize.height) - 1031.8) < 1.5, JSON.stringify(hwpxSize));
  const markdownJob = state.jobs.find((job) => job.name === path.basename(fixtures.markdownDoc));
  assert.equal(markdownJob.status, 'completed');
  assert.match(await fs.readFile(markdownJob.outputs[0], 'utf8'), /# 문서 개요/);
  assert.ok(markdownJob.outputs.some((file) => file.endsWith('.png')), 'Markdown images must be saved with the document');
  await page.screenshot({ path: path.join(output, '03-completed-and-error.png') });
  await page.getByRole('button', { name: /^설정/ }).click();
  await page.getByRole('dialog', { name: '설정', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, '04-settings.png') });
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.setViewportSize({ width: 840, height: 600 });
  await page.screenshot({ path: path.join(output, '05-small-window.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, 'app must not horizontally overflow at minimum size');
  await page.getByRole('button', { name: /변환 기록/ }).click();
  await page.screenshot({ path: path.join(output, '06-history.png') });
  await page.evaluate(() => window.forma.saveSettings({ theme: 'dark' }));
  await page.screenshot({ path: path.join(output, '07-dark.png') });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ result: 'PASS', packaged: Boolean(packaged), output, results: state.jobs.map((job) => ({ name: job.name, status: job.status, outputs: job.outputs, error: job.error })) }, null, 2));
} finally {
  if (packaged) {
    await page.evaluate((settings) => window.forma.saveSettings(settings), oldSettings).catch(() => {});
    await page.evaluate(() => window.forma.clearHistory()).catch(() => {});
  }
  await page.evaluate(() => window.forma.close()).catch(() => {});
  await browser.close().catch(() => {});
  if (child.exitCode === null) await new Promise((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
}
