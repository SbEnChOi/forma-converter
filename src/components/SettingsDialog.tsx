import { useState, type FormEvent } from 'react';
import { Check, FolderOpen, Monitor, Moon, Sun } from 'lucide-react';
import type { Capabilities, PageSize, Settings } from '../types';
import { displayError, pageSizeOptions } from '../utils';
import Modal from './Modal';

export default function SettingsDialog({ settings, capabilities, onClose, onSave, onChooseFolder }: {
  settings: Settings;
  capabilities: Capabilities;
  onClose(): void;
  onSave(settings: Partial<Settings>): Promise<void>;
  onChooseFolder(): void;
}) {
  const [theme, setTheme] = useState(settings.theme);
  const [quality, setQuality] = useState(settings.quality);
  const [pageSize, setPageSize] = useState<PageSize>(settings.pageSize);
  const [combineImages, setCombine] = useState(settings.combineImages);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try { await onSave({ theme, quality, combineImages, pageSize }); onClose(); }
    catch (failure) { setError(displayError(failure)); }
    finally { setSaving(false); }
  }

  return <Modal title="설정" description="Forma를 편하게 쓰는 방법" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="modal-body settings-body">
        <fieldset className="setting-field theme-field"><legend>화면 모드</legend><div className="theme-options">
          {([{ value: 'system', label: '시스템', Icon: Monitor }, { value: 'light', label: '라이트', Icon: Sun }, { value: 'dark', label: '다크', Icon: Moon }] as const).map(({ value, label, Icon }) => <label key={value} className={theme === value ? 'selected' : ''}><input type="radio" name="theme" value={value} checked={theme === value} onChange={() => setTheme(value)} /><Icon size={20} strokeWidth={1.6} /><span>{label}</span>{theme === value && <Check className="theme-check" size={13} />}</label>)}
        </div></fieldset>
        <div className="setting-field"><label htmlFor="default-quality">기본 사진 품질 <output>{quality}%</output></label><input id="default-quality" type="range" min="1" max="100" value={quality} onChange={event => setQuality(Number(event.target.value))} /><p className="field-help">새로 추가하는 사진에 적용됩니다. 파일별로 바꿀 수도 있습니다.</p></div>
        <div className="setting-field"><label htmlFor="default-page-size">기본 PDF 용지 크기</label><div className="select-wrap"><select id="default-page-size" value={pageSize} onChange={event => setPageSize(event.target.value as PageSize)}>{pageSizeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><p className="field-help">PDF로 변환할 때 기본으로 적용됩니다. 파일별로 바꿀 수 있습니다.</p></div>
        <div className="setting-field"><span className="field-label">저장 위치</span><button type="button" className="folder-setting" onClick={onChooseFolder}><FolderOpen size={17} /><span title={settings.destination || '원본 옆의 변환된 파일 폴더'}>{settings.destination || '원본 옆의 ‘변환된 파일’ 폴더'}</span><span className="link-label">변경</span></button>{settings.destination && <button type="button" className="text-button folder-reset" onClick={async () => { try { await onSave({ destination: null }); } catch (failure) { setError(displayError(failure)); } }}>원본 옆에 저장하기</button>}</div>
        <label className="checkbox-setting"><input type="checkbox" checked={combineImages} onChange={event => setCombine(event.target.checked)} /><span><strong>사진을 PDF 하나로 합치기</strong><small>출력을 PDF로 고른 사진이 2장 이상이면 파일 하나로 묶습니다.</small></span></label>
        <div className="office-availability"><span className="field-label">Office 문서 변환</span><div>{([{ key: 'word', label: 'Word' }, { key: 'excel', label: 'Excel' }, { key: 'powerpoint', label: 'PowerPoint' }] as const).map(({ key, label }) => <span key={key} className={capabilities[key] ? 'available' : 'unavailable'}>{capabilities[key] ? <Check size={12} /> : <span className="status-dot" />}{label}<span className="sr-only">{capabilities[key] ? ' 사용 가능' : ' 설치 필요'}</span></span>)}</div><p className="field-help">한글 파일과 사진 변환은 Office 설치 없이 사용할 수 있습니다.</p></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="settings-version"><span>Forma</span><span>버전 {capabilities.version}</span></div>
      </div>
      <div className="modal-footer"><button className="button secondary" type="button" onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={saving}>{saving ? '저장 중…' : '완료'}</button></div>
    </form>
  </Modal>;
}
