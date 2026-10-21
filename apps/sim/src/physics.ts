/**
 * Quad flight model. Pure maths, no renderer, no DOM — so it can be unit tested
 * in Node and ported to Rust later without touching the renderer.
 *
 * Frame conventions (three.js):
 *   world: +X right, +Y up, +Z toward the pilot (back)
 *   body : +X right, +Y up, +Z back  ->  forward is -Z
 *   omega: body rates, +X = nose up, +Y = nose left, +Z = roll left
 *
 * Physical notes:
 *   - thrust per motor scales with throttle^2 (thrust ~ rpm^2), which is why a
 *     5" quad hovers near 35% and why throttle feels soft at the bottom.
 *   - motors lag (first order), so flicks are not instant.
 *   - the mixer feeds the *actual* motor thrusts into the torque equation, so
 *     saturation at full throttle reproduces real "it won't roll at full punch".
 */

export interface Inputs {
  throttle: number; // 0..1
  roll: number; // -1..1, + = right
  pitch: number; // -1..1, + = nose up
  yaw: number; // -1..1, + = right
  armed: boolean;
  angle: boolean;
}

export interface QuadParams {
  mass: number;
  arm: number; // motor to centre, metres
  inertia: [number, number, number];
  maxThrustPerMotor: number; // newtons at full throttle
  motorTau: number; // seconds
  dragLin: number;
  dragQuad: number;
  angDrag: number;
  yawCoef: number; // prop drag torque per newton
  rateMax: [number, number, number]; // deg/s: pitch, yaw, roll
  pid: { p: number; i: number; d: number };
  angle: { kp: number; rate: number; tau: number; maxLean: number }; // angle-mode response
  mixAuth: number; // differential-thrust authority at the mixer
  sagVolts: number;
  packVolts: number;
  turbulence: number; // 0..1
}

export const DEFAULT_PARAMS: QuadParams = {
  mass: 0.65,
  arm: 0.115,
  inertia: [0.004, 0.008, 0.004],
  maxThrustPerMotor: 12.5,
  // A 5" freestyle quad spools almost instantly. 30 ms made the first beat of
  // a punch or a flip feel soft; 20 ms is closer to a modern 6S build.
  motorTau: 0.02,
  dragLin: 0.05,
  dragQuad: 0.012,
  angDrag: 0.03,
  // More prop-drag yaw torque than the first pass; yaw was the slowest axis.
  yawCoef: 0.024,
  // Freestyle rates, not cinematic rates. 800 deg/s is still flyable on the
  // course but gives the sticks real authority.
  rateMax: [800, 500, 800],
  pid: { p: 0.095, i: 0.55, d: 0.0018 },
  // ANGLE is for cruising, not for feeling dead: 45 deg of lean and a faster
  // attitude loop. Yaw stays capped below the lean rate so the horizon is safe.
  angle: { kp: 4, rate: 260, tau: 0.05, maxLean: (45 * Math.PI) / 180 },
  mixAuth: 0.65,
  sagVolts: 2.4,
  packVolts: 25.2,
  turbulence: 0.35,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface QuadState {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  omega: Vec3; // body rates, rad/s
  motors: [number, number, number, number]; // 0..1 commanded
  thrust: [number, number, number, number]; // newtons, actual
  voltage: number;
  crashed: boolean;
  time: number;
}

export interface Collider {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/**
 * A flat, landable surface above the ground. The matching visual slab is added
 * by the map builder; physics only needs the footprint and the top height.
 */
export interface Platform {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

/**
 * A solid ramp / bank. The surface rises linearly from yAtMin to yAtMax along
 * the chosen axis. The mesh is a solid wedge down to y = 0, so the route can
 * use it as a floor and low props can use it as a skate bank.
 */
export interface Ramp {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  axis: 'x' | 'z';
  yAtMin: number;
  yAtMax: number;
}

function rampHeight(r: Ramp, x: number, z: number): number {
  const t =
    r.axis === 'z'
      ? (z - r.minZ) / Math.max(1e-6, r.maxZ - r.minZ)
      : (x - r.minX) / Math.max(1e-6, r.maxX - r.minX);
  return r.yAtMin + (r.yAtMax - r.yAtMin) * clamp(t, 0, 1);
}

const MOTOR_POS: Array<{ x: number; z: number; s: number }> = [
  { x: 1, z: -1, s: 1 }, // 0 front right, CCW
  { x: -1, z: -1, s: -1 }, // 1 front left, CW
  { x: 1, z: 1, s: -1 }, // 2 rear right, CW
  { x: -1, z: 1, s: 1 }, // 3 rear left, CCW
];

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic noise in -1..1 for prop wash / air disturbance. */
function noise(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export class QuadSim {
  params: QuadParams;
  state: QuadState;
  colliders: Collider[] = [];
  platforms: Platform[] = [];
  ramps: Ramp[] = [];
  /** Reset position. Maps move this before calling reset(). */
  spawn: Vec3 = { x: 0, y: 0.06, z: 0 };

  private integral: Vec3 = { x: 0, y: 0, z: 0 };
  private prevOmega: Vec3 = { x: 0, y: 0, z: 0 };
  private angleTargetPitch = 0;
  private angleTargetRoll = 0;
  private steps = 0;

  constructor(params: QuadParams = DEFAULT_PARAMS) {
    this.params = { ...params, pid: { ...params.pid }, angle: { ...params.angle } };
    this.state = this.initialState();
  }

  private initialState(): QuadState {
    return {
      pos: { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z },
      vel: { x: 0, y: 0, z: 0 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      omega: { x: 0, y: 0, z: 0 },
      motors: [0, 0, 0, 0],
      thrust: [0, 0, 0, 0],
      voltage: this.params.packVolts,
      crashed: false,
      time: 0,
    };
  }

  reset(): void {
    this.integral = { x: 0, y: 0, z: 0 };
    this.prevOmega = { x: 0, y: 0, z: 0 };
    this.angleTargetPitch = 0;
    this.angleTargetRoll = 0;
    this.state = this.initialState();
  }

  /**
   * Highest landable surface under the quad, if that surface is at or just
   * below the probe height. A small tolerance lets a landing snap cleanly
   * instead of falling through a thin slab at high tick rates.
   */
  private surfaceAt(x: number, z: number, probeY: number): number | null {
    let best: number | null = null;

    for (const p of this.platforms) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      if (p.top > probeY + 0.05) continue;
      if (best === null || p.top > best) best = p.top;
    }

    for (const r of this.ramps) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const h = rampHeight(r, x, z);
      if (h > probeY + 0.05) continue;
      if (best === null || h > best) best = h;
    }

    return best;
  }

  private landOnSurfaces(): void {
    const s = this.state;
    if (s.vel.y > 0.25) return;

    const top = this.surfaceAt(s.pos.x, s.pos.z, s.pos.y);
    if (top === null || s.pos.y > top + 0.03) return;

    const impact = Math.max(0, -s.vel.y);
    s.pos.y = top + 0.02;
    s.vel.y = 0;
    if (impact > 2) {
      s.vel.x *= 0.75;
      s.vel.z *= 0.75;
    }
    const w = s.omega;
    w.x = 0;
    w.y = 0;
    w.z = 0;

    if (impact > 15 || Math.abs(this.tilt()) > 1.45) {
      s.crashed = true;
      s.motors = [0, 0, 0, 0];
      s.thrust = [0, 0, 0, 0];
      s.vel.x = 0;
      s.vel.y = 0;
      s.vel.z = 0;
    }
  }

  /** Throttle that holds altitude in still air (0..1), including pack sag. */
  hoverThrottle(): number {
    const p = this.params;
    const weight = p.mass * 9.81;
    let fraction = weight / (4 * p.maxThrustPerMotor);
    for (let i = 0; i < 4; i++) {
      const volts = p.packVolts - p.sagVolts * clamp(fraction, 0, 1);
      const scale = (volts / p.packVolts) ** 2;
      fraction = weight / (4 * p.maxThrustPerMotor * scale);
    }
    return Math.sqrt(clamp(fraction, 0, 1));
  }

  step(dt: number, input: Inputs): void {
    const p = this.params;
    const s = this.state;
    if (s.crashed) {
      // Dead quad: no motors, no control. Let it drop and settle instead of
      // freezing in mid-air where it hit something.
      const deadSpeed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
      const deadDrag = (p.dragLin + p.dragQuad * deadSpeed) / p.mass;
      s.vel.x -= deadDrag * s.vel.x * dt;
      s.vel.y += (-9.81 - deadDrag * s.vel.y) * dt;
      s.vel.z -= deadDrag * s.vel.z * dt;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;

      // A dead quad still settles on ramps and mezzanine decks rather than
      // falling through them to the ground plane.
      const surface = this.surfaceAt(s.pos.x, s.pos.z, s.pos.y);
      const restY = surface === null ? 0.02 : surface + 0.02;
      if (s.pos.y <= restY) {
        s.pos.y = restY;
        s.vel.x = 0;
        s.vel.y = 0;
        s.vel.z = 0;
      }
      s.time += dt;
      return;
    }

    // ---- rate setpoints -------------------------------------------------
    let setPitch = clamp(input.angle ? input.pitch * p.angle.maxLean : input.pitch, -1, 1);
    let setRoll = clamp(input.angle ? input.roll * p.angle.maxLean : input.roll, -1, 1);

    let targetPitch: number;
    let targetYaw: number;
    let targetRoll: number;

    if (input.angle) {
      // Angle mode: the stick is a lean angle relative to the current heading.
      // Do NOT use euler().x/z here: those are world-referenced, so a yaw
      // command while pitched would make the controller fight the turn and
      // tumble. Project the up vector onto the heading frame instead, then
      // rate-limit the correction hard so it eases in without overshoot.
      const f = this.forwardVector();
      const u = this.upVector();
      const heading = Math.atan2(-f.x, -f.z);
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      const rx = Math.cos(heading);
      const rz = -Math.sin(heading);
      const pitchRel = -Math.asin(clamp(u.x * fx + u.z * fz, -1, 1));
      const rollRel = -Math.asin(clamp(u.x * rx + u.z * rz, -1, 1));

      // Smooth the target angle (not the measured one) so touch-screen steps
      // and finger tremor don't show up as attitude jerks, while the attitude
      // loop itself stays fast enough to feel connected.
      const kTarget = 1 - Math.exp(-dt / p.angle.tau);
      this.angleTargetPitch += (setPitch - this.angleTargetPitch) * kTarget;
      this.angleTargetRoll += (setRoll - this.angleTargetRoll) * kTarget;

      const angleRate = Math.min(p.angle.rate, p.rateMax[0]) * DEG;
      targetPitch = clamp((this.angleTargetPitch - pitchRel) * p.angle.kp, -1, 1) * angleRate;
      targetRoll = clamp((-this.angleTargetRoll - rollRel) * p.angle.kp, -1, 1) * angleRate;
      // In angle mode a full-rate yaw would outrun the attitude correction
      // (yawing while pitched redistributes pitch into roll), so cap it.
      targetYaw = -input.yaw * Math.min(250, p.rateMax[1]) * DEG;
    } else {
      targetPitch = setPitch * p.rateMax[0] * DEG; // + = nose up
      targetYaw = -input.yaw * p.rateMax[1] * DEG; // + stick = nose right
      targetRoll = -setRoll * p.rateMax[2] * DEG; // + stick = roll right
    }

    // ---- rate PID -------------------------------------------------------
    const err = {
      x: targetPitch - s.omega.x,
      y: targetYaw - s.omega.y,
      z: targetRoll - s.omega.z,
    };

    this.integral.x = clamp(this.integral.x + err.x * dt, -2, 2);
    this.integral.y = clamp(this.integral.y + err.y * dt, -2, 2);
    this.integral.z = clamp(this.integral.z + err.z * dt, -2, 2);

    const dTerm = {
      x: -(s.omega.x - this.prevOmega.x) / dt,
      y: -(s.omega.y - this.prevOmega.y) / dt,
      z: -(s.omega.z - this.prevOmega.z) / dt,
    };
    this.prevOmega = { ...s.omega };

    const pid = p.pid;
    const uPitch = clamp(pid.p * err.x + pid.i * this.integral.x + pid.d * dTerm.x, -1, 1);
    const uRoll = clamp(pid.p * err.z + pid.i * this.integral.z + pid.d * dTerm.z, -1, 1);
    const uYaw = clamp(pid.p * 1.6 * err.y + pid.i * 1.4 * this.integral.y + pid.d * dTerm.y, -1, 1);

    // ---- mixer (torque domain) -----------------------------------------
    // uPitch + = nose up, uRoll + = roll left, uYaw + = nose left, matching tau.
    const thr = input.armed ? clamp(input.throttle, 0, 1) : 0;
    const base = thr * thr; // thrust ~ rpm^2 -> hover near 35% throttle
    const AUTH = p.mixAuth;
    const mix = [
      base + AUTH * (uPitch + uRoll - uYaw), // 0 FR (CCW)
      base + AUTH * (uPitch - uRoll + uYaw), // 1 FL (CW)
      base + AUTH * (-uPitch + uRoll + uYaw), // 2 RR (CW)
      base + AUTH * (-uPitch - uRoll - uYaw), // 3 RL (CCW)
    ];

    // ---- motors: lag + voltage sag + prop wash ---------------------------
    const prevTotal =
      s.thrust[0]! + s.thrust[1]! + s.thrust[2]! + s.thrust[3]!;
    const load = clamp(prevTotal / (4 * p.maxThrustPerMotor), 0, 1);
    const voltage = p.packVolts - p.sagVolts * load;
    const voltScale = (voltage / p.packVolts) ** 2;

    const descending = s.vel.y < -2.5;
    const wash = descending ? p.turbulence * clamp(-s.vel.y / 8, 0, 1) : 0;
    const alpha = 1 - Math.exp(-dt / Math.max(p.motorTau, 1e-4));

    for (let i = 0; i < 4; i++) {
      const cmd = clamp(mix[i]!, 0, 1);
      s.motors[i] = (s.motors[i] ?? 0) + (cmd - (s.motors[i] ?? 0)) * alpha;
      const jitter = 1 + wash * noise(this.steps * 0.37 + i * 2.1) * 0.3;
      s.thrust[i] = s.motors[i]! * p.maxThrustPerMotor * voltScale * jitter;
    }
    s.voltage += (voltage - s.voltage) * Math.min(1, dt * 8);
    s.time += dt;
    this.steps++;

    // ---- forces / torques ----------------------------------------------
    const t = s.thrust;
    const tauX = p.arm * (t[0]! + t[1]! - t[2]! - t[3]!); // front - rear, + = nose up
    const tauZ = p.arm * (t[0]! + t[2]! - t[1]! - t[3]!); // right - left, + = roll left
    const spinSum =
      MOTOR_POS[0]!.s * t[0]! +
      MOTOR_POS[1]!.s * t[1]! +
      MOTOR_POS[2]!.s * t[2]! +
      MOTOR_POS[3]!.s * t[3]!;
    const tauY = -p.yawCoef * spinSum; // + = nose left

    const thrustTotal = t[0]! + t[1]! + t[2]! + t[3]!;

    // ---- integrate linear ------------------------------------------------
    const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
    const dragScale = p.dragLin + p.dragQuad * speed;
    const up = this.upVector();
    const ax = (up.x * thrustTotal - dragScale * s.vel.x) / p.mass;
    const ay = (up.y * thrustTotal - dragScale * s.vel.y) / p.mass - 9.81;
    const az = (up.z * thrustTotal - dragScale * s.vel.z) / p.mass;

    s.vel.x += ax * dt;
    s.vel.y += ay * dt;
    s.vel.z += az * dt;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;

    // ---- integrate angular ----------------------------------------------
    const w = s.omega;
    const ix = p.inertia[0];
    const iy = p.inertia[1];
    const iz = p.inertia[2];

    // gyroscopic term: omega x (I omega)
    const gx = w.y * iz * w.z - w.z * iy * w.y;
    const gy = w.z * ix * w.x - w.x * iz * w.z;
    const gz = w.x * iy * w.y - w.y * ix * w.x;

    const dwx = (tauX - p.angDrag * w.x - gx) / ix;
    const dwy = (tauY - p.angDrag * w.y - gy) / iy;
    const dwz = (tauZ - p.angDrag * w.z - gz) / iz;

    w.x += dwx * dt;
    w.y += dwy * dt;
    w.z += dwz * dt;

    // quaternion integration: q' = 0.5 * q * (0, w)
    const q = s.quat;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;
    const halfX = 0.5 * w.x * dt;
    const halfY = 0.5 * w.y * dt;
    const halfZ = 0.5 * w.z * dt;
    q.x += qw * halfX + qy * halfZ - qz * halfY;
    q.y += qw * halfY + qz * halfX - qx * halfZ;
    q.z += qw * halfZ + qx * halfY - qy * halfX;
    q.w += -qx * halfX - qy * halfY - qz * halfZ;
    const qlen = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= qlen;
    q.y /= qlen;
    q.z /= qlen;
    q.w /= qlen;

    // ---- ramps / raised decks -------------------------------------------
    // These are landable surfaces, checked before box colliders so a quad
    // descending onto a mezzanine does not get pushed around by the slab's
    // collider. Slabs are deliberately modelled a little below the deck top.
    if (!s.crashed) this.landOnSurfaces();

    // ---- obstacles -------------------------------------------------------
    // A bump only ends the run if you really smack something. Light contact
    // pushes the quad out of the box and bounces it, so clipping a prop on a
    // container or a barrier doesn't wipe the attempt.
    if (!s.crashed && this.colliders.length) {
      const r = 0.09;
      for (const c of this.colliders) {
        const minX = c.min.x - r;
        const maxX = c.max.x + r;
        const minY = c.min.y - r;
        const maxY = c.max.y + r;
        const minZ = c.min.z - r;
        const maxZ = c.max.z + r;
        if (
          s.pos.x > minX &&
          s.pos.x < maxX &&
          s.pos.y > minY &&
          s.pos.y < maxY &&
          s.pos.z > minZ &&
          s.pos.z < maxZ
        ) {
          // shallowest exit = the face we actually touched
          const exits = [
            { d: maxX - s.pos.x, axis: 'x' as const, sign: 1 },
            { d: s.pos.x - minX, axis: 'x' as const, sign: -1 },
            { d: maxY - s.pos.y, axis: 'y' as const, sign: 1 },
            { d: s.pos.y - minY, axis: 'y' as const, sign: -1 },
            { d: maxZ - s.pos.z, axis: 'z' as const, sign: 1 },
            { d: s.pos.z - minZ, axis: 'z' as const, sign: -1 },
          ];
          const e = exits.reduce((a, b) => (b.d < a.d ? b : a));

          if (e.axis === 'x') s.pos.x = e.sign > 0 ? maxX : minX;
          else if (e.axis === 'y') s.pos.y = e.sign > 0 ? maxY : minY;
          else s.pos.z = e.sign > 0 ? maxZ : minZ;

          const v = e.axis === 'x' ? s.vel.x : e.axis === 'y' ? s.vel.y : s.vel.z;
          const hitSpeed = Math.max(0, -v * e.sign);

          if (hitSpeed > 5.0) {
            s.crashed = true;
            s.motors = [0, 0, 0, 0];
            s.thrust = [0, 0, 0, 0];
            s.vel.x = 0;
            s.vel.y = 0;
            s.vel.z = 0;
            w.x = 0;
            w.y = 0;
            w.z = 0;
          } else {
            // soft bounce: kill the into-the-face speed, keep most of the slide
            if (e.axis === 'x') {
              s.vel.x = -v * 0.25;
              s.vel.y *= 0.85;
              s.vel.z *= 0.85;
            } else if (e.axis === 'y') {
              s.vel.y = -v * 0.25;
              s.vel.x *= 0.85;
              s.vel.z *= 0.85;
            } else {
              s.vel.z = -v * 0.25;
              s.vel.x *= 0.85;
              s.vel.y *= 0.85;
            }
          }
          break;
        }
      }
    }

    // ---- ground ----------------------------------------------------------
    if (s.pos.y <= 0.02) {
      s.pos.y = 0.02;
      const down = -s.vel.y; // how hard it comes down
      const horiz = Math.hypot(s.vel.x, s.vel.z);
      s.vel.x = 0;
      s.vel.z = 0;
      s.vel.y = 0;
      w.x = 0;
      w.y = 0;
      w.z = 0;
      // Forgiving touchdown: sliding along the runway or a small drop is a
      // landing. Only a real slam, a fast ground strike, or ending up nearly
      // upside down ends the attempt.
      if (down > 15.0 || horiz > 15 || Math.abs(this.tilt()) > 1.45) {
        s.crashed = true;
        s.motors = [0, 0, 0, 0];
        s.thrust = [0, 0, 0, 0];
      }
    }
  }

  upVector(): Vec3 {
    const q = this.state.quat;
    return {
      x: 2 * (q.x * q.y - q.w * q.z),
      y: 1 - 2 * (q.x * q.x + q.z * q.z),
      z: 2 * (q.y * q.z + q.w * q.x),
    };
  }

  forwardVector(): Vec3 {
    const q = this.state.quat;
    return {
      x: -(2 * (q.x * q.z + q.w * q.y)),
      y: -(2 * (q.y * q.z - q.w * q.x)),
      z: -(1 - 2 * (q.x * q.x + q.y * q.y)),
    };
  }

  /** roll (x), pitch (z) in radians for angle mode. */
  euler(): { x: number; y: number; z: number } {
    const u = this.upVector();
    const pitch = Math.asin(clamp(u.z, -1, 1));
    const roll = Math.atan2(-u.x, u.y);
    const f = this.forwardVector();
    const yaw = Math.atan2(-f.x, -f.z);
    return { x: pitch, y: yaw, z: roll };
  }

  /** Absolute tilt from vertical, radians. */
  tilt(): number {
    return Math.acos(clamp(this.upVector().y, -1, 1));
  }

  altitude(): number {
    return this.state.pos.y;
  }

  speed(): number {
    const v = this.state.vel;
    return Math.hypot(v.x, v.y, v.z);
  }
}
