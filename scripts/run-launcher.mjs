import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(root, 'dist', 'launcher', 'FPV.exe');
const result = spawnSync(exe, [], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 0);
