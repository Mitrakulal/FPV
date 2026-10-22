import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps', 'launcher', 'FPVLauncher.cs');
const manifest = path.join(root, 'apps', 'launcher', 'app.manifest');
const outDir = path.join(root, 'dist', 'launcher');
const outFile = path.join(outDir, 'FPV.exe');

function findCsc() {
  const windir = process.env.WINDIR ?? 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('csc.exe not found. This build needs the .NET Framework 4.x compiler included with Windows.');
}

if (!fs.existsSync(source)) {
  throw new Error(`launcher source not found: ${source}`);
}

fs.mkdirSync(outDir, { recursive: true });

const csc = findCsc();
const args = [
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  '/warn:4',
  '/out:' + outFile,
  '/win32manifest:' + manifest,
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  source,
];

execFileSync(csc, args, { cwd: root, stdio: 'inherit' });
console.log(`[launcher] built ${path.relative(root, outFile)}`);
