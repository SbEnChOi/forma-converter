import { parentPort, workerData } from 'node:worker_threads';
import { convertFile } from './convert.mjs';

const controller = new AbortController();
parentPort.on('message', (message) => { if (message === 'cancel') controller.abort(); });
try {
  const result = await convertFile({ ...workerData, signal: controller.signal }, (phase) => parentPort.postMessage({ type: 'phase', phase }));
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: { name: error.name, message: error.message, details: error.cause?.stack || error.stack } });
} finally { parentPort.close(); }
