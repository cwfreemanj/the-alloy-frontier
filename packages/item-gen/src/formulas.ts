/**
 * Provisional balance formulas (GDD 4.11, 4.12). These are prototype equations,
 * not permanent balancing commitments. All functions are total: non-finite or
 * negative inputs are sanitised so extreme values can never overflow or produce NaN.
 */
import type { ForgeMode, Specialization, TemperStrategy, WeaponStats } from './types';

export const GENERATOR_VERSION = 'itemgen-0.1';
export const BALANCE_VERSION = 'balance-0.1';

/** Software-level numeric protections (GDD 4.6): overflow guards, not design caps. */
export const LIMITS = {
  maxMastery: 1_000_000,
  maxBufferQuantity: 9_999,
  maxStat: 1_000_000_000,
};

export function sanitize(x: number, max: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return 0;
  return Math.min(x, max);
}

export function clamp01(x: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** SmithFactor = 1 + 0.60 × ln(1 + Mastery / 20) */
export function smithFactor(mastery: number): number {
  return 1 + 0.6 * Math.log1p(sanitize(mastery, LIMITS.maxMastery) / 20);
}

/** BufferFactor = 1 + 0.04 × ln(1 + BufferQuantity / StandardBatch) */
export function bufferFactor(quantity: number, standardBatch: number): number {
  const batch = typeof standardBatch === 'number' && standardBatch > 0 && Number.isFinite(standardBatch) ? standardBatch : 1;
  return 1 + 0.04 * Math.log1p(sanitize(quantity, LIMITS.maxBufferQuantity) / batch);
}

/** PROTOTYPE DECISION: MaterialFactor = 0.8 + 0.4 × quality (quality 0.5 -> 1.0). */
export function materialFactor(quality: number): number {
  return 0.8 + 0.4 * clamp01(quality);
}

/**
 * PROTOTYPE DECISION: Quick Forge, merchant and quest items use ForgeFactor 1.0 (predictable).
 * Masterwork: ForgeFactor = 0.95 + 0.30 × puzzleScore. A poor result is a mild
 * tradeoff, never destruction of materials (GDD 4.13).
 */
export function forgeFactor(mode: ForgeMode | 'merchant' | 'quest', score: number): number {
  if (mode !== 'masterwork') return 1;
  return 0.95 + 0.3 * clamp01(score);
}

/** Damage = round(BaseMaterialDamage × SmithFactor × MaterialFactor × BufferFactor × ForgeFactor) */
export function formulaDamage(base: number, sf: number, mf: number, bf: number, ff: number): number {
  const raw = sanitize(base, LIMITS.maxStat) * sf * mf * bf * ff;
  if (!Number.isFinite(raw)) return LIMITS.maxStat;
  return Math.min(LIMITS.maxStat, Math.round(raw));
}

export interface StatModifier {
  damage?: number;
  attackSpeed?: number;
  stagger?: number;
  staminaCostMultiplier?: number;
  /** Additive. */
  critChance?: number;
}

export const SPECIALIZATIONS: Record<Specialization, { name: string; description: string; mod: StatModifier }> = {
  balanced: { name: 'Balanced', description: 'No tradeoffs. The Quick Forge default.', mod: {} },
  keen: {
    name: 'Keen Edge',
    description: '+8% damage, +3% crit, -15% stagger. Rewards precise light combos.',
    mod: { damage: 1.08, stagger: 0.85, critChance: 0.03 },
  },
  heavy: {
    name: 'Heavy Fuller',
    description: '+35% stagger, +3% damage, -8% attack speed. Breaks enemy poise and guards.',
    mod: { stagger: 1.35, damage: 1.03, attackSpeed: 0.92 },
  },
  agile: {
    name: 'Agile Balance',
    description: '+12% attack speed, -10% stamina cost, -6% damage. Sustained pressure.',
    mod: { attackSpeed: 1.12, staminaCostMultiplier: 0.9, damage: 0.94 },
  },
};

export const TEMPERS: Record<TemperStrategy, { name: string; description: string; mod: StatModifier }> = {
  none: { name: 'Standard cooling', description: 'Quick Forge default.', mod: {} },
  oil: { name: 'Oil quench', description: 'Stable and forgiving: +6% stagger.', mod: { stagger: 1.06 } },
  water: {
    name: 'Water quench',
    description: 'Performance: +6% damage, but +4% stamina cost (brittle, harder to control).',
    mod: { damage: 1.06, staminaCostMultiplier: 1.04 },
  },
  air: {
    name: 'Air cooling',
    description: 'Endurance: -6% stamina cost, -3% damage.',
    mod: { staminaCostMultiplier: 0.94, damage: 0.97 },
  },
};

export function applyModifier(stats: WeaponStats, mod: StatModifier): WeaponStats {
  return {
    damage: stats.damage * (mod.damage ?? 1),
    attackSpeed: stats.attackSpeed * (mod.attackSpeed ?? 1),
    stagger: stats.stagger * (mod.stagger ?? 1),
    staminaCostMultiplier: stats.staminaCostMultiplier * (mod.staminaCostMultiplier ?? 1),
    critChance: stats.critChance + (mod.critChance ?? 0),
  };
}
