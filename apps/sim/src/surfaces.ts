import * as THREE from 'three';
import type { Collider, Ramp } from './physics';

/**
 * Solid wedge geometry for a z-axis ramp. The physics surface and the mesh use
 * the same four corners, so the visual slope and the landable surface agree.
 */
export function wedgeMesh(ramp: Ramp, material: THREE.Material): THREE.Mesh {
  const { minX, maxX, minZ, maxZ, yAtMin, yAtMax } = ramp;

  const A = new THREE.Vector3(minX, 0, minZ);
  const B = new THREE.Vector3(maxX, 0, minZ);
  const C = new THREE.Vector3(maxX, 0, maxZ);
  const D = new THREE.Vector3(minX, 0, maxZ);
  const E = new THREE.Vector3(minX, yAtMin, minZ);
  const F = new THREE.Vector3(maxX, yAtMin, minZ);
  const G = new THREE.Vector3(maxX, yAtMax, maxZ);
  const H = new THREE.Vector3(minX, yAtMax, maxZ);

  const positions: number[] = [];
  const uvs: number[] = [];
  const push = (p: THREE.Vector3) => {
    positions.push(p.x, p.y, p.z);
    uvs.push((p.x - minX) / Math.max(1e-6, maxX - minX), (p.z - minZ) / Math.max(1e-6, maxZ - minZ));
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    push(a);
    push(b);
    push(c);
  };

  // bottom (-Y)
  tri(A, B, C);
  tri(A, C, D);
  // top slope (+Y)
  tri(E, H, G);
  tri(E, G, F);
  // low / high end caps
  if (yAtMin > 1e-4) {
    tri(A, F, B);
    tri(A, E, F);
  }
  if (yAtMax > 1e-4) {
    tri(D, C, G);
    tri(D, G, H);
  }
  // sides
  tri(A, H, E);
  tri(A, D, H);
  tri(B, F, G);
  tri(B, G, C);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A thin glowing strip following one side of a ramp surface. */
export function rampEdge(ramp: Ramp, x: number, material: THREE.Material): THREE.Mesh {
  const yA = ramp.yAtMin + 0.035;
  const yB = ramp.yAtMax + 0.035;
  const zA = ramp.minZ;
  const zB = ramp.maxZ;
  const len = Math.hypot(zB - zA, yB - yA);
  const geo = new THREE.BoxGeometry(0.055, 0.055, len);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, (yA + yB) / 2, (zA + zB) / 2);
  mesh.rotation.x = Math.atan2(yA - yB, zB - zA);
  return mesh;
}

/**
 * Solid shells for a ramp. The slope itself stays a landable surface; these
 * thin boxes close the two sides and the tall end so a quad cannot fly through
 * the side of a bank. Side shells are split along the slope and never rise
 * above the local surface, which keeps the walkable top clear.
 */
export function rampColliders(ramp: Ramp, steps = 6): Collider[] {
  const out: Collider[] = [];
  const along = ramp.axis === 'z' ? [ramp.minZ, ramp.maxZ] : [ramp.minX, ramp.maxX];
  const [t0, t1] = along as [number, number];
  const span = t1 - t0;
  if (span <= 1e-3) return out;

  const thickness = 0.07;
  const rise = ramp.yAtMax - ramp.yAtMin;
  const heightAt = (t: number) => ramp.yAtMin + rise * Math.max(0, Math.min(1, (t - t0) / span));

  for (let i = 0; i < steps; i++) {
    const a = t0 + (span * i) / steps;
    const b = t0 + (span * (i + 1)) / steps;
    const h = Math.max(heightAt(a), heightAt(b));
    if (h <= 0.08) continue;
    if (ramp.axis === 'z') {
      out.push({ min: { x: ramp.minX, y: 0, z: a }, max: { x: ramp.minX + thickness, y: h, z: b } });
      out.push({ min: { x: ramp.maxX - thickness, y: 0, z: a }, max: { x: ramp.maxX, y: h, z: b } });
    } else {
      out.push({ min: { x: a, y: 0, z: ramp.minZ }, max: { x: b, y: h, z: ramp.minZ + thickness } });
      out.push({ min: { x: a, y: 0, z: ramp.maxZ - thickness }, max: { x: b, y: h, z: ramp.maxZ } });
    }
  }

  // Cap the tall end, stopping 20 cm below the lip so landing on the edge wins.
  const capTop = Math.max(ramp.yAtMin, ramp.yAtMax) - 0.2;
  if (capTop > 0.05) {
    const highAtMax = ramp.yAtMax > ramp.yAtMin;
    if (ramp.axis === 'z') {
      const z = highAtMax ? ramp.maxZ - thickness : ramp.minZ;
      out.push({ min: { x: ramp.minX + thickness, y: 0, z }, max: { x: ramp.maxX - thickness, y: capTop, z: z + thickness } });
    } else {
      const x = highAtMax ? ramp.maxX - thickness : ramp.minX;
      out.push({ min: { x, y: 0, z: ramp.minZ + thickness }, max: { x: x + thickness, y: capTop, z: ramp.maxZ - thickness } });
    }
  }

  return out;
}
