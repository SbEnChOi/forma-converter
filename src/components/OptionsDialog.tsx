import { useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import type { ConversionOptions, Job, PageSize, Settings } from '../types';
import { displayError, displayFormat, pageSizeOptions } from '../utils';
import Modal from './Modal';

export default function OptionsDialog({ job, settings, onClose, onSave }: {
  job: Job;
  settings: Settings;
  onClose(): void;
  onSave(options: ConversionOptions): Promise<void>;
}) {
  const [quality, setQuality] = useState(job.options.quality ?? settings.quality);
  const [width, setWidth] = useState(String(job.options.maxWidth ?? settings.maxWidth ?? ''));
  const [height, setHeight] = useState(String(job.options.maxHeight ?? settings.maxHeight ?? ''));
  const [background, setBackground] = useState(job.options.background ?? settings.background);
  const [pages, setPages] = useState(job.options.pages ?? '');
  const [pageSize, setPageSize] = useState<PageSize>(job.options.pageSize ?? settings.pageSize);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const image = job.category === 'image';
  const pdf = job.category === 'pdf' && ['png', 'jpg', 'jpeg', 'txt', 'md'].includes(job.format);
  const pdfOutput = job.format === 'pdf';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ quality, maxWidth: width ? Number(width) : undefined, maxHeight: height ? Number(height) : undefined, background, pages: pages.trim(), pageSize });
      onClose();
    } catch (failure) { setError(displayError(failure)); } finally { setSaving(false); }
  }

  return <Modal title="변환 설정" description={`${job.name} → ${displayFormat(job.format)}`} onClose={onClose}>
    <form onSubmit={submit}>
      <div className="modal-body">
        {image && <>
          <div className="setting-field">
            <label htmlFor="image-quality">사진 품질 <output>{quality}%</output></label>
            <input id="image-quality" type="range" min="1" max="100" step="1" value={quality} onChange={event => setQuality(Number(event.target.value))} />
            <div className="range-captions"><span>작은 용량</span><span>높은 품질</span></div>
            <p className="field-help">JPG·WEBP·AVIF에 적용됩니다.</p>
          </div>
          <div className="setting-field">
            <span className="field-label">사진 크기</span>
            <div className="dimension-grid">
              <label>최대 너비<div className="input-unit"><input type="number" min="1" max="20000" placeholder="원본 크기" value={width} onChange={event => setWidth(event.target.value)} /><span>px</span></div></label>
              <span className="dimension-times">×</span>
              <label>최대 높이<div className="input-unit"><input type="number" min="1" max="20000" placeholder="원본 크기" value={height} onChange={event => setHeight(event.target.value)} /><span>px</span></div></label>
            </div>
            <p className="field-help">비율을 유지하며, 원본보다 크게 확대하지 않습니다.</p>
          </div>
          <div className="setting-field color-field"><div><label htmlFor="image-background">배경색</label><p className="field-help">JPG·PDF처럼 투명도를 지원하지 않는 형식에 적용됩니다.</p></div><label className="color-input"><input id="image-background" type="color" value={background} onChange={event => setBackground(event.target.value)} /><span>{background.toUpperCase()}</span></label></div>
          {['gif', 'tif', 'tiff'].includes(job.extension.replace(/^\./, '').toLowerCase()) && <div className="inline-note"><Info size={16} /><p>여러 프레임이 있는 사진은 첫 번째 프레임을 변환합니다.</p></div>}
        </>}
        {pdfOutput && <div className="setting-field">
          <label htmlFor="pdf-page-size">PDF 용지 크기</label>
          <div className="select-wrap"><select id="pdf-page-size" value={pageSize} onChange={event => setPageSize(event.target.value as PageSize)}>{pageSizeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          <p className="field-help">원본 방향을 유지하고, 내용의 비율을 지키며 선택한 용지에 맞춥니다.</p>
        </div>}
        {pdf && <div className="setting-field"><label htmlFor="pdf-pages">변환할 페이지</label><input id="pdf-pages" type="text" inputMode="text" pattern="[0-9,\-\s]*" placeholder="전체 페이지" value={pages} onChange={event => setPages(event.target.value)} autoComplete="off" /><p className="field-help">예: 1-3, 5, 8-10 · 비워 두면 모든 페이지를 변환합니다.</p></div>}
        {!image && <div className="inline-note"><Info size={17} /><p>{job.category === 'pdf' ? '스캔한 PDF의 문자를 인식하는 OCR은 지원하지 않습니다. 사진 추출은 스캔한 PDF에서도 사용할 수 있습니다.' : ['hwp', 'hwpx'].includes(job.extension.replace(/^\./, '').toLowerCase()) ? '복잡한 표·수식·특수 글꼴은 원본과 다를 수 있습니다. 변환 후 결과를 열어 확인해 주세요.' : '문서의 서식과 인쇄 설정을 기준으로 변환합니다. 설치된 글꼴에 따라 결과가 달라질 수 있습니다.'}</p></div>}
        {!image && !pdf && !pdfOutput && <p className="quiet-paragraph">이 형식은 추가 설정 없이 변환할 수 있습니다.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button className="button secondary" type="button" onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={saving}>{saving ? '저장 중…' : '설정 적용'}</button></div>
    </form>
  </Modal>;
}
