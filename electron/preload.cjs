const { contextBridge, ipcRenderer, webUtils } = require('electron');

const methods = ['getState', 'chooseFiles', 'addPaths', 'chooseFolder', 'updateJob', 'removeJob', 'start', 'cancel', 'clearCompleted', 'retryFailed', 'openOutput', 'showInFolder', 'getSettings', 'saveSettings', 'clearHistory', 'getCapabilities'];
const api = Object.fromEntries(methods.map((method) => [method, (...args) => ipcRenderer.invoke(`forma:${method}`, ...args)]));
api.subscribe = (listener) => {
  const handler = (_event, state) => listener(state);
  ipcRenderer.on('forma:state', handler);
  return () => ipcRenderer.removeListener('forma:state', handler);
};
for (const action of ['minimize', 'maximize', 'close']) api[action] = () => ipcRenderer.send('forma:window', action);
api.droppedPaths = (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
contextBridge.exposeInMainWorld('forma', api);
