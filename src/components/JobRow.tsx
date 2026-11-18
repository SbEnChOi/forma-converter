import { ArrowRight, Check, CircleAlert, FileSpreadsheet, FileText, FolderOpen, Image, Info, LoaderCircle, Presentation, SlidersHorizontal, X } from 'lucide-react';
import type { FormaBridge, Job } from '../types';
import { displayFormat, displayPageSize, formatBytes, formatDate, splitName } from '../utils';

export default function JobRow({ job, history = false, bridge, onOptions, onDetails, onAction }: {
  job: Job;
  history?: boolean;
  bridge: FormaBridge;
  onOptions(job: Job): void;
  onDetails(job: Job): void;
  onAction(action: () => Promise<unknown>): void;
}) {
  const { stem, extension } = splitName(job.name);
  const nameCharacters = Array.from(stem);
  const namePrefix = nameCharacters.length > 36 ? nameCharacters.slice(0, -10).join('') : stem;
  const nameTail = nameCharacters.length > 36 ? nameCharacters.slice(-10).join('') : '';
  const busy = job.status === 'processing' || job.status === 'cancelling';
  const editable = !history && ['pending', 'failed', 'cancelled'].includes(job.status);
  const Icon = job.category === 'image' ? Image : job.category === 'spreadsheet' ? FileSpreadsheet : job.category === 'presentation' ? Presentation : FileText;
  const status = {
    pending: '준비됨', processing: job.phase || '변환 중', cancelling: '취소 중',
    completed: '완료', failed: '변환 실패', cancelled: '취소됨',
  }[job.status];

  return <div className={`job-row status-${job.status}`} role="listitem" data-job-id={job.id}>
    <div className={`file-icon category-${job.category}`}>
      {job.thumbnail && job.category === 'image' ? <img src={job.thumbnail} alt="" /> : <Icon size={23} strokeWidth={1.7} />}
    </div>
    <div className="file-info">
      <div className="file-name" title={job.name}><span className="file-stem">{namePrefix}</span>{nameTail && <span className="file-tail">{nameTail}</span>}<span className="file-extension">{extension}</span></div>
      <div className="file-meta"><span>{displayFormat(job.extension)}</span><span className="meta-dot">·</span><span>{formatBytes(job.size)}</span>
        {job.format === 'pdf' && job.options.pageSize && job.options.pageSize !== 'original' && <><span className="meta-dot">·</span><span>{displayPageSize(job.options.pageSize)} 용지</span></>}
        {history && job.completedAt && <><span className="meta-dot">·</span><span>{formatDate(job.completedAt)}</span></>}
        {job.sourceCount && job.sourceCount > 1 ? <><span className="meta-dot">·</span><span>{job.sourceCount}개 파일</span></> : null}
      </div>
      {job.status === 'failed' && <button className="file-error" onClick={() => onDetails(job)} title={job.error}>{job.error || '파일을 변환하지 못했습니다. 자세히 보기'}</button>}
      {job.warnings.length > 0 && job.status === 'completed' && <button className="file-warning" onClick={() => onDetails(job)}>변환 안내 확인</button>}
    </div>
    <div className="format-control">
      <ArrowRight size={14} className="format-arrow" aria-hidden="true" />
      {editable ? <div className="select-wrap row-select"><select aria-label={`${job.name} 출력 형식`} value={job.format}
        onChange={event => onAction(() => bridge.updateJob({ id: job.id, format: event.target.value }))}>
        {job.availableFormats.map(format => <option key={format} value={format}>{displayFormat(format)}</option>)}
      </select></div> : <span className="static-format">{displayFormat(job.format)}</span>}
    </div>
    <div className={`job-status ${busy ? 'is-busy' : ''}`} role={busy ? 'status' : undefined}>
      {busy ? <LoaderCircle size={13} className="spin" /> : job.status === 'completed' ? <Check size={14} /> : job.status === 'failed' ? <CircleAlert size={13} /> : <span className="status-dot" />}
      <span title={status}>{status}</span>
    </div>
    <div className="row-actions">
      {job.status === 'completed' ? <>
        <button className="open-result" onClick={() => onAction(() => bridge.openOutput(job.id))}>열기</button>
        <button className="icon-button subtle" title="저장 폴더에서 보기" aria-label={`${job.name} 저장 폴더에서 보기`} onClick={() => onAction(() => bridge.showInFolder(job.id))}><FolderOpen size={16} /></button>
      </> : history ? (job.error || job.warnings.length > 0 ? <button className="icon-button subtle" title="변환 안내" aria-label={`${job.name} 변환 안내`} onClick={() => onDetails(job)}><Info size={16} /></button> : null) : <>
        <button className="icon-button subtle" disabled={!editable} title="변환 설정" aria-label={`${job.name} 변환 설정`} onClick={() => onOptions(job)}><SlidersHorizontal size={16} /></button>
        {!history && <button className="icon-button subtle" title={busy ? '변환 취소' : '목록에서 제거'} aria-label={`${job.name} ${busy ? '변환 취소' : '목록에서 제거'}`}
          disabled={job.status === 'cancelling'} onClick={() => onAction(() => busy ? bridge.cancel(job.id) : bridge.removeJob(job.id))}><X size={16} /></button>}
      </>}
    </div>
  </div>;
}
