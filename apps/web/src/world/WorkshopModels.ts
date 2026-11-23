/**
 * Model Workshop recipes as game-ready meshes: each model is built once from its recipe, merged per
 * material (one draw call per material) and shared by every instance in the world.
 */
import * as THREE from 'three';
import { DEFAULT_MATERIALS, MaterialBank, buildModel, makeCanvasTextureFactory, optimizeForGame, setTextureFactory, starterLibrary, type Recipe } from './workshop/core.js';
import pumphouse from './workshop/pumphouse.json';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}
export interface GameModel {
  id: string;
  parts: ModelPart[];
  /** Half the diagonal of the XZ footprint, in metres. */
  radius: number;
  height: number;
}

let bank: MaterialBank | null = null;
let recipes: Map<string, Recipe> | null = null;
const cache = new Map<string, GameModel | null>();
let glow = 1;

function init(): void {
  if (bank) return;
  if (typeof document !== 'undefined') setTextureFactory(makeCanvasTextureFactory(document));
  bank = new MaterialBank(DEFAULT_MATERIALS);
  recipes = new Map(starterLibrary().map((r) => [r.id, r]));
  // The team's saved edit of the pumphouse (Model Workshop shared library).
  recipes.set('steam_pumphouse', pumphouse as unknown as Recipe);
}

/** The game-ready model for a workshop recipe id (null if unknown). */
export function gameModel(id: string): GameModel | null {
  if (cache.has(id)) return cache.get(id)!;
  init();
  const r = recipes!.get(id);
  if (!r) {
    cache.set(id, null);
    return null;
  }
  const opt = optimizeForGame(buildModel(r, bank!));
  const box = new THREE.Box3().setFromObject(opt);
  const size = box.getSize(new THREE.Vector3());
  const parts = (opt.children as THREE.Mesh[]).map((m) => {
    const material = m.material as THREE.MeshStandardMaterial;
    if (material.emissiveIntensity > 0 && material.emissive.getHex() !== 0) material.userData.baseGlow ??= material.emissiveIntensity;
    material.emissiveIntensity = (material.userData.baseGlow ?? material.emissiveIntensity) * (material.userData.baseGlow !== undefined ? glow : 1);
    return { geometry: m.geometry, material };
  });
  const model = { id, parts, radius: Math.hypot(size.x, size.z) / 2, height: size.y };
  cache.set(id, model);
  return model;
}

/** Scale every shared emissive material (lamps, crystals, ore veins) for the time of day. */
export function setModelGlow(k: number): void {
  glow = k;
  for (const m of cache.values())
    for (const p of m?.parts ?? []) if (p.material.userData.baseGlow !== undefined) p.material.emissiveIntensity = p.material.userData.baseGlow * k;
}

export function modelGlow(): number {
  return glow;
}

/** A shared material from the workshop theme (e.g. the grass detail map for the terrain). */
export function themeMaterial(key: string): THREE.MeshStandardMaterial {
  init();
  return bank!.get(key);
}
