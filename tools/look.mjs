/**
 * Dev eyeball shots: menu, both maps, overview, eye level, chase.
 * Usage: node tools/look.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8091';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});

const errors = [];
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
await page.setViewport({ width: 1280, height: 720 });

const shots = [
  ['menu', '/sim/'],
  ['airfield-overview', '/sim/?map=airfield&view=overview'],
  ['airfield-eye', '/sim/?map=airfield&alt=2.5'],
  ['airfield-chase', '/sim/?map=airfield&alt=3&view=chase'],
  ['indoor-overview', '/sim/?map=indoor&view=overview'],
  ['indoor-eye', '/sim/?map=indoor'],
  ['indoor-chase', '/sim/?map=indoor&view=chase&alt=2'],
];

for (const [name, url] of shots) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `scratch/${name}.png` });
}

const stats = await page.evaluate(() => ({
  map: document.getElementById('mapName')?.textContent,
  progress: document.getElementById('progress')?.textContent,
  fps: document.getElementById('fps')?.textContent,
  frameMs: document.getElementById('frameMs')?.textContent,
}));
console.log('stats:', stats);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no runtime errors');
await browser.close();
