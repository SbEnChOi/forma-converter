import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CFB from 'cfb';
import { convertOffice } from '../engine/office.mjs';

const windows = process.platform === 'win32';

test('Office cancellation is checked before reading or starting an application', { skip: !windows }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forma-office-cancel-'));
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(convertOffice(path.join(temporary, 'missing.docx'), 'pdf', {}, temporary, controller.signal), { name: 'AbortError' });
    assert.deepEqual(await readdir(temporary), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('encrypted OOXML is rejected locally before Office can display a password prompt', { skip: !windows }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forma-office-encrypted-'));
  try {
    const source = path.join(temporary, '암호 문서.docx');
    const output = path.join(temporary, 'job');
    await mkdir(output);
    const compound = CFB.utils.cfb_new();
    CFB.utils.cfb_add(compound, 'EncryptedPackage', Buffer.from('encrypted sample'));
    const bytes = CFB.write(compound, { type: 'buffer' });
    await writeFile(source, bytes);
    await assert.rejects(convertOffice(source, 'pdf', {}, output), /암호/);
    assert.deepEqual(await readdir(output), []);
    assert.ok((await readFile(source)).equals(bytes));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('encrypted legacy XLS is rejected by its FILEPASS record before starting Excel', { skip: !windows }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forma-office-xls-'));
  try {
    const source = path.join(temporary, '암호 표.xls');
    const output = path.join(temporary, 'job');
    await mkdir(output);
    const compound = CFB.utils.cfb_new();
    CFB.utils.cfb_add(compound, 'Workbook', Buffer.from([0x2f, 0x00, 0x00, 0x00]));
    await writeFile(source, CFB.write(compound, { type: 'buffer' }));
    await assert.rejects(convertOffice(source, 'pdf', {}, output), /암호/);
    assert.deepEqual(await readdir(output), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
