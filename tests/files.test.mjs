import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { commitResults, makeStage, removeStage } from '../engine/files.mjs';

test('same-name output preserves the original and earlier results', async () => {
  const stage = await makeStage();
  const destination = path.resolve('output/file-safety');
  await fs.mkdir(destination, { recursive: true });
  const original = path.join(destination, `원본 ${Date.now()}.txt`);
  const staged = path.join(stage, path.basename(original));
  await fs.writeFile(original, '원본 내용');
  await fs.writeFile(staged, '변환 내용');
  try {
    const first = await commitResults([staged], destination, { stage });
    const second = await commitResults([staged], destination, { stage });
    assert.notEqual(first[0], original);
    assert.notEqual(first[0], second[0]);
    assert.equal(await fs.readFile(original, 'utf8'), '원본 내용');
    assert.equal(await fs.readFile(first[0], 'utf8'), '변환 내용');
  } finally { await removeStage(stage); }
});

test('cancelled or empty output does not commit a result', async () => {
  const stage = await makeStage();
  const destination = path.join(stage, '결과');
  const empty = path.join(stage, 'empty.txt');
  await fs.writeFile(empty, '');
  try {
    await assert.rejects(commitResults([empty], destination, { stage }), /비어/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(commitResults([empty], destination, { stage, signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(fs.access(destination));
  } finally { await removeStage(stage); }
});

test('staged outputs cannot escape the job directory', async () => {
  const stage = await makeStage();
  try { await assert.rejects(commitResults([path.resolve('package.json')], path.join(stage, 'result'), { stage }), /경로/); }
  finally { await removeStage(stage); }
});
