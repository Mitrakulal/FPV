import * as THREE from 'three';
import type { Assets, TexSet } from './assets';
import { buildQuad } from './quad';
import type { Collider, Platform, Ramp } from './physics';
import { buildPark } from './park';
import { buildGhostWorks } from './industry';
import type { World } from './world';
import {
  bannerTexture,
  chainLinkTexture,
  gateNumberTexture,
  graffitiTexture,
  grassBladeTexture,
  markingsTexture,
  runwayDashTexture,
  signTexture,
  treelineTexture,
} from './textures';

export type { World } from './world';

type MatOpts = {
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envMapIntensity?: number;
  roughnessMap?: boolean;
};

function pbr(set: TexSet, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: opts.roughnessMap === false ? null : set.roughnessMap,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    normalScale: new THREE.Vector2(opts.normalScale ?? 0.8, opts.normalScale ?? 0.8),
    envMapIntensity: opts.envMapIntensity ?? 1,
  });
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shadowed(mesh: THREE.Mesh, cast = true, receive = true): THREE.Mesh {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

export async function buildWorld(renderer: THREE.WebGLRenderer, assets: Assets): Promise<World> {
  const scene = new THREE.Scene();
  const colliders: Collider[] = [];
  const ramps: Ramp[] = [];
  const platforms: Platform[] = [];

  // ---------------------------------------------------------------- lighting
  // Late-afternoon sun coming across the course from the front-left. Keeping it
  // in front of the spawn makes the shadows read instead of hiding behind props.
  const sunDir = new THREE.Vector3(-0.52, 0.4, -0.74).normalize();

  const sun = new THREE.DirectionalLight(0xffe0c2, 3.8);
  const sunTarget = new THREE.Vector3(44, 0, -52);
  sun.position.copy(sunDir).multiplyScalar(132).add(sunTarget);
  sun.target.position.copy(sunTarget);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 300;
  // Wide enough to hold the runway, the warehouse and the park plaza east of
  // the strip in one shadow pass; the centre sits between them.
  sun.shadow.camera.left = -104;
  sun.shadow.camera.right = 104;
  sun.shadow.camera.top = 104;
  sun.shadow.camera.bottom = -104;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.055;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const sky = assets.sky;
  if (sky) {
    scene.background = sky;
    scene.backgroundIntensity = 0.82;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(sky).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.62;
    pmrem.dispose();
  }

  scene.fog = new THREE.FogExp2(0xb9bec2, 0.0024);
  scene.add(new THREE.AmbientLight(0xdce8ff, 0.14));

  // Very soft cool fill from the east. The low sun leaves the skate-park banks
  // facing away from it almost black; this keeps their slopes readable.
  const fill = new THREE.DirectionalLight(0xbfd7f2, 0.45);
  fill.position.set(210, 55, -20);
  fill.target.position.set(60, 0, -52);
  scene.add(fill);
  scene.add(fill.target);

  // ---------------------------------------------------------------- ground
  const grass = await assets.tex('grass_ground', 240, 240);
  const grassMat = pbr(grass, {
    color: 0x6b7d55,
    roughness: 1,
    normalScale: 0.35,
    roughnessMap: false,
    envMapIntensity: 0.55,
  });
  const grassPlane = new THREE.Mesh(new THREE.PlaneGeometry(620, 620), grassMat);
  grassPlane.rotation.x = -Math.PI / 2;
  grassPlane.position.y = -0.03;
  grassPlane.receiveShadow = true;
  scene.add(grassPlane);

  const asphalt = await assets.tex('asphalt_02', 40, 160);
  const asphaltMat = pbr(asphalt, {
    color: 0x9aa0a4,
    roughness: 0.94,
    normalScale: 0.3,
    roughnessMap: false,
    envMapIntensity: 0.5,
  });
  const asphaltPlane = new THREE.Mesh(new THREE.PlaneGeometry(100, 400), asphaltMat);
  asphaltPlane.rotation.x = -Math.PI / 2;
  asphaltPlane.position.z = -140;
  asphaltPlane.receiveShadow = true;
  scene.add(asphaltPlane);

  // runway edge lines + centreline, so the strip reads as an old airfield
  const paintMat = new THREE.MeshStandardMaterial({
    color: 0xdedbd0,
    roughness: 0.9,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  for (const lx of [-47, 47]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 396), paintMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(lx, 0.01, -140);
    scene.add(edge);
  }

  const dashTex = runwayDashTexture();
  dashTex.wrapT = THREE.RepeatWrapping;
  dashTex.repeat.set(1, 40);
  const centre = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 380),
    new THREE.MeshStandardMaterial({
      map: dashTex,
      transparent: true,
      opacity: 0.42,
      roughness: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  centre.rotation.x = -Math.PI / 2;
  centre.position.set(0, 0.011, -140);
  scene.add(centre);

  // painted lines / skid marks laid over the asphalt
  const markings = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshStandardMaterial({
      map: markingsTexture(),
      transparent: true,
      opacity: 0.34,
      roughness: 0.85,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  markings.rotation.x = -Math.PI / 2;
  markings.position.set(0, 0.012, -34);
  markings.receiveShadow = true;
  scene.add(markings);

  // puddles
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x101820,
    roughness: 0.07,
    metalness: 0.55,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.95,
  });
  const puddles: THREE.Mesh[] = [];
  const pr = rng(91);
  for (const [x, z, sx, sz] of [
    [-7.5, -16, 1.7, 1.1],
    [9, -31, 2.2, 1.3],
    [-13, -44, 1.3, 0.9],
    [15, -8, 1.9, 1.2],
    [-2, -56, 1.4, 1.6],
  ] as const) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 26), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = pr() * Math.PI;
    p.scale.set(sx, sz, 1);
    p.position.set(x, 0.014, z);
    scene.add(p);
    puddles.push(p);
  }

  // ---------------------------------------------------------------- warehouse
  const concrete = await assets.tex('concrete_wall_008', 5, 2);
  const concreteFloor = await assets.tex('concrete_floor_worn_001', 8, 6);
  const wallMat = pbr(concrete, { color: 0xc9c3b6, roughness: 0.95, normalScale: 1.2 });
  const floorMat = pbr(concreteFloor, { color: 0xbdb9b1, roughness: 0.9, normalScale: 0.9 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(27, 27), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-28, 0.015, -21);
  floor.receiveShadow = true;
  scene.add(floor);

  const walls: Array<[number, number, number, number, number, number]> = [
    [0.5, 7.4, 28, -41.75, 3.7, -21],
    [27, 7.4, 0.5, -28, 3.7, -35],
    [0.5, 7.4, 8, -14.25, 3.7, -31],
    [8, 7.4, 0.5, -18.25, 3.7, -34.75],
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    shadowed(m);
    scene.add(m);
    colliders.push({
      min: { x: x - w / 2, y: 0, z: z - d / 2 },
      max: { x: x + w / 2, y: h, z: z + d / 2 },
    });
  }

  // window bays: dark recesses + boards
  const recessMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c0e,
    roughness: 0.95,
    metalness: 0,
  });
  const boardMat = new THREE.MeshStandardMaterial({
    color: 0x6a5a44,
    roughness: 0.95,
    metalness: 0,
  });
  const wr = rng(7);
  for (let i = 0; i < 4; i++) {
    const z = -31 + i * 6.4;
    const recess = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), recessMat);
    recess.rotation.y = Math.PI / 2;
    recess.position.set(-41.48, 4.3, z);
    scene.add(recess);

    for (let b = 0; b < 2 + Math.floor(wr() * 2); b++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 2.6), boardMat);
      board.rotation.x = (wr() - 0.5) * 0.35;
      board.position.set(-41.4, 3.5 + b * 0.6 + wr() * 0.2, z);
      shadowed(board, false, true);
      scene.add(board);
    }
  }

  // roof: two corrugated slabs, one partly collapsed
  const corrugated = await assets.tex('corrugated_iron_02', 6, 3);
  const roofMat = new THREE.MeshStandardMaterial({
    map: corrugated.map,
    color: 0x767068,
    roughness: 0.93,
    metalness: 0.05,
  });
  const roofA = new THREE.Mesh(new THREE.BoxGeometry(14, 0.12, 28), roofMat);
  roofA.position.set(-35, 7.5, -21);
  roofA.rotation.z = 0.03;
  shadowed(roofA);
  scene.add(roofA);

  // the other half of the roof is gone — collapsed panels lie in the yard
  for (const [px, pz, prot, py] of [
    [-16.5, -7.6, 0.5, 0.06],
    [-13.2, -10.4, -0.32, 0.05],
  ] as const) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.1, 2.8), roofMat);
    panel.position.set(px, py, pz);
    panel.rotation.y = prot;
    panel.rotation.z = 0.04;
    shadowed(panel);
    scene.add(panel);
  }

  // steel columns holding what is left of the roof
  const steel = new THREE.MeshStandardMaterial({
    color: 0x5d6066,
    roughness: 0.55,
    metalness: 0.85,
  });
  for (let i = 0; i < 5; i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 7.2, 10), steel);
    col.position.set(-16.5, 3.6, -32 + i * 5.6);
    shadowed(col);
    scene.add(col);
  }

  // graffiti on the inside walls
  const graffMat = (i: number) =>
    new THREE.MeshStandardMaterial({
      map: graffitiTexture(i),
      transparent: true,
      roughness: 0.9,
      metalness: 0,
      depthWrite: false,
    });
  const g1 = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.3), graffMat(0));
  g1.rotation.y = Math.PI / 2;
  g1.position.set(-41.45, 2.4, -14);
  scene.add(g1);
  const g2 = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), graffMat(1));
  g2.position.set(-33, 2.6, -34.7);
  scene.add(g2);
  const g3 = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), graffMat(2));
  g3.rotation.y = Math.PI / 2;
  g3.position.set(-41.45, 2.2, -26);
  scene.add(g3);

  // rubble
  const rubbleMat = new THREE.MeshStandardMaterial({
    color: 0x8d887e,
    roughness: 1,
    metalness: 0,
  });
  const rr = rng(33);
  for (let i = 0; i < 26; i++) {
    const size = 0.15 + rr() * 0.55;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rubbleMat);
    rock.position.set(-40 + rr() * 24, size * 0.6, -33 + rr() * 24);
    rock.rotation.set(rr() * 3, rr() * 3, rr() * 3);
    shadowed(rock, true, true);
    scene.add(rock);
  }

  // ---------------------------------------------------------------- containers
  const rusty = await assets.tex('rusty_metal_02', 3, 1.2);
  const containerColors = [0x2e5c78, 0x8a3d2c, 0x3f6b4a, 0x7a6a52, 0x646c74];

  const makeContainer = (
    x: number,
    y: number,
    z: number,
    rotY: number,
    colorIndex: number,
  ) => {
    const mat = pbr(rusty, {
      color: containerColors[colorIndex % containerColors.length] ?? 0xffffff,
      roughness: 0.78,
      metalness: 0.45,
      normalScale: 1.4,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(6.06, 2.59, 2.44), mat);
    box.position.set(x, y + 1.295, z);
    box.rotation.y = rotY;
    shadowed(box);
    scene.add(box);

    // door end + locking bars
    const doorMat = pbr(rusty, {
      color: 0x555b60,
      roughness: 0.7,
      metalness: 0.55,
      normalScale: 1.2,
    });
    const local = new THREE.Matrix4().makeRotationY(rotY);
    for (const off of [-0.6, 0.6]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8), doorMat);
      const p = new THREE.Vector3(3.05, 1.3, off).applyMatrix4(local);
      bar.position.set(x + p.x, y + p.y, z + p.z);
      bar.rotation.z = 0.02;
      shadowed(bar, false, false);
      scene.add(bar);
    }

    const c = Math.abs(Math.cos(rotY));
    const s = Math.abs(Math.sin(rotY));
    const hx = c * 3.03 + s * 1.22;
    const hz = s * 3.03 + c * 1.22;
    colliders.push({
      min: { x: x - hx, y, z: z - hz },
      max: { x: x + hx, y: y + 2.59, z: z + hz },
    });
  };

  makeContainer(17, 0, -17, 0.28, 0);
  makeContainer(22.5, 0, -27, 1.15, 1);
  makeContainer(17.5, 0, -39, -0.18, 2);
  makeContainer(18.1, 2.59, -39.6, -0.05, 3);
  makeContainer(-1, 0, -54, 1.54, 4);

  // barrels, tyres, pallets
  const barrelMat = pbr(rusty, { color: 0x9a4a2e, roughness: 0.8, metalness: 0.5 });
  const barrelBlue = pbr(rusty, { color: 0x2f4f7a, roughness: 0.75, metalness: 0.4 });
  const br = rng(17);
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.29, 0.92, 16),
      i % 3 === 0 ? barrelBlue : barrelMat,
    );
    b.position.set(-12 + br() * 6, 0.46, -14 + br() * 8);
    b.rotation.y = br() * 3;
    shadowed(b);
    scene.add(b);
  }

  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x14161a,
    roughness: 0.95,
    metalness: 0,
  });
  for (const [tx, tz, count] of [
    [24, -8, 3],
    [-16, -46, 4],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 8, 18), tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(tx + (i % 2) * 0.06, 0.14 + i * 0.28, tz + (i % 2) * 0.05);
      shadowed(tyre);
      scene.add(tyre);
    }
  }

  // ---------------------------------------------------------------- gates
  const gateColors = [0xff6a18, 0xffc21a, 0xff3b30, 0x1fb8ff, 0xff6a18];
  const gateCurve = (w: number, h: number, r: number): THREE.CatmullRomCurve3 => {
    const pts: THREE.Vector3[] = [];
    const hw = w / 2;
    const hh = h / 2;
    const corners: Array<[number, number, number]> = [
      [hw - r, hh - r, 0],
      [-hw + r, hh - r, Math.PI / 2],
      [-hw + r, -hh + r, Math.PI],
      [hw - r, -hh + r, -Math.PI / 2],
    ];
    for (const [cx, cy, start] of corners) {
      for (let i = 0; i <= 4; i++) {
        const a = start + (i / 4) * (Math.PI / 2);
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0));
      }
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  };

  const gatePositions: Array<[number, number, number, number]> = [
    [0, 2.6, -11, 0],
    [12, 2.7, -24, -0.5],
    [-12, 2.9, -36, 0.55],
    [10, 3.2, -49, -0.35],
    [0, 4.3, -62, 0],
  ];

  gatePositions.forEach(([x, y, z, rot], i) => {
    const size = 2.35 + (i === 4 ? 0.35 : 0);
    const color = gateColors[i % gateColors.length] ?? 0xff6a18;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.02,
      emissive: color,
      emissiveIntensity: 0.12,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(gateCurve(size, size, 0.38), 96, 0.075, 10, true), mat);
    tube.position.set(x, y, z);
    tube.rotation.y = rot;
    shadowed(tube);
    scene.add(tube);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.45),
      new THREE.MeshStandardMaterial({
        map: gateNumberTexture(i + 1, `#${color.toString(16).padStart(6, '0')}`),
        roughness: 0.8,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    label.position.set(x, y + size / 2 + 0.45, z);
    label.rotation.y = rot;
    scene.add(label);
  });

  // ---------------------------------------------------------------- fence
  const chain = chainLinkTexture();
  chain.repeat.set(52, 1.6);
  const fenceMat = new THREE.MeshStandardMaterial({
    map: chain,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    color: 0xb9c4cc,
    roughness: 0.6,
    metalness: 0.5,
  });

  const postMat = new THREE.MeshStandardMaterial({
    color: 0x7d858e,
    roughness: 0.5,
    metalness: 0.7,
  });

  for (const fx of [-54, 54]) {
    const spans: Array<[number, number]> =
      fx === 54
        ? [
            [12, -10],
            [-26, -144],
          ]
        : [[12, -144]];

    for (const [zA, zB] of spans) {
      const length = Math.abs(zB - zA);
      const mat = fenceMat.clone();
      mat.map = chain.clone();
      mat.map.repeat.set(length / 3, 1.6);
      mat.map.needsUpdate = true;
      const fence = new THREE.Mesh(new THREE.PlaneGeometry(length, 3.4), mat);
      fence.rotation.y = Math.PI / 2;
      fence.position.set(fx, 1.7, (zA + zB) / 2);
      scene.add(fence);
    }

    for (let i = 0; i <= 26; i++) {
      const z = 12 - i * 6;
      // Service entrance to the park: leave the fence line open here.
      if (fx === 54 && z < -9 && z > -27) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8), postMat);
      post.position.set(fx, 1.75, z);
      shadowed(post, true, false);
      scene.add(post);
    }
  }

  // ---------------------------------------------------------------- poles + wires
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x4b4a46,
    roughness: 0.9,
    metalness: 0.1,
  });
  const polePositions: Array<[number, number]> = [
    [46, -4],
    [46, -34],
    [46, -64],
  ];
  for (const [px, pz] of polePositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9.5, 8), poleMat);
    pole.position.set(px, 4.75, pz);
    shadowed(pole);
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), poleMat);
    arm.position.set(px, 8.4, pz);
    shadowed(arm, true, false);
    scene.add(arm);
  }

  const wireMat = new THREE.MeshStandardMaterial({
    color: 0x232629,
    roughness: 0.8,
    metalness: 0.3,
  });
  for (let i = 0; i < polePositions.length - 1; i++) {
    const a = polePositions[i];
    const b = polePositions[i + 1];
    if (!a || !b) continue;
    for (const off of [-0.9, 0, 0.9]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(a[0] + off, 8.35, a[1]),
        new THREE.Vector3((a[0] + b[0]) / 2 + off, 7.1, (a[1] + b[1]) / 2),
        new THREE.Vector3(b[0] + off, 8.35, b[1]),
      ]);
      const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.022, 5, false), wireMat);
      scene.add(wire);
    }
  }

  // ---------------------------------------------------------------- trees
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.4, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x36482e, roughness: 1, flatShading: true });

  const treeCount = 64;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount * 3);
  const tr = rng(5);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const leafColor = new THREE.Color();

  const clusters = [
    { x: -105, z: -40, r: 48 },
    // Keep the east tree line beyond the skate park so the new plaza is open.
    { x: 195, z: -34, r: 38 },
    { x: -15, z: -215, r: 52 },
    { x: 78, z: 44, r: 36 },
    { x: -112, z: 34, r: 42 },
  ];

  for (let i = 0; i < treeCount; i++) {
    const cluster = clusters[i % clusters.length] ?? clusters[0]!;
    const a = tr() * Math.PI * 2;
    const rad = Math.sqrt(tr()) * cluster.r;
    const x = cluster.x + Math.cos(a) * rad;
    const z = cluster.z + Math.sin(a) * rad;
    const scale = 0.85 + tr() * 0.9;

    m4.compose(new THREE.Vector3(x, 1.7 * scale, z), q.identity(), new THREE.Vector3(scale, scale, scale));
    trunks.setMatrixAt(i, m4);

    for (let k = 0; k < 3; k++) {
      const lx = x + (tr() - 0.5) * 2.4;
      const lz = z + (tr() - 0.5) * 2.4;
      v3.set(lx, (3.0 + k * 0.9 + tr() * 0.7) * scale, lz);
      m4.compose(
        v3,
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr() * Math.PI),
        new THREE.Vector3(1.7 + tr() * 1.1, 1.1 + tr() * 0.7, 1.7 + tr() * 1.1).multiplyScalar(scale),
      );
      const idx = i * 3 + k;
      leaves.setMatrixAt(idx, m4);
      leafColor.setHSL(0.26 + tr() * 0.045, 0.22 + tr() * 0.12, 0.2 + tr() * 0.08);
      leaves.setColorAt(idx, leafColor);
    }
  }
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  scene.add(trunks, leaves);

  // distant treeline so the horizon is not just a bright band
  const treelineTex = treelineTexture();
  treelineTex.wrapS = THREE.RepeatWrapping;
  treelineTex.repeat.set(6, 1);
  const treelineMat = new THREE.MeshBasicMaterial({
    map: treelineTex,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.BackSide,
    color: 0x5d6b5e,
    fog: true,
    depthWrite: false,
  });
  const treeline = new THREE.Mesh(new THREE.CylinderGeometry(285, 285, 30, 96, 1, true), treelineMat);
  treeline.position.set(0, 12, -20);
  scene.add(treeline);

  // ---------------------------------------------------------------- grass tufts
  const blade = grassBladeTexture();
  const tuftMat = new THREE.MeshStandardMaterial({
    map: blade,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    color: 0x9fb07e,
  });
  const tuftGeo = new THREE.PlaneGeometry(0.75, 0.55);
  const tuftCount = 420;
  const tuftsA = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
  const tuftsB = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
  const gr = rng(23);

  for (let i = 0; i < tuftCount; i++) {
    let x = (gr() - 0.5) * 150;
    let z = -gr() * 140 + 16;
    // grass only grows off the runway
    if (Math.abs(x) < 55) x = Math.sign(x || 1) * (55 + gr() * 20);
    // keep the park service path clear
    if (x > 46 && x < 78 && z > -31 && z < -5) x = -48 - gr() * 12;
    const s = 0.6 + gr() * 0.9;
    const rot = gr() * Math.PI;

    m4.compose(
      new THREE.Vector3(x, 0.26 * s, z),
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
      new THREE.Vector3(s, s, s),
    );
    tuftsA.setMatrixAt(i, m4);

    m4.compose(
      new THREE.Vector3(x, 0.26 * s, z),
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + Math.PI / 2),
      new THREE.Vector3(s, s, s),
    );
    tuftsB.setMatrixAt(i, m4);
  }
  tuftsA.instanceMatrix.needsUpdate = true;
  tuftsB.instanceMatrix.needsUpdate = true;
  scene.add(tuftsA, tuftsB);

  // ---------------------------------------------------------------- dust
  const dustCount = 240;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 90;
    dustPos[i * 3 + 1] = Math.random() * 5 + 0.2;
    dustPos[i * 3 + 2] = -Math.random() * 85 + 12;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xd9cdbd,
      size: 0.03,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);

  // ---------------------------------------------------------------- course dressing
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x4b5058,
    roughness: 0.5,
    metalness: 0.8,
  });
  const canvasMat = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });

  // start gantry
  const gantryZ = -4.2;
  for (const gx of [-6.4, 6.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 5.5, 0.34), metalMat);
    post.position.set(gx, 2.75, gantryZ);
    shadowed(post);
    scene.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.9), metalMat);
    foot.position.set(gx, 0.08, gantryZ);
    shadowed(foot, true, true);
    scene.add(foot);
    colliders.push({
      min: { x: gx - 0.2, y: 0, z: gantryZ - 0.2 },
      max: { x: gx + 0.2, y: 5.5, z: gantryZ + 0.2 },
    });
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.5, 0.5), metalMat);
  beam.position.set(0, 5.6, gantryZ);
  shadowed(beam);
  scene.add(beam);

  const startBanner = new THREE.Mesh(
    new THREE.PlaneGeometry(11.6, 1.15),
    canvasMat(bannerTexture('FPV RIG  ·  FREE FLIGHT', '#ff6a18')),
  );
  startBanner.position.set(0, 4.9, gantryZ + 0.01);
  scene.add(startBanner);

  // trackside banner stands
  const stands: Array<[number, number, number, string, string]> = [
    [15, -20, -0.9, 'FREE', '#ff6a18'],
    [-16, -33, 0.8, 'ACRO', '#1fb8ff'],
    [16, -47, -0.7, 'FPV', '#ffc21a'],
    [-14, -57, 0.9, 'PARK', '#35e08a'],
  ];
  for (const [sx, sz, rot, text, accent] of stands) {
    const stand = new THREE.Group();
    for (const off of [-1.5, 1.5]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8), metalMat);
      p.position.set(off, 1.4, 0);
      shadowed(p, true, false);
      stand.add(p);
    }
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(3.1, 0.85),
      canvasMat(bannerTexture(text, accent)),
    );
    cloth.position.set(0, 2.3, 0.03);
    stand.add(cloth);
    stand.position.set(sx, 0, sz);
    stand.rotation.y = rot;
    scene.add(stand);
  }

  // big billboard by the back straight
  const billboard = new THREE.Group();
  const boardBack = new THREE.Mesh(new THREE.BoxGeometry(7.4, 4.0, 0.24), metalMat);
  boardBack.position.y = 3.2;
  shadowed(boardBack);
  billboard.add(boardBack);
  const boardFace = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 3.6),
    canvasMat(signTexture('FPV RIG', 'LOCAL SESSION · GATE 4', '#ff6a18')),
  );
  boardFace.position.set(0, 3.2, 0.13);
  billboard.add(boardFace);
  for (const off of [-2.2, 2.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.6, 0.28), metalMat);
    leg.position.set(off, 0.8, 0);
    shadowed(leg);
    billboard.add(leg);
  }
  billboard.position.set(19, 0, -44);
  billboard.rotation.y = -0.55;
  scene.add(billboard);
  colliders.push({
    min: { x: 15.6, y: 0, z: -45.6 },
    max: { x: 22.4, y: 1.6, z: -42.4 },
  });

  // wrecked cars out by the bando
  const makeWreck = (x: number, z: number, rot: number, tint: number) => {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.72,
      metalness: 0.35,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b1114,
      roughness: 0.18,
      metalness: 0.6,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.95 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.82, 1.86), paint);
    body.position.y = 0.72;
    shadowed(body);
    car.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.66, 1.7), paint);
    cabin.position.set(-0.2, 1.4, 0);
    shadowed(cabin);
    car.add(cabin);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 1.55), glass);
    windshield.position.set(0.9, 1.42, 0);
    windshield.rotation.z = -0.28;
    car.add(windshield);

    for (const wx of [-1.35, 1.35]) {
      for (const wz of [-0.92, 0.92]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), rubber);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.34, wz);
        shadowed(wheel, true, false);
        car.add(wheel);
      }
    }

    car.position.set(x, 0, z);
    car.rotation.y = rot;
    scene.add(car);

    const hx = Math.abs(Math.cos(rot)) * 2.2 + Math.abs(Math.sin(rot)) * 1.0;
    const hz = Math.abs(Math.sin(rot)) * 2.2 + Math.abs(Math.cos(rot)) * 1.0;
    colliders.push({
      min: { x: x - hx, y: 0, z: z - hz },
      max: { x: x + hx, y: 1.8, z: z + hz },
    });
  };
  makeWreck(-23, -8.5, 0.4, 0x6c4a3f);
  makeWreck(27, -52, -0.9, 0x4a5560);

  // cones
  const coneGeo = new THREE.ConeGeometry(0.24, 0.62, 12);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a12, roughness: 0.65 });
  const conePositions: Array<[number, number]> = [
    [-8, -6],
    [8, -6],
    [-13, -14],
    [13, -14],
    [-14, -27],
    [-6, -31],
    [15, -33],
    [-11, -43],
    [2, -44],
    [11, -55],
    [-8, -60],
  ];
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, conePositions.length);
  conePositions.forEach(([cx, cz], i) => {
    m4.compose(
      new THREE.Vector3(cx, 0.31, cz),
      q.identity(),
      new THREE.Vector3(1, 1, 1),
    );
    cones.setMatrixAt(i, m4);
  });
  cones.instanceMatrix.needsUpdate = true;
  cones.castShadow = true;
  scene.add(cones);

  // jersey barriers
  const barrierMat = pbr(concrete, { color: 0xc4beb2, roughness: 0.95, normalScale: 1 });
  for (const [bx, bz, brot] of [
    [-12, -20, 0.15],
    [-11.6, -23, 0.15],
    [14, -40, -0.5],
  ] as const) {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.95, 0.62), barrierMat);
    barrier.position.set(bx, 0.48, bz);
    barrier.rotation.y = brot;
    shadowed(barrier);
    scene.add(barrier);
    colliders.push({
      min: { x: bx - 1.6, y: 0, z: bz - 0.5 },
      max: { x: bx + 1.6, y: 0.95, z: bz + 0.5 },
    });
  }

  // windsock at the runway edge
  const sockOrange = new THREE.MeshStandardMaterial({
    color: 0xff5a12,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const sockWhite = new THREE.MeshStandardMaterial({
    color: 0xefe9dc,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.4, 10), metalMat);
  sockPole.position.set(49, 2.7, -10);
  shadowed(sockPole);
  scene.add(sockPole);

  const sock = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34 - i * 0.055, 0.39 - i * 0.055, 0.48, 12, 1, true),
      i % 2 === 0 ? sockOrange : sockWhite,
    );
    seg.rotation.z = Math.PI / 2;
    seg.position.x = 0.3 + i * 0.48;
    sock.add(seg);
  }
  sock.position.set(49, 5.25, -10);
  sock.rotation.y = -0.7;
  sock.rotation.z = 0.06;
  scene.add(sock);

  // event support van
  const van = new THREE.Group();
  const vanBody = new THREE.MeshStandardMaterial({ color: 0xd7d4ca, roughness: 0.55, metalness: 0.25 });
  const vanGlass = new THREE.MeshStandardMaterial({ color: 0x0b1216, roughness: 0.15, metalness: 0.7 });
  const vanRubber = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.95 });

  const vanShell = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.7, 2.05), vanBody);
  vanShell.position.y = 1.05;
  shadowed(vanShell);
  van.add(vanShell);
  const vanCab = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.62, 1.95), vanBody);
  vanCab.position.set(2.15, 0.7, 0);
  shadowed(vanCab);
  van.add(vanCab);
  const vanWind = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 1.82), vanGlass);
  vanWind.position.set(1.62, 1.42, 0);
  vanWind.rotation.z = -0.32;
  van.add(vanWind);
  for (const wx of [-1.55, 1.9]) {
    for (const wz of [-1.0, 1.0]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), vanRubber);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.34, wz);
      shadowed(wheel, true, false);
      van.add(wheel);
    }
  }
  van.position.set(-24, 0, -1.5);
  van.rotation.y = 0.22;
  scene.add(van);
  colliders.push({
    min: { x: -27.2, y: 0, z: -3.2 },
    max: { x: -20.8, y: 2.1, z: 0.2 },
  });

  // ---------------------------------------------------------------- ghost works
  const works = await buildGhostWorks(scene, assets, colliders);
  platforms.push(...works.platforms);

  // ---------------------------------------------------------------- park
  const park = await buildPark(scene, assets, colliders);
  ramps.push(...park.ramps);
  platforms.push(...park.platforms);

  // ---------------------------------------------------------------- the quad
  const quad = buildQuad();
  scene.add(quad.group);

  return {
    kind: 'airfield',
    label: 'AIRFIELD + PARK',
    scene,
    quad,
    sun,
    colliders,
    ramps,
    platforms,
    dust,
    puddles,
    spawn: { x: 0, y: 0.06, z: 0 },
    overview: { pos: [0, 36, 30], look: [0, 0, -28] },
    grade: {
      bloomThreshold: 1.5,
      bloom: 0.12,
      exposure: 1.0,
      vignette: 0.75,
      grain: 0.018,
    },
  };
}
