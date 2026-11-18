import { createServer } from 'vite';
import electron from 'electron';
import { spawn } from 'node:child_process';

const server = await createServer();
await server.listen();
const environment = { ...process.env, FORMA_DEV_URL: 'http://127.0.0.1:5188' };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { env: environment, stdio: 'inherit', windowsHide: true });
child.once('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => child.kill());
