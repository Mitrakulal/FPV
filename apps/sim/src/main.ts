import * as THREE from 'three';
import { Assets } from './assets';
import { QuadSim, DEFAULT_PARAMS } from './physics';
import { InputClient } from './input';
import { buildWorld } from './scene';
import { buildIndoorWorld } from './indoor';
import { PostFX } from './post';
import { SimAudio } from './audio';
import type { World, WorldKind } from './world';

const canvas = document.getElementById('view') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});

/** Keep the total pixel count near 1080p even on big/high-dpi screens. */
function targetDpr(): number {
  const css = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.max(0.5, Math.min(window.devicePixelRatio, 1.5, Math.sqrt(3_200_000 / css)));
}

let qualityScale = 1;
renderer.setPixelRatio(targetDpr());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const assets = new Assets();
await assets.load(renderer);

const [airfield, indoor] = await Promise.all([
  buildWorld(renderer, assets),
  buildIndoorWorld(renderer, assets),
]);
const worlds: Record<WorldKind, World> = { airfield, indoor };
let activeWorld: World = airfield;
let activeKind: WorldKind = 'airfield';

const camera = new THREE.PerspectiveCamera(86, window.innerWidth / window.innerHeight, 0.03, 520);
camera.up.set(0, 1, 0);

const post = new PostFX(renderer);
post.setGrade(activeWorld.grade);

const sim = new QuadSim(DEFAULT_PARAMS);

let camTilt = (24 * Math.PI) / 180;
let chase = false;
let overview = false;
let analog = false;
let analogMix = 0;
let wasCrashed = false;
let flash = 0;
let menuOpen = true;
let sessionStarted = false;
let courseComplete = false;

const input = new InputClient((code) => onKey(code));

const urlParams = new URLSearchParams(location.search);
const lookParam = urlParams.get('look');
const debugLook = lookParam ? lookParam.split(',').map(Number) : null;

function setWorld(kind: WorldKind): void {
  const next = worlds[kind];
  activeWorld = next;
  activeKind = kind;
  audio.setEnvironment(kind === 'indoor' ? 'indoor' : 'outdoor');
  sim.spawn = { ...next.spawn };
  sim.colliders = next.colliders;
  sim.ramps = next.ramps;
  sim.platforms = next.platforms;
  sim.reset();
  next.training?.reset();
  sim.state.quat = { x: 0, y: 0, z: 0, w: 1 };
  post.setGrade(next.grade);
  chasePos.set(next.spawn.x, next.spawn.y + 2, next.spawn.z + 6);
  courseComplete = false;
  wasCrashed = false;
  flash = 0;
  setBanner(null);
}

function startMode(kind: WorldKind, fromUrl = false): void {
  setWorld(kind);
  sessionStarted = true;
  menuOpen = false;
  menuEl.hidden = true;
  document.body.classList.remove('menu-open');
  accumulator = 0;
  last = performance.now();
  input.disarmKeyboard();
  chase = false;
  overview = false;
  camTilt = (24 * Math.PI) / 180;

  if (fromUrl) {
    overview = urlParams.get('view') === 'overview';
    if (urlParams.get('view') === 'chase') chase = true;
    const alt = Number(urlParams.get('alt'));
    if (urlParams.has('alt') && Number.isFinite(alt)) sim.state.pos.y = Math.max(0.05, alt);
  }
  setBanner(null);
}

function openMenu(fromFlight: boolean): void {
  menuOpen = true;
  menuEl.hidden = false;
  document.body.classList.add('menu-open');
  resumeBtn.hidden = !fromFlight || !sessionStarted;
  resumeBtn.textContent = activeKind === 'indoor' ? 'RESUME TRAINING' : 'RESUME FLIGHT';
  input.disarmKeyboard();
  accumulator = 0;
  setBanner(null);
}

function resumeSession(): void {
  if (!sessionStarted) return;
  menuOpen = false;
  menuEl.hidden = true;
  document.body.classList.remove('menu-open');
  last = performance.now();
  accumulator = 0;
  input.disarmKeyboard();
}

function reset() {
  sim.reset();
  activeWorld.training?.reset();
  courseComplete = false;
  wasCrashed = false;
  input.disarmKeyboard();
  setBanner(null);
  flash = 0;
}

function onKey(code: string) {
  if (code === 'KeyM') {
    audio.toggleMuted();
    syncAudioUi();
  }

  if (menuOpen) {
    if (code === 'Digit1') startMode('airfield');
    else if (code === 'Digit2') startMode('indoor');
    else if (code === 'Escape' && sessionStarted) resumeSession();
    audio.ensure();
    return;
  }

  if (code === 'Escape') {
    openMenu(true);
    audio.ensure();
    return;
  }

  if (code === 'KeyR') reset();
  else if (code === 'KeyC') chase = !chase;
  else if (code === 'KeyO') overview = !overview;
  else if (code === 'KeyV') setAnalog(!analog);
  else if (code === 'Space') input.toggleArm();
  else if (code === 'BracketLeft') camTilt = Math.max(0, camTilt - (5 * Math.PI) / 180);
  else if (code === 'BracketRight') camTilt = Math.min((60 * Math.PI) / 180, camTilt + (5 * Math.PI) / 180);
  else if (code === 'KeyH') hud.help.hidden = !hud.help.hidden;
  audio.ensure();
}

// ---------------------------------------------------------------- audio
const audio = new SimAudio();

// ---------------------------------------------------------------- hud
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const hud = {
  linkDot: el<HTMLSpanElement>('linkDot'),
  linkText: el<HTMLSpanElement>('linkText'),
  rtt: el<HTMLSpanElement>('rtt'),
  hz: el<HTMLSpanElement>('hz'),
  pkts: el<HTMLSpanElement>('pkts'),
  age: el<HTMLDivElement>('age'),
  fps: el<HTMLSpanElement>('fps'),
  frameMs: el<HTMLSpanElement>('frameMs'),
  tickRate: el<HTMLSpanElement>('tickRate'),
  cameraMode: el<HTMLDivElement>('cameraMode'),
  thrFill: el<HTMLDivElement>('thrFill'),
  thrTxt: el<HTMLDivElement>('thrTxt'),
  sticks: el<HTMLDivElement>('sticks'),
  alt: el<HTMLSpanElement>('alt'),
  spd: el<HTMLSpanElement>('spd'),
  volts: el<HTMLSpanElement>('volts'),
  tilt: el<HTMLSpanElement>('tilt'),
  progress: el<HTMLDivElement>('progress'),
  mapName: el<HTMLSpanElement>('mapName'),
  armPill: el<HTMLDivElement>('armPill'),
  modePill: el<HTMLDivElement>('modePill'),
  banner: el<HTMLDivElement>('banner'),
  vignette: el<HTMLDivElement>('vignette'),
  soundPill: el<HTMLDivElement>('soundPill'),
  helpPhone: el<HTMLSpanElement>('helpPhone'),
  help: el<HTMLDivElement>('help'),
  boot: el<HTMLDivElement>('boot'),
};

const menuEl = el<HTMLDivElement>('menu');
const resumeBtn = el<HTMLButtonElement>('resumeBtn');
const mapBtn = el<HTMLButtonElement>('mapBtn');
const muteBtn = el<HTMLButtonElement>('muteBtn');
const muteTxt = el<HTMLSpanElement>('muteTxt');
const volSlider = el<HTMLInputElement>('volSlider');
const volOut = el<HTMLOutputElement>('volOut');

function syncAudioUi(): void {
  const pct = Math.round(audio.volume * 100);
  volSlider.value = String(pct);
  volOut.textContent = `${pct}%`;
  muteBtn.classList.toggle('off', audio.muted);
  muteBtn.setAttribute('aria-pressed', String(audio.muted));
  muteTxt.textContent = audio.muted ? 'MUTED' : 'SOUND ON';
  hud.soundPill.hidden = !audio.muted;
}
syncAudioUi();

// Screenshot aid: ?hud=0 hides the overlays so docs and thumbnails stay clean.
if (new URLSearchParams(window.location.search).get('hud') === '0') {
  document.body.classList.add('hide-hud');
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-map]')) {
  button.addEventListener('click', () => {
    const map = button.dataset.map;
    if (map === 'airfield' || map === 'indoor') startMode(map);
  });
}
resumeBtn.addEventListener('click', () => resumeSession());
mapBtn.addEventListener('click', () => openMenu(true));
muteBtn.addEventListener('click', () => {
  audio.ensure();
  audio.toggleMuted();
  syncAudioUi();
});
volSlider.addEventListener('input', () => {
  audio.ensure();
  audio.setVolume(Number(volSlider.value) / 100);
  syncAudioUi();
});

function setBanner(text: string | null, kind: 'lost' | 'crashed' | null = null) {
  if (!text) {
    hud.banner.hidden = true;
    hud.banner.className = 'banner';
    return;
  }
  hud.banner.hidden = false;
  hud.banner.textContent = text;
  hud.banner.className = `banner ${kind ?? ''}`;
}

function setAnalog(on: boolean) {
  analog = on;
  hud.vignette.classList.toggle('analog', on);
}

// ---------------------------------------------------------------- loop
const TICK = 0.001;
const bootAt = performance.now();
let accumulator = 0;
let last = performance.now();
let fpsEma = 60;
let frameEma = 16.7;
let ticksPerSecond = 0;
let tickCounter = 0;
let tickSampleAt = performance.now();
let hudAt = 0;
const DEG = 180 / Math.PI;

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tiltQ = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const chasePos = new THREE.Vector3(0, 2, 6);
const chaseLook = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const propPhase = [0, 0, 0, 0];

function syncQuadVisual() {
  const s = sim.state;
  const q = activeWorld.quad.group;
  q.position.set(s.pos.x, s.pos.y, s.pos.z);
  q.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
}

function updateCamera(dt: number, now: number) {
  const s = sim.state;
  const level = s.motors.reduce((a, b) => a + b, 0) / 4;
  const q = tmpQ.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);

  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  // speed widens the view a touch, like every FPV cam does under load
  const hfov = (116 + Math.min(10, speed * 0.35)) * (Math.PI / 180);
  const aspect = window.innerWidth / window.innerHeight;
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
  const nextFov = Math.min(120, Math.max(50, vfov * DEG));
  if (Math.abs(camera.fov - nextFov) > 0.05) {
    camera.fov += (nextFov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  // FPV is the only mode where the airframe would sit inside the camera.
  // Chase, overview and the debug camera all want to see the model.
  activeWorld.quad.setFirstPerson(!chase && !overview && !debugLook);

  if (debugLook && debugLook.length >= 6) {
    camera.position.set(debugLook[0]!, debugLook[1]!, debugLook[2]!);
    camera.lookAt(debugLook[3]!, debugLook[4]!, debugLook[5]!);
    return;
  }

  if (overview) {
    const [x, y, z] = activeWorld.overview.pos;
    const [lx, ly, lz] = activeWorld.overview.look;
    camera.position.set(x, y, z);
    camera.lookAt(lx, ly, lz);
    return;
  }

  if (chase) {
    // springy chase cam, a bit of lag so speed reads
    tmpV.set(0, 0.34, 1.05).applyQuaternion(q);
    lookTarget.set(s.pos.x, s.pos.y + 0.03, s.pos.z);
    chasePos.lerp(
      new THREE.Vector3(s.pos.x + tmpV.x, Math.max(0.22, s.pos.y + tmpV.y), s.pos.z + tmpV.z),
      1 - Math.exp(-dt * 8),
    );
    camera.position.copy(chasePos);
    chaseLook.lerp(lookTarget, 1 - Math.exp(-dt * 12));
    camera.lookAt(chaseLook);
    return;
  }

  // FPV: camera sits in the pod, tilted up relative to the frame. The lens rides
  // above the prop plane like a real stack, so the front blades sweep through
  // the bottom corners instead of sitting edge-on at the frustum edge.
  tmpV.set(0, 0.055, -0.05).applyQuaternion(q);
  camera.position.set(s.pos.x + tmpV.x, s.pos.y + tmpV.y, s.pos.z + tmpV.z);

  tiltQ.setFromAxisAngle(X_AXIS, camTilt);
  camera.quaternion.copy(q).multiply(tiltQ);

  // motor vibration + low-frequency wobble in dirty air
  const t = now * 0.001;
  const vib = 0.0007 + level * 0.0014;
  const wobble = Math.min(0.006, Math.abs(s.vel.y) * 0.002 + level * 0.002);
  camera.translateX(Math.sin(t * 137) * vib + Math.sin(t * 7.3) * wobble * 0.4);
  camera.translateY(Math.sin(t * 91 + 1.3) * vib + Math.sin(t * 5.1 + 0.4) * wobble);
  camera.rotateZ(Math.sin(t * 4.7) * wobble * 0.25);
}

function updateMenuCamera(now: number) {
  activeWorld.quad.setFirstPerson(false);
  if (debugLook && debugLook.length >= 6) {
    camera.position.set(debugLook[0]!, debugLook[1]!, debugLook[2]!);
    camera.lookAt(debugLook[3]!, debugLook[4]!, debugLook[5]!);
    return;
  }
  const [x, y, z] = activeWorld.overview.pos;
  const [lx, ly, lz] = activeWorld.overview.look;
  const drift = now * 0.00004;
  camera.position.set(x + Math.sin(drift) * 5, y, z + Math.cos(drift) * 5);
  camera.lookAt(lx, ly, lz);
}

function updateHud(now: number) {
  const link = input.link;
  const s = sim.state;
  const inp = input.read();
  const armed = inp.armed && !s.crashed;

  hud.linkDot.classList.toggle('ok', link.fresh);
  hud.linkText.textContent = link.fresh ? 'TX live' : link.connected ? 'TX silent' : 'TX offline';
  hud.rtt.textContent = link.rttMs >= 0 ? link.rttMs.toFixed(1) : '--';
  hud.hz.textContent = link.fresh ? String(link.hz) : '--';
  hud.pkts.textContent = String(link.packets);
  hud.age.textContent = link.ageMs >= 0 ? `last frame ${link.ageMs} ms ago` : 'no frames yet';

  hud.fps.textContent = fpsEma.toFixed(0);
  hud.frameMs.textContent = frameEma.toFixed(1);
  hud.tickRate.textContent = String(ticksPerSecond);
  hud.cameraMode.textContent = `${chase ? 'CHASE' : 'FPV'} · tilt ${Math.round(camTilt * DEG)}°${analog ? ' · analog' : ''}`;

  const thrPct = Math.round(inp.throttle * 100);
  hud.thrFill.style.height = `${thrPct}%`;
  hud.thrTxt.textContent = `${thrPct}%`;
  hud.sticks.textContent = `P ${Math.round(inp.pitch * 100)} · R ${Math.round(inp.roll * 100)} · Y ${Math.round(inp.yaw * 100)}`;

  hud.alt.textContent = s.pos.y.toFixed(1);
  hud.spd.textContent = Math.hypot(s.vel.x, s.vel.y, s.vel.z).toFixed(1);
  hud.volts.textContent = s.voltage.toFixed(1);
  hud.tilt.textContent = `${Math.round(sim.tilt() * DEG)}°`;

  hud.progress.textContent = courseComplete
    ? 'COURSE COMPLETE'
    : activeWorld.training
      ? activeWorld.training.progressText()
      : 'FREE FLIGHT';
  hud.mapName.textContent = activeWorld.label;

  hud.armPill.textContent = armed ? 'ARMED' : 'DISARMED';
  hud.armPill.classList.toggle('armed', armed);
  hud.modePill.textContent = inp.angle ? 'ANGLE' : 'ACRO';
  hud.helpPhone.textContent = link.fresh
    ? 'TX: phone link live'
    : 'phone: open /tx/ over adb reverse';

  if (sim.state.crashed) {
    setBanner('CRASHED · R to restart from the start', 'crashed');
  } else if (courseComplete) {
    setBanner('COURSE COMPLETE · R to fly again', null);
  } else if (!link.fresh && link.packets > 0) {
    setBanner('LINK LOST · motors cut', 'lost');
  } else if (!link.fresh && link.packets === 0 && now - bootAt < 8000) {
    setBanner(
      link.connected
        ? 'no TX data · open /tx/ on the phone'
        : 'relay offline · restart run.bat',
      null,
    );
  } else {
    setBanner(null);
  }
}

const blurDir = new THREE.Vector2(1, 0);

function frame(now: number) {
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.25, Math.max(0, rawDt));

  fpsEma = fpsEma * 0.9 + (1 / Math.max(rawDt, 0.0001)) * 0.1;
  frameEma = frameEma * 0.9 + rawDt * 1000 * 0.1;

  input.update(dt);
  if (!menuOpen) {
    accumulator += dt;
    let steps = 0;
    const limitTicks = 400;
    while (accumulator >= TICK && steps < limitTicks) {
      sim.step(TICK, input.read());
      accumulator -= TICK;
      steps++;
      tickCounter++;
    }
    if (steps >= limitTicks) accumulator = 0; // never spiral
  } else {
    accumulator = 0;
  }

  const armedSignal = input.read().armed && !sim.state.crashed;

  if (sim.state.crashed && !wasCrashed) {
    flash = 0.55;
  }
  wasCrashed = sim.state.crashed;

  syncQuadVisual();
  if (menuOpen) updateMenuCamera(now);
  else updateCamera(dt, now);

  if (!menuOpen && activeWorld.training && !courseComplete && !sim.state.crashed) {
    tmpV.set(sim.state.pos.x, sim.state.pos.y, sim.state.pos.z);
    const step = activeWorld.training.index;
    const result = activeWorld.training.update(tmpV, now);
    if (result.passed) {
      flash = Math.max(flash, 0.07);
      audio.portal(step, result.complete);
    }
    if (result.complete) courseComplete = true;
  }

  // props + motion blur
  const quad = activeWorld.quad;
  const level = sim.state.motors.reduce((a, b) => a + b, 0) / 4;
  const spinning = armedSignal && !sim.state.crashed;
  // Spool the visual blur in above idle, so the props read as swept discs in a
  // hover instead of three blades strobing past the lens.
  const blur = spinning ? Math.max(0, Math.min(1, (level - 0.1) / 0.35)) : 0;
  quad.setPropBlur(blur);
  for (let i = 0; i < quad.propGroups.length; i++) {
    const g = quad.propGroups[i];
    if (!g) continue;
    propPhase[i] =
      (propPhase[i] ?? 0) + (spinning ? dt * (6 + level * 150) : 0) * (i % 2 === 0 ? 1 : -1);
    g.rotation.y = propPhase[i] ?? 0;
  }

  const s = sim.state;
  audio.update({
    motors: s.motors,
    armed: armedSignal,
    crashed: s.crashed,
    paused: menuOpen,
    speed: Math.hypot(s.vel.x, s.vel.y, s.vel.z),
    verticalSpeed: s.vel.y,
    bumps: s.bumps,
    bumpSpeed: s.bumpSpeed,
    landings: s.landings,
    landingImpact: s.landingImpact,
  });
  activeWorld.dust.rotation.y += dt * 0.008;
  analogMix += ((analog ? 1 : 0) - analogMix) * (1 - Math.exp(-dt * 7));
  flash = Math.max(0, flash - dt * 1.6);

  if (now - hudAt > 100) {
    hudAt = now;
    input.refresh();
    updateHud(now);
  }
  if (now - tickSampleAt >= 1000) {
    tickSampleAt = now;
    ticksPerSecond = tickCounter;
    tickCounter = 0;
    if (!urlParams.has('fixed')) adaptQuality();
  }

  // screen-space smear from rotation, like a rolling shutter
  const w = sim.state.omega;
  const wm = Math.hypot(w.x, w.y);
  if (wm > 0.001) blurDir.set(w.y, w.x).normalize();
  const blurAmount = Math.min(0.006, wm * 0.0014);

  post.render(
    activeWorld.scene,
    camera,
    { blurDir, blurAmount, analog: analogMix, flash },
    now * 0.001,
  );

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- quality
let qualityStage = 0;
let lowFpsFor = 0;

function adaptQuality() {
  if (fpsEma < 55) lowFpsFor += 1;
  else lowFpsFor = Math.max(0, lowFpsFor - 0.5);
  if (lowFpsFor < 4) return;

  lowFpsFor = 0;
  if (qualityStage === 0) {
    qualityStage = 1;
    qualityScale = 0.85;
    applySize();
  } else if (qualityStage === 1) {
    qualityStage = 2;
    qualityScale = 0.7;
    for (const next of Object.values(worlds)) {
      next.sun.shadow.mapSize.set(1024, 1024);
      next.sun.shadow.map?.dispose();
      if (next.sun.shadow.map) next.sun.shadow.map = null;
    }
    applySize();
  } else if (qualityStage === 2) {
    qualityStage = 3;
    qualityScale = 0.6;
    applySize();
  }
}

function applySize() {
  const dpr = targetDpr() * qualityScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight, dpr);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applySize();
});

window.addEventListener('pointerdown', () => audio.ensure(), { once: true });
window.addEventListener('keydown', () => audio.ensure(), { once: true });

post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
setAnalog(false);
syncQuadVisual();
hud.boot.classList.add('done');
setTimeout(() => hud.boot.remove(), 700);

// handy for poking at the sim from the devtools console
(window as unknown as { fpv: unknown }).fpv = {
  renderer,
  get world() {
    return activeWorld;
  },
  worlds,
  activeWorld: () => activeWorld,
  sim,
  camera,
  input,
  post,
  assets,
  audio,
  quality: () => ({ qualityScale, qualityStage, dpr: renderer.getPixelRatio(), fpsEma }),
};
(window as unknown as { THREE: unknown }).THREE = THREE;

const startMap = urlParams.get('map');
if (startMap === 'airfield' || startMap === 'indoor') {
  startMode(startMap, true);
} else {
  openMenu(false);
}

requestAnimationFrame((t) => {
  last = t;
  tickSampleAt = t;
  frame(t);
});
