/**
 * End-to-end check: server up, static pages served, phone frames reach the sim.
 * Run with the server already running:  node tools/smoke.ts
 */
import {
  FLAG_ARMED,
  FLAG_HOLD,
  decodeTxFrame,
  encodeTxFrame,
} from '../packages/protocol/protocol.ts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8080';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    console.error(`FAIL  ${message}`);
    process.exit(1);
  }
  console.log(`ok    ${message}`);
}

const health = await fetch(`${BASE}/health`).then((r) => r.json());
assert(health && typeof health.tx === 'boolean', 'health endpoint responds');

for (const path of ['/sim/', '/tx/', '/sim/sim.js', '/tx/tx.js']) {
  const res = await fetch(`${BASE}${path}`);
  assert(res.ok, `GET ${path} -> ${res.status}`);
}

await new Promise<void>((resolve, reject) => {
  const sim = new WebSocket(`${BASE.replace('http', 'ws')}/ws?role=sim`);
  const tx = new WebSocket(`${BASE.replace('http', 'ws')}/ws?role=tx`);
  let received = 0;
  let bad = 0;
  let resetSeen = false;

  sim.binaryType = 'arraybuffer';
  sim.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data) as { type?: string };
        if (msg.type === 'reset') resetSeen = true;
      } catch {
        /* ignore */
      }
      return;
    }
    const frame = decodeTxFrame(ev.data as ArrayBuffer);
    if (!frame) bad++;
    else received++;
  };

  sim.onopen = () => {
    tx.onopen = async () => {
      // busy-pace at 250 Hz: setTimeout(4) is clamped to ~15 ms on Windows
      const start = performance.now();
      let sent = 0;
      while (performance.now() - start < 1000) {
        const due = Math.floor((performance.now() - start) / 4);
        if (due > sent) {
          tx.send(
            encodeTxFrame({
              seq: sent,
              tUs: (sent * 4000) >>> 0,
              throttle: 300,
              yaw: 0,
              pitch: 100,
              roll: -100,
              flags: FLAG_ARMED | FLAG_HOLD,
              mode: 2,
              aux: 0,
            }),
          );
          sent++;
        }
      }
      const status = await fetch(`${BASE}/health`).then((r) => r.json());
      tx.send(JSON.stringify({ type: 'reset' }));
      await sleep(400);
      try {
        assert(bad === 0, 'every forwarded frame decodes');
        assert(received > 150, `sim received ${received}/200 frames`);
        assert(status.tx === true, 'server marks TX link live while frames arrive');
        assert(status.txHz > 150, `server measured ${status.txHz} Hz from the phone`);
        assert(resetSeen, 'phone R button resets the sim');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        sim.close();
        tx.close();
      }
    };
    tx.onerror = () => reject(new Error('tx socket failed'));
  };
  sim.onerror = () => reject(new Error('sim socket failed'));
});

await sleep(300);
console.log('\nall smoke checks passed');
process.exit(0);
