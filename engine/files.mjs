import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException('변환을 취소했습니다.', 'AbortError');
}

export function safeStem(source) {
  const stem = path.parse(source).name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '');
  const safe = Array.from(stem || '파일').slice(0, 100).join('');
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `_${safe}` : safe;
}

export function resultName(source, extension) { return `${safeStem(source)}.${extension}`; }
export async function makeStage() { return fs.mkdtemp(path.join(os.tmpdir(), 'forma-convert-')); }

export async function removeStage(directory) {
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('forma-convert-')) throw new Error('임시 폴더 경로가 올바르지 않습니다.');
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
}

async function uniqueFolder(parent, name) {
  for (let i = 0; i < 10000; i++) {
    const target = path.join(parent, i ? `${name} (${i + 1})` : name);
    try { await fs.mkdir(target); return target; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('같은 이름의 폴더가 너무 많습니다. 다른 저장 위치를 선택해 주세요.');
}

async function copyUnique(source, directory) {
  const { name, ext } = path.parse(path.basename(source));
  for (let i = 0; i < 10000; i++) {
    const target = path.join(directory, i ? `${name} (${i + 1})${ext}` : `${name}${ext}`);
    try { await fs.copyFile(source, target, constants.COPYFILE_EXCL); return target; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('같은 이름의 결과가 너무 많습니다. 다른 저장 위치를 선택해 주세요.');
}

/** Copies only verified, staged outputs. Existing files never become rollback targets. */
export async function commitResults(paths, destination, { stage, groupName, signal } = {}) {
  checkCancelled(signal);
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('변환 결과 파일이 만들어지지 않았습니다.');
  const stageRoot = stage ? await fs.realpath(stage) : null;
  for (const file of paths) {
    const actual = await fs.realpath(file);
    if (stageRoot && (path.relative(stageRoot, actual).startsWith('..') || path.isAbsolute(path.relative(stageRoot, actual)))) throw new Error('변환 결과 경로가 올바르지 않습니다.');
    const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size === 0) throw new Error('변환 결과가 비어 있습니다. 원본을 확인해 주세요.');
  }
  await fs.mkdir(destination, { recursive: true });
  const group = groupName ? await uniqueFolder(destination, safeStem(`${groupName}.output`)) : null;
  const outputDirectory = group ?? destination;
  const created = [];
  try {
    for (const source of paths) {
      checkCancelled(signal);
      created.push(await copyUnique(source, outputDirectory));
    }
    checkCancelled(signal);
    return created;
  } catch (error) {
    await Promise.allSettled(created.map((file) => fs.unlink(file)));
    if (group) await fs.rmdir(group).catch(() => {});
    throw error;
  }
}
