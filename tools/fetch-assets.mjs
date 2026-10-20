/**
 * Pulls the CC0 textures and sky used by the renderer into public/assets.
 * Poly Haven assets are CC0 (public domain) — no attribution required, free to ship.
 * Run once:  node tools/fetch-assets.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('apps/server/public/assets');
const TEX = path.join(ROOT, 'tex');
const HDRI = path.join(ROOT, 'hdri');

const TEXTURES = [
  'asphalt_02',
  'concrete_floor_worn_001',
  'concrete_wall_008',
  'rusty_metal_02',
  'corrugated_iron_02',
  'grass_ground',
  'gravel_floor',
];

const MAPS = ['diff', 'nor_gl', 'rough'];

const SKY = {
  name: 'sky.hdr',
  url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
};

async function download(url, dest) {
  try {
    const stat = await fs.stat(dest);
    if (stat.size > 1024) {
      console.log(`skip   ${path.basename(dest)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  } catch {
    /* missing */
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  console.log(`get    ${path.basename(dest)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

await fs.mkdir(TEX, { recursive: true });
await fs.mkdir(HDRI, { recursive: true });

for (const id of TEXTURES) {
  for (const map of MAPS) {
    const url = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${map}_1k.jpg`;
    await download(url, path.join(TEX, `${id}_${map}.jpg`));
  }
}

await download(SKY.url, path.join(HDRI, SKY.name));

console.log('\nassets ready in apps/server/public/assets (CC0, Poly Haven)');
