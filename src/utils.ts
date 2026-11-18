import type { PageSize } from './types';

export const pageSizeOptions: Array<{ value: PageSize; label: string }> = [
  { value: 'original', label: '원본 유지' },
  { value: 'a4', label: 'A4 · 210 × 297 mm' },
  { value: 'a3', label: 'A3 · 297 × 420 mm' },
  { value: 'b4', label: 'B4 · 257 × 364 mm' },
  { value: 'b5', label: 'B5 · 182 × 257 mm' },
  { value: 'a5', label: 'A5 · 148 × 210 mm' },
  { value: 'letter', label: 'Letter · 216 × 279 mm' },
  { value: 'legal', label: 'Legal · 216 × 356 mm' },
];

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '크기 확인 중';
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 * 1024 ? 'KB' : bytes < 1024 * 1024 * 1024 ? 'MB' : 'GB';
  const divisor = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(bytes / divisor)} ${unit}`;
}

export function displayFormat(format: string) {
  return format.replace(/^\./, '').toUpperCase();
}

export function displayPageSize(value?: string) {
  if (!value || value === 'original') return '';
  return pageSizeOptions.find(option => option.value === value)?.label.split(' · ')[0] ?? value.toUpperCase();
}

export function splitName(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: '' };
}

export function displayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '작업을 완료하지 못했습니다. 다시 시도해 주세요.');
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').replace(/^Error:\s*/, '');
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
