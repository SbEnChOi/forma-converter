import fs from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const entries = [];
const ui = new Set(['node_modules/react', 'node_modules/react-dom', 'node_modules/lucide-react']);
for (const [directory, info] of Object.entries(lock.packages)) {
  if (!directory || (info.dev && !ui.has(directory))) continue;
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const files = await fs.readdir(directory);
    const licenseFiles = files.filter((file) => /^(?:licen[cs]e|copying|notice)(?:\.[^.]+)?$/i.test(file));
    const texts = [];
    for (const file of licenseFiles) { const target = path.join(directory, file); if ((await fs.stat(target)).isFile()) texts.push(await fs.readFile(target, 'utf8')); }
    entries.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? info.license ?? '', text: texts.join('\n\n') });
  } catch {}
}
entries.sort((a, b) => a.name.localeCompare(b.name));
const header = '# Third-party notices\n\nForma includes the following open-source components. Runtime package license files are also retained with their packages. Electron and Chromium notices are distributed in the executable folder. No Microsoft Office or Windows font binaries are redistributed.\n\n';
const handoc = '## HanDoc (vendored)\n\nSource: https://github.com/muin-company/handoc\nCommit: ' + (await fs.readFile('vendor/handoc/UPSTREAM_COMMIT', 'utf8')).trim() + '\n\nForma modifications: resolve image manifest references, normalize DOCX colors and image dimensions.\n\n' + await fs.readFile('vendor/handoc/LICENSE', 'utf8') + '\n\n';
await fs.writeFile('THIRD_PARTY_NOTICES.md', header + handoc + entries.map((entry) => `## ${entry.name} ${entry.version}\n\nLicense: ${typeof entry.license === 'string' ? entry.license : JSON.stringify(entry.license)}\n\n${entry.text}\n`).join('\n'));
console.log(`Wrote notices for ${entries.length} installed components and HanDoc.`);
