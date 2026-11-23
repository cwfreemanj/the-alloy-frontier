// Types for the shared atmosphere kit (plain JS shared with the workshop artifact).
import type * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export interface TimeOfDay {
  label: string;
  sun: { el: number; az: number; color: string; intensity: number };
  hemi: [string, string, number];
  zenith: string;
  horizon: string;
  fog: [string, number];
  exposure: number;
  bloom: [number, number, number];
  glow: number;
  night: number;
  grade: { warmth: number; saturation: number; contrast: number; vignette: number };
}
export type TimeKey = 'morning' | 'day' | 'golden' | 'dusk' | 'night';
export const TIMES: Record<TimeKey, TimeOfDay>;
export function sunDirection(t: TimeOfDay, out?: THREE.Vector3): THREE.Vector3;

export type SkyUniforms = Record<'uZenith' | 'uHorizon' | 'uSunColor', { value: THREE.Color }> &
  Record<'uSunDir', { value: THREE.Vector3 }> &
  Record<'uNight' | 'uTime', { value: number }>;
export function createSky(radius?: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial & { uniforms: SkyUniforms }>;

export type ParticlePreset = 'embers' | 'sparks' | 'smoke' | 'dust' | 'wisps' | 'motes';
export interface Emitter {
  x: number;
  y: number;
  z: number;
  count?: number;
  radius?: number;
  height?: number;
}
export class ParticleField {
  constructor(preset: ParticlePreset, emitters: Emitter[], opts?: { density?: number; pixelRatio?: number });
  points: THREE.Points;
  update(t: number): void;
  dispose(): void;
}

export interface GrassSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  h?: number;
  color: string;
}
export function createGrass(spots: GrassSpot[], timeUniform: { value: number }): THREE.InstancedMesh;

export interface Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  setSize(w: number, h: number): void;
  render(t: number): void;
  dispose(): void;
}
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts?: { samples?: number }): Post;
