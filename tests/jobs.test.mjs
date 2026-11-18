import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JobManager, executeInWorker } from '../engine/jobs.mjs';
import { createFixtures } from './fixtures.mjs';

async function setup(execute) {
  await fs.mkdir(path.resolve('output'), { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('output/jobs-check-'));
  const fixtures = await createFixtures(path.join(directory, '파일'));
  const manager = new JobManager({ userData: path.join(directory, 'profile'), capabilities: { word: true, excel: true, powerpoint: true }, execute, thumbnail: async () => undefined });
  await manager.initialize();
  return { manager, fixtures, directory };
}

test('a failed file does not block later files and records stay after reload', async () => {
  const { manager, fixtures, directory } = await setup(async (input) => {
    if (input.source.endsWith('.docx')) throw new Error('의도한 파일 오류');
    return { paths: [input.source + '.converted'], warnings: [] };
  });
  await manager.add([fixtures.photo, fixtures.docx, fixtures.pdf]);
  manager.start(); await manager.runPromise;
  assert.deepEqual(manager.jobs.map((job) => job.status), ['completed', 'failed', 'completed']);
  assert.equal(manager.snapshot().finished, 3);
  await manager.shutdown();
  const next = new JobManager({ userData: path.join(directory, 'profile'), capabilities: {} });
  await next.initialize();
  assert.equal(next.history.length, 3);
  assert.equal((await fs.stat(fixtures.photo)).isFile(), true);
  manager.clearHistory(); await manager.shutdown();
  assert.equal((await fs.stat(fixtures.photo)).isFile(), true);
});

test('batch cancellation cancels active and waiting work', async () => {
  const { manager, fixtures } = await setup((_input, signal) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('취소', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }));
  await manager.add([fixtures.photo, fixtures.pdf]);
  manager.start(); manager.cancel(); await manager.runPromise;
  assert.deepEqual(manager.jobs.map((job) => job.status), ['cancelled', 'cancelled']);
  assert.equal(manager.running, false);
  manager.retryFailed(); assert.equal(manager.jobs[0].status, 'pending');
  await manager.shutdown();
});

test('only pending photos targeting PDF merge, preserving their order', async () => {
  const calls = [];
  const { manager, fixtures } = await setup(async (input) => { calls.push(input); return { paths: ['test.pdf'], warnings: [] }; });
  await manager.add([fixtures.photo, fixtures.pdf, fixtures.photo2]);
  for (const job of manager.jobs.filter((job) => job.category === 'image')) manager.update({ id: job.id, format: 'pdf' });
  manager.saveSettings({ combineImages: true });
  manager.start(); await manager.runPromise;
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].sources, [fixtures.photo, fixtures.photo2]);
  assert.equal(calls[1].source, fixtures.pdf);
  await manager.shutdown();
});

test('a preferred format is used for new jobs and a scoped batch only converts its ids', async () => {
  const calls = [];
  const { manager, fixtures } = await setup(async (input) => { calls.push(input); return { paths: ['test.pdf'], warnings: [] }; });
  await manager.add([fixtures.pdf], 'pdf');
  assert.equal(manager.jobs.find((job) => job.category === 'pdf').format, 'pdf');
  await manager.add([fixtures.photo]);
  const photo = manager.jobs.find((job) => job.category === 'image');
  manager.start([photo.id]); await manager.runPromise;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, fixtures.photo);
  assert.equal(manager.jobs.find((job) => job.category === 'pdf').status, 'pending');
  await manager.shutdown();
});

test('real worker converts a file with a Korean path', async () => {
  const { fixtures, directory } = await setup();
  const result = await executeInWorker({ source: fixtures.photo, format: 'jpg', options: {}, destination: path.join(directory, '결과') }, new AbortController().signal);
  assert.equal(result.paths.length, 1);
  assert.ok((await fs.stat(result.paths[0])).size > 0);
});

test('editing a failed merged PDF updates every photo on retry', async () => {
  const calls = [];
  const { manager, fixtures } = await setup(async (input) => {
    calls.push(input);
    if (calls.length === 1) throw new Error('첫 시도 오류');
    return { paths: ['test.pdf'], warnings: [] };
  });
  await manager.add([fixtures.photo, fixtures.photo2]);
  for (const job of manager.jobs) manager.update({ id: job.id, format: 'pdf', options: { quality: 90, maxWidth: 1200 } });
  manager.saveSettings({ combineImages: true });
  manager.start(); await manager.runPromise;
  const merged = manager.jobs[0];
  manager.update({ id: merged.id, options: { quality: 10, maxWidth: 100 } });
  manager.start(); await manager.runPromise;
  assert.deepEqual(calls[1].sourceOptions.map(({ quality, maxWidth }) => [quality, maxWidth]), [[10, 100], [10, 100]]);
  await manager.shutdown();
});
