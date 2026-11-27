import { LIMITS } from './formulas';
import type { GearBonuses, Rarity, WeaponStats } from './types';
import { RARITY_ORDER } from './types';

/** Rating value an imbuement contributes. */
export const IMBUEMENT_RATING: Record<string, number> = { storm_arc: 80 };

/**
 * PROPOSED equipment rating (GDD 2.6, 4.6): derived from actual combat value
 * (damage throughput, stagger, stamina efficiency, crit, abilities) rather than
 * inherited from the rarity label or material tier.
 */
export function equipmentRating(stats: WeaponStats, imbuements: readonly string[]): number {
  const dps = stats.damage * stats.attackSpeed * (1 + stats.critChance * 0.5);
  const efficiency = (1 - stats.staminaCostMultiplier) * 400;
  const abilities = imbuements.reduce((s, id) => s + (IMBUEMENT_RATING[id] ?? 40), 0);
  const raw = dps * 10 + stats.stagger * 2 + efficiency + abilities;
  if (!Number.isFinite(raw)) return LIMITS.maxStat;
  return Math.max(1, Math.min(LIMITS.maxStat, Math.round(raw)));
}

/** PROPOSED rating of armor and shields: their defense plus what their bonuses are worth. */
export function armorRating(defense: number, bonuses: GearBonuses = {}): number {
  const attrs = Object.values(bonuses.attributes ?? {}).reduce((a, b) => a + b, 0);
  const raw = defense * 12 + (bonuses.maxHealth ?? 0) * 2 + (bonuses.maxStamina ?? 0) * 2 + attrs * 25;
  if (!Number.isFinite(raw)) return LIMITS.maxStat;
  return Math.max(1, Math.min(LIMITS.maxStat, Math.round(raw)));
}

/** PROPOSED rarity thresholds on a 0..1 roll-quality score. */
export const RARITY_THRESHOLDS: Array<[Rarity, number]> = [
  ['mythic', 0.95],
  ['legendary', 0.86],
  ['epic', 0.74],
  ['rare', 0.58],
  ['uncommon', 0.38],
  ['common', 0],
];

export function rarityFromScore(score: number): Rarity {
  for (const [r, t] of RARITY_THRESHOLDS) if (score >= t) return r;
  return 'common';
}

export function rarityIndex(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

export function minRarity(a: Rarity, b: Rarity): Rarity {
  return rarityIndex(a) <= rarityIndex(b) ? a : b;
}

export const RARITY_AFFIX_COUNT: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};
