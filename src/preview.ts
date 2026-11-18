import type { AppState, FormaBridge, Job } from './types';

// This bridge is imported only by Vite's development build. It never performs file I/O.
export function createPreviewBridge(): FormaBridge {
  const listeners = new Set<(state: AppState) => void>();
  let state: AppState = {
    jobs: [], history: [], running: false, total: 0, finished: 0,
    settings: { destination: null, quality: 90, maxWidth: null, maxHeight: null, background: '#ffffff', theme: 'light', combineImages: false, pageSize: 'original' },
  };
  const demo = new URLSearchParams(location.search).has('demo');
  const sample = (): Job[] => [
    { id: 'preview-1', source: 'C:\\사진\\제주에서 보낸 주말.HEIC', name: '제주에서 보낸 주말.HEIC', extension: 'heic', category: 'image', size: 3680502, format: 'jpg', availableFormats: ['jpg', 'png', 'webp', 'avif', 'pdf'], options: {}, status: 'pending', outputs: [], warnings: [], createdAt: new Date().toISOString() },
    { id: 'preview-2', source: 'C:\\문서\\프로젝트 기획안.hwpx', name: '프로젝트 기획안.hwpx', extension: 'hwpx', category: 'document', size: 184020, format: 'pdf', availableFormats: ['pdf', 'docx', 'txt', 'md'], options: {}, status: 'pending', outputs: [], warnings: [], createdAt: new Date().toISOString() },
    { id: 'preview-3', source: 'C:\\문서\\2026년 11월 회의록.docx', name: '2026년 11월 회의록.docx', extension: 'docx', category: 'document', size: 42094, format: 'pdf', availableFormats: ['pdf', 'hwpx', 'txt', 'html', 'md'], options: {}, status: 'pending', outputs: [], warnings: [], createdAt: new Date().toISOString() },
  ];
  if (demo) state.jobs = sample();
  const emit = () => { for (const listener of listeners) listener(structuredClone(state)); };
  const desktopOnly = async () => { throw new Error('화면 미리보기입니다. 실제 파일 변환은 Forma 데스크톱 앱에서 사용할 수 있습니다.'); };
  return {
    async getState() { return structuredClone(state); },
    async chooseFiles() { state.jobs = sample(); emit(); },
    addPaths: desktopOnly,
    chooseFolder: desktopOnly,
    async updateJob(update) { state.jobs = state.jobs.map(job => job.id === update.id ? { ...job, ...update, options: update.options ?? job.options } : job); emit(); },
    async removeJob(id) { state.jobs = state.jobs.filter(job => job.id !== id); emit(); },
    start: desktopOnly,
    async cancel() {},
    async clearCompleted() { state.jobs = state.jobs.filter(job => job.status !== 'completed'); emit(); },
    async retryFailed() { state.jobs = state.jobs.map(job => job.status === 'failed' || job.status === 'cancelled' ? { ...job, status: 'pending' } : job); emit(); },
    openOutput: desktopOnly,
    showInFolder: desktopOnly,
    async getSettings() { return structuredClone(state.settings); },
    async saveSettings(settings) { state.settings = { ...state.settings, ...settings }; emit(); },
    async clearHistory() { state.history = []; emit(); },
    async getCapabilities() { return { word: true, excel: true, powerpoint: true, version: '1.3.0' }; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    minimize() {}, maximize() {}, close() {},
    droppedPaths() { return []; },
  };
}
