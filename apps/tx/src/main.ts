import {
  FLAG_ANGLE,
  FLAG_ARMED,
  FLAG_HOLD,
  encodeTxFrame,
  type TxFrame,
} from '../../../packages/protocol/protocol';

type ThrottleMode = 'hold' | 'spring';

interface Settings {
  mode: 1 | 2;
  throttle: ThrottleMode;
  expo: number; // 0..1
  deadband: number; // 0..0.1
  scale: number; // 0.7..1.3
  haptics: boolean;
  invertPitch: boolean;
  invertYaw: boolean;
}

const DEFAULTS: Settings = {
  mode: 2,
  throttle: 'hold',
  expo: 0.35,
  deadband: 0.02,
  scale: 1,
  haptics: true,
  invertPitch: false,
  invertYaw: false,
};

const STORE_KEY = 'fpv.tx.settings.v2';

// Knob diameter at 100% size. It is deliberately small relative to the stick:
// the travel left over is what your thumb actually gets to use.
const KNOB_BASE = 46;

function applyKnobSize() {
  document.documentElement.style.setProperty('--knob', `${Math.round(KNOB_BASE * settings.scale)}px`);
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode, ignore */
  }
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function expo(v: number, amount: number): number {
  return (1 - amount) * v + amount * v * v * v;
}

function withDeadband(v: number, db: number): number {
  const a = Math.abs(v);
  if (a <= db) return 0;
  const scaled = (a - db) / (1 - db);
  return Math.sign(v) * clamp(scaled, 0, 1);
}

class Stick {
  x = 0;
  y = 0;
  private pointerId: number | null = null;
  private radius = 1;

  constructor(
    private readonly el: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly springX: boolean,
    private readonly springY: boolean,
    private readonly onInput: () => void,
    private readonly onRelease: () => void,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('lostpointercapture', this.up);
    this.measure();
    window.addEventListener('resize', () => this.measure());
    this.paint();
  }

  measure() {
    const rect = this.el.getBoundingClientRect();
    const knobRect = this.knob.getBoundingClientRect();
    this.radius = Math.max(10, Math.min(rect.width, rect.height) / 2 - knobRect.width / 2 - 6);
    this.paint();
  }

  private applyFromEvent(e: PointerEvent) {
    const rect = this.el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const scale = len > this.radius ? this.radius / len : 1;
    this.set((dx * scale) / this.radius, -(dy * scale) / this.radius);
  }

  private down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.measure();
    this.applyFromEvent(e);
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.applyFromEvent(e);
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.release();
  };

  set(x: number, y: number) {
    this.x = clamp(x, -1, 1);
    this.y = clamp(y, -1, 1);
    this.paint();
    this.onInput();
  }

  release() {
    if (this.springX) this.x = 0;
    if (this.springY) this.y = 0;
    this.paint();
    this.onRelease();
    this.onInput();
  }

  paint() {
    this.knob.style.transform = `translate(${(this.x * this.radius).toFixed(1)}px, ${(
      -this.y * this.radius
    ).toFixed(1)}px)`;
  }

  get active(): boolean {
    return this.pointerId !== null;
  }
}

const settings = loadSettings();
let armed = false;
let angleMode = true;
let seq = 0;
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let rttMs = -1;
let sentThisSecond = 0;
let sendHz = 0;
let lastSendAt = 0;
let wakeLock: WakeLockSentinel | null = null;

const linkPill = must<HTMLDivElement>('link');
const linkText = must<HTMLSpanElement>('linkText');
const rttEl = must<HTMLDivElement>('rtt');
const rateEl = must<HTMLDivElement>('rate');
const armBtn = must<HTMLButtonElement>('armBtn');
const armState = must<HTMLDivElement>('armState');
const thrBig = must<HTMLDivElement>('thrBig');
const leftRead = must<HTMLDivElement>('leftRead');
const rightRead = must<HTMLDivElement>('rightRead');
const msgEl = must<HTMLDivElement>('msg');
const leftStickEl = must<HTMLDivElement>('leftStick');
const rightStickEl = must<HTMLDivElement>('rightStick');
const btnSettings = must<HTMLButtonElement>('btnSettings');
const btnFull = must<HTMLButtonElement>('btnFull');
const btnAngle = must<HTMLButtonElement>('btnAngle');
const btnRestart = must<HTMLButtonElement>('btnRestart');
const sheet = must<HTMLDivElement>('sheet');
const btnClose = must<HTMLButtonElement>('btnClose');
const btnReset = must<HTMLButtonElement>('btnReset');
const sheetInfo = must<HTMLDivElement>('sheetInfo');

const setMode = must<HTMLSelectElement>('setMode');
const setThrottle = must<HTMLSelectElement>('setThrottle');
const setExpo = must<HTMLInputElement>('setExpo');
const setDead = must<HTMLInputElement>('setDead');
const setSize = must<HTMLInputElement>('setSize');
const setHaptics = must<HTMLInputElement>('setHaptics');
const setInvPitch = must<HTMLInputElement>('setInvPitch');
const setInvYaw = must<HTMLInputElement>('setInvYaw');
const valExpo = must<HTMLElement>('valExpo');
const valDead = must<HTMLElement>('valDead');
const valSize = must<HTMLElement>('valSize');

let flashTimer = 0;
function flash(text: string) {
  msgEl.textContent = text;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (msgEl.textContent = ''), 2200);
}

let interacted = false;
window.addEventListener('pointerdown', () => (interacted = true), { once: true });

function buzz(ms: number) {
  if (!settings.haptics || !interacted) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* vibration is a nice-to-have, never a failure */
  }
}

const leftStick = {
  el: leftStickEl,
  knob: must<HTMLDivElement>('leftKnob'),
  instance: null as unknown as Stick,
};
const rightStick = {
  el: rightStickEl,
  knob: must<HTMLDivElement>('rightKnob'),
  instance: null as unknown as Stick,
};

function buildSticks() {
  const leftSpringY = settings.throttle === 'spring';

  if (settings.mode === 2) {
    leftStick.instance = new Stick(
      leftStick.el,
      leftStick.knob,
      true,
      leftSpringY,
      sendSoon,
      releaseSafety,
    );
    rightStick.instance = new Stick(rightStick.el, rightStick.knob, true, true, sendSoon, () => {});
  } else {
    leftStick.instance = new Stick(leftStick.el, leftStick.knob, true, true, sendSoon, () => {});
    rightStick.instance = new Stick(
      rightStick.el,
      rightStick.knob,
      true,
      leftSpringY,
      sendSoon,
      releaseSafety,
    );
  }

  // A transmitter boots with the throttle stick at the bottom, not in the middle.
  const thr = settings.mode === 2 ? leftStick.instance : rightStick.instance;
  thr.set(thr.x, -1);

  // First layout pass may not have settled when the sticks are constructed.
  requestAnimationFrame(() => {
    leftStick.instance?.measure();
    rightStick.instance?.measure();
    thr.paint();
  });
}

function releaseSafety() {
  // Releasing the throttle stick must never leave the quad armed at an unknown
  // throttle. Disarm on release in spring mode only; hold mode is intentional.
  if (settings.throttle === 'spring') {
    // snap to hover-ish 35%
    const stick = throttleStick();
    stick.set(stick.x, 0.35 * 2 - 1);
  }
}

function throttleStick(): Stick {
  return settings.mode === 2 ? leftStick.instance : rightStick.instance;
}

function stickAxes(): { thr: number; yaw: number; pitch: number; roll: number } {
  const left = leftStick.instance;
  const right = rightStick.instance;
  if (!left || !right) return { thr: 0, yaw: 0, pitch: 0, roll: 0 };

  if (settings.mode === 2) {
    return {
      thr: clamp((left.y + 1) / 2, 0, 1),
      yaw: settings.invertYaw ? -left.x : left.x,
      pitch: settings.invertPitch ? -right.y : right.y,
      roll: right.x,
    };
  }
  return {
    thr: clamp((right.y + 1) / 2, 0, 1),
    yaw: settings.invertYaw ? -right.x : right.x,
    pitch: settings.invertPitch ? -left.y : left.y,
    roll: left.x,
  };
}

// A finger on glass is never still. Real gimbals are smooth because of their
// springs and mass; a 12 ms one-pole filter on the three stick axes gives the
// same feel and stops the quad from chasing touch-screen tremor.
const smooth = { pitch: 0, roll: 0, yaw: 0 };
let smoothAt = 0;
const SMOOTH_TAU = 0.012;

function currentFrame(): TxFrame {
  const a = stickAxes();
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - smoothAt) / 1000));
  smoothAt = now;
  const k = 1 - Math.exp(-dt / SMOOTH_TAU);
  smooth.pitch += (a.pitch - smooth.pitch) * k;
  smooth.roll += (a.roll - smooth.roll) * k;
  smooth.yaw += (a.yaw - smooth.yaw) * k;

  const db = settings.deadband;
  const e = settings.expo;
  return {
    seq: seq & 0xffff,
    tUs: (performance.now() * 1000) >>> 0,
    throttle: Math.round((a.thr * 2 - 1) * 1000),
    yaw: Math.round(withDeadband(expo(smooth.yaw, e), db) * 1000),
    pitch: Math.round(withDeadband(expo(smooth.pitch, e), db) * 1000),
    roll: Math.round(withDeadband(expo(smooth.roll, e), db) * 1000),
    flags:
      (armed ? FLAG_ARMED : 0) |
      (angleMode ? FLAG_ANGLE : 0) |
      (settings.throttle === 'hold' ? FLAG_HOLD : 0),
    mode: settings.mode,
    aux: 0,
  };
}

function send() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  lastSendAt = performance.now();
  const frame = currentFrame();
  seq++;
  ws.send(encodeTxFrame(frame));
  sentThisSecond++;
}

function sendSoon() {
  if (performance.now() - lastSendAt > 2) send();
}

window.setInterval(send, 4); // 250 Hz pacing
window.setInterval(() => {
  sendHz = sentThisSecond;
  sentThisSecond = 0;
}, 1000);

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
  }
}, 500);

function connect() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?role=tx`;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;
  setLink(false, 'connecting');

  socket.onopen = () => {
    setLink(true, 'link');
    buzz(12);
  };

  socket.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    let msg: { type?: string; t?: number } = {};
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'pong' && typeof msg.t === 'number') {
      const sample = performance.now() - msg.t;
      rttMs = rttMs < 0 ? sample : rttMs * 0.8 + sample * 0.2;
      rttEl.textContent = `${rttMs.toFixed(1)} ms`;
    }
  };

  socket.onclose = () => {
    setLink(false, 'offline');
    if (armed) disarm('link lost');
    scheduleReconnect();
  };

  socket.onerror = () => {
    /* onclose fires too */
  };
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 400);
}

function setLink(ok: boolean, text: string) {
  linkPill.classList.toggle('ok', ok);
  linkText.textContent = text;
  if (!ok) {
    rttEl.textContent = '-- ms';
    rateEl.textContent = '-- Hz';
    rttMs = -1;
  }
}

function arm() {
  const thr = stickAxes().thr;
  if (thr > 0.1) {
    flash('lower throttle to arm');
    buzz(60);
    return;
  }
  if (ws?.readyState !== WebSocket.OPEN) {
    flash('no link');
    return;
  }
  armed = true;
  buzz(24);
  paintArm();
  send();
}

function disarm(reason?: string) {
  if (!armed) return;
  armed = false;
  paintArm();
  buzz(40);
  if (reason) flash(reason);
  send();
}

function paintArm() {
  armBtn.textContent = armed ? 'ARMED' : 'DISARMED';
  armBtn.classList.toggle('on', armed);
  armState.textContent = armed ? 'ARMED' : 'DISARMED';
  armState.classList.toggle('on', armed);
  leftStick.el.classList.toggle('armed', armed);
  rightStick.el.classList.toggle('armed', armed);
}

function paintReadouts() {
  const a = stickAxes();
  thrBig.textContent = `${Math.round(a.thr * 100)}%`;
  leftRead.textContent =
    settings.mode === 2
      ? `THR ${Math.round(a.thr * 100)}% · YAW ${Math.round(a.yaw * 100)}`
      : `P ${Math.round(a.pitch * 100)} · Y ${Math.round(a.yaw * 100)}`;
  rightRead.textContent =
    settings.mode === 2
      ? `P ${Math.round(a.pitch * 100)} · R ${Math.round(a.roll * 100)}`
      : `THR ${Math.round(a.thr * 100)}% · R ${Math.round(a.roll * 100)}`;
}

window.setInterval(paintReadouts, 50);

armBtn.addEventListener('click', () => (armed ? disarm() : arm()));

btnRestart.addEventListener('click', () => {
  if (ws?.readyState !== WebSocket.OPEN) {
    flash('no link');
    return;
  }
  // Reset the run on the sim, then disarm so a restart never comes back hot.
  ws.send(JSON.stringify({ type: 'reset' }));
  disarm('run restarted');
  buzz(30);
  flash('run restarted');
});

function paintAngleButton() {
  btnAngle.textContent = angleMode ? 'ANGLE' : 'ACRO';
  btnAngle.style.color = angleMode ? 'var(--accent)' : '';
}
paintAngleButton();

btnAngle.addEventListener('click', () => {
  angleMode = !angleMode;
  paintAngleButton();
  send();
});

btnFull.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      await orientation.lock?.('landscape');
    } else {
      await document.exitFullscreen();
    }
  } catch {
    flash('fullscreen blocked — rotate manually');
  }
});

btnSettings.addEventListener('click', () => {
  sheet.hidden = false;
  syncSheet();
});
btnClose.addEventListener('click', () => (sheet.hidden = true));

function syncSheet() {
  setMode.value = String(settings.mode);
  setThrottle.value = settings.throttle;
  setExpo.value = String(Math.round(settings.expo * 100));
  setDead.value = String(Math.round(settings.deadband * 100));
  setSize.value = String(Math.round(settings.scale * 100));
  setHaptics.checked = settings.haptics;
  setInvPitch.checked = settings.invertPitch;
  setInvYaw.checked = settings.invertYaw;
  valExpo.textContent = `${Math.round(settings.expo * 100)}%`;
  valDead.textContent = `${Math.round(settings.deadband * 100)}%`;
  valSize.textContent = `${Math.round(settings.scale * 100)}%`;
  sheetInfo.textContent = `${location.host} · ${settings.mode === 2 ? 'Mode 2' : 'Mode 1'}`;
}

function applySetting() {
  saveSettings(settings);
  applyKnobSize();
  syncSheet();
  rebuildSticksIfNeeded();
  // knob size may have changed: re-measure both gimbals
  leftStick.instance?.measure();
  rightStick.instance?.measure();
}

let builtFor = '';
function rebuildSticksIfNeeded() {
  const key = `${settings.mode}:${settings.throttle}`;
  if (key === builtFor) return;
  builtFor = key;
  leftStick.el.replaceWith(leftStick.el.cloneNode(true) as HTMLElement);
  rightStick.el.replaceWith(rightStick.el.cloneNode(true) as HTMLElement);
  // re-resolve after clone
  const newLeft = document.getElementById('leftStick') as HTMLDivElement;
  const newRight = document.getElementById('rightStick') as HTMLDivElement;
  leftStick.el = newLeft;
  leftStick.knob = newLeft.querySelector('.knob') as HTMLDivElement;
  rightStick.el = newRight;
  rightStick.knob = newRight.querySelector('.knob') as HTMLDivElement;
  leftStick.instance = null as unknown as Stick;
  rightStick.instance = null as unknown as Stick;
  buildSticks();
  paintArm();
}

setMode.addEventListener('change', () => {
  settings.mode = setMode.value === '1' ? 1 : 2;
  disarm('mode changed');
  applySetting();
});
setThrottle.addEventListener('change', () => {
  settings.throttle = setThrottle.value === 'spring' ? 'spring' : 'hold';
  disarm('throttle mode changed');
  applySetting();
});
setExpo.addEventListener('input', () => {
  settings.expo = Number(setExpo.value) / 100;
  applySetting();
});
setDead.addEventListener('input', () => {
  settings.deadband = Number(setDead.value) / 100;
  applySetting();
});
setSize.addEventListener('input', () => {
  settings.scale = Number(setSize.value) / 100;
  applySetting();
});
setHaptics.addEventListener('change', () => {
  settings.haptics = setHaptics.checked;
  applySetting();
});
setInvPitch.addEventListener('change', () => {
  settings.invertPitch = setInvPitch.checked;
  applySetting();
});
setInvYaw.addEventListener('change', () => {
  settings.invertYaw = setInvYaw.checked;
  applySetting();
});
btnReset.addEventListener('click', () => {
  Object.assign(settings, DEFAULTS);
  disarm('defaults restored');
  applySetting();
});

// Keyboard, for testing the whole chain on a desktop.
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    armed ? disarm() : arm();
    return;
  }
  keys.add(e.code);
  steerKeyboard();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function steerKeyboard() {
  const thr = throttleStick();
  const rp = settings.mode === 2 ? rightStick.instance : leftStick.instance;
  if (!thr || !rp) return;
  const step = 0.04;
  if (keys.has('KeyW')) thr.set(thr.x, thr.y + step);
  if (keys.has('KeyS')) thr.set(thr.x, thr.y - step);
  if (keys.has('KeyA')) thr.set(thr.x - step, thr.y);
  if (keys.has('KeyD')) thr.set(thr.x + step, thr.y);
  if (keys.has('ArrowUp')) rp.set(rp.x, rp.y + step);
  if (keys.has('ArrowDown')) rp.set(rp.x, rp.y - step);
  if (keys.has('ArrowLeft')) rp.set(rp.x - step, rp.y);
  if (keys.has('ArrowRight')) rp.set(rp.x + step, rp.y);
}

async function requestWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    wakeLock?.addEventListener('release', () => (wakeLock = null));
  } catch {
    /* ignore */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    disarm('page hidden');
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  } else {
    requestWakeLock();
    if (ws?.readyState !== WebSocket.OPEN) connect();
  }
});

window.addEventListener('beforeunload', () => {
  disarm();
});

// Boot
applyKnobSize();
rebuildSticksIfNeeded();
paintArm();
paintReadouts();
connect();
requestWakeLock();
window.setInterval(() => {
  rateEl.textContent = `${sendHz} Hz`;
}, 250);
