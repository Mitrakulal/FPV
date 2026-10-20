import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import {
  decodeTxFrame,
  encodeTxFrame,
  type ServerStatus,
  type TxFrame,
} from '../../../packages/protocol/protocol';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC_DIR = path.resolve(process.cwd(), process.env.PUBLIC_DIR ?? 'apps/server/public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const t0 = Date.now();
let lastFrame: TxFrame | null = null;
let lastFrameAt = 0;
const frameTimes: number[] = [];
let droppedFrames = 0;

/** Frames received in the last second. */
function measuredHz(): number {
  const now = Date.now();
  while (frameTimes.length > 0 && now - (frameTimes[0] ?? now) > 1000) frameTimes.shift();
  return frameTimes.length;
}

const sims = new Set<WebSocket>();
const txs = new Set<WebSocket>();

function log(...args: unknown[]) {
  const stamp = new Date().toISOString().slice(11, 23);
  console.log(`[${stamp}]`, ...args);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status(), null, 2));
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`not found: ${pathname}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const role = url.searchParams.get('role') === 'tx' ? 'tx' : 'sim';
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, role);
  });
});

wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, role: 'tx' | 'sim') => {
  (ws as WebSocket & { role: 'tx' | 'sim' }).role = role;
  if (role === 'tx') {
    txs.add(ws);
    log(`tx connected  (${txs.size} tx, ${sims.size} sim)`);
  } else {
    sims.add(ws);
    log(`sim connected (${txs.size} tx, ${sims.size} sim)`);
    if (lastFrame) ws.send(Buffer.from(encodeForClient(lastFrame)));
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (role !== 'tx') return;
      const frame = decodeTxFrame(new Uint8Array(data as Buffer));
      if (!frame) {
        droppedFrames++;
        return;
      }
      lastFrame = frame;
      lastFrameAt = Date.now();
      frameTimes.push(lastFrameAt);
      if (frameTimes.length > 600) frameTimes.shift();
      const out = Buffer.from(encodeForClient(frame));
      for (const sim of sims) if (sim.readyState === WebSocket.OPEN) sim.send(out);
      return;
    }

    let msg: { type?: string; t?: number } = {};
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: msg.t ?? 0, st: Date.now() }));
    } else if (msg.type === 'hello') {
      ws.send(JSON.stringify({ type: 'hello', role, serverT: Date.now() }));
    } else if (msg.type === 'reset' && role === 'tx') {
      // Phone-side R button: restart the run on every connected sim.
      const payload = JSON.stringify({ type: 'reset' });
      for (const sim of sims) if (sim.readyState === WebSocket.OPEN) sim.send(payload);
      log('reset requested by tx');
    }
  });

  ws.on('close', () => {
    sims.delete(ws);
    txs.delete(ws);
    log(`${role} disconnected (${txs.size} tx, ${sims.size} sim)`);
    if (role === 'tx' && txs.size === 0) {
      broadcastStatus(true);
    }
  });

  ws.on('error', (err) => log(`${role} error:`, err.message));
  broadcastStatus();
});

// Re-encode so a decoded frame is normalised before leaving the server.
function encodeForClient(frame: TxFrame): Uint8Array {
  return encodeTxFrame(frame);
}

function status(): ServerStatus {
  const now = Date.now();
  const age = lastFrameAt ? now - lastFrameAt : Number.POSITIVE_INFINITY;
  return {
    type: 'status',
    tx: age < 250,
    txAgeMs: Number.isFinite(age) ? Math.round(age) : -1,
    txHz: measuredHz(),
    sims: sims.size,
    txs: txs.size,
    t: now,
  };
}

function broadcastStatus(force = false) {
  if (!force && sims.size === 0 && txs.size === 0) return;
  const payload = JSON.stringify(status());
  for (const ws of [...sims, ...txs]) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

setInterval(() => broadcastStatus(), 250);

setInterval(() => {
  if (droppedFrames > 0) {
    log(`dropped ${droppedFrames} malformed frame(s) — check the phone page version`);
    droppedFrames = 0;
  }
}, 5000);

server.listen(PORT, HOST, () => {
  log(`fpv rig server on http://${HOST}:${PORT}  (uptime from ${new Date(t0).toISOString()})`);
  log(`  sim : http://${HOST}:${PORT}/sim/`);
  log(`  tx  : http://${HOST}:${PORT}/tx/   (phone: http://127.0.0.1:${PORT}/tx/ over adb reverse)`);
});
