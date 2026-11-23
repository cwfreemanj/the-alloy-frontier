// Types for the Model Workshop core (plain JS shared with the workshop artifact).
import type * as THREE from 'three';

export interface RecipePart {
  id: string;
  name: string;
  shape: string;
  pos: number[];
  rot: number[];
  scale: number[];
  mat: string;
  tint: string | null;
  params: Record<string, number>;
}
export interface Recipe {
  format: 'alloy-recipe';
  version: number;
  id: string;
  name: string;
  category: string;
  notes?: string;
  tags?: string[];
  parts: RecipePart[];
}
export type Theme = Record<string, { color: string; rough?: number; metal?: number; emissive?: string; glow?: number; tex?: string }>;
export type TextureFactory = ((key: string) => THREE.Texture) & { clear(): void };

export const DEFAULT_MATERIALS: Theme;
export function rng(seed: number): () => number;
export function setTextureFactory(f: TextureFactory | null): void;
export function makeCanvasTextureFactory(doc: Document, seedOf?: (key: string) => number): TextureFactory;
export class MaterialBank {
  constructor(theme: Theme);
  get(key: string, tint?: string | null): THREE.MeshStandardMaterial;
}
export function buildModel(r: Recipe, bank: MaterialBank): THREE.Group;
export function optimizeForGame(group: THREE.Group): THREE.Group;
export function starterLibrary(): Recipe[];
