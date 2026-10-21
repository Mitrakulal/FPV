import * as THREE from 'three';

export interface PortalVisual {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  halfW: number;
  halfH: number;
  round: boolean;
  frameMat: THREE.MeshStandardMaterial;
  labelMat: THREE.MeshBasicMaterial;
  beacon: THREE.Mesh;
  beaconBaseY: number;
}

const AMBER = 0xffb15c;
const AMBER_EMISSIVE = 0xff8738;
const CYAN = 0x5ea8c4;
const CYAN_EMISSIVE = 0x256c88;
const DONE = 0x6fa88f;
const DONE_EMISSIVE = 0x2b6f5a;

/**
 * Ordered gate logic for the indoor course. Gates are passed from the front
 * face to the back face, so flying backwards or around a wall does not count.
 */
export class TrainingCourse {
  readonly portals: PortalVisual[];
  index = 0;
  complete = false;
  private prevSide: Array<number | undefined>;

  constructor(portals: PortalVisual[]) {
    this.portals = portals;
    this.prevSide = new Array(portals.length).fill(undefined) as Array<number | undefined>;
    this.applyStatus();
  }

  reset(): void {
    this.index = 0;
    this.complete = false;
    this.prevSide = new Array(this.portals.length).fill(undefined) as Array<number | undefined>;
    this.applyStatus();
  }

  get total(): number {
    return this.portals.length;
  }

  progressText(): string {
    if (this.complete) return 'COURSE COMPLETE';
    return `PORTAL ${Math.min(this.index + 1, this.total)} / ${this.total}`;
  }

  /** Returns true on the frame a portal is passed, and once on completion. */
  update(pos: THREE.Vector3, now: number): { passed: boolean; complete: boolean } {
    let passed = false;
    let finished = false;

    if (!this.complete) {
      for (let i = 0; i < this.portals.length; i++) {
        const p = this.portals[i];
        if (!p) continue;
        const relX = pos.x - p.center.x;
        const relY = pos.y - p.center.y;
        const relZ = pos.z - p.center.z;
        const side = relX * p.normal.x + relY * p.normal.y + relZ * p.normal.z;
        const u = relX * p.right.x + relY * p.right.y + relZ * p.right.z;
        const v = relX * p.up.x + relY * p.up.y + relZ * p.up.z;
        const previous = this.prevSide[i];

        if (i === this.index && previous !== undefined && previous > 0 && side <= 0) {
          const nearU = Math.abs(u) <= p.halfW * 1.18;
          const nearV = Math.abs(v) <= p.halfH * 1.18;
          const inRound = !p.round || (u / Math.max(0.01, p.halfW)) ** 2 + (v / Math.max(0.01, p.halfH)) ** 2 <= 1.3;
          if (nearU && nearV && inRound) {
            passed = true;
            this.index++;
            if (this.index >= this.portals.length) {
              this.complete = true;
              finished = true;
              this.applyStatus();
            } else {
              this.applyStatus();
            }
          }
        }

        this.prevSide[i] = side;
      }
    }

    this.animate(now);
    return { passed, complete: finished };
  }

  private applyStatus(): void {
    for (let i = 0; i < this.portals.length; i++) {
      const p = this.portals[i];
      if (!p) continue;
      if (this.complete || i < this.index) {
        p.frameMat.color.setHex(DONE);
        p.frameMat.emissive.setHex(DONE_EMISSIVE);
        p.frameMat.emissiveIntensity = 0.45;
        p.labelMat.opacity = 0.26;
        p.beacon.visible = false;
      } else if (i === this.index) {
        p.frameMat.color.setHex(AMBER);
        p.frameMat.emissive.setHex(AMBER_EMISSIVE);
        p.frameMat.emissiveIntensity = 2.6;
        p.labelMat.opacity = 1;
        p.beacon.visible = true;
      } else {
        p.frameMat.color.setHex(CYAN);
        p.frameMat.emissive.setHex(CYAN_EMISSIVE);
        p.frameMat.emissiveIntensity = 0.5;
        p.labelMat.opacity = 0.4;
        p.beacon.visible = false;
      }
    }
  }

  private animate(now: number): void {
    if (this.complete) return;
    const p = this.portals[this.index];
    if (!p) return;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0045);
    p.frameMat.emissiveIntensity = 2.1 + pulse * 1.8;
    p.beacon.visible = true;
    p.beacon.rotation.y = now * 0.0018;
    p.beacon.rotation.z = now * 0.0009;
    p.beacon.position.y = p.beaconBaseY + Math.sin(now * 0.0022) * 0.16;
  }
}
