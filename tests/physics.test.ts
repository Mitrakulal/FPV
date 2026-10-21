import test from 'node:test';
import assert from 'node:assert/strict';
import { QuadSim, DEFAULT_PARAMS, type Inputs } from '../apps/sim/src/physics.ts';

const DT = 0.001;

function sim(): QuadSim {
  return new QuadSim(DEFAULT_PARAMS);
}

function freeze(s: QuadSim, throttle: number): Inputs {
  return { throttle, roll: 0, pitch: 0, yaw: 0, armed: true, angle: false };
}

const idle: Inputs = { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false };

test('hover throttle is physically sane (~30-40%)', () => {
  const s = sim();
  const h = s.hoverThrottle();
  assert.ok(h > 0.28 && h < 0.42, `hover throttle ${h}`);
});

test('holds altitude at hover throttle once in equilibrium', () => {
  const s = sim();
  s.reset();
  const h = s.hoverThrottle();
  // spin motors up, then start the measurement from a still hover
  for (let i = 0; i < 2000; i++) s.step(DT, freeze(s, h));
  s.state.vel.y = 0;
  const y0 = s.altitude();
  for (let i = 0; i < 3000; i++) s.step(DT, freeze(s, h));
  const drift = Math.abs(s.altitude() - y0);
  assert.ok(drift < 0.1, `altitude drifted ${drift.toFixed(3)} m`);
  assert.equal(s.state.crashed, false);
});

test('disarmed means no thrust', () => {
  const s = sim();
  s.state.pos.y = 3;
  const input: Inputs = { ...freeze(s, 0.6), armed: false };
  for (let i = 0; i < 100; i++) s.step(DT, input);
  assert.ok(s.state.thrust.every((t) => t < 0.01));
  assert.ok(s.state.vel.y < 0, 'should be falling');
});

test('pitch stick up gives nose-up rate', () => {
  const s = sim();
  const h = s.hoverThrottle();
  for (let i = 0; i < 200; i++) s.step(DT, freeze(s, h));
  for (let i = 0; i < 120; i++) s.step(DT, { ...freeze(s, h), pitch: 0.5 });
  assert.ok(s.state.omega.x > 1, `omega.x=${s.state.omega.x.toFixed(2)}`);
});

test('roll stick right gives roll-right rate (negative z)', () => {
  const s = sim();
  const h = s.hoverThrottle();
  for (let i = 0; i < 200; i++) s.step(DT, freeze(s, h));
  for (let i = 0; i < 120; i++) s.step(DT, { ...freeze(s, h), roll: 0.5 });
  assert.ok(s.state.omega.z < -1, `omega.z=${s.state.omega.z.toFixed(2)}`);
});

test('yaw stick right gives nose-right rate (negative y)', () => {
  const s = sim();
  const h = s.hoverThrottle();
  for (let i = 0; i < 200; i++) s.step(DT, freeze(s, h));
  for (let i = 0; i < 400; i++) s.step(DT, { ...freeze(s, h), yaw: 0.5 });
  assert.ok(s.state.omega.y < -0.2, `omega.y=${s.state.omega.y.toFixed(2)}`);
});

test('full pitch reaches the commanded rate in under 250ms', () => {
  const s = sim();
  const h = s.hoverThrottle();
  for (let i = 0; i < 300; i++) s.step(DT, freeze(s, h));
  const target = DEFAULT_PARAMS.rateMax[0] * (Math.PI / 180);
  let reached = -1;
  for (let i = 0; i < 250; i++) {
    s.step(DT, { ...freeze(s, h), pitch: 1 });
    if (reached < 0 && s.state.omega.x >= target * 0.9) reached = i;
  }
  assert.ok(reached >= 0, `never reached ${target.toFixed(2)} rad/s, got ${s.state.omega.x.toFixed(2)}`);
  assert.ok(reached < 200, `took ${reached} ms`);
});

test('motor commands stay bounded and finite', () => {
  const s = sim();
  const h = s.hoverThrottle();
  for (let i = 0; i < 1000; i++) {
    s.step(DT, {
      throttle: 1,
      roll: Math.sin(i / 40),
      pitch: Math.cos(i / 55),
      yaw: Math.sin(i / 90),
      armed: true,
      angle: false,
    });
  }
  for (const m of s.state.motors) assert.ok(Number.isFinite(m) && m >= 0 && m <= 1, `motor ${m}`);
  for (const t of s.state.thrust) assert.ok(Number.isFinite(t) && t >= 0, `thrust ${t}`);
});

test('quaternion stays normalised', () => {
  const s = sim();
  const h = s.hoverThrottle();
  for (let i = 0; i < 4000; i++) {
    s.step(DT, {
      throttle: h + Math.sin(i / 30) * 0.15,
      roll: Math.sin(i / 17) * 0.8,
      pitch: Math.cos(i / 23) * 0.8,
      yaw: Math.sin(i / 51) * 0.6,
      armed: true,
      angle: false,
    });
    const q = s.state.quat;
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    assert.ok(Math.abs(len - 1) < 1e-6, `|q|=${len}`);
  }
});

test('crash from height stops the quad', () => {
  const s = sim();
  s.reset();
  s.state.pos.y = 20;
  for (let i = 0; i < 4000; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.equal(s.state.crashed, true);
});

test('a 10 m drop is survivable, not a crash', () => {
  const s = sim();
  s.reset();
  s.state.pos.y = 10; // ~14 m/s touchdown
  for (let i = 0; i < 3000; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.equal(s.state.crashed, false);
  assert.ok(Math.abs(s.state.pos.y - 0.02) < 1e-6);
});

test('a fast low pass along the ground is not a crash', () => {
  const s = sim();
  s.reset();
  s.state.pos = { x: 0, y: 0.3, z: 0 };
  s.state.vel = { x: 0, y: -1, z: -12 };
  for (let i = 0; i < 100; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.equal(s.state.crashed, false);
});

test('light obstacle contact bounces instead of ending the run', () => {
  const s = sim();
  s.reset();
  s.colliders = [{ min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } }];
  s.state.pos = { x: 0.62, y: 1, z: 0 };
  s.state.vel = { x: -3, y: 0, z: 0 };
  for (let i = 0; i < 100; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.equal(s.state.crashed, false);
  assert.ok(s.state.pos.x >= 0.59 - 1e-6, `pos.x ${s.state.pos.x}`);
  assert.ok(s.state.vel.x > 0, `vel.x ${s.state.vel.x}`);
});

test('a soft contact raises a bump event for audio', () => {
  const s = sim();
  s.reset();
  s.colliders = [{ min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } }];
  s.state.pos = { x: 0.62, y: 1, z: 0 };
  s.state.vel = { x: -3, y: 0, z: 0 };
  for (let i = 0; i < 100; i++) s.step(DT, idle);
  assert.equal(s.state.crashed, false);
  assert.ok(s.state.bumps > 0, `bumps ${s.state.bumps}`);
  assert.ok(s.state.bumpSpeed > 1, `bump speed ${s.state.bumpSpeed}`);
});

test('a landing records its impact once for audio', () => {
  const s = sim();
  s.reset();
  s.state.pos = { x: 0, y: 2, z: 0 };
  s.state.vel = { x: 0, y: -4, z: 0 };
  for (let i = 0; i < 1000; i++) s.step(DT, idle);
  assert.equal(s.state.crashed, false);
  assert.equal(s.state.landings, 1);
  assert.ok(s.state.landingImpact > 1.2, `impact ${s.state.landingImpact}`);

  // Sitting on the ground must not keep re-triggering the touchdown sound.
  for (let i = 0; i < 1000; i++) s.step(DT, idle);
  assert.equal(s.state.landings, 1);
});

test('hard obstacle hit still crashes', () => {
  const s = sim();
  s.reset();
  s.colliders = [{ min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } }];
  s.state.pos = { x: 0.62, y: 1, z: 0 };
  s.state.vel = { x: -8, y: 0, z: 0 };
  for (let i = 0; i < 100; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.equal(s.state.crashed, true);
});

test('a crashed quad sinks to the ground instead of hanging in the air', () => {
  const s = sim();
  s.reset();
  s.colliders = [{ min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 2, z: 0.5 } }];
  s.state.pos = { x: 0.62, y: 1.5, z: 0 };
  s.state.vel = { x: -8, y: 0, z: 0 };
  for (let i = 0; i < 100; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.equal(s.state.crashed, true);
  for (let i = 0; i < 3000; i++) s.step(DT, { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, angle: false });
  assert.ok(s.state.pos.y <= 0.021, `pos.y ${s.state.pos.y}`);
});

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Pitch relative to the current heading (the angle angle-mode controls). */
function headingPitch(s: QuadSim): number {
  const f = s.forwardVector();
  const u = s.upVector();
  const heading = Math.atan2(-f.x, -f.z);
  const dot = u.x * -Math.sin(heading) + u.z * -Math.cos(heading);
  return (-Math.asin(clamp1(dot)) * 180) / Math.PI;
}

test('angle mode holds the commanded lean and moves forward', () => {
  const s = sim();
  s.reset();
  s.state.pos.y = 30;
  const input: Inputs = { throttle: 0.5, roll: 0, pitch: -1, yaw: 0, armed: true, angle: true };
  for (let i = 0; i < 2000; i++) s.step(DT, input);

  const lean = (-DEFAULT_PARAMS.angle.maxLean * 180) / Math.PI;
  const pitch = headingPitch(s);
  assert.ok(
    Math.abs(pitch - lean) < 2,
    `leans ${pitch.toFixed(1)}°, expected ${lean.toFixed(0)}°`,
  );
  assert.ok(s.state.pos.z < -2, `did not fly forward (z=${s.state.pos.z.toFixed(2)})`);
});

test('angle mode does not tumble when yawing while pitched', () => {
  const s = sim();
  s.reset();
  s.state.pos.y = 30;
  const base: Inputs = { throttle: 0.5, roll: 0, pitch: -1, yaw: 0, armed: true, angle: true };
  for (let i = 0; i < 2000; i++) s.step(DT, base);
  for (let i = 0; i < 1500; i++) s.step(DT, { ...base, yaw: 1 });

  const up = s.upVector();
  assert.ok(up.y > 0.7, `lost the horizon while yawing (up.y=${up.y.toFixed(2)})`);
  const lean = (-DEFAULT_PARAMS.angle.maxLean * 180) / Math.PI;
  const pitch = headingPitch(s);
  assert.ok(
    pitch > lean - 10 && pitch < lean + 10,
    `pitch drifted to ${pitch.toFixed(1)}° during yaw`,
  );
});

test('angle mode levels out without overshooting past level', () => {
  const s = sim();
  s.reset();
  s.state.pos.y = 30;
  for (let i = 0; i < 2000; i++)
    s.step(DT, { throttle: 0.5, roll: 0, pitch: -1, yaw: 0, armed: true, angle: true });

  let maxPitch = -Infinity;
  for (let i = 0; i < 1500; i++) {
    s.step(DT, { throttle: 0.5, roll: 0, pitch: 0, yaw: 0, armed: true, angle: true });
    maxPitch = Math.max(maxPitch, s.euler().x);
  }
  assert.ok(maxPitch < (2 * Math.PI) / 180, `overshot level by ${((maxPitch * 180) / Math.PI).toFixed(1)}°`);
});

// ---------------------------------------------------------------- worlds

test('reset uses the map spawn instead of the origin', () => {
  const s = sim();
  s.spawn = { x: 3, y: 0.06, z: -12 };
  s.reset();
  assert.deepEqual(s.state.pos, { x: 3, y: 0.06, z: -12 });
  assert.deepEqual(s.state.vel, { x: 0, y: 0, z: 0 });
  assert.equal(s.state.crashed, false);
});

test('a raised platform is landable and holds the quad', () => {
  const s = sim();
  s.platforms = [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5, top: 4 }];
  s.reset();
  s.state.pos = { x: 0, y: 7, z: 0 };
  for (let i = 0; i < 3000; i++) s.step(DT, idle);
  assert.equal(s.state.crashed, false);
  assert.ok(Math.abs(s.state.pos.y - 4.02) < 0.01, `pos.y ${s.state.pos.y}`);
});

test('a 10 m drop onto a platform is survivable', () => {
  const s = sim();
  s.platforms = [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5, top: 5 }];
  s.reset();
  s.state.pos = { x: 0, y: 15, z: 0 };
  for (let i = 0; i < 3000; i++) s.step(DT, idle);
  assert.equal(s.state.crashed, false);
  assert.ok(Math.abs(s.state.pos.y - 5.02) < 0.01, `pos.y ${s.state.pos.y}`);
});

test('a slope is landable at its local height', () => {
  const s = sim();
  s.ramps = [{ minX: -5, maxX: 5, minZ: -10, maxZ: 0, axis: 'z', yAtMin: 2, yAtMax: 0 }];
  s.reset();
  // z = -8 is 20% along the ramp: surface = 2 + (0 - 2) * 0.2 = 1.6
  s.state.pos = { x: 0, y: 2.6, z: -8 };
  for (let i = 0; i < 1500; i++) s.step(DT, idle);
  assert.equal(s.state.crashed, false);
  assert.ok(Math.abs(s.state.pos.y - 1.62) < 0.02, `pos.y ${s.state.pos.y}`);
});

test('a dead quad settles on a raised deck, not the floor', () => {
  const s = sim();
  s.platforms = [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5, top: 5 }];
  s.reset();
  s.state.pos = { x: 0, y: 9, z: 0 };
  s.state.crashed = true;
  for (let i = 0; i < 3000; i++) s.step(DT, idle);
  assert.ok(Math.abs(s.state.pos.y - 5.02) < 0.01, `pos.y ${s.state.pos.y}`);
});

