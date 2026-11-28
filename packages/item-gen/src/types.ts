/**
 * JSON-compatible gameplay data contracts (GDD 6.3, 6.7, 6.12).
 * No Three.js or DOM references may appear in these types.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export type MaterialId = 'iron_ore' | 'ironwood' | 'ironglass' | 'binding_flux' | 'emberleaf' | 'healing_salve' | 'stamina_tonic';
export type MaterialKind = 'primary' | 'secondary' | 'catalyst' | 'buffer' | 'herb' | 'consumable';

export interface MaterialDefinition {
  id: MaterialId;
  name: string;
  kind: MaterialKind;
  description: string;
  /** Names of the procedural traits a lot of this material may carry. */
  traitNames: string[];
}

/** A stack of one material sharing a single quality/origin (GDD 6.7 MaterialLot). */
export interface MaterialLot {
  lotId: string;
  materialId: MaterialId;
  quantity: number;
  /** Normalised quality 0..1 (e.g. ore purity). */
  quality: number;
  /** Provenance, e.g. a resource node ID or "merchant:bram". */
  origin: string;
  traits?: Record<string, number>;
}

/** Material actually drawn from a specific lot during a transaction. */
export interface ConsumedMaterial {
  lotId: string;
  materialId: MaterialId;
  quantity: number;
  quality: number;
}

export type WeaponFamily = 'longsword' | 'shortsword' | 'greatsword' | 'axe' | 'mace' | 'dagger' | 'staff' | 'bow';
/** What kind of damage a weapon deals (see packages/game-rules/src/damage.ts). */
export type DamageType = 'slash' | 'pierce' | 'blunt' | 'magic';
/** Armor and shields: they give defense, not damage (docs/equipment-contract.md). */
export type ArmorFamily = 'shield' | 'helmet' | 'chest' | 'legs';
/** Every kind of item. Gathering tools and armor are not weapons (no weapon mastery). */
export type ItemFamily = WeaponFamily | ArmorFamily | 'tool';

/** Equipment slots on the character (see docs/equipment-contract.md). 'ring' fits either ring slot. */
export type EquipSlotKind = 'weapon' | 'offhand' | 'head' | 'shoulders' | 'neck' | 'cape' | 'chest' | 'belt' | 'hands' | 'legs' | 'feet' | 'ring' | 'tool';
export type ToolKind = 'mining' | 'woodcutting';

/** Where an item goes when equipped. Lives on the blueprint (items are sealed by integrity). */
export interface EquipInfo {
  slot: EquipSlotKind;
  /** Weapons only. 2 = two-handed: also occupies the off-hand. Default 1. */
  hands?: 1 | 2;
  /** Tools only: the gathering it allows, and how good it is (1 = basic). */
  tool?: { kind: ToolKind; power: number };
}

/** Flat bonuses an item gives while equipped. Attribute keys: strength, dexterity, vitality, endurance. */
export interface GearBonuses {
  maxHealth?: number;
  maxStamina?: number;
  attributes?: Record<string, number>;
}
export type ForgeMode = 'quick' | 'masterwork';
export type Specialization = 'balanced' | 'keen' | 'heavy' | 'agile';
export type TemperStrategy = 'none' | 'oil' | 'water' | 'air';
export type HeatLevel = 'dull' | 'cherry' | 'bright';
export type ItemSource = 'merchant' | 'quick_forge' | 'masterwork_forge' | 'quest' | 'drop';

export interface WeaponStats {
  /** Damage per standard hit before attack multipliers. */
  damage: number;
  /** Attack speed multiplier (1 = standard). */
  attackSpeed: number;
  /** Stagger (poise damage) per standard hit. */
  stagger: number;
  /** Multiplier applied to weapon action stamina costs (lower is better). */
  staminaCostMultiplier: number;
  /** Probability 0..1 of a critical hit. */
  critChance: number;
}

export interface Affix {
  id: string;
  name: string;
  description: string;
}

export interface ForgeStageResult {
  stage: 'heating' | 'hammering' | 'tempering' | 'finishing';
  label: string;
  /** Quality signal 0..1 for the stage, if applicable. */
  quality?: number;
  detail: string;
}

export interface ForgeRecord {
  mode: ForgeMode | 'merchant' | 'quest';
  makerId: string;
  makerName: string;
  /** Craftsman mastery snapshot at the moment of creation. */
  mastery: number;
  smithFactor: number;
  materialFactor: number;
  bufferFactor: number;
  forgeFactor: number;
  /** 0..1 forging quality. Quick Forge records 0.5 (predictable, unremarkable). */
  forgeScore: number;
  specialization: Specialization;
  temper: TemperStrategy;
  /** Damage straight from the GDD 4.11 formula before specialization/affixes. */
  formulaDamage: number;
  stages: ForgeStageResult[];
  /** The maker's perks that shaped this item (proficiency tree). Only present when there were some. */
  perks?: string[];
}

export interface ItemResult extends WeaponStats {
  rating: number;
  rarity: Rarity;
  affixes: Affix[];
  /** Imbuements the item actually has (active abilities / passives). */
  imbuements: string[];
  /** Armor: flat defense while equipped (all equipped defense adds up). */
  defense?: number;
  /** Flat bonuses while equipped. */
  bonuses?: GearBonuses;
}

export interface ItemHistoryEntry {
  at: number;
  event: string;
}

/** A unique generated equipment instance (GDD 6.3 ItemInstance, 6.12). */
export interface ItemInstance {
  schemaVersion: 1;
  itemId: string;
  seed: string;
  generatorVersion: string;
  balanceVersion: string;
  blueprintId: string;
  family: ItemFamily;
  displayName: string;
  customName?: string;
  source: ItemSource;
  materials: ConsumedMaterial[];
  /** Weighted average quality of consumed non-buffer materials, 0..1. */
  materialQuality: number;
  buffer: { materialId: MaterialId; quantity: number; standardBatch: number };
  /** Imbuements the blueprint/material combination could awaken. */
  potentialImbuements: string[];
  forge: ForgeRecord;
  /** Final-stat snapshot. Never recomputed after creation. */
  result: ItemResult;
  createdAt: number;
  history: ItemHistoryEntry[];
  /**
   * A copy of the blueprint it was forged from, when that was a found (generated) blueprint
   * (docs/blueprint-contract.md). The item then always knows its slot, family and look. Covered by integrity.
   */
  blueprint?: import('./blueprints').BlueprintDefinition;
  /** Hash of the immutable creation snapshot, used to detect tampering/corruption. */
  integrity: string;
}
