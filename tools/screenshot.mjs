/**
 * Headless checks + screenshots for the sim and transmitter pages.
 * Usage: node tools/screenshot.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1280,720',
  ],
});

const errors = [];
function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`${label} requestfailed: ${r.url()}`));
}

// --- sim, parked -----------------------------------------------------------
const page = await browser.newPage();
watch(page, 'sim');
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://127.0.0.1:8080/sim/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'scratch/sim-grounded.png' });

// --- sim, flying (keyboard arm + throttle) --------------------------------
await page.keyboard.press('Space');
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 900));
await page.keyboard.up('KeyW');
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'scratch/sim-flying.png' });

const stats = await page.evaluate(() => ({
  fps: document.getElementById('fps')?.textContent,
  frameMs: document.getElementById('frameMs')?.textContent,
  tickRate: document.getElementById('tickRate')?.textContent,
  alt: document.getElementById('alt')?.textContent,
  thr: document.getElementById('thrTxt')?.textContent,
  arm: document.getElementById('armPill')?.textContent,
  banner: document.getElementById('banner')?.hidden ? '' : document.getElementById('banner')?.textContent,
}));

// --- transmitter page ------------------------------------------------------
const tx = await browser.newPage();
watch(tx, 'tx');
await tx.setViewport({ width: 960, height: 460, isMobile: true, hasTouch: true });
await tx.goto('http://127.0.0.1:8080/tx/', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
await tx.screenshot({ path: 'scratch/tx.png' });

const txStats = await tx.evaluate(() => ({
  link: document.getElementById('linkText')?.textContent,
  arm: document.getElementById('armBtn')?.textContent,
  rtt: document.getElementById('rtt')?.textContent,
  twoSticks: document.querySelectorAll('.stick').length,
}));

console.log('sim:', stats);
console.log('tx :', txStats);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no runtime errors');

await browser.close();
process.exit(errors.length ? 1 : 0);
