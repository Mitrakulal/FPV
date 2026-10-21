import type * as THREE from 'three';
import type { QuadModel } from './quad';
import type { Collider, Platform, Ramp } from './physics';
import type { TrainingCourse } from './training';

export type WorldKind = 'airfield' | 'indoor';

/** Per-map colour grade. Kept in one place so map switches are instant. */
export interface WorldGrade {
  bloomThreshold: number;
  bloom: number;
  exposure: number;
  vignette: number;
  grain: number;
}

export interface World {
  kind: WorldKind;
  label: string;
  scene: THREE.Scene;
  quad: QuadModel;
  sun: THREE.DirectionalLight;
  colliders: Collider[];
  ramps: Ramp[];
  platforms: Platform[];
  dust: THREE.Points;
  puddles: THREE.Mesh[];
  spawn: { x: number; y: number; z: number };
  overview: { pos: [number, number, number]; look: [number, number, number] };
  grade: WorldGrade;
  training?: TrainingCourse;
}
