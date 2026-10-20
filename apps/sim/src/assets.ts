import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

type MapKind = 'diff' | 'nor_gl' | 'rough';

const BASE = '/assets';

/**
 * Loads the CC0 texture sets and the sky, and works out where the sun is in the
 * sky image so the directional light and the visible sun agree.
 */
export class Assets {
  private textures = new Map<string, TexSet>();
  private loader = new THREE.TextureLoader();
  private maxAniso = 4;

  sky: THREE.Texture | null = null;
  sunDir = new THREE.Vector3(0.4, 0.6, 0.4).normalize();
  ready = false;

  async load(renderer: THREE.WebGLRenderer): Promise<void> {
    this.maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

    const hdr = new HDRLoader();
    const sky = await hdr.loadAsync(`${BASE}/hdri/sky.hdr`);
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.colorSpace = THREE.LinearSRGBColorSpace;
    this.sky = sky;

    const image = sky.image as { data?: Uint16Array; width: number; height: number };
    if (image?.data) {
      const found = findBrightest(image.data, image.width, image.height);
      if (found) this.sunDir.copy(found);
    }

    // warm the shadow side a touch; the env map handles the rest
    this.ready = true;
  }

  async tex(
    id: string,
    repeatX: number,
    repeatY = repeatX,
    rotation = 0,
  ): Promise<TexSet> {
    const key = `${id}:${repeatX}:${repeatY}:${rotation}`;
    const hit = this.textures.get(key);
    if (hit) return hit;

    const [map, normalMap, roughnessMap] = await Promise.all([
      this.loadMap(id, 'diff', repeatX, repeatY, rotation),
      this.loadMap(id, 'nor_gl', repeatX, repeatY, rotation),
      this.loadMap(id, 'rough', repeatX, repeatY, rotation),
    ]);

    map.colorSpace = THREE.SRGBColorSpace;
    const set = { map, normalMap, roughnessMap };
    this.textures.set(key, set);
    return set;
  }

  private async loadMap(
    id: string,
    kind: MapKind,
    repeatX: number,
    repeatY: number,
    rotation: number,
  ): Promise<THREE.Texture> {
    const tex = await this.loader.loadAsync(`${BASE}/tex/${id}_${kind}.jpg`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = this.maxAniso;
    if (rotation !== 0) {
      tex.center.set(0.5, 0.5);
      tex.rotation = rotation;
    }
    if (kind !== 'diff') tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }
}

/**
 * Locate the sun in an equirectangular HDR: the centroid of everything close to
 * the brightest pixel. Half-float bit patterns are monotonic for positive values,
 * so raw comparison is enough.
 */
function findBrightest(data: Uint16Array, width: number, height: number): THREE.Vector3 | null {
  const px = 4;
  let max = 0;
  for (let i = 0; i < data.length; i += px * 7) {
    const r = data[i] ?? 0;
    if (r > max) max = r;
  }
  if (max === 0) return null;

  const threshold = max * 0.85;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;

  for (let y = 0; y < height; y += 2) {
    const v = (y + 0.5) / height;
    const lat = (v - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * px;
      const r = data[i] ?? 0;
      if (r < threshold) continue;

      const u = (x + 0.5) / width;
      const lon = (u - 0.5) * Math.PI * 2;
      sx += cl * Math.cos(lon);
      sy += Math.sin(lat);
      sz += cl * Math.sin(lon);
      count++;
    }
  }

  if (!count) return null;
  const dir = new THREE.Vector3(sx / count, sy / count, sz / count);
  if (dir.lengthSq() < 1e-6) return null;
  return dir.normalize();
}
