import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Assets, TexSet } from './assets';
import type { Collider, Platform } from './physics';

/**
 * Ghost Works: the abandoned industrial district north of the training gates.
 *
 * Everything here is static scenery meant to be flown through, so the module
 * exists to keep the draw-call cost flat. Geometry is baked into one merged
 * mesh per material instead of hundreds of separate meshes: a shed costs a
 * handful of draws, not forty. Colliders stay analytic boxes, matching the rest
 * of the sim.
 */

type MatOpts = {
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envMapIntensity?: number;
  emissive?: number;
  emissiveIntensity?: number;
};

function pbr(set: TexSet, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    normalScale: new THREE.Vector2(opts.normalScale ?? 0.8, opts.normalScale ?? 0.8),
    envMapIntensity: opts.envMapIntensity ?? 0.8,
  });
}

/** Bake many small parts into one mesh per material. */
class Batcher {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(
    mat: THREE.Material,
    geo: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    uvScale?: [number, number],
  ): void {
    const g = geo.clone();
    if (uvScale) {
      const uv = g.getAttribute('uv');
      if (uv) {
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
        }
        uv.needsUpdate = true;
      }
    }
    g.applyMatrix4(matrix);
    const list = this.buckets.get(mat);
    if (list) list.push(g);
    else this.buckets.set(mat, [g]);
    geo.dispose();
  }

  commit(scene: THREE.Scene, castShadow = true, receiveShadow = true): number {
    let calls = 0;
    for (const [mat, list] of this.buckets) {
      if (list.length === 0) continue;
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      scene.add(mesh);
      calls++;
    }
    this.buckets.clear();
    return calls;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function place(
  x: number,
  y: number,
  z: number,
  ry = 0,
  rx = 0,
  rz = 0,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, ONE);
}

/** Position/rotation with independent scale, for flat ground patches. */
function placeScaled(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0, 'YXZ'));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    q,
    new THREE.Vector3(sx, sy, sz),
  );
}

/**
 * Dirt apron as overlapping discs. A single plane gives the yard a hard
 * rectangular edge that reads badly against the runway, so each yard is a few
 * discs at slightly different heights that melt into the grass.
 */
function apron(
  b: Batcher,
  mat: THREE.Material,
  x: number,
  z: number,
  rx: number,
  rz: number,
  y = 0.02,
): void {
  const g = new THREE.CircleGeometry(1, 40);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * rx * 0.22, uv.getY(i) * rz * 0.22);
  }
  b.add(mat, g, placeScaled(x, y, z, rx, rz, 1, -Math.PI / 2));
}

function box(colliders: Collider[], x: number, z: number, w: number, d: number, h: number, y = 0): void {
  colliders.push({
    min: { x: x - w / 2, y, z: z - d / 2 },
    max: { x: x + w / 2, y: y + h, z: z + d / 2 },
  });
}

export interface IndustryBuild {
  platforms: Platform[];
}

/** A sawtooth-roofed factory shell: two long walls, open ends, roof ribs. */
function shed(
  b: Batcher,
  colliders: Collider[],
  platforms: Platform[],
  opts: {
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    wallMat: THREE.Material;
    roofMat: THREE.Material;
    postMat: THREE.Material;
    glassMat: THREE.Material;
    door: number;
    brokenRoof?: boolean;
  },
): void {
  const { x, z, w, d, h } = opts;
  const t = 0.55;
  const hw = w / 2;
  const hd = d / 2;
  const door = opts.door;

  // long side walls
  for (const sx of [-1, 1]) {
    b.add(opts.wallMat, new THREE.BoxGeometry(t, h, d), place(x + sx * hw, h / 2, z), [d * 0.16, h * 0.16]);
    colliders.push({
      min: { x: x + sx * hw - t / 2, y: 0, z: z - hd },
      max: { x: x + sx * hw + t / 2, y: h, z: z + hd },
    });
    // broken window band along the inside face
    for (let i = 0; i < 5; i++) {
      const wz = z - hd + 3 + i * ((d - 6) / 4);
      b.add(opts.glassMat, new THREE.BoxGeometry(0.08, 1.7, (d - 6) / 5 - 1.1), place(x + sx * (hw - t / 2), h * 0.62, wz));
    }
    // pilasters give the long wall some relief and catch the low sun
    for (let i = 0; i < 5; i++) {
      const pz = z - hd + 3 + i * ((d - 6) / 4);
      b.add(opts.wallMat, new THREE.BoxGeometry(t + 0.5, h, 0.7), place(x + sx * (hw + 0.12), h / 2, pz), [0.8, h * 0.16]);
    }
  }

  // end walls with a fly-through opening
  for (const sz of [-1, 1]) {
    const zz = z + sz * hd;
    const side = (w - door) / 2;
    for (const sx of [-1, 1]) {
      const cx = x + sx * (door / 2 + side / 2);
      b.add(opts.wallMat, new THREE.BoxGeometry(side, h, t), place(cx, h / 2, zz), [side * 0.16, h * 0.16]);
      colliders.push({
        min: { x: cx - side / 2, y: 0, z: zz - t / 2 },
        max: { x: cx + side / 2, y: h, z: zz + t / 2 },
      });
    }
    // lintel above the opening
    const lintel = h - 5.0;
    if (lintel > 0.4) {
      b.add(opts.wallMat, new THREE.BoxGeometry(door, lintel, t), place(x, h - lintel / 2, zz), [door * 0.16, lintel * 0.16]);
    }
    // rusted roller-door frame around the opening
    for (const sx of [-1, 1]) {
      b.add(opts.postMat, new THREE.BoxGeometry(0.3, 5.3, 0.4), place(x + sx * (door / 2 + 0.1), 2.65, zz), [1, 3]);
    }
    b.add(opts.postMat, new THREE.BoxGeometry(door + 0.6, 0.32, 0.4), place(x, 5.15, zz), [3, 1]);
  }

  // sawtooth roof: alternating rising panels across the width
  const teeth = Math.max(3, Math.round(w / 7));
  const tw = w / teeth;
  for (let i = 0; i < teeth; i++) {
    if (opts.brokenRoof && (i === 1 || i === teeth - 2)) continue;
    const cx = x - hw + tw * (i + 0.5);
    // sloped panel
    b.add(
      opts.roofMat,
      new THREE.BoxGeometry(tw, 0.16, d),
      place(cx, h + 0.5, z, 0, 0, 0.42),
      [d * 0.35, tw * 0.35],
    );
    // vertical glazed strip facing the light
    b.add(opts.glassMat, new THREE.BoxGeometry(0.08, 0.9, d * 0.96), place(cx + tw / 2 - 0.1, h + 0.55, z));
  }
  // ridge cap at each end of the roof span
  for (const sz of [-1, 1]) {
    b.add(opts.roofMat, new THREE.BoxGeometry(w, 0.3, 0.5), place(x, h + 0.3, z + sz * hd), [w * 0.35, 0.5]);
  }

  // interior columns + trusses
  for (let i = 0; i < 4; i++) {
    const cz = z - hd + 4 + i * ((d - 8) / 3);
    for (const sx of [-1, 1]) {
      b.add(opts.postMat, new THREE.CylinderGeometry(0.16, 0.2, h, 8), place(x + sx * (hw - 1.4), h / 2, cz));
      colliders.push({
        min: { x: x + sx * (hw - 1.4) - 0.22, y: 0, z: cz - 0.22 },
        max: { x: x + sx * (hw - 1.4) + 0.22, y: h, z: cz + 0.22 },
      });
    }
    b.add(opts.postMat, new THREE.BoxGeometry(w - 3, 0.22, 0.22), place(x, h - 0.9, cz));
  }

  // catwalk along one wall, landable
  const cw = 2.2;
  const cy = h * 0.52;
  b.add(opts.postMat, new THREE.BoxGeometry(cw, 0.14, d - 2), place(x - hw + cw / 2 + 0.4, cy, z));
  platforms.push({
    minX: x - hw + 0.4,
    maxX: x - hw + 0.4 + cw,
    minZ: z - hd + 1,
    maxZ: z + hd - 1,
    top: cy + 0.07,
  });
  for (const sz of [-1, 1]) {
    b.add(opts.postMat, new THREE.BoxGeometry(cw, 0.08, 0.08), place(x - hw + cw / 2 + 0.4, cy + 1.0, z + sz * (hd - 1)));
    for (const ox of [-1, 1]) {
      b.add(opts.postMat, new THREE.BoxGeometry(0.08, 1.0, 0.08), place(x - hw + cw / 2 + 0.4 + ox * (cw / 2 - 0.05), cy + 0.5, z + sz * (hd - 1)));
    }
  }
  for (let i = 0; i < 4; i++) {
    const cz = z - hd + 4 + i * ((d - 8) / 3);
    b.add(opts.postMat, new THREE.CylinderGeometry(0.07, 0.07, cy, 6), place(x - hw + cw + 0.55, cy / 2, cz));
  }
}

interface Mats {
  wall: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  container: THREE.MeshStandardMaterial;
}

function ghostWorks(
  b: Batcher,
  m: Mats,
  scene: THREE.Scene,
  colliders: Collider[],
  platforms: Platform[],
): void {
  // ---------------------------------------------------------------- yard floor
  apron(b, m.gravel, -36, -128, 27, 43, 0.02);
  apron(b, m.gravel, -44, -102, 17, 15, 0.03);
  apron(b, m.gravel, -26, -158, 19, 17, 0.035);

  // ---------------------------------------------------------------- the sheds
  shed(b, colliders, platforms, {
    x: -32,
    z: -108,
    w: 26,
    d: 36,
    h: 9,
    wallMat: m.wall,
    roofMat: m.roof,
    postMat: m.steel,
    glassMat: m.glass,
    door: 9,
  });

  shed(b, colliders, platforms, {
    x: -32,
    z: -156,
    w: 22,
    d: 26,
    h: 7.4,
    wallMat: m.wall,
    roofMat: m.roof,
    postMat: m.steel,
    glassMat: m.glass,
    door: 8,
    brokenRoof: true,
  });

  // ---------------------------------------------------------------- chimney
  const chx = -55;
  const chz = -112;
  b.add(m.rust, new THREE.CylinderGeometry(1.7, 2.4, 28, 20), place(chx, 14, chz), [6, 14]);
  for (let i = 0; i < 5; i++) {
    b.add(m.steel, new THREE.CylinderGeometry(2.02, 2.02, 0.3, 20), place(chx, 5 + i * 5, chz));
  }
  colliders.push({
    min: { x: chx - 2.4, y: 0, z: chz - 2.4 },
    max: { x: chx + 2.4, y: 28, z: chz + 2.4 },
  });

  // ---------------------------------------------------------------- silos
  for (const [sx, sz] of [
    [-56, -146],
    [-56, -156],
  ] as const) {
    b.add(m.rust, new THREE.CylinderGeometry(3, 3, 13, 20), place(sx, 6.5, sz), [8, 6]);
    b.add(m.roof, new THREE.ConeGeometry(3.1, 1.8, 20), place(sx, 13.9, sz));
    colliders.push({
      min: { x: sx - 3, y: 0, z: sz - 3 },
      max: { x: sx + 3, y: 14.8, z: sz + 3 },
    });
  }

  // ---------------------------------------------------------------- pipe gantry
  // Crossing between the sheds: fly under the pipes, through the frames.
  const gz0 = -126;
  const gz1 = -144;
  for (const pz of [gz0, gz1]) {
    for (const px of [-40, -24]) {
      b.add(m.steel, new THREE.BoxGeometry(0.3, 8, 0.3), place(px, 4, pz));
      colliders.push({
        min: { x: px - 0.25, y: 0, z: pz - 0.25 },
        max: { x: px + 0.25, y: 8, z: pz + 0.25 },
      });
    }
    b.add(m.steel, new THREE.BoxGeometry(16.6, 0.26, 0.3), place(-32, 7.6, pz));
  }
  for (const off of [-1.4, 0, 1.4]) {
    b.add(m.rust, new THREE.CylinderGeometry(0.34, 0.34, gz0 - gz1, 10), place(-32 + off, 7.0, (gz0 + gz1) / 2, 0, Math.PI / 2, 0), [3, 6]);
  }

  // ---------------------------------------------------------------- clutter
  // Crates, drums and pallet stacks, all merged.
  const rr = seeded(77);
  for (let i = 0; i < 18; i++) {
    const cx = -46 + rr() * 26;
    const cz = -140 + rr() * 34;
    if (Math.abs(cx + 32) < 12 && Math.abs(cz + 108) < 18) continue;
    const s = 0.7 + rr() * 0.9;
    b.add(m.rust, new THREE.BoxGeometry(s, s * 0.8, s), place(cx, s * 0.4, cz, rr() * Math.PI), [s, s]);
    colliders.push({
      min: { x: cx - s / 2, y: 0, z: cz - s / 2 },
      max: { x: cx + s / 2, y: s * 0.8, z: cz + s / 2 },
    });
  }
  for (let i = 0; i < 14; i++) {
    const dx = -50 + rr() * 34;
    const dz = -100 - rr() * 60;
    b.add(m.rust, new THREE.CylinderGeometry(0.3, 0.3, 0.95, 12), place(dx, 0.48, dz, rr() * 3), [2, 1]);
    colliders.push({
      min: { x: dx - 0.3, y: 0, z: dz - 0.3 },
      max: { x: dx + 0.3, y: 0.95, z: dz + 0.3 },
    });
  }

  // A couple of sodium lamps so the district reads at dusk and gives the eye
  // something warm to aim at.
  for (const [lx, lz] of [
    [-14, -96],
    [-52, -168],
  ] as const) {
    b.add(m.steel, new THREE.CylinderGeometry(0.09, 0.12, 7, 8), place(lx, 3.5, lz));
    b.add(m.steel, new THREE.BoxGeometry(1.4, 0.1, 0.1), place(lx + 0.6, 7, lz));
    b.add(m.lamp, new THREE.BoxGeometry(0.9, 0.12, 0.3), place(lx + 1.15, 6.92, lz));
    colliders.push({
      min: { x: lx - 0.2, y: 0, z: lz - 0.2 },
      max: { x: lx + 0.2, y: 7, z: lz + 0.2 },
    });
  }

  b.commit(scene);
}

function cargoYard(
  b: Batcher,
  m: Mats,
  scene: THREE.Scene,
  colliders: Collider[],
  platforms: Platform[],
): void {
  // ---------------------------------------------------------------- apron
  apron(b, m.gravel, 30, -124, 20, 35, 0.02);
  apron(b, m.gravel, 40, -140, 14, 12, 0.03);
  apron(b, m.gravel, 22, -104, 15, 12, 0.035);

  // ---------------------------------------------------------------- containers
  // One instanced mesh for the whole stack yard; instance colour does the rest.
  const specs: Array<[number, number, number, number]> = [
    [20, -104, 0, 0xc4785f],
    [20, -110.5, 0, 0x74a4b6],
    [20, -117, 0, 0x8aa878],
    [20, -123.5, 0, 0xbaac8f],
    [20, -130, 0, 0xd4906a],
    [20, -136.5, 0, 0x6497ab],
    [27, -107, 0, 0xbaac8f],
    [27, -114, 0, 0xc4785f],
    [27, -121, 0, 0x74a4b6],
    [27, -128, 0, 0x8aa878],
    [27, -135, 0, 0xd4906a],
    [20, -110.5, 1, 0x8aa878],
    [20, -123.5, 1, 0x74a4b6],
    [27, -114, 1, 0xbaac8f],
    [32.5, -104, 0, 0xd4906a],
    [32.5, -111, 0, 0x8aa878],
  ];
  const geo = new THREE.BoxGeometry(2.44, 2.59, 6.06);
  const boxes = new THREE.InstancedMesh(geo, m.container, specs.length);
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const col = new THREE.Color();
  const pos = new THREE.Vector3();
  specs.forEach(([x, z, layer, color], i) => {
    const y = 1.295 + layer * 2.59;
    mat4.compose(pos.set(x, y, z), quat.identity(), ONE);
    boxes.setMatrixAt(i, mat4);
    // Painted steel still has to read in shade; the iron texture is dark, so
    // the tint is pushed past 1.0 in linear space.
    boxes.setColorAt(i, col.setHex(color).multiplyScalar(2.1));
    const top = (layer + 1) * 2.59;
    colliders.push({
      min: { x: x - 1.22, y: 0, z: z - 3.03 },
      max: { x: x + 1.22, y: top, z: z + 3.03 },
    });
    platforms.push({
      minX: x - 1.22,
      maxX: x + 1.22,
      minZ: z - 3.03,
      maxZ: z + 3.03,
      top: top + 0.01,
    });
  });
  scene.add(boxes);

  // ---------------------------------------------------------------- fuel farm
  const tankZ = [-116, -126.5, -137];
  for (const tz of tankZ) {
    b.add(m.rust, new THREE.CylinderGeometry(2.35, 2.35, 9.4, 20), place(40, 2.9, tz, 0, Math.PI / 2), [11, 4]);
    for (const sz of [-2.8, 2.8]) {
      b.add(m.wall, new THREE.BoxGeometry(4.4, 1.1, 0.9), place(40, 0.55, tz + sz), [1, 1]);
    }
    // valve cluster + walkway rail
    b.add(m.steel, new THREE.CylinderGeometry(0.18, 0.18, 1.4, 8), place(42.3, 4.2, tz));
    b.add(m.steel, new THREE.CylinderGeometry(0.09, 0.09, 9.4, 6), place(42.9, 5.4, tz));
    for (const sz of [-3.4, 0, 3.4]) {
      b.add(m.steel, new THREE.BoxGeometry(0.07, 0.6, 0.07), place(42.9, 5.1, tz + sz));
    }
    colliders.push({
      min: { x: 37.6, y: 0, z: tz - 4.7 },
      max: { x: 42.4, y: 5.4, z: tz + 4.7 },
    });
  }

  // bund wall with an entry gap on the near side
  const bund: Array<[number, number, number, number]> = [
    [35.2, -128, 0.4, 34],
    [44.8, -128, 0.4, 34],
    [40, -145, 9.6, 0.4],
  ];
  for (const [x, z, w, d] of bund) {
    b.add(m.wall, new THREE.BoxGeometry(w, 1.15, d), place(x, 0.575, z), [Math.max(w, d) * 0.16, 0.3]);
    colliders.push({
      min: { x: x - w / 2, y: 0, z: z - d / 2 },
      max: { x: x + w / 2, y: 1.15, z: z + d / 2 },
    });
  }
  for (const sx of [-1, 1]) {
    b.add(m.wall, new THREE.BoxGeometry(1.9, 1.15, 0.4), place(40 + sx * 3.85, 0.575, -111), [0.4, 0.3]);
    colliders.push({
      min: { x: 40 + sx * 3.85 - 0.95, y: 0, z: -111.2 },
      max: { x: 40 + sx * 3.85 + 0.95, y: 1.15, z: -110.8 },
    });
  }

  // pump house between the tanks and the water tower
  b.add(m.wall, new THREE.BoxGeometry(5, 3.4, 4), place(43, 1.7, -141), [2, 1]);
  b.add(m.roof, new THREE.BoxGeometry(5.6, 0.2, 4.6), place(43, 3.5, -141), [2, 2]);
  b.add(m.glass, new THREE.BoxGeometry(0.1, 1.2, 0.9), place(40.44, 2.2, -142));
  colliders.push({
    min: { x: 40.5, y: 0, z: -143 },
    max: { x: 45.5, y: 3.5, z: -139 },
  });

  // manifold pipe running the length of the farm
  b.add(m.steel, new THREE.CylinderGeometry(0.22, 0.22, 34, 10), place(44.2, 1.2, -127, 0, Math.PI / 2));
  for (const tz of tankZ) {
    b.add(m.steel, new THREE.CylinderGeometry(0.16, 0.16, 2.4, 8), place(44.2, 2.2, tz + 4.3));
  }

  // ---------------------------------------------------------------- water tower
  const wx = 30;
  const wz = -152;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(m.steel, new THREE.CylinderGeometry(0.24, 0.32, 12, 8), place(wx + sx * 2.3, 6, wz + sz * 2.3));
      colliders.push({
        min: { x: wx + sx * 2.3 - 0.34, y: 0, z: wz + sz * 2.3 - 0.34 },
        max: { x: wx + sx * 2.3 + 0.34, y: 12, z: wz + sz * 2.3 + 0.34 },
      });
    }
  }
  for (const by of [4, 8]) {
    for (const sz of [-1, 1]) {
      b.add(m.steel, new THREE.BoxGeometry(4.6, 0.12, 0.12), place(wx, by, wz + sz * 2.3));
    }
    for (const sx of [-1, 1]) {
      b.add(m.steel, new THREE.BoxGeometry(0.12, 0.12, 4.6), place(wx + sx * 2.3, by, wz));
    }
  }
  b.add(m.rust, new THREE.CylinderGeometry(3.2, 3.2, 4.2, 24), place(wx, 14.1, wz), [14, 3]);
  b.add(m.rust, new THREE.ConeGeometry(3.2, 1.5, 24), place(wx, 11.25, wz, 0, Math.PI));
  b.add(m.roof, new THREE.ConeGeometry(3.35, 1.2, 24), place(wx, 16.8, wz));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(m.steel, new THREE.BoxGeometry(0.07, 0.9, 0.07), place(wx + Math.cos(a) * 3.05, 16.2, wz + Math.sin(a) * 3.05));
  }
  b.add(m.steel, new THREE.CylinderGeometry(3.1, 3.1, 0.08, 24), place(wx, 16.6, wz));
  colliders.push({
    min: { x: wx - 3.3, y: 11.0, z: wz - 3.3 },
    max: { x: wx + 3.3, y: 17.4, z: wz + 3.3 },
  });
  platforms.push({ minX: wx - 2.9, maxX: wx + 2.9, minZ: wz - 2.9, maxZ: wz + 2.9, top: 17.4 });

  // ladder up the near leg
  for (let i = 0; i < 14; i++) {
    b.add(m.steel, new THREE.BoxGeometry(0.5, 0.06, 0.06), place(wx - 2.3, 0.8 + i * 0.85, wz + 2.75));
  }

  // ---------------------------------------------------------------- gatehouse
  b.add(m.wall, new THREE.BoxGeometry(5.4, 2.9, 4), place(16.5, 1.45, -146), [2, 1]);
  b.add(m.roof, new THREE.BoxGeometry(6, 0.2, 4.6), place(16.5, 3.0, -146), [2, 2]);
  b.add(m.glass, new THREE.BoxGeometry(0.1, 1.1, 2.6), place(19.22, 1.7, -146));
  colliders.push({
    min: { x: 13.8, y: 0, z: -148 },
    max: { x: 19.2, y: 3.0, z: -144 },
  });

  // ---------------------------------------------------------------- clutter
  const rr = seeded(913);
  for (let i = 0; i < 10; i++) {
    const px = 15 + rr() * 4;
    const pz = -130 + rr() * 12;
    b.add(m.rust, new THREE.BoxGeometry(1.2, 0.16, 0.9), place(px, 0.1 + i * 0.14, pz, rr()));
    b.add(m.rust, new THREE.BoxGeometry(1.2, 0.16, 0.9), place(px, 0.1 + i * 0.14 + 0.08, pz, rr() * 0.2), [1, 1]);
  }
  for (let i = 0; i < 6; i++) {
    const dx = 36 + rr() * 6;
    const dz = -100 - rr() * 8;
    b.add(m.rust, new THREE.CylinderGeometry(0.32, 0.32, 0.95, 10), place(dx, 0.48, dz), [2, 1]);
    colliders.push({
      min: { x: dx - 0.32, y: 0, z: dz - 0.32 },
      max: { x: dx + 0.32, y: 0.95, z: dz + 0.32 },
    });
  }

  // high mast over the container rows
  b.add(m.steel, new THREE.CylinderGeometry(0.16, 0.26, 13, 10), place(22, 6.5, -99));
  b.add(m.steel, new THREE.BoxGeometry(1.8, 0.16, 0.16), place(22.8, 13, -99));
  b.add(m.lamp, new THREE.BoxGeometry(1.2, 0.14, 0.4), place(23.5, 12.92, -99));
  colliders.push({
    min: { x: 21.7, y: 0, z: -99.3 },
    max: { x: 22.3, y: 13, z: -98.7 },
  });
}

/** Gabled hangar with a wrecked light aircraft inside, plus a control tower. */
function southField(
  b: Batcher,
  m: Mats,
  colliders: Collider[],
  platforms: Platform[],
): void {
  const cx = -46;
  const cz = 34;
  const w = 26;
  const d = 20;
  const h = 8;
  const rise = 3.2;
  const hw = w / 2;
  const hd = d / 2;
  const t = 0.45;

  // slab
  b.add(m.wall, new THREE.BoxGeometry(w - 0.5, 0.14, d - 0.5), place(cx, 0.07, cz), [4, 3]);

  // west, east and south walls
  for (const [wx, wz, bw, bd] of [
    [cx - hw, cz, t, d],
    [cx + hw, cz, t, d],
    [cx, cz + hd, w, t],
  ] as const) {
    b.add(m.wall, new THREE.BoxGeometry(bw, h, bd), place(wx, h / 2, wz), [Math.max(bw, bd) * 0.16, h * 0.16]);
    colliders.push({
      min: { x: wx - bw / 2, y: 0, z: wz - bd / 2 },
      max: { x: wx + bw / 2, y: h, z: wz + bd / 2 },
    });
  }

  // gable roof, two slabs
  const slope = Math.atan2(rise, hd);
  const slabLen = Math.hypot(hd, rise) + 0.6;
  for (const sz of [-1, 1]) {
    b.add(
      m.roof,
      new THREE.BoxGeometry(w + 1.2, 0.22, slabLen),
      place(cx, h + rise / 2, cz + sz * (hd / 2), 0, sz * slope),
      [6, 3],
    );
  }
  b.add(m.roof, new THREE.BoxGeometry(w + 1.4, 0.3, 0.5), place(cx, h + rise, cz), [6, 1]);
  // gable infill on the east/west ends, stepped to keep it cheap
  for (const gx of [cx + hw, cx - hw]) {
    b.add(m.wall, new THREE.BoxGeometry(t, rise * 0.52, d), place(gx, h + rise * 0.26, cz), [0.5, 3]);
    b.add(m.wall, new THREE.BoxGeometry(t, rise * 0.52, d * 0.56), place(gx, h + rise * 0.74, cz), [0.5, 2]);
  }

  // open north face: header beam + rusted sliding door pushed to one side
  b.add(m.steel, new THREE.BoxGeometry(w, 1.5, 0.45), place(cx, h - 0.75, cz - hd), [4, 0.4]);
  b.add(m.steel, new THREE.BoxGeometry(0.3, h, 0.4), place(cx - hw + 0.2, h / 2, cz - hd));
  b.add(m.steel, new THREE.BoxGeometry(0.3, h, 0.4), place(cx + hw - 0.2, h / 2, cz - hd));
  b.add(m.rust, new THREE.BoxGeometry(8.4, 5.8, 0.2), place(cx + 5.6, 2.95, cz - hd - 0.3), [4, 3]);
  b.add(m.rust, new THREE.BoxGeometry(8.4, 0.25, 0.3), place(cx + 5.6, 6.0, cz - hd - 0.3), [4, 1]);
  colliders.push({
    min: { x: cx + 1.4, y: 0, z: cz - hd - 0.6 },
    max: { x: cx + 9.8, y: 6.0, z: cz - hd - 0.4 },
  });

  // interior columns and roof trusses
  for (let i = 0; i < 3; i++) {
    const pz = cz - hd + 3.5 + i * ((d - 7) / 2);
    for (const sx of [-1, 1]) {
      b.add(m.steel, new THREE.BoxGeometry(0.34, h, 0.34), place(cx + sx * (hw - 0.9), h / 2, pz));
      colliders.push({
        min: { x: cx + sx * (hw - 0.9) - 0.2, y: 0, z: pz - 0.2 },
        max: { x: cx + sx * (hw - 0.9) + 0.2, y: h, z: pz + 0.2 },
      });
    }
    b.add(m.steel, new THREE.BoxGeometry(w - 1.4, 0.2, 0.2), place(cx, h - 0.6, pz));
  }

  // ---------------------------------------------------------------- wreck
  const px = cx - 3.5;
  const pz = cz + 3.5;
  b.add(m.roof, new THREE.CylinderGeometry(0.85, 0.95, 7, 14), place(px, 1.55, pz, 0, Math.PI / 2), [6, 2]);
  b.add(m.roof, new THREE.ConeGeometry(0.85, 1.3, 14), place(px, 1.55, pz - 4.1, 0, -Math.PI / 2), [3, 1]);
  b.add(m.roof, new THREE.BoxGeometry(11, 0.18, 1.7), place(px, 1.85, pz - 0.4), [6, 1]);
  b.add(m.roof, new THREE.BoxGeometry(0.16, 1.5, 1.1), place(px, 2.5, pz + 3.3), [1, 1]);
  b.add(m.roof, new THREE.BoxGeometry(3.6, 0.14, 0.9), place(px, 1.9, pz + 3.4), [2, 1]);
  b.add(m.steel, new THREE.CylinderGeometry(0.09, 0.09, 1.3, 6), place(px, 1.5, pz + 4.6, 0, Math.PI / 2));
  for (const sx of [-1, 1]) {
    b.add(m.steel, new THREE.BoxGeometry(0.1, 0.7, 0.1), place(px + sx * 1.6, 0.95, pz - 1.4));
    b.add(m.steel, new THREE.CylinderGeometry(0.32, 0.32, 0.18, 10), place(px + sx * 1.7, 0.32, pz - 1.4, 0, Math.PI / 2));
  }
  colliders.push({
    min: { x: px - 1.1, y: 0, z: pz - 4.7 },
    max: { x: px + 1.1, y: 2.6, z: pz + 4.7 },
  });
  platforms.push({ minX: px - 5.3, maxX: px + 5.3, minZ: pz - 1.2, maxZ: pz + 0.4, top: 1.95 });

  // ---------------------------------------------------------------- hangar dressing
  b.add(m.rust, new THREE.BoxGeometry(0.9, 1.0, 6), place(cx - hw + 0.95, 0.5, cz + 2), [3, 1]);
  b.add(m.rust, new THREE.BoxGeometry(0.5, 0.1, 5.2), place(cx - hw + 0.95, 1.1, cz + 2), [3, 1]);
  const hr = seeded(57);
  for (let i = 0; i < 5; i++) {
    const bx = cx - hw + 3.2 + hr() * 8;
    const bz = cz + 5.5 + hr() * 5;
    const bs = 0.7 + hr() * 0.6;
    b.add(m.rust, new THREE.BoxGeometry(bs, bs * 0.85, bs), place(bx, bs * 0.43, bz, hr() * 1.2), [1, 1]);
    colliders.push({
      min: { x: bx - bs / 2, y: 0, z: bz - bs / 2 },
      max: { x: bx + bs / 2, y: bs * 0.85, z: bz + bs / 2 },
    });
  }
  for (const [dx, dz] of [
    [cx + hw - 2.2, cz + 6.5],
    [cx + hw - 3.1, cz + 7.1],
    [cx + hw - 2.4, cz + 7.6],
  ] as const) {
    b.add(m.rust, new THREE.CylinderGeometry(0.3, 0.3, 0.95, 12), place(dx, 0.48, dz), [2, 1]);
    colliders.push({
      min: { x: dx - 0.3, y: 0, z: dz - 0.3 },
      max: { x: dx + 0.3, y: 0.95, z: dz + 0.3 },
    });
  }
  // hanging work lamp
  b.add(m.steel, new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), place(cx + 2, 9.6, cz + 1));
  b.add(m.steel, new THREE.CylinderGeometry(0.34, 0.14, 0.36, 12), place(cx + 2, 8.3, cz + 1));
  b.add(m.lamp, new THREE.SphereGeometry(0.13, 8, 6), place(cx + 2, 8.14, cz + 1));

  // ---------------------------------------------------------------- tower
  const tx = 44;
  const tz = 30;
  b.add(m.wall, new THREE.BoxGeometry(5, 13, 5), place(tx, 6.5, tz), [1, 4]);
  b.add(m.glass, new THREE.BoxGeometry(0.1, 1.1, 3.2), place(tx - 2.52, 8.6, tz));
  b.add(m.steel, new THREE.BoxGeometry(0.12, 2.4, 0.12), place(tx - 2.7, 1.3, tz + 1.4));
  b.add(m.steel, new THREE.BoxGeometry(0.12, 2.4, 0.12), place(tx - 2.7, 1.3, tz - 1.4));
  b.add(m.wall, new THREE.BoxGeometry(7, 0.5, 7), place(tx, 13.25, tz), [2, 2]);
  for (const [ox, oz, bw, bd] of [
    [0, -3.4, 7, 0.16],
    [0, 3.4, 7, 0.16],
    [-3.4, 0, 0.16, 7],
    [3.4, 0, 0.16, 7],
  ] as const) {
    b.add(m.glass, new THREE.BoxGeometry(bw, 2.5, bd), place(tx + ox, 14.85, tz + oz));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(m.steel, new THREE.BoxGeometry(0.2, 2.7, 0.2), place(tx + sx * 3.4, 14.85, tz + sz * 3.4));
    }
  }
  b.add(m.roof, new THREE.BoxGeometry(7.8, 0.32, 7.8), place(tx, 16.3, tz), [2, 2]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(m.steel, new THREE.BoxGeometry(0.07, 0.9, 0.07), place(tx + Math.cos(a) * 3.7, 16.9, tz + Math.sin(a) * 3.7));
  }
  b.add(m.steel, new THREE.CylinderGeometry(3.75, 3.75, 0.07, 20), place(tx, 17.3, tz));
  b.add(m.steel, new THREE.CylinderGeometry(0.09, 0.14, 5, 8), place(tx + 2.2, 19.9, tz), [2, 1]);
  b.add(m.lamp, new THREE.SphereGeometry(0.16, 8, 6), place(tx + 2.2, 22.5, tz));
  colliders.push({
    min: { x: tx - 2.5, y: 0, z: tz - 2.5 },
    max: { x: tx + 2.5, y: 13.5, z: tz + 2.5 },
  });
  colliders.push({
    min: { x: tx - 3.9, y: 13, z: tz - 3.9 },
    max: { x: tx + 3.9, y: 17.4, z: tz + 3.9 },
  });

  // ---------------------------------------------------------------- windsock
  const sx = 30;
  const sz = 21;
  b.add(m.steel, new THREE.CylinderGeometry(0.07, 0.11, 6.5, 8), place(sx, 3.25, sz));
  for (let i = 0; i < 3; i++) {
    b.add(m.rust, new THREE.CylinderGeometry(0.32 - i * 0.05, 0.38 - i * 0.05, 0.7, 10, 1, true), place(sx + 0.55 + i * 0.72, 6.3 - i * 0.06, sz, 0, 0, Math.PI / 2), [2, 1]);
  }
  colliders.push({
    min: { x: sx - 0.15, y: 0, z: sz - 0.15 },
    max: { x: sx + 0.15, y: 6.5, z: sz + 0.15 },
  });

  // ---------------------------------------------------------------- line clutter
  const rr = seeded(331);
  for (let i = 0; i < 5; i++) {
    const cxx = -18 + i * 3.2;
    const czz = 6 + rr() * 4;
    b.add(m.rust, new THREE.ConeGeometry(0.28, 0.75, 10), place(cxx, 0.38, czz), [1, 1]);
    colliders.push({
      min: { x: cxx - 0.28, y: 0, z: czz - 0.28 },
      max: { x: cxx + 0.28, y: 0.75, z: czz + 0.28 },
    });
  }
  // tow tractor, seen better than modelled
  b.add(m.rust, new THREE.BoxGeometry(2.6, 1.0, 1.5), place(-10, 0.8, 12), [2, 1]);
  b.add(m.steel, new THREE.BoxGeometry(1.4, 0.9, 1.4), place(-10.6, 1.6, 12), [1, 1]);
  for (const ox of [-0.9, 0.9]) {
    for (const oz of [-0.8, 0.8]) {
      b.add(m.steel, new THREE.CylinderGeometry(0.35, 0.35, 0.24, 10), place(-10 + ox, 0.35, 12 + oz, 0, Math.PI / 2));
    }
  }
  colliders.push({
    min: { x: -11.3, y: 0, z: 11.2 },
    max: { x: -8.7, y: 2.1, z: 12.8 },
  });
}

export async function buildIndustry(
  scene: THREE.Scene,
  assets: Assets,
  colliders: Collider[],
): Promise<IndustryBuild> {
  const platforms: Platform[] = [];
  const b = new Batcher();

  // Tiling is driven per-part by UV scale, so the texture sets stay at 1:1.
  const concrete = await assets.tex('concrete_wall_008', 1, 1);
  const corrugated = await assets.tex('corrugated_iron_02', 1, 1);
  const rusty = await assets.tex('rusty_metal_02', 1, 1);
  const gravel = await assets.tex('gravel_floor', 1, 1);

  const m: Mats = {
    wall: pbr(concrete, { color: 0x8d877b, roughness: 0.97, normalScale: 1.3, envMapIntensity: 0.45 }),
    roof: pbr(corrugated, { color: 0x6a665d, roughness: 0.9, metalness: 0.1, normalScale: 1.2, envMapIntensity: 0.55 }),
    rust: pbr(rusty, { color: 0x7d5238, roughness: 0.88, metalness: 0.4, normalScale: 1.2, envMapIntensity: 0.65 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.55, metalness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.8, metalness: 0.1 }),
    gravel: pbr(gravel, { color: 0x6e6b62, roughness: 1, normalScale: 1, envMapIntensity: 0.35 }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xffb15c,
      emissive: 0xff8a3c,
      emissiveIntensity: 2.4,
      roughness: 0.5,
    }),
    container: new THREE.MeshStandardMaterial({
      map: corrugated.map,
      normalMap: corrugated.normalMap,
      roughnessMap: corrugated.roughnessMap,
      roughness: 0.78,
      metalness: 0.28,
      normalScale: new THREE.Vector2(0.9, 0.9),
      envMapIntensity: 0.7,
    }),
  };

  ghostWorks(b, m, scene, colliders, platforms);
  cargoYard(b, m, scene, colliders, platforms);
  // Commit per district so each keeps its own bounding box and culls.
  b.commit(scene);

  southField(b, m, colliders, platforms);
  b.commit(scene);

  return { platforms };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
