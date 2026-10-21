import * as THREE from 'three';
import type { Assets, TexSet } from './assets';
import type { Collider, Platform, Ramp } from './physics';
import { rampEdge, wedgeMesh } from './surfaces';
import { graffitiTexture, routeStencilTexture, signTexture } from './textures';

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
    roughness: opts.roughness ?? 0.95,
    metalness: opts.metalness ?? 0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 0.8, opts.normalScale ?? 0.8),
    envMapIntensity: opts.envMapIntensity ?? 0.6,
  });
}

function shadowed(mesh: THREE.Mesh, cast = true, receive = true): THREE.Mesh {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function boxCollider(
  colliders: Collider[],
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  y = 0,
): void {
  colliders.push({
    min: { x: x - w / 2, y, z: z - d / 2 },
    max: { x: x + w / 2, y: y + h, z: z + d / 2 },
  });
}

export interface ParkBuild {
  ramps: Ramp[];
  platforms: Platform[];
}

/**
 * A compact concrete skate park east of the runway. It exists to give the
 * free-flight map a second, denser place to fly: quarter banks, a funbox,
 * sculpture rings, a graffiti wall and shaded benches. Everything is static
 * and deliberately low-poly.
 */
export async function buildPark(
  scene: THREE.Scene,
  assets: Assets,
  colliders: Collider[],
): Promise<ParkBuild> {
  const ramps: Ramp[] = [];
  const platforms: Platform[] = [];

  const concreteTex = await assets.tex('concrete_floor_worn_001', 12, 10);
  const wallTex = await assets.tex('concrete_wall_008', 6, 2);
  const asphaltTex = await assets.tex('asphalt_02', 4, 2);
  const rustTex = await assets.tex('rusty_metal_02', 2, 1);

  const plazaMat = pbr(concreteTex, {
    color: 0xa9a69d,
    roughness: 0.94,
    normalScale: 1.1,
    envMapIntensity: 0.45,
  });
  const wallMat = pbr(wallTex, {
    color: 0x8f8a7e,
    roughness: 0.96,
    normalScale: 1.1,
  });
  const pathMat = pbr(asphaltTex, {
    color: 0x8f9599,
    roughness: 0.95,
    normalScale: 0.7,
    envMapIntensity: 0.45,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x434b51,
    roughness: 0.55,
    metalness: 0.7,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x1b2025,
    roughness: 0.5,
    metalness: 0.8,
  });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7b5c3e, roughness: 0.9 });
  const amberGlow = new THREE.MeshStandardMaterial({
    color: 0xffb15c,
    emissive: 0xff9a45,
    emissiveIntensity: 2.2,
    roughness: 0.45,
    metalness: 0.15,
  });
  const cyanGlow = new THREE.MeshStandardMaterial({
    color: 0x82dcff,
    emissive: 0x50c8ff,
    emissiveIntensity: 2.4,
    roughness: 0.4,
    metalness: 0.2,
  });

  // ---------------------------------------------------------------- paving
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(80, 78), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(112, 0.026, -49);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(24, 9), pathMat);
  path.rotation.x = -Math.PI / 2;
  path.position.set(61, 0.028, -18);
  path.receiveShadow = true;
  scene.add(path);

  // pale painted entrance lines
  const paint = new THREE.MeshBasicMaterial({
    color: 0xd8d2be,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  for (const z of [-21.8, -14.2]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(22, 0.25), paint);
    line.rotation.x = -Math.PI / 2;
    line.position.set(60.5, 0.031, z);
    scene.add(line);
  }

  // ---------------------------------------------------------------- entrance arch
  const entrance = new THREE.Group();
  for (const z of [-13.3, -22.7]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 5.0, 0.32), steelMat);
    post.position.set(0, 2.5, z + 18);
    shadowed(post);
    entrance.add(post);
    boxCollider(colliders, 68.8, z, 0.5, 0.5, 5.0);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 10.0), steelMat);
  beam.position.set(0, 5.05, 0);
  shadowed(beam);
  entrance.add(beam);
  const parkSign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 2.5),
    new THREE.MeshStandardMaterial({
      map: signTexture('FPV RIG PARK', 'OPEN SESSION · FLY FREELY', '#1fb8ff'),
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  parkSign.position.set(-0.18, 3.9, 0);
  parkSign.rotation.y = -Math.PI / 2;
  entrance.add(parkSign);
  entrance.position.set(68.8, 0, -18);
  scene.add(entrance);

  // ---------------------------------------------------------------- ramps
  const rampMat = pbr(concreteTex, {
    color: 0x9d9a90,
    roughness: 0.93,
    normalScale: 0.9,
    envMapIntensity: 0.4,
  });
  const addRamp = (r: Ramp) => {
    ramps.push(r);
    scene.add(wedgeMesh(r, rampMat));
    scene.add(rampEdge(r, r.minX + 0.08, amberGlow));
    scene.add(rampEdge(r, r.maxX - 0.08, amberGlow));
  };

  // two broad banks and a small kicker
  addRamp({ minX: 94, maxX: 106, minZ: -40, maxZ: -28, axis: 'z', yAtMin: 2.1, yAtMax: 0 });
  addRamp({ minX: 108, maxX: 114, minZ: -76, maxZ: -70, axis: 'z', yAtMin: 1.0, yAtMax: 0 });
  addRamp({ minX: 82, maxX: 89, minZ: -66, maxZ: -61, axis: 'z', yAtMin: 0.85, yAtMax: 0 });

  // funbox: up-bank, deck, down-bank
  addRamp({ minX: 120, maxX: 134, minZ: -58, maxZ: -46, axis: 'z', yAtMin: 2.6, yAtMax: 0 });
  addRamp({ minX: 120, maxX: 134, minZ: -82, maxZ: -70, axis: 'z', yAtMin: 0, yAtMax: 2.6 });
  const deckTop = 2.6;
  platforms.push({ minX: 120, maxX: 134, minZ: -70, maxZ: -58, top: deckTop });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 12), rampMat);
  deck.position.set(127, deckTop - 0.15, -64);
  shadowed(deck);
  scene.add(deck);
  // The collider stops just below the deck top so the landing surface wins.
  colliders.push({
    min: { x: 120, y: 2.2, z: -70 },
    max: { x: 134, y: deckTop - 0.12, z: -58 },
  });
  // funbox coping
  for (const x of [120.12, 133.88]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 12), darkSteel);
    rail.position.set(x, deckTop + 0.04, -64);
    scene.add(rail);
  }

  // ---------------------------------------------------------------- skate props
  const ledge = (x: number, z: number, w: number, d: number, h: number, tint = 0x9a978f) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pbr(concreteTex, { color: tint, roughness: 0.94 }));
    m.position.set(x, h / 2, z);
    shadowed(m);
    scene.add(m);
    boxCollider(colliders, x, z, w, d, h);
  };
  ledge(87, -45, 6.5, 1.4, 0.65);
  ledge(102, -63, 4.2, 1.1, 0.5, 0x85827a);
  ledge(142, -54, 1.2, 7.0, 0.55);

  // grind rail on two posts
  const railZ = -52;
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 9, 10), steelMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(97, 0.9, railZ);
  shadowed(rail);
  scene.add(rail);
  for (const x of [92.7, 101.3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.9, 8), steelMat);
    leg.position.set(x, 0.45, railZ);
    shadowed(leg);
    scene.add(leg);
    boxCollider(colliders, x, railZ, 0.16, 0.16, 0.9);
  }

  // benches + planters around the plaza
  const bench = (x: number, z: number, rot: number) => {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.13, 0.58), woodMat);
    seat.position.y = 0.55;
    shadowed(seat);
    g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.09), woodMat);
    back.position.set(0, 0.87, 0.26);
    shadowed(back);
    g.add(back);
    for (const off of [-0.95, 0.95]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.45), darkSteel);
      leg.position.set(off, 0.28, 0);
      shadowed(leg);
      g.add(leg);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(g);
    boxCollider(colliders, x, z, 2.7, 1.0, 1.0);
  };
  bench(80, -30, 0.2);
  bench(80, -68, 0.2);
  bench(145, -32, -0.4);

  const planter = (x: number, z: number) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.75, 0.8, 12), wallMat);
    pot.position.set(x, 0.4, z);
    shadowed(pot);
    scene.add(pot);
    const bush = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.05, 1),
      new THREE.MeshStandardMaterial({ color: 0x3b5134, roughness: 1, flatShading: true }),
    );
    bush.position.set(x, 1.55, z);
    bush.scale.set(1.1, 0.8, 1.1);
    shadowed(bush);
    scene.add(bush);
    boxCollider(colliders, x, z, 1.6, 1.6, 1.1);
  };
  planter(75, -14);
  planter(149, -14);
  planter(75, -84);
  planter(149, -84);

  // ---------------------------------------------------------------- rings
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.13, 8, 48), amberGlow);
  ring1.position.set(112, 6.0, -52);
  ring1.rotation.y = 0;
  scene.add(ring1);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.11, 8, 44), cyanGlow);
  ring2.position.set(112, 6.5, -66);
  scene.add(ring2);

  // thin support struts so the rings read as a sculpture, not floating props
  for (const [x, z, top] of [
    [108.9, -52, 6.0],
    [115.1, -52, 6.0],
    [109.5, -66, 6.5],
    [114.5, -66, 6.5],
  ] as const) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, top, 8), darkSteel);
    strut.position.set(x, top / 2, z);
    scene.add(strut);
    boxCollider(colliders, x, z, 0.16, 0.16, top);
  }

  // ---------------------------------------------------------------- graffiti wall
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.4, 24), wallMat);
  wall.position.set(151.4, 2.2, -54);
  shadowed(wall);
  scene.add(wall);
  colliders.push({
    min: { x: 151.15, y: 0, z: -66 },
    max: { x: 151.65, y: 4.4, z: -42 },
  });

  const graffMat = (i: number) =>
    new THREE.MeshStandardMaterial({
      map: graffitiTexture(i),
      transparent: true,
      roughness: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  for (const [i, z] of [
    [0, -49],
    [1, -59],
  ] as const) {
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.7), graffMat(i));
    tag.rotation.y = -Math.PI / 2;
    tag.position.set(151.12, 2.35, z);
    scene.add(tag);
  }

  const parkBanner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.35),
    new THREE.MeshStandardMaterial({
      map: routeStencilTexture('PARK', '#ffb15c', 'NO TIMER · JUST FLY'),
      transparent: true,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  parkBanner.rotation.y = -Math.PI / 2;
  parkBanner.position.set(151.05, 4.0, -54);
  scene.add(parkBanner);

  // ---------------------------------------------------------------- lamps
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe0b0,
    emissive: 0xffc176,
    emissiveIntensity: 3.0,
    roughness: 0.3,
  });
  for (const [x, z] of [
    [78, -12],
    [78, -86],
    [146, -86],
  ] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.4, 8), darkSteel);
    pole.position.set(x, 3.2, z);
    shadowed(pole);
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.1), darkSteel);
    arm.position.set(x + 0.7, 6.25, z);
    scene.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.28), bulbMat);
    bulb.position.set(x + 1.3, 6.12, z);
    scene.add(bulb);
    boxCollider(colliders, x, z, 0.28, 0.28, 6.4);
  }

  // ---------------------------------------------------------------- trees
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 3.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3b5030, roughness: 1, flatShading: true });
  const treeSpots: Array<[number, number, number]> = [
    [80, -20, 1.0],
    [143, -20, 1.1],
    [80, -78, 0.95],
    [140, -78, 1.15],
    [96, -14, 0.9],
    [130, -86, 0.85],
    [74, -56, 1.05],
  ];
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  const crowns = new THREE.InstancedMesh(leafGeo, leafMat, treeSpots.length * 3);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tr = seeded(44);
  treeSpots.forEach(([x, z, s], i) => {
    m4.compose(new THREE.Vector3(x, 1.6 * s, z), q.identity(), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    for (let k = 0; k < 3; k++) {
      m4.compose(
        new THREE.Vector3(x + (tr() - 0.5) * 2.0, (3.0 + k * 0.75 + tr() * 0.5) * s, z + (tr() - 0.5) * 2.0),
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr() * Math.PI),
        new THREE.Vector3(1.55 + tr() * 0.8, 1.0 + tr() * 0.5, 1.55 + tr() * 0.8).multiplyScalar(s),
      );
      crowns.setMatrixAt(i * 3 + k, m4);
    }
    boxCollider(colliders, x, z, 0.6, 0.6, 3.2 * s);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  crowns.castShadow = true;
  scene.add(trunks, crowns);

  // ---------------------------------------------------------------- path stencil
  const arrow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 2.1),
    new THREE.MeshBasicMaterial({
      map: routeStencilTexture('PARK', '#78e6b0', 'EAST OF THE RUNWAY'),
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  arrow.rotation.x = -Math.PI / 2;
  arrow.rotation.z = -Math.PI / 2;
  arrow.position.set(57, 0.034, -18);
  scene.add(arrow);

  // small scrap pile left over from building the park
  const scrap = new THREE.MeshStandardMaterial({ color: 0x6e6458, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const size = 0.15 + tr() * 0.35;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), scrap);
    rock.position.set(136 + tr() * 8, size * 0.6, -34 + tr() * 5);
    rock.rotation.set(tr() * 3, tr() * 3, tr() * 3);
    shadowed(rock, false, true);
    scene.add(rock);
  }

  return { ramps, platforms };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
