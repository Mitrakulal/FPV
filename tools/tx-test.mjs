/**
 * Touch test for the phone page: drag the throttle up, let go, check it holds,
 * then arm and confirm the server sees a live 250 Hz-ish stream.
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8080';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=960,460'],
});

const page = await browser.newPage();
await page.setViewport({ width: 960, height: 460, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/tx/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));

const box = await page.evaluate(() => {
  const el = document.getElementById('leftStick');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height };
});
if (!box) throw new Error('no left stick');

const readThrottle = () =>
  page.evaluate(() => ({
    pct: document.getElementById('thrBig')?.textContent,
    arm: document.getElementById('armBtn')?.textContent,
    link: document.getElementById('linkText')?.textContent,
    hz: document.getElementById('rate')?.textContent,
    msg: document.getElementById('msg')?.textContent,
  }));

console.log('rest      ', await readThrottle());

// dragging the throttle stick up should land around 60-80% and stay there
const top = box.y - box.h * 0.34;
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x, top, { steps: 8 });
await new Promise((r) => setTimeout(r, 150));
console.log('dragging  ', await readThrottle());
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const held = await readThrottle();
console.log('released  ', held);

// holding mid throttle must refuse to arm
await page.click('#armBtn');
await new Promise((r) => setTimeout(r, 200));
const refused = await readThrottle();
console.log('arm@high ', refused);

// back to the bottom, then arm
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x, box.y + box.h * 0.45, { steps: 8 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
await page.click('#armBtn');
await new Promise((r) => setTimeout(r, 500));
const armed = await readThrottle();
console.log('armed     ', armed);

const health = await fetch(`${BASE}/health`).then((r) => r.json());
console.log('server    ', health);

const checks = [
  ['throttle holds after release', held.pct === '66%' || Number.parseInt(held.pct ?? '0') > 50],
  ['refuses to arm at high throttle', refused.arm === 'DISARMED'],
  ['arms at low throttle', armed.arm === 'ARMED'],
  ['server sees live tx', health.tx === true && health.txHz > 40],
  ['no page errors', errors.length === 0],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (errors.length) console.log(errors.join('\n'));
await page.screenshot({ path: 'scratch/tx-armed.png' });
await browser.close();
process.exit(failed ? 1 : 0);
