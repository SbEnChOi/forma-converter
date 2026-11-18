import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, CircleAlert, FileText, Files, FolderOpen, History, Image, Info, LoaderCircle, Minus, Plus, RotateCcw, Scaling, Settings2, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import type { AppState, Capabilities, FormaBridge, Job, PageSize } from './types';
import { displayError, displayFormat, formatBytes, pageSizeOptions } from './utils';
import { createPreviewBridge } from './preview';
import { FileIllustration, FormaMark } from './components/Brand';
import JobRow from './components/JobRow';
import Modal from './components/Modal';
import OptionsDialog from './components/OptionsDialog';
import SettingsDialog from './components/SettingsDialog';

const previewMode = import.meta.env.DEV && !window.forma;
if (previewMode) window.forma = createPreviewBridge();

type View = 'all' | 'image' | 'document' | 'pdf' | 'history';
type DialogState = { type: 'settings' } | { type: 'options'; job: Job } | { type: 'details'; job: Job } | { type: 'formats' } | null;
const initialState: AppState = {
  jobs: [], history: [], running: false, total: 0, finished: 0,
  settings: { destination: null, quality: 90, maxWidth: null, maxHeight: null, background: '#ffffff', theme: 'system', combineImages: false, pageSize: 'original' },
};
const views = [
  { id: 'all', label: '전체 파일', Icon: Files },
  { id: 'image', label: '사진', Icon: Image },
  { id: 'document', label: '문서', Icon: FileText },
  { id: 'pdf', label: 'PDF 크기', Icon: Scaling },
  { id: 'history', label: '변환 기록', Icon: History },
] as const;

function inView(job: Job, view: View) {
  if (view === 'all') return true;
  if (view === 'image') return job.category === 'image';
  if (view === 'pdf') return job.category === 'pdf';
  if (view === 'document') return job.category !== 'image' && job.category !== 'pdf';
  return false;
}

export default function App() {
  const bridge: FormaBridge | undefined = window.forma;
  const [state, setState] = useState<AppState>(initialState);
  const [capabilities, setCapabilities] = useState<Capabilities>({ word: false, excel: false, powerpoint: false, version: '1.0.0' });
  const [view, setView] = useState<View>('all');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const dragDepth = useRef(0);
  const closeDialog = useCallback(() => setDialog(null), []);

  const action = useCallback((operation: () => Promise<unknown>) => {
    operation().catch(error => setMessage(displayError(error)));
  }, []);

  useEffect(() => {
    if (!bridge) { setMessage('앱에 연결하지 못했습니다. Forma를 닫고 다시 열어 주세요.'); return; }
    let active = true;
    const unsubscribe = bridge.subscribe(next => { if (active) setState(next); });
    bridge.getState().then(next => { if (active) { setState(next); setReady(true); } }).catch(error => { if (active) setMessage(displayError(error)); });
    bridge.getCapabilities().then(next => { if (active) setCapabilities(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = state.settings.theme === 'system' ? media.matches ? 'dark' : 'light' : state.settings.theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [state.settings.theme]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (!bridge || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        action(() => bridge.chooseFiles(view === 'pdf' ? 'pdf' : undefined));
      } else if (event.key === ',') { event.preventDefault(); setDialog({ type: 'settings' }); }
      else if (event.key === 'Enter' && !dialog && !state.running) {
        event.preventDefault();
        action(() => bridge.start(state.jobs.filter(job => job.status === 'pending' && inView(job, view)).map(job => job.id)));
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [bridge, action, dialog, state.running, state.jobs, view]);

  const pending = state.jobs.filter(job => job.status === 'pending');
  const completed = state.jobs.filter(job => job.status === 'completed');
  const failed = state.jobs.filter(job => job.status === 'failed' || job.status === 'cancelled');
  const visiblePending = view === 'history' ? pending : pending.filter(job => inView(job, view));
  const pdfPhotos = visiblePending.filter(job => job.category === 'image' && job.format === 'pdf');
  const visibleJobs = view === 'history' ? state.history : state.jobs.filter(job => inView(job, view));
  const availableFormats = useMemo(() => [...new Set(visiblePending.flatMap(job => job.availableFormats))].sort((a, b) => {
    const priority = ['pdf', 'jpg', 'png', 'webp', 'avif', 'tiff', 'docx', 'hwpx', 'txt', 'md', 'html', 'xlsx', 'csv', 'pptx'];
    return priority.indexOf(a) - priority.indexOf(b);
  }), [state.jobs, view]);
  const allSize = visiblePending.reduce((total, job) => total + job.size, 0);
  const title = view === 'history' ? '변환 기록' : view === 'image' ? '사진 변환' : view === 'document' ? '문서 변환' : view === 'pdf' ? 'PDF 크기 변경' : '파일 변환';
  const subtitle = view === 'history' ? '이 컴퓨터에서 변환한 파일을 다시 찾아보세요.' : view === 'pdf' ? 'A4 PDF를 B4·A3 등으로 바꿔 보세요.' : '원하는 형식으로, 이 컴퓨터에서.';
  const isHistory = view === 'history';

  function applyFormat(format: string) {
    if (!bridge || !format) return;
    const eligible = visiblePending.filter(job => job.availableFormats.includes(format));
    action(async () => { await Promise.all(eligible.map(job => bridge.updateJob({ id: job.id, format }))); setMessage(`${eligible.length}개 파일의 출력 형식을 ${displayFormat(format)}로 바꿨습니다.`); });
  }

  function applyPageSize(value: string) {
    if (!bridge || !value) return;
    const eligible = visiblePending.filter(job => job.category === 'pdf' && job.format === 'pdf');
    if (!eligible.length) { setMessage('용지 크기를 바꿀 PDF가 없습니다. PDF를 추가하고 출력 형식을 PDF로 선택해 주세요.'); return; }
    const option = pageSizeOptions.find(entry => entry.value === value);
    action(async () => {
      await Promise.all(eligible.map(job => bridge.updateJob({ id: job.id, options: { pageSize: value as PageSize } })));
      setMessage(`${eligible.length}개 PDF의 용지 크기를 ${option?.label ?? value}로 바꿨습니다.`);
    });
  }

  function addFiles() {
    if (!bridge) return;
    if (view === 'history') setView('all');
    action(() => bridge.chooseFiles(view === 'pdf' ? 'pdf' : undefined));
  }

  if (!bridge) return <div className="connection-error"><FormaMark /><h1>Forma를 다시 열어 주세요</h1><p>{message || '앱에 연결하지 못했습니다.'}</p></div>;

  return <div className={`app-shell ${dragging ? 'is-dragging' : ''}`}
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); const dropped = bridge.droppedPaths(Array.from(event.dataTransfer.files)); const paths = view === 'pdf' ? dropped.filter(file => file.toLowerCase().endsWith('.pdf')) : dropped; if (paths.length) { if (view === 'history') setView('all'); action(() => bridge.addPaths(paths, view === 'pdf' ? 'pdf' : undefined)); } else setMessage(view === 'pdf' ? 'PDF 파일만 추가할 수 있습니다.' : '탐색기에서 파일을 끌어놓거나 ‘파일 추가’를 눌러 주세요.'); }}>
    <div className="titlebar"><div className="titlebar-name">Forma{previewMode && ' · 화면 미리보기'}</div><div className="window-controls"><button aria-label="창 최소화" title="최소화" onClick={() => bridge.minimize()}><Minus size={14} /></button><button aria-label="창 최대화 또는 복원" title="최대화 또는 복원" onClick={() => bridge.maximize()}><Square size={11} /></button><button className="window-close" aria-label="창 닫기" title="닫기" onClick={() => bridge.close()}><X size={16} /></button></div></div>

    <aside className="sidebar">
      <div className="brand"><FormaMark /><div><span className="brand-name">Forma</span><span className="brand-caption">로컬 파일 변환</span></div></div>
      <span className="nav-label">보관함</span>
      <nav aria-label="파일 유형">{views.map(({ id, label, Icon }) => {
        const count = id === 'history' ? state.history.length : state.jobs.filter(job => inView(job, id)).length;
        return <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}><Icon size={18} strokeWidth={1.7} /><span>{label}</span>{count > 0 && <span className="nav-count">{new Intl.NumberFormat('ko-KR').format(count)}</span>}</button>;
      })}</nav>
      <div className="sidebar-bottom"><div className="local-note"><div className="local-note-icon"><ShieldCheck size={20} strokeWidth={1.6} /></div><div><strong>파일은 여기, 그대로.</strong><span>외부 업로드 없이 변환해요.</span></div></div><div className="sidebar-divider" /><button className="sidebar-tool" onClick={() => setDialog({ type: 'settings' })}><Settings2 size={17} strokeWidth={1.7} /><span>설정</span><kbd>Ctrl ,</kbd></button><button className="sidebar-tool support-tool" onClick={() => setDialog({ type: 'formats' })}><Info size={16} strokeWidth={1.7} /><span>지원 형식</span><span className="sidebar-version">v{capabilities.version}</span></button></div>
    </aside>

    <main className="main-area">
      <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div><button className="button add-button" title="파일 추가 (Ctrl+O)" onClick={addFiles}><Plus size={16} strokeWidth={2} /><span>파일 추가</span></button></header>
      <div className="workspace">
        {visibleJobs.length === 0 ? <div className="empty-workspace">
          {isHistory ? <div className="history-empty"><div className="empty-circle"><History size={30} strokeWidth={1.4} /></div><h2>아직 변환 기록이 없어요</h2><p>변환이 끝난 파일을 여기에서 다시 열 수 있습니다.</p><button className="button secondary" onClick={() => setView('all')}>파일 변환으로 이동<ArrowRight size={14} /></button></div> : <>
            <button className="drop-zone" onClick={addFiles} aria-label="파일을 선택하거나 여기에 끌어놓으세요">
              <FileIllustration /><h2>{view === 'image' ? '변환할 사진을 추가하세요' : view === 'document' ? '변환할 문서를 추가하세요' : view === 'pdf' ? '크기를 바꿀 PDF를 추가하세요' : '변환할 파일을 추가하세요'}</h2><p>{view === 'pdf' ? 'PDF를 끌어놓고 새 용지 크기를 고르세요.' : '파일을 여기로 끌어놓거나 아래 버튼을 눌러 주세요.'}</p><span className="drop-button"><Plus size={16} />{view === 'pdf' ? 'PDF 선택' : '파일 선택'}</span><span className="drop-shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>O</kbd></span>
            </button>
            {view === 'pdf' ? <div className="empty-formats"><span><Scaling size={15} />A4 · B4 · A3 · Letter</span><span className="formats-divider" /><span><FileText size={15} />PDF 페이지 크기 변경</span></div> : <div className="empty-formats"><span><Image size={15} />JPG · PNG · HEIC · WEBP</span><span className="formats-divider" /><span><FileText size={15} />PDF · HWP · HWPX · Office</span></div>}
            <div className="workflow-hint"><span><b>1</b>{view === 'pdf' ? 'PDF 추가' : '파일 추가'}</span><ArrowRight size={13} /><span><b>2</b>{view === 'pdf' ? '용지 크기' : '형식 선택'}</span><ArrowRight size={13} /><span><b>3</b>변환 완료</span></div>
          </>}
        </div> : <div className="populated-workspace">
          <div className="list-toolbar"><div className="list-title"><span>{isHistory ? '최근 변환' : '변환할 파일'}</span><span className="count-badge">{visibleJobs.length}</span></div><div className="list-tools">
            {!isHistory && view === 'pdf' && visiblePending.some(job => job.category === 'pdf' && job.format === 'pdf') && <div className="select-wrap batch-select"><select aria-label="PDF 용지 크기 한 번에 바꾸기" value="" onChange={event => applyPageSize(event.target.value)}><option value="">용지 크기</option>{pageSizeOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div>}
            {!isHistory && visiblePending.length > 0 && <div className="select-wrap batch-select"><select aria-label="출력 형식 한 번에 바꾸기" value="" onChange={event => applyFormat(event.target.value)}><option value="">한 번에 바꾸기</option>{availableFormats.map(format => <option value={format} key={format}>{displayFormat(format)}</option>)}</select></div>}
            {!isHistory && failed.length > 0 && <button className="text-button" onClick={() => action(() => bridge.retryFailed())}><RotateCcw size={14} />다시 시도</button>}
            {!isHistory && completed.length > 0 && <button className="text-button clear-button" onClick={() => action(() => bridge.clearCompleted())}><CheckCheck size={15} />완료 정리</button>}
            {isHistory && <button className="text-button" onClick={() => action(() => bridge.clearHistory())}><Trash2 size={14} />기록 지우기</button>}
          </div></div>
          <div className="job-list" role="list" aria-label={isHistory ? '변환 기록 목록' : '변환 파일 목록'}>{visibleJobs.map(job => <JobRow key={job.id} job={job} history={isHistory} bridge={bridge} onOptions={job => setDialog({ type: 'options', job })} onDetails={job => setDialog({ type: 'details', job })} onAction={action} />)}</div>
          {!isHistory && <button className="mini-drop" onClick={addFiles}><Plus size={16} /><span>{view === 'pdf' ? 'PDF를 더 추가하거나 여기로 끌어놓으세요' : '파일을 더 추가하거나 여기로 끌어놓으세요'}</span></button>}
          {isHistory && <p className="history-note">기록을 지워도 원본과 변환된 파일은 그대로 남아 있습니다.</p>}
        </div>}
      </div>

      <footer className="conversion-footer">
        <div className="destination-row"><button className="destination-button" onClick={() => action(() => bridge.chooseFolder())} title={state.settings.destination || '원본 옆의 변환된 파일 폴더'}><FolderOpen size={16} strokeWidth={1.7} /><span className="destination-label">저장 위치</span><span className="destination-path">{state.settings.destination || '원본 옆의 ‘변환된 파일’ 폴더'}</span><span className="destination-change">변경</span></button><span className="offline-indicator"><span />내 컴퓨터에서만</span></div>
        <div className="conversion-action-row"><div className="conversion-summary" aria-live="polite">
          {state.running ? <><div className="summary-title"><LoaderCircle size={15} className="spin" />파일을 변환하고 있어요<span className="summary-count">{state.finished} / {state.total}</span></div><div className="overall-progress" role="progressbar" aria-label="전체 변환 진행" aria-valuenow={state.finished} aria-valuemin={0} aria-valuemax={state.total || 1}><span style={{ width: `${state.total ? state.finished / state.total * 100 : 0}%` }} /></div></> : visiblePending.length > 0 ? <><div className="summary-title">{visiblePending.length}개 파일 준비됨<span className="summary-size">{formatBytes(allSize)}</span></div>{pdfPhotos.length >= 2 ? <label className="combine-checkbox"><input type="checkbox" checked={state.settings.combineImages} onChange={event => action(() => bridge.saveSettings({ combineImages: event.target.checked }))} /><span>사진을 PDF 하나로 합치기</span></label> : <p className="summary-description">{view === 'pdf' ? 'PDF 용지 크기를 고른 뒤 변환하세요.' : '원본 파일은 그대로 보관됩니다.'}</p>}</> : completed.length > 0 ? <><div className="summary-title summary-success"><Check size={16} />{completed.length}개 파일 변환 완료</div><p className="summary-description">파일 옆의 ‘열기’로 결과를 확인하세요.</p></> : <><div className="summary-title">파일을 추가하면 준비 끝.</div><p className="summary-description">{view === 'pdf' ? 'PDF를 추가하고 새 용지 크기를 고르세요.' : '사진과 문서, 여러 개도 한 번에 변환하세요.'}</p></>}
        </div><div className="convert-actions">{state.running ? <button className="button secondary cancel-all" onClick={() => action(() => bridge.cancel())}>전체 취소</button> : <button className="button primary convert-button" disabled={!ready || !visiblePending.length} onClick={() => action(() => bridge.start(visiblePending.map(job => job.id)))}><span>변환 시작</span>{visiblePending.length > 0 ? <span className="button-count">{visiblePending.length}</span> : <ArrowRight size={16} />}</button>}</div></div>
      </footer>
    </main>

    {dragging && <div className="drag-overlay"><div><ArrowDownToLine size={36} strokeWidth={1.5} /><h2>{view === 'pdf' ? '여기에 PDF를 놓으세요' : '여기에 파일을 놓으세요'}</h2><p>{view === 'pdf' ? '새 용지 크기를 고른 뒤 변환할 수 있습니다.' : '사진과 문서를 함께 추가할 수 있어요.'}</p></div></div>}
    {message && <div className="notification" role="status"><Info size={17} /><p>{message}</p><button className="icon-button" aria-label="알림 닫기" onClick={() => setMessage('')}><X size={16} /></button></div>}
    {dialog?.type === 'options' && <OptionsDialog job={dialog.job} settings={state.settings} onClose={closeDialog} onSave={options => bridge.updateJob({ id: dialog.job.id, options })} />}
    {dialog?.type === 'settings' && <SettingsDialog settings={state.settings} capabilities={capabilities} onClose={closeDialog} onSave={settings => bridge.saveSettings(settings)} onChooseFolder={() => action(() => bridge.chooseFolder())} />}
    {dialog?.type === 'details' && <Modal title={dialog.job.status === 'failed' ? '변환하지 못했어요' : '변환 안내'} description={dialog.job.name} onClose={closeDialog}><div className="modal-body details-body">{dialog.job.error && <div className="error-details"><CircleAlert size={19} /><p>{dialog.job.error}</p></div>}{dialog.job.warnings.map((warning, index) => <div className="inline-note" key={index}><Info size={17} /><p>{warning}</p></div>)}{dialog.job.outputs.length > 0 && <div className="output-paths"><span className="field-label">저장된 파일</span>{dialog.job.outputs.map(path => <p title={path} key={path}>{path}</p>)}</div>}<p className="field-help">원본 파일은 변경되지 않았습니다.</p></div><div className="modal-footer">{dialog.job.status === 'completed' && <button className="button secondary" onClick={() => action(() => bridge.showInFolder(dialog.job.id))}><FolderOpen size={15} />폴더 열기</button>}<button className="button primary" onClick={closeDialog}>확인</button></div></Modal>}
    {dialog?.type === 'formats' && <Modal title="어떤 파일을 변환할 수 있나요?" description="파일을 추가하면 가능한 출력 형식만 보여 드립니다." onClose={closeDialog} wide><div className="modal-body formats-body"><div className="format-family"><div className="family-heading"><Image size={19} /><h3>사진</h3></div><p>JPG · PNG · WEBP · AVIF · TIFF · HEIC/HEIF · BMP · GIF · SVG</p><span>사진 크기와 품질 조절, 사진을 PDF로 저장</span></div><div className="format-family"><div className="family-heading"><FileText size={19} /><h3>문서</h3></div><p>HWP · HWPX · DOC · DOCX · RTF · ODT · TXT</p><span>한글 문서와 워드 문서 변환, PDF·문서를 Markdown으로 정리</span></div><div className="format-family"><div className="family-heading"><Scaling size={19} /><h3>PDF</h3></div><p>PDF · A4 · A3 · B4 · B5 · Letter · Legal</p><span>PDF 페이지 크기 변경, 페이지별 사진·텍스트 추출</span></div><div className="format-family"><div className="family-heading"><Files size={19} /><h3>Office</h3></div><p>XLS · XLSX · CSV · PPT · PPTX</p><span>문서의 인쇄 설정을 따라 PDF로 변환</span></div><div className="inline-note"><ShieldCheck size={18} /><p>모든 변환은 이 컴퓨터에서 처리합니다. Office 문서와 PDF → DOCX 변환에는 설치된 Microsoft Office가 필요합니다.</p></div><p className="field-help">HWP 출력은 HWPX 형식으로 제공합니다. PDF로 저장할 때 A3·A4·B4·Letter 등 용지 크기를 고를 수 있습니다. 암호화·배포용 제한 문서와 스캔 PDF의 OCR은 지원하지 않습니다.</p></div><div className="modal-footer"><button className="button primary" onClick={closeDialog}>확인</button></div></Modal>}
  </div>;
}
