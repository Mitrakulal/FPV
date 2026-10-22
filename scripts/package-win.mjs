import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const releaseRoot = path.join(root, 'dist', 'release');
const appName = `FPV-Rig-${version}`;
const appDir = path.join(releaseRoot, appName);
const zipPath = path.join(releaseRoot, `${appName}-portable.zip`);
const payloadDir = path.join(releaseRoot, 'payload');
const payloadZip = path.join(releaseRoot, 'payload.zip');
const setupPath = path.join(releaseRoot, `${appName}-Setup.exe`);
const manifest = path.join(root, 'apps', 'launcher', 'app.manifest');

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function write(destination, text) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text, 'utf8');
}

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

const csc = findCsc();
const common = path.join(root, 'packaging', 'installer', 'Common.cs');

function compileCSharp(source, output, extraArgs = []) {
  const args = [
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    '/warn:4',
    '/out:' + output,
    '/win32manifest:' + manifest,
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    ...extraArgs,
    common,
    ...source,
  ];
  run(csc, args);
}

console.log(`[package] ${appName}`);

run(process.execPath, ['scripts/build.mjs']);
run(process.execPath, ['scripts/build-launcher.mjs']);

fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

copyFile(path.join(root, 'dist', 'launcher', 'FPV.exe'), path.join(appDir, 'FPV.exe'));
copyFile(process.execPath, path.join(appDir, 'node', 'node.exe'));
copyFile(path.join(root, 'dist', 'server.js'), path.join(appDir, 'server', 'server.js'));
write(path.join(appDir, 'server', 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');
copy(path.join(root, 'apps', 'server', 'public'), path.join(appDir, 'server', 'public'));
copy(path.join(root, 'node_modules', 'ws'), path.join(appDir, 'server', 'node_modules', 'ws'));

const adbSource = path.join(root, 'tools', 'platform-tools');
for (const name of ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt', 'source.properties']) {
  const source = path.join(adbSource, name);
  if (fs.existsSync(source)) copyFile(source, path.join(appDir, 'tools', 'adb', name));
}

copyFile(path.join(root, 'LICENSE'), path.join(appDir, 'LICENSE'));
write(path.join(appDir, 'portable.txt'), 'Portable build: settings and logs live in the data folder next to FPV.exe.\n');
write(path.join(appDir, 'VERSION.txt'), `${pkg.name} ${version}\nBuilt ${new Date().toISOString()}\n`);
write(path.join(appDir, 'START-HERE.txt'), [
  'FPV RIG - portable build',
  '',
  '1. Double-click FPV.exe.',
  '2. On the Android phone, enable Developer options and USB debugging.',
  '3. Connect the phone with a data-capable USB cable and tap Allow.',
  '4. Wait for PHONE to turn green. The transmitter page opens automatically.',
  '',
  'The simulator opens in Chrome or Edge app mode. If neither is installed,',
  'the default browser is used.',
  '',
  'No phone? Click Open Simulator and fly with the keyboard:',
  '  W / S throttle, arrow keys pitch/roll, A / D yaw, Space arm, R restart.',
  '',
  'Everything runs on this PC. The server binds to 127.0.0.1 only.',
  '',
  'Logs: data\\logs\\launcher.log and data\\logs\\server.log',
  'Phone URL: http://127.0.0.1:8080/tx/ (the launcher picks the next free port if 8080 is busy)',
  '',
  'If Windows SmartScreen appears, this build is unsigned. Choose More info -> Run anyway.',
].join('\r\n') + '\r\n');
write(path.join(appDir, 'THIRD-PARTY.md'), [
  '# Third-party components',
  '',
  '- Node.js runtime: MIT and bundled third-party licenses; https://nodejs.org/en/about/legal',
  '- ws: MIT; see server/node_modules/ws/LICENSE',
  '- Android platform-tools / adb: Android SDK license; see tools/adb/NOTICE.txt',
  '- three.js: MIT; served inside the simulator bundle.',
].join('\n') + '\n');

fs.mkdirSync(releaseRoot, { recursive: true });
if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
console.log('[package] creating portable zip...');
run('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -LiteralPath '${appDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`,
]);

console.log('[package] building installer payload...');
copy(appDir, payloadDir);
fs.rmSync(path.join(payloadDir, 'portable.txt'), { force: true });
write(path.join(payloadDir, 'START-HERE.txt'), [
  'FPV RIG',
  '',
  'This copy is installed for the current Windows user.',
  'Launch it from the Start menu or the desktop shortcut.',
  '',
  'Settings and logs live in %LOCALAPPDATA%\\FPV.',
  'Everything runs on this PC. The server binds to 127.0.0.1 only.',
  '',
  'If Windows SmartScreen appears, this build is unsigned. Choose More info -> Run anyway.',
].join('\r\n') + '\r\n');

compileCSharp([path.join(root, 'packaging', 'installer', 'Uninstaller.cs')], path.join(payloadDir, 'Uninstall.exe'));

if (fs.existsSync(payloadZip)) fs.rmSync(payloadZip, { force: true });
run('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -Path '${path.join(payloadDir, '*').replace(/'/g, "''")}' -DestinationPath '${payloadZip.replace(/'/g, "''")}' -CompressionLevel Optimal`,
]);

console.log('[package] embedding payload and building setup...');
compileCSharp([path.join(root, 'packaging', 'installer', 'Installer.cs')], setupPath, ['/resource:' + payloadZip + ',payload.zip']);

fs.rmSync(payloadDir, { recursive: true, force: true });
fs.rmSync(payloadZip, { force: true });

const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
const setupMb = (fs.statSync(setupPath).size / 1024 / 1024).toFixed(1);
console.log(`[package] ${path.relative(root, appDir)}`);
console.log(`[package] ${path.relative(root, zipPath)} (${zipMb} MB)`);
console.log(`[package] ${path.relative(root, setupPath)} (${setupMb} MB)`);
