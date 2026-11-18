import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { defaultSettings, getFormatInfo, normalizeOptions, normalizeSettings } from './catalog.mjs';
import { makeThumbnail } from './images.mjs';

const terminalStates = new Set(['completed', 'failed', 'cancelled']);
export function executeInWorker(input, signal, phase) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let settled = false;
    const abort = () => worker.postMessage('cancel');
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.on('message', (message) => {
      if (message.type === 'phase') phase?.(message.phase);
      if (message.type === 'result') finish(resolve, message.result);
      if (message.type === 'error') {
        const error = new Error(message.error.message);
        error.name = message.error.name;
        error.details = message.error.details;
        finish(reject, error);
      }
    });
    worker.on('error', (error) => finish(reject, error));
    worker.on('exit', (code) => { if (!settled) finish(reject, new Error(`변환 도구가 종료되었습니다. 파일을 다시 추가해 주세요. (${code})`)); });
  });
}

export function formatsFor(info, capabilities) {
  return info.outputs.filter((format) => {
    if (info.category === 'spreadsheet') return capabilities.excel;
    if (info.category === 'presentation') return capabilities.powerpoint;
    if (info.extension === 'pdf' && format === 'docx') return capabilities.word;
    if (info.category === 'document' && !['hwp', 'hwpx'].includes(info.extension)) {
      if (format === 'md') return ['docx', 'txt'].includes(info.extension) || capabilities.word;
      return format === 'hwpx' || capabilities.word;
    }
    return true;
  });
}

export class JobManager extends EventEmitter {
  constructor({ userData, capabilities, execute = executeInWorker, thumbnail = makeThumbnail }) {
    super();
    this.userData = userData; this.capabilities = capabilities; this.execute = execute; this.thumbnail = thumbnail;
    this.jobs = []; this.history = []; this.settings = { ...defaultSettings };
    this.running = false; this.batch = []; this.active = null; this.controller = null;
    this.persistence = Promise.resolve(); this.runPromise = null;
  }

  async initialize() {
    await fs.mkdir(this.userData, { recursive: true });
    try { this.settings = normalizeSettings(JSON.parse(await fs.readFile(path.join(this.userData, 'settings.json'), 'utf8'))); } catch {}
    try {
      const history = JSON.parse(await fs.readFile(path.join(this.userData, 'history.json'), 'utf8'));
      if (Array.isArray(history)) this.history = history.filter((job) => job && typeof job.id === 'string' && typeof job.name === 'string' && typeof job.source === 'string' && Array.isArray(job.outputs) && job.outputs.every((file) => typeof file === 'string') && terminalStates.has(job.status)).slice(0, 100);
    } catch {}
  }

  snapshot() {
    const finished = this.batch.filter((id) => terminalStates.has(this.jobs.find((job) => job.id === id)?.status)).length;
    return structuredClone({ jobs: this.jobs, history: this.history, settings: this.settings, running: this.running, total: this.batch.length, finished });
  }

  changed() { this.emit('change', this.snapshot()); }
  persist() {
    const settings = JSON.stringify(this.settings), history = JSON.stringify(this.history);
    this.persistence = this.persistence.then(async () => {
      for (const [name, data] of [['settings', settings], ['history', history]]) {
        const target = path.join(this.userData, `${name}.json`);
        const temp = `${target}.tmp`;
        await fs.writeFile(temp, data, 'utf8');
        await fs.rename(temp, target);
      }
    }).catch((error) => this.emit('diagnostic', error));
  }

  async add(paths, preferredFormat) {
    if (!Array.isArray(paths) || paths.length > 500 || paths.some((file) => typeof file !== 'string')) throw new Error('한 번에 500개 이하의 파일을 추가해 주세요.');
    if (preferredFormat != null && typeof preferredFormat !== 'string') throw new Error('출력 형식을 확인해 주세요.');
    if (this.jobs.length + paths.length > 500) throw new Error('목록에 500개까지 추가할 수 있습니다. 완료한 파일을 정리해 주세요.');
    const errors = [];
    for (const source of paths) {
      try {
        if (!path.isAbsolute(source)) throw new Error('파일 경로를 확인해 주세요.');
        const actual = await fs.realpath(source);
        if (this.jobs.some((job) => job.source.toLowerCase() === actual.toLowerCase() && ['pending', 'processing', 'cancelling'].includes(job.status))) continue;
        const stat = await fs.stat(actual), info = getFormatInfo(actual);
        if (!stat.isFile()) throw new Error('폴더는 추가할 수 없습니다.');
        if (!info) throw new Error('지원하지 않는 파일 형식입니다.');
        const availableFormats = formatsFor(info, this.capabilities);
        if (!availableFormats.length) throw new Error('이 문서를 변환하려면 해당 Microsoft Office 앱이 필요합니다.');
        const initialFormat = preferredFormat && availableFormats.includes(preferredFormat)
          ? preferredFormat
          : availableFormats.includes(info.defaultOutput) ? info.defaultOutput : availableFormats[0];
        const job = {
          id: randomUUID(), source: actual, name: path.basename(actual), extension: info.extension,
          category: info.category, size: stat.size, format: initialFormat,
          availableFormats, options: normalizeOptions(this.settings), outputs: [], warnings: [], status: 'pending', createdAt: new Date().toISOString(),
        };
        this.jobs.push(job); this.changed();
        if (info.category === 'image') {
          void this.thumbnail(actual).then((thumbnail) => { if (thumbnail && this.jobs.includes(job)) { job.thumbnail = thumbnail; this.changed(); } }).catch(() => {});
        }
      } catch (error) { errors.push(`${path.basename(source)}: ${error.message}`); }
    }
    if (errors.length) throw new Error(errors.slice(0, 4).join('\n') + (errors.length > 4 ? `\n외 ${errors.length - 4}개 파일` : ''));
  }

  update({ id, format, options }) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['pending', 'failed', 'cancelled'].includes(job.status)) throw new Error('변환을 마친 파일은 다시 추가해 주세요.');
    if (format != null) {
      if (!job.availableFormats.includes(format)) throw new Error('이 파일에서 지원하지 않는 출력 형식입니다.');
      job.format = format;
    }
    if (options != null) {
      job.options = normalizeOptions({ ...job.options, ...options });
      if (job.sourceCount > 1) job.sourceOptions = job.sourceOptions.map((current) => normalizeOptions({ ...current, ...options }));
    }
    if (terminalStates.has(job.status)) { job.status = 'pending'; delete job.error; job.warnings = []; }
    this.changed();
  }

  remove(id) {
    const job = this.jobs.find((entry) => entry.id === id);
    if (job && ['processing', 'cancelling'].includes(job.status)) throw new Error('진행 중인 변환을 먼저 취소해 주세요.');
    this.jobs = this.jobs.filter((entry) => entry.id !== id); this.changed();
  }

  saveSettings(value) { this.settings = normalizeSettings(value, this.settings); this.persist(); this.changed(); }
  clearCompleted() { this.jobs = this.jobs.filter((job) => !terminalStates.has(job.status)); this.changed(); }
  clearHistory() { this.history = []; this.persist(); this.changed(); }
  retryFailed() {
    for (const job of this.jobs) if (['failed', 'cancelled'].includes(job.status)) { job.status = 'pending'; job.warnings = []; job.outputs = []; delete job.error; }
    this.changed();
  }

  start(ids) {
    if (this.running) return;
    if (ids != null && (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== 'string'))) throw new Error('변환할 파일을 확인해 주세요.');
    const requested = Array.isArray(ids) ? new Set(ids) : null;
    const available = () => this.jobs.filter((job) => job.status === 'pending' && (!requested || requested.has(job.id)));
    if (this.settings.combineImages) {
      const images = available().filter((job) => job.category === 'image' && job.format === 'pdf' && !job.sourceCount);
      if (images.length > 1) {
        const index = this.jobs.indexOf(images[0]);
        const merged = { ...images[0], id: randomUUID(), name: `사진 ${images.length}장.pdf`, extension: 'images',
          sourceCount: images.length, sources: images.map((job) => job.source), sourceOptions: images.map((job) => job.options),
          availableFormats: ['pdf'], size: images.reduce((total, job) => total + job.size, 0), thumbnail: images[0].thumbnail };
        this.jobs = this.jobs.filter((job) => !images.includes(job));
        this.jobs.splice(index, 0, merged);
        if (requested) { for (const image of images) requested.delete(image.id); requested.add(merged.id); }
      }
    }
    this.batch = available().map((job) => job.id);
    if (!this.batch.length) return;
    this.batchDestination = this.settings.destination;
    this.running = true; this.changed();
    this.runPromise = this.processBatch();
  }

  async processBatch() {
    try {
      for (const id of this.batch) {
        const job = this.jobs.find((entry) => entry.id === id);
        if (!job || job.status !== 'pending') continue;
        this.active = id; this.controller = new AbortController();
        job.status = 'processing'; job.phase = '준비 중'; job.outputs = []; job.warnings = []; delete job.error; this.changed();
        try {
          const result = await this.execute({ source: job.source, sources: job.sources, sourceOptions: job.sourceOptions, format: job.format, options: job.options, destination: this.batchDestination }, this.controller.signal, (phase) => { job.phase = phase; this.changed(); });
          job.status = 'completed'; job.outputs = result.paths; job.warnings = result.warnings;
        } catch (error) {
          job.status = this.controller.signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'failed';
          job.error = job.status === 'cancelled' ? undefined : error.message;
          if (job.status === 'failed') this.emit('diagnostic', error);
        } finally {
          job.completedAt = new Date().toISOString(); delete job.phase;
          this.history.unshift({ ...structuredClone(job), id: randomUUID(), thumbnail: undefined });
          this.history = this.history.slice(0, 100); this.persist();
          this.active = null; this.controller = null; this.changed();
        }
      }
    } finally { this.running = false; this.changed(); }
  }

  cancel(id) {
    const targets = id ? [id] : this.batch;
    for (const target of targets) {
      const job = this.jobs.find((entry) => entry.id === target);
      if (!job) continue;
      if (['processing', 'cancelling'].includes(job.status)) { job.status = 'cancelling'; this.controller?.abort(); }
      else if (job.status === 'pending') { job.status = 'cancelled'; job.completedAt = new Date().toISOString(); }
    }
    this.changed();
  }

  find(id) { return this.jobs.find((job) => job.id === id) ?? this.history.find((job) => job.id === id); }
  async shutdown() { this.cancel(); await this.runPromise; await this.persistence; }
}
