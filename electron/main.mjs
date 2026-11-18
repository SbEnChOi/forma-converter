import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobManager } from '../engine/jobs.mjs';
import { supportedExtensions } from '../engine/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const devUrl = !app.isPackaged && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.FORMA_DEV_URL || '') ? process.env.FORMA_DEV_URL : null;
if (!app.isPackaged && process.env.FORMA_TEST_PROFILE) app.setPath('userData', path.resolve(process.env.FORMA_TEST_PROFILE));
app.setName('Forma');
app.setAppUserModelId('local.forma.converter');

let window, manager, capabilities;
let closing = false, allowingQuit = false, quitting = false;

async function getCapabilities() {
  try {
    const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @{word=($null -ne [type]::GetTypeFromProgID('Word.Application')); excel=($null -ne [type]::GetTypeFromProgID('Excel.Application')); powerpoint=($null -ne [type]::GetTypeFromProgID('PowerPoint.Application'))} | ConvertTo-Json -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000, encoding: 'utf8' });
    return { ...JSON.parse(stdout.trim()), version: app.getVersion() };
  } catch { return { word: false, excel: false, powerpoint: false, version: app.getVersion() }; }
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('앱 창을 확인하지 못했습니다.');
}

function jobFor(id) {
  if (typeof id !== 'string' || id.length > 100) throw new Error('파일을 다시 선택해 주세요.');
  const job = manager.find(id);
  if (!job || job.status !== 'completed' || !job.outputs.length) throw new Error('완료된 변환 결과를 선택해 주세요.');
  return job;
}

async function validOutput(id) {
  const job = jobFor(id);
  const target = job.outputs[0];
  if (!path.isAbsolute(target) || !['jpg', 'png', 'webp', 'avif', 'tiff', 'pdf', 'docx', 'hwpx', 'txt', 'html', 'md', 'xlsx', 'csv', 'pptx'].includes(path.extname(target).slice(1).toLowerCase())) throw new Error('결과 파일 경로를 확인해 주세요.');
  try { if (!(await fs.stat(target)).isFile()) throw new Error(); }
  catch { throw new Error('결과 파일을 찾지 못했습니다. 이동하거나 삭제되었는지 확인해 주세요.'); }
  return { job, target };
}

function registerApi() {
  const handlers = {
    getState: () => manager.snapshot(),
    getCapabilities: () => capabilities,
    getSettings: () => ({ ...manager.settings }),
    chooseFiles: async (preferredFormat) => {
      const pdfOnly = preferredFormat === 'pdf';
      const result = await dialog.showOpenDialog(window, {
        title: pdfOnly ? '크기를 바꿀 PDF 선택' : '변환할 파일 선택',
        buttonLabel: '추가',
        properties: ['openFile', 'multiSelections'],
        filters: pdfOnly
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [{ name: '사진과 문서', extensions: supportedExtensions }, { name: '모든 파일', extensions: ['*'] }],
      });
      if (!result.canceled) await manager.add(result.filePaths, preferredFormat);
    },
    addPaths: (paths, preferredFormat) => manager.add(paths, preferredFormat),
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog(window, { title: '변환 결과 저장 폴더', buttonLabel: '이 폴더에 저장', properties: ['openDirectory', 'createDirectory'], ...(manager.settings.destination ? { defaultPath: manager.settings.destination } : {}) });
      if (!result.canceled) manager.saveSettings({ destination: result.filePaths[0] });
    },
    saveSettings: (settings) => manager.saveSettings(settings),
    updateJob: (value) => {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string') throw new Error('파일 설정을 확인해 주세요.');
      manager.update(value);
    },
    removeJob: (id) => manager.remove(id),
    start: (ids) => manager.start(ids),
    cancel: (id) => manager.cancel(id),
    clearCompleted: () => manager.clearCompleted(),
    retryFailed: () => manager.retryFailed(),
    clearHistory: () => manager.clearHistory(),
    openOutput: async (id) => {
      const { job, target } = await validOutput(id);
      const error = await shell.openPath(job.outputs.length > 1 ? path.dirname(target) : target);
      if (error) throw new Error('결과를 열지 못했습니다. 저장 폴더에서 파일을 확인해 주세요.');
    },
    showInFolder: async (id) => { const { target } = await validOutput(id); shell.showItemInFolder(target); },
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`forma:${name}`, async (event, ...args) => {
    trusted(event);
    try { return await handler(...args); }
    catch (error) {
      void log(error);
      throw new Error(error.message || '작업을 완료하지 못했습니다. 다시 시도해 주세요.');
    }
  });
  ipcMain.on('forma:window', (event, action) => {
    trusted(event);
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
}

async function log(error) {
  try { await fs.appendFile(path.join(app.getPath('userData'), 'diagnostic.log'), `${new Date().toISOString()} ${error.details || error.stack || error}\n`, 'utf8'); } catch {}
}

async function createWindow() {
  window = new BrowserWindow({
    title: 'Forma', width: 1100, height: 790, minWidth: 840, minHeight: 600,
    frame: false, show: false, backgroundColor: '#f7f7f9',
    icon: path.join(root, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(root, 'electron', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  window.webContents.on('render-process-gone', (_event, details) => { void log(new Error(`화면 종료: ${details.reason}`)); });
  window.on('close', async (event) => {
    if (!manager.running || closing || quitting) return;
    event.preventDefault();
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '변환 중입니다', message: '변환을 중단하고 Forma를 닫을까요?', detail: '완료한 파일은 저장한 폴더에 남습니다.', buttons: ['계속 변환', '중단하고 닫기'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) { closing = true; await manager.shutdown(); window.close(); }
  });
  window.once('ready-to-show', () => { if (!process.env.FORMA_TEST_HIDDEN || app.isPackaged) window.show(); });
  manager.on('change', (state) => { if (window && !window.isDestroyed()) window.webContents.send('forma:state', state); });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(root, 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(?:file|data|blob|devtools):/.test(details.url) || (devUrl && (details.url.startsWith(devUrl + '/') || details.url.startsWith(devUrl.replace('http:', 'ws:') + '/')));
      callback({ cancel: !allowed });
    });
    capabilities = await getCapabilities();
    manager = new JobManager({ userData: app.getPath('userData'), capabilities });
    await manager.initialize();
    manager.on('diagnostic', (error) => { void log(error); });
    registerApi();
    await createWindow();
  }).catch(async (error) => { await log(error); dialog.showErrorBox('Forma를 시작하지 못했습니다', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (allowingQuit || !manager) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    manager.shutdown().finally(() => { allowingQuit = true; app.quit(); });
  });
}
