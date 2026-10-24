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

export async function buildGhostWorks(
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

  const wallMat = pbr(concrete, { color: 0x8d877b, roughness: 0.97, normalScale: 1.3, envMapIntensity: 0.45 });
  const roofMat = pbr(corrugated, { color: 0x6a665d, roughness: 0.9, metalness: 0.1, normalScale: 1.2, envMapIntensity: 0.55 });
  const rustMat = pbr(rusty, { color: 0x7d5238, roughness: 0.88, metalness: 0.4, normalScale: 1.2, envMapIntensity: 0.65 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.55, metalness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.8, metalness: 0.1 });
  const gravelMat = pbr(gravel, { color: 0x5c574d, roughness: 1, normalScale: 1, envMapIntensity: 0.35 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffb15c,
    emissive: 0xff8a3c,
    emissiveIntensity: 2.4,
    roughness: 0.5,
  });

  // ---------------------------------------------------------------- yard floor
  const yardGeo = new THREE.PlaneGeometry(48, 82);
  const yardUv = yardGeo.getAttribute('uv');
  for (let i = 0; i < yardUv.count; i++) yardUv.setXY(i, yardUv.getX(i) * 10, yardUv.getY(i) * 17);
  const yard = new THREE.Mesh(yardGeo, gravelMat);
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(-36, 0.02, -130);
  yard.receiveShadow = true;
  scene.add(yard);

  // ---------------------------------------------------------------- the sheds
  shed(b, colliders, platforms, {
    x: -32,
    z: -108,
    w: 26,
    d: 36,
    h: 9,
    wallMat,
    roofMat,
    postMat: steelMat,
    glassMat,
    door: 9,
  });

  shed(b, colliders, platforms, {
    x: -32,
    z: -156,
    w: 22,
    d: 26,
    h: 7.4,
    wallMat,
    roofMat,
    postMat: steelMat,
    glassMat,
    door: 8,
    brokenRoof: true,
  });

  // ---------------------------------------------------------------- chimney
  const chx = -55;
  const chz = -112;
  b.add(rustMat, new THREE.CylinderGeometry(1.7, 2.4, 28, 20), place(chx, 14, chz), [6, 14]);
  for (let i = 0; i < 5; i++) {
    b.add(steelMat, new THREE.CylinderGeometry(2.02, 2.02, 0.3, 20), place(chx, 5 + i * 5, chz));
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
    b.add(rustMat, new THREE.CylinderGeometry(3, 3, 13, 20), place(sx, 6.5, sz), [8, 6]);
    b.add(roofMat, new THREE.ConeGeometry(3.1, 1.8, 20), place(sx, 13.9, sz));
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
      b.add(steelMat, new THREE.BoxGeometry(0.3, 8, 0.3), place(px, 4, pz));
      colliders.push({
        min: { x: px - 0.25, y: 0, z: pz - 0.25 },
        max: { x: px + 0.25, y: 8, z: pz + 0.25 },
      });
    }
    b.add(steelMat, new THREE.BoxGeometry(16.6, 0.26, 0.3), place(-32, 7.6, pz));
  }
  for (const off of [-1.4, 0, 1.4]) {
    b.add(rustMat, new THREE.CylinderGeometry(0.34, 0.34, gz0 - gz1, 10), place(-32 + off, 7.0, (gz0 + gz1) / 2, 0, Math.PI / 2, 0), [3, 6]);
  }

  // ---------------------------------------------------------------- clutter
  // Crates, drums and pallet stacks, all merged.
  const rr = seeded(77);
  for (let i = 0; i < 18; i++) {
    const cx = -46 + rr() * 26;
    const cz = -140 + rr() * 34;
    if (Math.abs(cx + 32) < 12 && Math.abs(cz + 108) < 18) continue;
    const s = 0.7 + rr() * 0.9;
    b.add(rustMat, new THREE.BoxGeometry(s, s * 0.8, s), place(cx, s * 0.4, cz, rr() * Math.PI), [s, s]);
    colliders.push({
      min: { x: cx - s / 2, y: 0, z: cz - s / 2 },
      max: { x: cx + s / 2, y: s * 0.8, z: cz + s / 2 },
    });
  }
  for (let i = 0; i < 14; i++) {
    const dx = -50 + rr() * 34;
    const dz = -100 - rr() * 60;
    b.add(rustMat, new THREE.CylinderGeometry(0.3, 0.3, 0.95, 12), place(dx, 0.48, dz, rr() * 3), [2, 1]);
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
    b.add(steelMat, new THREE.CylinderGeometry(0.09, 0.12, 7, 8), place(lx, 3.5, lz));
    b.add(steelMat, new THREE.BoxGeometry(1.4, 0.1, 0.1), place(lx + 0.6, 7, lz));
    b.add(lampMat, new THREE.BoxGeometry(0.9, 0.12, 0.3), place(lx + 1.15, 6.92, lz));
    colliders.push({
      min: { x: lx - 0.2, y: 0, z: lz - 0.2 },
      max: { x: lx + 0.2, y: 7, z: lz + 0.2 },
    });
  }

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
