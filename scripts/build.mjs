import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    entryPoints: ['apps/sim/src/main.ts'],
    outfile: 'apps/server/public/sim/sim.js',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    minify: true,
    logLevel: 'info',
  },
  {
    entryPoints: ['apps/tx/src/main.ts'],
    outfile: 'apps/server/public/tx/tx.js',
    bundle: true,
    format: 'esm',
    target: 'es2020',
    sourcemap: false,
    minify: true,
    logLevel: 'info',
  },
  {
    entryPoints: ['apps/server/src/server.ts'],
    outfile: 'dist/server.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    sourcemap: false,
    logLevel: 'info',
  },
];

if (watch) {
  const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[build] watching…');
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log('[build] ok');
}
