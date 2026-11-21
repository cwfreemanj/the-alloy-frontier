/**
 * Deterministic procedural equipment generation (GDD 2.6, 4.11, 6.12; AF-004).
 *
 * Same seed + inputs + GENERATOR_VERSION => identical ItemInstance (apart from the
 * caller-supplied itemId/createdAt, which are also inputs). Final stats are
 * snapshotted into `result` so later balance changes never silently alter items.
 */
import { getBlueprint } from './blueprints';
import {
  BALANCE_VERSION,
  GENERATOR_VERSION,
  LIMITS,
  SPECIALIZATIONS,
  TEMPERS,
  applyModifier,
  bufferFactor,
  clamp01,
  forgeFactor,
  formulaDamage,
  materialFactor,
  sanitize,
  smithFactor,
  type StatModifier,
} from './formulas';
import { MATERIALS } from './materials';
import { RARITY_AFFIX_COUNT, equipmentRating, minRarity, rarityFromScore } from './rating';
import { Rng, hashHex, stableStringify } from './rng';
import type {
  Affix,
  ConsumedMaterial,
  ForgeMode,
  ForgeStageResult,
  ItemInstance,
  ItemSource,
  Rarity,
  Specialization,
  TemperStrategy,
  WeaponStats,
} from './types';

export interface ImbuementDefinition {
  id: string;
  name: string;
  description: string;
  /** Active abilities occupy a hotkey slot (GDD 4.15). */
  active: boolean;
  staminaCost: number;
  cooldown: number;
  radius: number;
  damageMultiplier: number;
  staggerMultiplier: number;
}

export const IMBUEMENTS: Record<string, ImbuementDefinition> = {
  storm_arc: {
    id: 'storm_arc',
    name: 'Storm Arc',
    description: 'Material-born ability: discharge the ironglass edge in a ring of lightning around you.',
    active: true,
    staminaCost: 5,
    cooldown: 12,
    radius: 4.5,
    damageMultiplier: 1.3,
    staggerMultiplier: 2.2,
  },
};

interface AffixDefinition extends Affix {
  mod: StatModifier;
  mythicOnly?: boolean;
}

export const AFFIXES: AffixDefinition[] = [
  { id: 'honed', name: 'Honed', description: '+5% damage', mod: { damage: 1.05 } },
  { id: 'swift', name: 'Swift', description: '+5% attack speed', mod: { attackSpeed: 1.05 } },
  { id: 'tempered_spine', name: 'Tempered Spine', description: '+12% stagger', mod: { stagger: 1.12 } },
  { id: 'featherbalanced', name: 'Featherbalanced', description: '-8% stamina cost', mod: { staminaCostMultiplier: 0.92 } },
  { id: 'keen_eye', name: 'Keen Eye', description: '+4% critical chance', mod: { critChance: 0.04 } },
  {
    id: 'maker_resonance',
    name: "Maker's Resonance",
    description: '+10% damage and stagger',
    mod: { damage: 1.1, stagger: 1.1 },
    mythicOnly: true,
  },
];

export interface GenerationInput {
  itemId: string;
  seed: string;
  blueprintId: string;
  source: ItemSource;
  mode: ForgeMode | 'merchant' | 'quest';
  materials: ConsumedMaterial[];
  bufferQuantity: number;
  maker: { id: string; name: string; mastery: number };
  /** Masterwork puzzle score 0..1 (server must derive it from evidence, never trust a client value). */
  forgeScore?: number;
  specialization?: Specialization;
  temper?: TemperStrategy;
  stages?: ForgeStageResult[];
  createdAt: number;
  /** Used for merchant/quest stock that consumes no lots. */
  fixedMaterialQuality?: number;
}

function weightedQuality(mats: ConsumedMaterial[], filter: (m: ConsumedMaterial) => boolean): number | undefined {
  let q = 0;
  let n = 0;
  for (const m of mats) {
    if (!filter(m)) continue;
    const qty = sanitize(m.quantity, 1e9);
    q += clamp01(m.quality) * qty;
    n += qty;
  }
  return n > 0 ? q / n : undefined;
}

const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

function finalizeStats(s: WeaponStats): WeaponStats {
  return {
    damage: Math.max(1, Math.min(LIMITS.maxStat, Math.round(s.damage))),
    attackSpeed: round(Math.max(0.25, Math.min(4, s.attackSpeed)), 3),
    stagger: round(Math.max(0, Math.min(LIMITS.maxStat, s.stagger)), 1),
    staminaCostMultiplier: round(Math.max(0.1, Math.min(4, s.staminaCostMultiplier)), 3),
    critChance: round(clamp01(s.critChance), 3),
  };
}

export function computeIntegrity(item: Omit<ItemInstance, 'integrity' | 'history' | 'customName'>): string {
  const { itemId, seed, generatorVersion, balanceVersion, blueprintId, materials, buffer, forge, result, createdAt, source } =
    item;
  return hashHex(
    stableStringify({ itemId, seed, generatorVersion, balanceVersion, blueprintId, materials, buffer, forge, result, createdAt, source }),
  );
}

export function verifyIntegrity(item: ItemInstance): boolean {
  return computeIntegrity(item) === item.integrity;
}

export class GenerationError extends Error {}

export function generateItem(input: GenerationInput): ItemInstance {
  const bp = getBlueprint(input.blueprintId);
  if (!bp) throw new GenerationError(`Unknown blueprint ${input.blueprintId}`);
  const rng = new Rng(`${input.seed}:${GENERATOR_VERSION}`);

  const mode = input.mode;
  const mastery = sanitize(input.maker.mastery, LIMITS.maxMastery);
  const specialization: Specialization = mode === 'masterwork' ? (input.specialization ?? 'balanced') : 'balanced';
  const temper: TemperStrategy = mode === 'masterwork' ? (input.temper ?? 'oil') : 'none';
  const score = mode === 'masterwork' ? clamp01(input.forgeScore ?? 0) : 0.5;

  const nonBuffer = (m: ConsumedMaterial) => MATERIALS[m.materialId]?.kind !== 'buffer';
  const materialQuality = clamp01(weightedQuality(input.materials, nonBuffer) ?? input.fixedMaterialQuality ?? 0.5);
  const catalystQuality =
    weightedQuality(input.materials, (m) => MATERIALS[m.materialId]?.kind === 'catalyst') ?? materialQuality;

  const sf = smithFactor(mastery);
  const mf = materialFactor(materialQuality);
  const bufferQty = sanitize(Math.floor(input.bufferQuantity), LIMITS.maxBufferQuantity);
  const bf = bufferFactor(bufferQty, bp.buffer.standardBatch);
  const ff = forgeFactor(mode, score);
  const fDamage = formulaDamage(bp.baseDamage, sf, mf, bf, ff);

  let stats: WeaponStats = {
    damage: fDamage,
    attackSpeed: bp.baseAttackSpeed,
    // PROTOTYPE DECISION: craftsmanship also improves balance/poise damage, at half the smith rate.
    stagger: bp.baseStagger * (1 + (sf - 1) * 0.5) * mf * ff,
    staminaCostMultiplier: bp.baseStaminaMultiplier,
    critChance: 0.05,
  };
  stats = applyModifier(stats, SPECIALIZATIONS[specialization].mod);
  stats = applyModifier(stats, TEMPERS[temper].mod);

  // Rarity: the exceptional nature of the roll (GDD 2.6), separate from rating.
  const roll = rng.next();
  const masteryTerm = Math.min(1, (sf - 1) / 1.2);
  let rarity: Rarity;
  if (mode === 'masterwork') {
    rarity = rarityFromScore(0.45 * score + 0.2 * materialQuality + 0.2 * masteryTerm + 0.15 * roll);
  } else if (mode === 'quick') {
    // Quick Forge: limited traits/customisation (GDD 4.4) -> capped at Uncommon.
    rarity = minRarity(rarityFromScore(0.25 + 0.25 * materialQuality + 0.15 * masteryTerm + 0.15 * roll), 'uncommon');
  } else {
    rarity = 'common';
  }

  const pool = AFFIXES.filter((a) => !a.mythicOnly || rarity === 'mythic');
  const affixDefs = rng.shuffle(pool).slice(0, RARITY_AFFIX_COUNT[rarity]);
  if (rarity === 'mythic' && !affixDefs.some((a) => a.id === 'maker_resonance')) {
    affixDefs[affixDefs.length - 1] = AFFIXES.find((a) => a.id === 'maker_resonance')!;
  }
  for (const a of affixDefs) stats = applyModifier(stats, a.mod);
  const finalStats = finalizeStats(stats);

  // Material-born imbuement (GDD 4.15): needs a masterwork forge and conductive catalyst.
  const stages: ForgeStageResult[] = [...(input.stages ?? [])];
  const imbuements: string[] = [];
  for (const imb of bp.potentialImbuements) {
    const awaken = mode === 'masterwork' ? score * 0.7 + clamp01(catalystQuality) * 0.3 : 0;
    if (mode === 'masterwork' && awaken >= 0.6) {
      imbuements.push(imb);
      stages.push({
        stage: 'finishing',
        label: 'Awakening',
        quality: round(awaken, 3),
        detail: `${IMBUEMENTS[imb]?.name ?? imb} awakened (${Math.round(awaken * 100)}% resonance, needs 60%).`,
      });
    } else if (mode === 'masterwork') {
      stages.push({
        stage: 'finishing',
        label: 'Awakening',
        quality: round(awaken, 3),
        detail: `${IMBUEMENTS[imb]?.name ?? imb} stayed dormant (${Math.round(awaken * 100)}% resonance, needs 60%).`,
      });
    }
  }

  const affixes: Affix[] = affixDefs.map(({ id, name, description }) => ({ id, name, description }));
  const rating = equipmentRating(finalStats, imbuements);

  const base: Omit<ItemInstance, 'integrity' | 'history'> = {
    schemaVersion: 1,
    itemId: input.itemId,
    seed: input.seed,
    generatorVersion: GENERATOR_VERSION,
    balanceVersion: BALANCE_VERSION,
    blueprintId: bp.id,
    family: bp.family,
    displayName: bp.name,
    source: input.source,
    materials: input.materials.map((m) => ({ ...m })),
    materialQuality: round(materialQuality, 4),
    buffer: { materialId: bp.buffer.materialId, quantity: bufferQty, standardBatch: bp.buffer.standardBatch },
    potentialImbuements: [...bp.potentialImbuements],
    forge: {
      mode,
      makerId: input.maker.id,
      makerName: input.maker.name,
      mastery,
      smithFactor: round(sf, 4),
      materialFactor: round(mf, 4),
      bufferFactor: round(bf, 4),
      forgeFactor: round(ff, 4),
      forgeScore: round(score, 4),
      specialization,
      temper,
      formulaDamage: fDamage,
      stages,
    },
    result: { ...finalStats, rating, rarity, affixes, imbuements },
    createdAt: input.createdAt,
  };
  return {
    ...base,
    history: [{ at: input.createdAt, event: `Created by ${input.maker.name} (${input.source})` }],
    integrity: computeIntegrity(base),
  };
}

export function itemDisplayName(item: ItemInstance): string {
  return item.customName ?? item.displayName;
}

/** Basic structural validation for loaded/received items. */
export function validateItem(item: unknown): item is ItemInstance {
  if (!item || typeof item !== 'object') return false;
  const it = item as ItemInstance;
  if (it.schemaVersion !== 1 || typeof it.itemId !== 'string' || !getBlueprint(it.blueprintId)) return false;
  const r = it.result;
  if (!r) return false;
  for (const k of ['damage', 'attackSpeed', 'stagger', 'staminaCostMultiplier', 'critChance', 'rating'] as const) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k]) || r[k] < 0) return false;
  }
  return verifyIntegrity(it);
}
