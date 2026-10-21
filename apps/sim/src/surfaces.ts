import * as THREE from 'three';
import type { Ramp } from './physics';

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
