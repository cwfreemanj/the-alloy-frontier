// Types for the Model Workshop equipment generator (plain JS shared with the workshop artifact).
import type { Recipe } from './core.js';

export interface EquipmentMeta {
  type: string;
  slot: string;
  space: 'item' | 'body';
  shape: string;
  rarity: string;
  mount?: { mode: string; bone?: string; point?: number[] };
  grip?: number[];
  tip?: number[];
  bones?: string[];
}
export interface EquipmentRecipe extends Recipe {
  meta: EquipmentMeta;
}
export const GENERATOR_VERSION: number;
export function generateEquipment(type: string, spec?: { seed?: string; rarity?: string; blend?: string; shape?: string; size?: number; profile?: number }): EquipmentRecipe;
