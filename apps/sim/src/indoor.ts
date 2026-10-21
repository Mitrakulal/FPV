import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Assets, TexSet } from './assets';
import { buildQuad } from './quad';
import type { Collider, Platform, Ramp } from './physics';
import { rampEdge, wedgeMesh } from './surfaces';
import { TrainingCourse, type PortalVisual } from './training';
import {
  routeStencilTexture,
  signTexture,
  tesseractWallTexture,
  trainingNumberTexture,
} from './textures';
import type { World } from './world';

type MatOpts = {
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envMapIntensity?: number;
};

function pbr(set: TexSet, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 0.8, opts.normalScale ?? 0.8),
    envMapIntensity: opts.envMapIntensity ?? 0.6,
  });
}

type Hole =
  | { kind: 'arch'; cx: number; cy: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number }
  | { kind: 'slot'; cx: number; cy: number; w: number; h: number }
  | { kind: 'hex'; cx: number; cy: number; r: number };

interface HoleInfo {
  points: THREE.Vector2[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function holeInfo(hole: Hole): HoleInfo {
  const points: THREE.Vector2[] = [];

  if (hole.kind === 'circle') {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      points.push(new THREE.Vector2(hole.cx + Math.cos(a) * hole.r, hole.cy + Math.sin(a) * hole.r));
    }
  } else if (hole.kind === 'hex') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      points.push(new THREE.Vector2(hole.cx + Math.cos(a) * hole.r, hole.cy + Math.sin(a) * hole.r * 0.866));
    }
  } else if (hole.kind === 'arch') {
    const hw = hole.w / 2;
    const y0 = hole.cy - hole.h / 2;
    const yTop = hole.cy + hole.h / 2;
    const spring = Math.max(y0, yTop - hw);
    points.push(new THREE.Vector2(hole.cx - hw, y0));
    points.push(new THREE.Vector2(hole.cx + hw, y0));
    points.push(new THREE.Vector2(hole.cx + hw, spring));
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      points.push(new THREE.Vector2(hole.cx + Math.cos(a) * hw, spring + Math.sin(a) * hw));
    }
    points.push(new THREE.Vector2(hole.cx - hw, y0));
  } else {
    const hw = hole.w / 2;
    const hh = hole.h / 2;
    points.push(new THREE.Vector2(hole.cx - hw, hole.cy - hh));
    points.push(new THREE.Vector2(hole.cx + hw, hole.cy - hh));
    points.push(new THREE.Vector2(hole.cx + hw, hole.cy + hh));
    points.push(new THREE.Vector2(hole.cx - hw, hole.cy + hh));
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { points, minX, maxX, minY, maxY };
}

function holePath(info: HoleInfo): THREE.Path {
  const ordered = THREE.ShapeUtils.isClockWise(info.points)
    ? info.points
    : [...info.points].reverse();
  const path = new THREE.Path();
  path.setFromPoints(ordered);
  path.closePath();
  return path;
}

function frameCurve(points: THREE.Vector2[], z: number): THREE.CurvePath<THREE.Vector3> {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    curve.add(new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, z), new THREE.Vector3(b.x, b.y, z)));
  }
  return curve;
}

function addBox(
  scene: THREE.Scene,
  colliders: Collider[],
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  collide = true,
  cast = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collide) {
    colliders.push({
      min: { x: x - w / 2, y: y - h / 2, z: z - d / 2 },
      max: { x: x + w / 2, y: y + h / 2, z: z + d / 2 },
    });
  }
  return mesh;
}

/**
 * Indoor start-to-finish training facility. The layout is deliberately broad:
 * 32 m wide rooms, 4-7 m openings and ramps no steeper than ~18 degrees. The
 * tesseract cladding is one repeated emissive texture plus a handful of frames,
 * keeping the draw count low while the portals do the guidance work.
 */
export async function buildIndoorWorld(renderer: THREE.WebGLRenderer, assets: Assets): Promise<World> {
  const scene = new THREE.Scene();
  const colliders: Collider[] = [];
  const ramps: Ramp[] = [];
  const platforms: Platform[] = [];

  scene.background = new THREE.Color(0x05070a);
  scene.fog = new THREE.FogExp2(0x05070a, 0.008);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.4;
  pmrem.dispose();

  // ---------------------------------------------------------------- lights
  const sun = new THREE.DirectionalLight(0xffb36f, 3.4);
  sun.position.set(26, 48, 22);
  sun.target.position.set(0, 3, -48);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 78;
  sun.shadow.camera.bottom = -78;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x7cc5e8, 1.25);
  fill.position.set(-22, 18, -94);
  fill.target.position.set(0, 5, -42);
  scene.add(fill);
  scene.add(fill.target);

  scene.add(new THREE.HemisphereLight(0xffc38c, 0x080c12, 1.1));
  scene.add(new THREE.AmbientLight(0x91a9c4, 0.42));

  // A few soft pools of light keep the route readable without washing out the
  // tesseract glow. They are intentionally shadowless for performance.
  for (const [x, z, color] of [
    [0, 10, 0xffb15c],
    [-4, -22, 0xffb15c],
    [4, -42, 0x78e6b0],
    [-4, -60, 0x78e6b0],
    [0, -84, 0xffb15c],
  ] as const) {
    const pl = new THREE.PointLight(color, 260, 38, 2);
    pl.position.set(x, 14, z);
    scene.add(pl);
  }

  // ---------------------------------------------------------------- materials
  const concrete = await assets.tex('concrete_floor_worn_001', 8, 30);
  const rampTex = await assets.tex('concrete_floor_worn_001', 2, 4);
  const floorMat = pbr(concrete, {
    color: 0x6f6d68,
    roughness: 0.82,
    normalScale: 0.9,
    envMapIntensity: 0.7,
  });
  const rampMat = pbr(rampTex, {
    color: 0x77756f,
    roughness: 0.88,
    normalScale: 0.8,
    envMapIntensity: 0.55,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x22262c,
    roughness: 0.86,
    metalness: 0.08,
  });
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x101318,
    roughness: 0.92,
    metalness: 0.05,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1a1e22,
    roughness: 0.4,
    metalness: 0.82,
  });
  const bronze = new THREE.MeshStandardMaterial({
    color: 0x4d3b2a,
    roughness: 0.5,
    metalness: 0.65,
  });
  const amberGlow = new THREE.MeshStandardMaterial({
    color: 0xffc286,
    emissive: 0xff9a45,
    emissiveIntensity: 2.4,
    roughness: 0.32,
    metalness: 0.2,
  });
  const cyanGlow = new THREE.MeshStandardMaterial({
    color: 0x9de8ff,
    emissive: 0x42c4ff,
    emissiveIntensity: 2.2,
    roughness: 0.3,
    metalness: 0.15,
  });

  const tesseractTex = tesseractWallTexture(8, 2);
  const tesseractMat = new THREE.MeshStandardMaterial({
    map: tesseractTex,
    emissiveMap: tesseractTex,
    emissive: 0xffffff,
    emissiveIntensity: 0.62,
    color: 0x9d9388,
    roughness: 0.76,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const tesseractSmall = tesseractWallTexture(3, 1);
  const tesseractEndMat = new THREE.MeshStandardMaterial({
    map: tesseractSmall,
    emissiveMap: tesseractSmall,
    emissive: 0xffffff,
    emissiveIntensity: 0.58,
    color: 0x9d9388,
    roughness: 0.76,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });

  // ---------------------------------------------------------------- shell
  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 118), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.012, -41);
  floor.receiveShadow = true;
  scene.add(floor);

  // A darker, polished central lane helps the eye follow the route.
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 114),
    new THREE.MeshStandardMaterial({
      color: 0x3c3d3c,
      roughness: 0.45,
      metalness: 0.18,
      envMapIntensity: 0.9,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.02, -41);
  lane.receiveShadow = true;
  scene.add(lane);

  // Outer walls and ceiling.
  addBox(scene, colliders, wallMat, -16.25, 9, -41, 0.5, 18, 118, false, true);
  addBox(scene, colliders, wallMat, 16.25, 9, -41, 0.5, 18, 118, false, true);
  addBox(scene, colliders, wallMat, 0, 9, 18.25, 32.5, 18, 0.5, false, true);
  addBox(scene, colliders, wallMat, 0, 9, -100.25, 32.5, 18, 0.5, false, true);
  addBox(scene, colliders, ceilingMat, 0, 18.25, -41, 32.5, 0.5, 118.5, false, false);

  // Outer wall colliders are manual so the visuals can stay thin.
  colliders.push({ min: { x: -16.5, y: 0, z: 18 }, max: { x: -16, y: 18, z: -100 } });
  colliders.push({ min: { x: 16, y: 0, z: 18 }, max: { x: 16.5, y: 18, z: -100 } });
  colliders.push({ min: { x: -16.5, y: 0, z: 18 }, max: { x: 16.5, y: 18, z: 18.5 } });
  colliders.push({ min: { x: -16.5, y: 0, z: -100.5 }, max: { x: 16.5, y: 18, z: -100 } });
  colliders.push({ min: { x: -16.5, y: 18, z: 18 }, max: { x: 16.5, y: 18.5, z: -100 } });

  // Tesseract cladding on the long walls.
  for (const x of [-15.96, 15.96]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(114, 17), tesseractMat);
    panel.position.set(x, 8.7, -41);
    panel.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(panel);
  }
  const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(31.4, 17), tesseractEndMat);
  backPanel.position.set(0, 8.7, 17.96);
  backPanel.rotation.y = Math.PI;
  scene.add(backPanel);
  const frontPanel = new THREE.Mesh(new THREE.PlaneGeometry(31.4, 17), tesseractEndMat);
  frontPanel.position.set(0, 8.7, -99.96);
  scene.add(frontPanel);

  // Vertical ribs give the cladding real depth in the chase camera.
  const ribGeo = new THREE.BoxGeometry(0.22, 17.4, 0.22);
  const ribs = new THREE.InstancedMesh(ribGeo, bronze, 34);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ribIndex = 0;
  for (const x of [-15.55, 15.55]) {
    for (let i = 0; i < 17; i++) {
      m4.compose(new THREE.Vector3(x, 8.6, 16 - i * 7.2), q.identity(), new THREE.Vector3(1, 1, 1));
      ribs.setMatrixAt(ribIndex++, m4);
    }
  }
  ribs.instanceMatrix.needsUpdate = true;
  ribs.castShadow = false;
  scene.add(ribs);

  // Base light lines.
  for (const x of [-15.72, 15.72]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 114), amberGlow);
    strip.position.set(x, 0.23, -41);
    scene.add(strip);
  }

  // Ceiling beams.
  const beamGeo = new THREE.BoxGeometry(1, 1, 1);
  const beams = new THREE.InstancedMesh(beamGeo, darkMetal, 17);
  for (let i = 0; i < 17; i++) {
    m4.compose(new THREE.Vector3(0, 17.75, 16 - i * 7.1), q.identity(), new THREE.Vector3(32, 0.18, 0.24));
    beams.setMatrixAt(i, m4);
  }
  beams.instanceMatrix.needsUpdate = true;
  scene.add(beams);

  // Ceiling light strips: warm on one side, cold on the other.
  const warmStrips = new THREE.InstancedMesh(beamGeo, amberGlow, 8);
  const coldStrips = new THREE.InstancedMesh(beamGeo, cyanGlow, 8);
  for (let i = 0; i < 8; i++) {
    m4.compose(new THREE.Vector3(-7, 17.5, 12 - i * 13.5), q.identity(), new THREE.Vector3(0.26, 0.06, 5.6));
    warmStrips.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(7, 17.5, 5 - i * 13.5), q.identity(), new THREE.Vector3(0.2, 0.06, 5.6));
    coldStrips.setMatrixAt(i, m4);
  }
  warmStrips.instanceMatrix.needsUpdate = true;
  coldStrips.instanceMatrix.needsUpdate = true;
  scene.add(warmStrips, coldStrips);

  // ---------------------------------------------------------------- portals
  const portals: PortalVisual[] = [];
  const portalMats: THREE.MeshStandardMaterial[] = [];

  function wallWithOpening(z: number, hole: Hole, number: number): void {
    const info = holeInfo(hole);
    const outer = new THREE.Shape();
    outer.moveTo(-16, 0);
    outer.lineTo(16, 0);
    outer.lineTo(16, 18);
    outer.lineTo(-16, 18);
    outer.closePath();
    outer.holes.push(holePath(info));

    const thickness = 0.55;
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: thickness,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 16,
    });
    geo.translate(0, 0, -thickness / 2);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.z = z;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);

    const z0 = z - thickness / 2;
    const z1 = z + thickness / 2;
    const addSeg = (x0: number, x1: number, y0: number, y1: number) => {
      if (x1 - x0 < 0.03 || y1 - y0 < 0.03) return;
      colliders.push({
        min: { x: x0, y: y0, z: z0 },
        max: { x: x1, y: y1, z: z1 },
      });
    };
    addSeg(-16, info.minX, 0, 18);
    addSeg(info.maxX, 16, 0, 18);
    addSeg(info.minX, info.maxX, 0, Math.max(0, info.minY));
    addSeg(info.minX, info.maxX, Math.min(18, info.maxY), 18);

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xffb15c,
      emissive: 0xff8738,
      emissiveIntensity: 2.6,
      roughness: 0.35,
      metalness: 0.35,
    });
    portalMats.push(frameMat);

    const frameZ = z + 0.36;
    const curve = frameCurve(info.points, frameZ);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(32, info.points.length * 3), 0.065, 6, false), frameMat);
    tube.castShadow = false;
    scene.add(tube);

    const cx = (info.minX + info.maxX) / 2;
    const labelY = Math.min(16.4, info.maxY + 0.9);
    const labelMat = new THREE.MeshBasicMaterial({
      map: trainingNumberTexture(number, '#ffb15c'),
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.62), labelMat);
    label.position.set(cx, labelY, frameZ + 0.02);
    scene.add(label);

    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.33, 0), frameMat);
    beacon.position.set(cx, labelY + 0.85, frameZ + 0.02);
    scene.add(beacon);

    portals.push({
      center: new THREE.Vector3(cx, (info.minY + info.maxY) / 2, z),
      normal: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      halfW: (info.maxX - info.minX) / 2,
      halfH: (info.maxY - info.minY) / 2,
      round: hole.kind === 'circle' || hole.kind === 'hex',
      frameMat,
      labelMat,
      beacon,
      beaconBaseY: labelY + 0.85,
    });
  }

  wallWithOpening(2, { kind: 'arch', cx: 0, cy: 2.8, w: 7.0, h: 5.4 }, 1);
  wallWithOpening(-22, { kind: 'circle', cx: 0, cy: 8.0, r: 3.1 }, 2);
  wallWithOpening(-44, { kind: 'rect', cx: 9.0, cy: 2.6, w: 5.0, h: 5.0 }, 3);
  wallWithOpening(-54, { kind: 'slot', cx: -8.0, cy: 3.5, w: 3.0, h: 7.0 }, 4);
  wallWithOpening(-62, { kind: 'hex', cx: 8.0, cy: 3.2, r: 3.0 }, 5);
  wallWithOpening(-86, { kind: 'circle', cx: 0, cy: 8.0, r: 3.4 }, 6);

  // ---------------------------------------------------------------- ramps
  const ramp1: Ramp = {
    minX: -5,
    maxX: 5,
    minZ: -14,
    maxZ: 2,
    axis: 'z',
    yAtMin: 5,
    yAtMax: 0,
  };
  const ramp2: Ramp = {
    minX: 5.8,
    maxX: 14,
    minZ: -44,
    maxZ: -26,
    axis: 'z',
    yAtMin: 0,
    yAtMax: 5,
  };
  const ramp3: Ramp = {
    minX: -6,
    maxX: 6,
    minZ: -86,
    maxZ: -68,
    axis: 'z',
    yAtMin: 6,
    yAtMax: 0,
  };
  for (const r of [ramp1, ramp2, ramp3]) {
    ramps.push(r);
    scene.add(wedgeMesh(r, rampMat));
    scene.add(rampEdge(r, r.minX + 0.12, amberGlow));
    scene.add(rampEdge(r, r.maxX - 0.12, cyanGlow));
  }

  // ---------------------------------------------------------------- mezzanine
  // Main deck, split around the down-ramp.
  platforms.push({ minX: -16, maxX: 5.8, minZ: -44, maxZ: -14, top: 5 });
  const deckA = new THREE.Mesh(new THREE.BoxGeometry(21.8, 0.3, 30), rampMat);
  deckA.position.set(-5.1, 4.85, -29);
  deckA.castShadow = true;
  deckA.receiveShadow = true;
  scene.add(deckA);
  colliders.push({ min: { x: -16, y: 4.55, z: -44 }, max: { x: 5.8, y: 4.88, z: -14 } });

  platforms.push({ minX: 5.8, maxX: 16, minZ: -26, maxZ: -14, top: 5 });
  const deckB = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.3, 12), rampMat);
  deckB.position.set(10.9, 4.85, -20);
  deckB.castShadow = true;
  deckB.receiveShadow = true;
  scene.add(deckB);
  colliders.push({ min: { x: 5.8, y: 4.55, z: -26 }, max: { x: 16, y: 4.88, z: -14 } });

  // Support columns under the deck.
  for (const [x, z] of [
    [-13, -18],
    [-5, -28],
    [3, -39],
    [2, -19],
  ] as const) {
    addBox(scene, colliders, darkMetal, x, 2.3, z, 0.38, 4.6, 0.38, true, true);
  }

  // Low edge rails make the deck readable without blocking the route.
  for (const x of [-15.7, 5.55]) {
    addBox(scene, colliders, bronze, x, 5.45, -29, 0.08, 0.7, 30, true, false);
  }

  // End deck, six metres up.
  platforms.push({ minX: -16, maxX: 16, minZ: -98, maxZ: -86, top: 6 });
  const endDeck = new THREE.Mesh(new THREE.BoxGeometry(32, 0.3, 12), rampMat);
  endDeck.position.set(0, 5.85, -92);
  endDeck.castShadow = true;
  endDeck.receiveShadow = true;
  scene.add(endDeck);
  colliders.push({ min: { x: -16, y: 5.55, z: -98 }, max: { x: 16, y: 5.88, z: -86 } });
  for (const [x, z] of [
    [-13, -88],
    [13, -88],
    [-13, -96],
    [13, -96],
  ] as const) {
    addBox(scene, colliders, darkMetal, x, 2.85, z, 0.4, 5.7, 0.4, true, true);
  }

  // ---------------------------------------------------------------- floating tesseract frames
  const frameBars = new THREE.InstancedMesh(beamGeo, darkMetal, 16);
  const frameGlow = new THREE.InstancedMesh(beamGeo, amberGlow, 16);
  let bar = 0;
  const addFrame = (x: number, y: number, z: number, w: number, h: number) => {
    const tx = x;
    for (const [offY, sw, sh] of [
      [h / 2, w, 0.13],
      [-h / 2, w, 0.13],
      [0, 0.13, h],
    ] as const) {
      m4.compose(
        new THREE.Vector3(tx + (sw === 0.13 ? (offY === 0 ? -w / 2 : w / 2) : 0), y + offY, z),
        q.identity(),
        new THREE.Vector3(sw, sh, 0.13),
      );
      frameBars.setMatrixAt(bar, m4);
      m4.compose(
        new THREE.Vector3(tx + (sw === 0.13 ? (offY === 0 ? -w / 2 + 0.04 : w / 2 - 0.04) : 0), y + offY, z + 0.075),
        q.identity(),
        new THREE.Vector3(sw * 0.92, sh * 0.92, 0.035),
      );
      frameGlow.setMatrixAt(bar, m4);
      bar++;
    }
    // vertical side bars are two separate boxes
    bar--;
    for (const side of [-1, 1]) {
      m4.compose(
        new THREE.Vector3(tx + (side * w) / 2, y, z),
        q.identity(),
        new THREE.Vector3(0.13, h, 0.13),
      );
      frameBars.setMatrixAt(bar, m4);
      m4.compose(
        new THREE.Vector3(tx + (side * w) / 2, y, z + 0.075),
        q.identity(),
        new THREE.Vector3(0.035, h * 0.92, 0.035),
      );
      frameGlow.setMatrixAt(bar, m4);
      bar++;
    }
  };
  addFrame(-11, 13.5, -10, 7, 8);
  addFrame(10, 12.5, -31, 5.5, 7);
  addFrame(-9, 14.2, -50, 6.5, 8.5);
  addFrame(8, 13.2, -72, 5, 6);
  frameBars.instanceMatrix.needsUpdate = true;
  frameGlow.instanceMatrix.needsUpdate = true;
  scene.add(frameBars, frameGlow);

  // ---------------------------------------------------------------- route paint
  const stencilMat = (text: string, accent: string, sub = '') =>
    new THREE.MeshBasicMaterial({
      map: routeStencilTexture(text, accent, sub),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

  const floorSign = (
    x: number,
    z: number,
    text: string,
    accent: string,
    sub: string,
    w = 4.8,
    h = 2.4,
    y = 0.036,
  ) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stencilMat(text, accent, sub));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  const wallSign = (
    x: number,
    y: number,
    z: number,
    text: string,
    accent: string,
    sub: string,
    w = 5.6,
    h = 2.8,
  ) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stencilMat(text, accent, sub));
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  floorSign(0, 13.2, 'START', '#78e6b0', 'ARM · FOLLOW THE LIGHT', 5.0, 2.5);
  wallSign(0, 8.0, 2.38, 'FOLLOW', '#ffb15c', 'THE LIGHT', 6.0, 3.0);
  floorSign(0, 5.2, '01', '#ffb15c', 'ARCH', 2.4, 1.2);
  floorSign(0, -18.5, 'CLIMB', '#ffb15c', 'RING 02', 4.2, 2.1, 5.04);
  floorSign(2.5, -25.5, 'DOWN', '#78e6b0', 'RAMP →', 3.8, 1.9, 5.04);
  wallSign(7.5, 7.9, -43.7, 'DROP', '#78e6b0', 'SQUARE 03', 5.2, 2.6);
  floorSign(-4, -48, 'LEFT', '#ffb15c', 'SLOT 04', 3.6, 1.8);
  floorSign(2, -57, 'RIGHT', '#ffb15c', 'HEX 05', 3.6, 1.8);
  floorSign(0, -65, 'CLIMB', '#ffb15c', 'RAMP 06', 3.8, 1.9);
  floorSign(0, -84.8, '06', '#78e6b0', 'CLIMB OUT', 2.4, 1.2, 6.04);
  floorSign(0, -93.5, 'END', '#ffb15c', 'R TO FLY AGAIN', 4.8, 2.4, 6.04);

  // Instanced floor arrows.
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.18, 0.1);
  arrowShape.lineTo(0.18, 0.1);
  arrowShape.lineTo(0.18, 0.95);
  arrowShape.lineTo(0.48, 0.95);
  arrowShape.lineTo(0, 1.55);
  arrowShape.lineTo(-0.48, 0.95);
  arrowShape.lineTo(-0.18, 0.95);
  arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xffb15c,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const arrows: Array<[number, number, number, number, number]> = [
    [0, 0.04, 8.6, 0, 1.1],
    [0, 0.04, 3.5, 0, 0.9],
    [0, 5.04, -16.5, 0, 1.0],
    [3.1, 5.04, -24.8, -Math.PI / 2, 0.9],
    [-3.8, 0.04, -47.5, -0.35, 0.9],
    [2.5, 0.04, -57.5, -0.55, 0.9],
    [0, 0.04, -65.5, 0, 0.9],
    [0, 6.04, -90.5, 0, 1.0],
  ];
  const arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, arrows.length);
  arrows.forEach(([x, y, z, rot, scale], i) => {
    m4.compose(
      new THREE.Vector3(x, y, z),
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
      new THREE.Vector3(scale, 1, scale),
    );
    arrowMesh.setMatrixAt(i, m4);
  });
  arrowMesh.instanceMatrix.needsUpdate = true;
  scene.add(arrowMesh);

  // Start pad + finish pad.
  const startRing = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.76, 48), cyanGlow);
  startRing.rotation.x = -Math.PI / 2;
  startRing.position.set(0, 0.04, 13.2);
  scene.add(startRing);
  const endRing = new THREE.Mesh(new THREE.RingGeometry(1.8, 1.98, 48), amberGlow);
  endRing.rotation.x = -Math.PI / 2;
  endRing.position.set(0, 6.04, -93.5);
  scene.add(endRing);

  // Big sign on the end wall.
  const endSign = new THREE.Mesh(
    new THREE.PlaneGeometry(9.2, 4.6),
    new THREE.MeshStandardMaterial({
      map: signTexture('END', 'COURSE COMPLETE · R TO FLY AGAIN', '#ffb15c'),
      roughness: 0.78,
      side: THREE.DoubleSide,
    }),
  );
  endSign.position.set(0, 10.8, -99.7);
  scene.add(endSign);

  // ---------------------------------------------------------------- dust
  const dustCount = 280;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 30;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 15;
    dustPos[i * 3 + 2] = 16 - Math.random() * 114;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xffc58b,
      size: 0.032,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);

  // ---------------------------------------------------------------- course + quad
  const training = new TrainingCourse(portals);
  const quad = buildQuad();
  scene.add(quad.group);

  return {
    kind: 'indoor',
    label: 'INDOOR TRAINING',
    scene,
    quad,
    sun,
    colliders,
    ramps,
    platforms,
    dust,
    puddles: [],
    spawn: { x: 0, y: 0.06, z: 14 },
    overview: { pos: [0, 16.5, 18], look: [0, 4, -88] },
    grade: {
      bloomThreshold: 0.72,
      bloom: 0.34,
      exposure: 1.05,
      vignette: 0.86,
      grain: 0.021,
    },
    training,
  };
}
