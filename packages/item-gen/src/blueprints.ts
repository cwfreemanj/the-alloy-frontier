import type { ForgeMode, MaterialId, Specialization, WeaponFamily } from './types';

export interface MaterialRequirement {
  materialId: MaterialId;
  quantity: number;
}

/** WeaponDefinition + CraftingRecipe (GDD 6.3), merged for the slice. */
export interface BlueprintDefinition {
  id: string;
  name: string;
  family: WeaponFamily;
  tier: string;
  description: string;
  baseDamage: number;
  baseAttackSpeed: number;
  baseStagger: number;
  baseStaminaMultiplier: number;
  /** Materials consumed (primary + secondary + catalyst). */
  materials: MaterialRequirement[];
  buffer: { materialId: MaterialId; min: number; standardBatch: number };
  masteryRequirement: number;
  craftable: boolean;
  modes: ForgeMode[];
  allowedSpecializations: Specialization[];
  potentialImbuements: string[];
  /** Base blacksmith XP awarded by mode. */
  masteryXp: { quick: number; masterwork: number };
  visual: { blade: string; edge: string; guard: string; grip: string; length: number; glow?: string };
}

const ALL_SPECS: Specialization[] = ['balanced', 'keen', 'heavy', 'agile'];

export const BLUEPRINTS: Record<string, BlueprintDefinition> = {
  worn_longsword: {
    id: 'worn_longsword',
    name: 'Worn Longsword',
    family: 'longsword',
    tier: 'Scrap iron',
    description: 'A pitted training blade from the Emberhold rack.',
    baseDamage: 14,
    baseAttackSpeed: 1,
    baseStagger: 16,
    baseStaminaMultiplier: 1,
    materials: [],
    buffer: { materialId: 'binding_flux', min: 0, standardBatch: 2 },
    masteryRequirement: 0,
    craftable: false,
    modes: [],
    allowedSpecializations: ['balanced'],
    potentialImbuements: [],
    masteryXp: { quick: 0, masterwork: 0 },
    visual: { blade: '#6d6a66', edge: '#8d8984', guard: '#4b3b2c', grip: '#3a2a1e', length: 1.0 },
  },
  merchant_steel_longsword: {
    id: 'merchant_steel_longsword',
    name: 'Shop Steel Longsword',
    family: 'longsword',
    tier: 'Basic steel',
    description: 'Serviceable merchant stock. Fixed quality, no customisation (GDD 4.5).',
    baseDamage: 20,
    baseAttackSpeed: 1,
    baseStagger: 20,
    baseStaminaMultiplier: 1,
    materials: [],
    buffer: { materialId: 'binding_flux', min: 0, standardBatch: 2 },
    masteryRequirement: 0,
    craftable: false,
    modes: [],
    allowedSpecializations: ['balanced'],
    potentialImbuements: [],
    masteryXp: { quick: 0, masterwork: 0 },
    visual: { blade: '#9aa1a8', edge: '#c9cfd4', guard: '#5a5550', grip: '#2f2620', length: 1.05 },
  },
  iron_longsword: {
    id: 'iron_longsword',
    name: 'Iron Longsword',
    family: 'longsword',
    tier: 'Basic steel',
    description: 'The Emberhold standard pattern. Same basic steel and base damage as merchant stock.',
    baseDamage: 20,
    baseAttackSpeed: 1,
    baseStagger: 20,
    baseStaminaMultiplier: 1,
    materials: [
      { materialId: 'iron_ore', quantity: 3 },
      { materialId: 'ironwood', quantity: 1 },
    ],
    buffer: { materialId: 'binding_flux', min: 2, standardBatch: 2 },
    masteryRequirement: 0,
    craftable: true,
    modes: ['quick', 'masterwork'],
    allowedSpecializations: ALL_SPECS,
    potentialImbuements: [],
    masteryXp: { quick: 30, masterwork: 55 },
    visual: { blade: '#8f969c', edge: '#d7dde2', guard: '#6b4a2e', grip: '#3b2a1d', length: 1.05 },
  },
  tempered_longsword: {
    id: 'tempered_longsword',
    name: 'Tempered Steel Longsword',
    family: 'longsword',
    tier: 'Tempered steel',
    description: 'Heavier, dependable defensive blade. Needs more iron and flux.',
    baseDamage: 23,
    baseAttackSpeed: 0.95,
    baseStagger: 26,
    baseStaminaMultiplier: 1.05,
    materials: [
      { materialId: 'iron_ore', quantity: 5 },
      { materialId: 'ironwood', quantity: 1 },
    ],
    buffer: { materialId: 'binding_flux', min: 4, standardBatch: 4 },
    masteryRequirement: 8,
    craftable: true,
    modes: ['quick', 'masterwork'],
    allowedSpecializations: ALL_SPECS,
    potentialImbuements: [],
    masteryXp: { quick: 40, masterwork: 70 },
    visual: { blade: '#7c858d', edge: '#c3ccd3', guard: '#3d3d42', grip: '#2a2420', length: 1.12 },
  },
  ironglass_longsword: {
    id: 'ironglass_longsword',
    name: 'Ironglass Longsword',
    family: 'longsword',
    tier: 'Ironglass alloy',
    description: 'Lightweight fantasy-tech alloy. Conductive shards may awaken Storm Arc in a skilled forge.',
    baseDamage: 21,
    baseAttackSpeed: 1.1,
    baseStagger: 18,
    baseStaminaMultiplier: 0.9,
    materials: [
      { materialId: 'iron_ore', quantity: 2 },
      { materialId: 'ironglass', quantity: 3 },
      { materialId: 'ironwood', quantity: 1 },
    ],
    buffer: { materialId: 'binding_flux', min: 3, standardBatch: 3 },
    masteryRequirement: 5,
    craftable: true,
    modes: ['quick', 'masterwork'],
    allowedSpecializations: ALL_SPECS,
    potentialImbuements: ['storm_arc'],
    masteryXp: { quick: 40, masterwork: 75 },
    visual: { blade: '#5f7f8c', edge: '#9ff3ff', guard: '#30353b', grip: '#22262b', length: 1.08, glow: '#3fe0ff' },
  },
};

export function getBlueprint(id: string): BlueprintDefinition | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BLUEPRINTS, id) ? BLUEPRINTS[id] : undefined;
}

export const CRAFTABLE_BLUEPRINTS: BlueprintDefinition[] = Object.values(BLUEPRINTS).filter((b) => b.craftable);
