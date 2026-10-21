import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8080';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});

async function runMap(map) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${BASE}/sim/?map=${map}&alt=3&fixed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));

  async function measure(label) {
    await new Promise((r) => setTimeout(r, 1200));
    const ms = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const times = [];
          let prev = performance.now();
          function tick(t) {
            times.push(t - prev);
            prev = t;
            if (times.length < 180) requestAnimationFrame(tick);
            else {
              const ok = times.slice(30).sort((a, b) => a - b);
              resolve(ok[Math.floor(ok.length * 0.5)]);
            }
          }
          requestAnimationFrame(tick);
        }),
    );
    const q = await page.evaluate(() => window.fpv.quality());
    console.log(
      `${map} ${label}: ${ms.toFixed(1)} ms (${(1000 / ms).toFixed(0)} fps) dpr=${q.dpr.toFixed(2)} stage=${q.qualityStage}`,
    );
  }

  await measure('baseline 1');
  await measure('baseline 2');

  await page.evaluate(() => {
    const { post } = window.fpv;
    post.__orig = post.render.bind(post);
    post.render = () => {};
  });
  await measure('no post');

  await page.evaluate(() => {
    const { post, renderer, activeWorld, camera } = window.fpv;
    const world = activeWorld();
    post.render = () => {
      renderer.setRenderTarget(null);
      renderer.render(world.scene, camera);
    };
  });
  await measure('scene direct to canvas');

  await page.evaluate(() => {
    const { renderer } = window.fpv;
    renderer.shadowMap.enabled = false;
  });
  await measure('scene direct, no shadow');

  await page.evaluate(() => {
    const { post, renderer, activeWorld, camera } = window.fpv;
    const world = activeWorld();
    post.render = post.__orig;
    renderer.shadowMap.enabled = true;
    world.scene.environment = null;
  });
  await measure('post, env off');

  await page.evaluate(() => {
    const { post } = window.fpv;
    post.sceneRT.samples = 0;
    post.sceneRT.dispose();
    post.setSize(window.innerWidth, window.innerHeight, window.fpv.renderer.getPixelRatio());
  });
  await measure('post, env off, msaa 0');

  await page.close();
}

await runMap('airfield');
await runMap('indoor');
await browser.close();
