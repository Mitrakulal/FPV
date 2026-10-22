import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, 'tools');
const target = path.join(tools, 'platform-tools');
const adb = path.join(target, 'adb.exe');

if (fs.existsSync(adb)) {
  console.log('[adb] bundled platform-tools already present');
  process.exit(0);
}

const url = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const zip = path.join(os.tmpdir(), `platform-tools-${process.pid}.zip`);
console.log('[adb] downloading Android platform-tools...');
const response = await fetch(url);
if (!response.ok) throw new Error(`platform-tools download failed: HTTP ${response.status}`);
fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));

fs.mkdirSync(tools, { recursive: true });
console.log('[adb] extracting...');
execFileSync('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${tools.replace(/'/g, "''")}' -Force`,
], { stdio: 'inherit' });
fs.rmSync(zip, { force: true });

if (!fs.existsSync(adb)) {
  throw new Error(`adb.exe was not found after extracting platform-tools: ${adb}`);
}
console.log(`[adb] ready: ${path.relative(root, adb)}`);
