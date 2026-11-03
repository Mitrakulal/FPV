import {
  FLAG_ARMED,
  FLAG_RESET,
  fromAxis,
  decodeTxFrame,
  type TxFrame,
} from '../../../packages/protocol/protocol';
import type { Inputs } from './physics';

export interface LinkInfo {
  connected: boolean;
  fresh: boolean;
  ageMs: number;
  rttMs: number;
  hz: number;
  sendHz: number;
  packets: number;
}

/** Reads the phone transmitter over the local WebSocket, falls back to the keyboard. */
export class InputClient {
  private ws: WebSocket | null = null;
  private lastFrame: TxFrame | null = null;
  private lastFrameAt = 0;
  private resetHeld = false;
  private framesThisSecond = 0;
  private hz = 0;
  private rtt = -1;
  private packets = 0;
  private reconnectAt = 0;

  private keys = new Set<string>();
  private keyThrottle = 0;
  private keyArmed = false;

  // USB gamepad / RC sim dongle. Polled every frame; the phone link still wins
  // whenever it is actually sending frames.
  private pad: Gamepad | null = null;
  private padName = '';
  private padPrev: boolean[] = [];

  link: LinkInfo = {
    connected: false,
    fresh: false,
    ageMs: -1,
    rttMs: -1,
    hz: 0,
    sendHz: 0,
    packets: 0,
  };

  constructor(private readonly onDiscreteKey?: (code: string) => void) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onDiscreteKey?.(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    setInterval(() => {
      this.hz = this.framesThisSecond;
      this.framesThisSecond = 0;
      this.link = this.snapshot();
    }, 1000);

    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
      }
    }, 500);

    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?role=sim`);
    } catch {
      this.reconnectAt = performance.now() + 1000;
      return;
    }
    this.ws = ws;
    // Binary frames arrive as Blob unless we ask for ArrayBuffer. The frame
    // decoder needs the raw bytes, so this line is load-bearing.
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.link = this.snapshot();
      ws.send(JSON.stringify({ type: 'hello' }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as { type?: string; t?: number };
          if (msg.type === 'pong' && typeof msg.t === 'number') {
            const sample = performance.now() - msg.t;
            this.rtt = this.rtt < 0 ? sample : this.rtt * 0.8 + sample * 0.2;
          } else if (msg.type === 'reset') {
            // Phone-side R button, forwarded by the relay.
            this.onDiscreteKey?.('KeyR');
          }
        } catch {
          /* ignore */
        }
        return;
      }
      const frame = decodeTxFrame(ev.data as ArrayBuffer);
      if (!frame) return;
      const reset = (frame.flags & FLAG_RESET) !== 0;
      this.lastFrame = frame;
      this.lastFrameAt = performance.now();
      this.framesThisSecond++;
      this.packets++;
      // The phone holds the reset bit high for ~200 ms. Reset once on the
      // rising edge; the JSON reset path above remains for good measure.
      if (reset && !this.resetHeld) this.onDiscreteKey?.('KeyR');
      this.resetHeld = reset;
    };
    ws.onclose = () => {
      this.link = this.snapshot();
      this.reconnectAt = performance.now() + 500;
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private snapshot(): LinkInfo {
    const age = this.lastFrameAt ? performance.now() - this.lastFrameAt : Infinity;
    const connected = this.ws?.readyState === WebSocket.OPEN;
    return {
      connected,
      fresh: age < 250,
      ageMs: Number.isFinite(age) ? Math.round(age) : -1,
      rttMs: this.rtt,
      hz: this.hz,
      sendHz: this.hz,
      packets: this.packets,
    };
  }

  /** Call once per rendered frame so the link block stays honest between ticks. */
  refresh(): LinkInfo {
    if (this.ws === null || this.ws.readyState === WebSocket.CLOSED) {
      if (performance.now() > this.reconnectAt) this.connect();
    }
    this.link = this.snapshot();
    return this.link;
  }

  toggleArm(): void {
    this.keyArmed = !this.keyArmed;
  }

  armKeyboard(): void {
    this.keyArmed = true;
  }

  disarmKeyboard(): void {
    this.keyArmed = false;
  }

  get keyboardArmed(): boolean {
    return this.keyArmed;
  }

  /** Integrate keyboard throttle once per rendered frame (wall-clock dt). */
  update(dt: number) {
    this.pollGamepad();
    if (this.keys.has('KeyW')) this.keyThrottle = Math.min(1, this.keyThrottle + 0.6 * dt);
    if (this.keys.has('KeyS')) this.keyThrottle = Math.max(0, this.keyThrottle - 0.9 * dt);
  }

  /**
   * Read the first connected standard gamepad. This covers USB RC simulator
   * dongles (they enumerate as a joystick) and ordinary Xbox/PlayStation pads.
   * A / cross toggles arm, B / circle restarts the run.
   */
  private pollGamepad(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    let pad: Gamepad | null = null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    this.pad = pad;
    this.padName = pad?.id ?? '';
    if (!pad) {
      this.padPrev = [];
      return;
    }
    const pressed = pad.buttons.map((b) => !!b?.pressed);
    if (pressed[0] && !this.padPrev[0]) this.toggleArm();
    if (pressed[1] && !this.padPrev[1]) this.onDiscreteKey?.('KeyR');
    this.padPrev = pressed;
  }

  /** Mode 2: left stick throttle/yaw, right stick pitch/roll. */
  private readGamepad(pad: Gamepad): Inputs {
    const axis = (i: number) => pad.axes[i] ?? 0;
    const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : v);
    return {
      throttle: Math.max(0, Math.min(1, (1 - axis(1)) / 2)),
      yaw: dz(axis(0)),
      pitch: dz(axis(3)),
      roll: dz(axis(2)),
      armed: this.keyArmed,
      angle: false,
    };
  }

  /** Name of the connected gamepad, or an empty string. */
  get gamepadName(): string {
    return this.padName;
  }

  /** Inputs for the next physics tick. */
  read(): Inputs {
    const now = performance.now();
    const fresh = this.lastFrame && now - this.lastFrameAt < 250;
    if (!fresh) this.resetHeld = false;

    if (fresh && this.lastFrame) {
      const f = this.lastFrame;
      return {
        throttle: (f.throttle + 1000) / 2000,
        yaw: fromAxis(f.yaw),
        // TX/receiver convention: stick forward (up) = nose down = forward.
        pitch: -fromAxis(f.pitch),
        roll: fromAxis(f.roll),
        armed: (f.flags & FLAG_ARMED) !== 0,
        angle: (f.flags & 2) !== 0,
      };
    }

    if (this.pad) return this.readGamepad(this.pad);

    // keyboard fallback, so the sim is usable without a phone
    const yaw = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    // up arrow = nose down / forward, same as pushing a radio stick forward
    const pitch = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
    const roll = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);

    return {
      throttle: this.keyThrottle,
      yaw,
      pitch,
      roll,
      armed: this.keyArmed,
      angle: false,
    };
  }
}
