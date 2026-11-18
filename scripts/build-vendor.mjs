import { build } from 'esbuild';
import path from 'node:path';

const packages = ['document-model', 'hwpx-core', 'hwpx-parser', 'hwpx-writer', 'docx-reader', 'docx-writer'];
await build({
  entryPoints: ['vendor/handoc-entry.ts'], outfile: 'vendor/handoc.mjs',
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: Object.fromEntries(packages.map((name) => [`@handoc/${name}`, path.resolve(`vendor/handoc/packages/${name}/src/index.ts`)])),
  logLevel: 'info',
});
