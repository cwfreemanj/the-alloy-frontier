/**
 * Progression layers (GDD 2.2, 2.3, 4.3). Weapon mastery and blacksmith mastery are
 * deliberately separate systems and must never be conflated.
 */
import type { WeaponFamily } from '@alloy/item-gen';
import { createAllocated, createAttributes, type AttributeLevels, type AttributeState } from './attributes';

export interface ProgressionState {
  version: 1;
  adventurer: { rank: number; xp: number };
  /** Mastery per weapon family. Longsword always exists (older saves only have it). */
  weaponMastery: { longsword: { level: number; xp: number } } & Partial<Record<WeaponFamily, { level: number; xp: number }>>;
  /** Open-ended profession mastery (1-100 foundational ranks, continued growth proposed). */
  professions: { blacksmithing: { mastery: number; xp: number } } & Partial<Record<GatheringProficiency, { level: number; xp: number }>>;
  /** Grow-by-use attributes. Optional: saves from before attributes have none (filled on load). */
  attributes?: AttributeState;
  /** Stat points spent per attribute. Unspent points are derived from the adventurer rank. */
  allocated?: AttributeLevels;
  /** Skill bar (keys 1-4): learned skill ids or null. Optional in older saves. */
  skillBar?: Array<string | null>;
}

export const WEAPON_MASTERY_MAX = 30;

/** Gathering proficiencies: improve by gathering (mining ore and ironglass, cutting ironwood, picking herbs). */
export const GATHERING_PROFICIENCIES = ['mining', 'woodcutting', 'herbalism'] as const;
export type GatheringProficiency = (typeof GATHERING_PROFICIENCIES)[number];
export const PROFICIENCY_MAX = 100;
export const proficiencyXpToNext = (level: number) => 20 + 6 * level;
/** XP for one gather. */
export const GATHER_PROFICIENCY_XP = 5;
/** Extra-unit chance per level above 1 (added to the tool's). */
export const PROFICIENCY_YIELD_BONUS = 0.01;

/** Which proficiency a material trains. */
export function proficiencyFor(material: string): GatheringProficiency {
  return material === 'ironwood' ? 'woodcutting' : material === 'herb' ? 'herbalism' : 'mining';
}

/** Add XP to a gathering proficiency in place. Returns the levels gained. */
export function addProficiencyXp(p: ProgressionState, id: GatheringProficiency, xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  const s = (p.professions[id] ??= { level: 1, xp: 0 });
  if (s.level >= PROFICIENCY_MAX) return 0;
  s.xp += Math.min(xp, 1000);
  let levels = 0;
  while (s.level < PROFICIENCY_MAX && s.xp >= proficiencyXpToNext(s.level)) {
    s.xp -= proficiencyXpToNext(s.level);
    s.level++;
    levels++;
  }
  if (s.level >= PROFICIENCY_MAX) s.xp = 0;
  return levels;
}

export const proficiencyLevel = (p: ProgressionState, id: GatheringProficiency) => p.professions[id]?.level ?? 1;
export const ADVENTURER_RANK_MAX = 50;
/** PROTOTYPE DECISION: the player starts as an apprentice smith (mastery 10). */
export const STARTING_SMITH_MASTERY = 10;

export function createProgression(): ProgressionState {
  return {
    version: 1,
    adventurer: { rank: 1, xp: 0 },
    weaponMastery: { longsword: { level: 1, xp: 0 } },
    professions: { blacksmithing: { mastery: STARTING_SMITH_MASTERY, xp: 0 } },
    attributes: createAttributes(),
    allocated: createAllocated(),
  };
}

export const weaponXpToNext = (level: number) => 40 + 30 * level;
export const adventurerXpToNext = (rank: number) => 100 * rank;
/** Open-ended: each rank costs a little more; no hard cap. */
export const smithXpToNext = (mastery: number) => 20 + 4 * Math.max(0, mastery);

/** Small per-level weapon mastery bonus to damage (≤ +29% at 30). */
export function weaponMasteryDamageBonus(level: number): number {
  const l = Math.max(1, Math.min(WEAPON_MASTERY_MAX, Math.floor(level) || 1));
  return 0.01 * (l - 1);
}

function clone(p: ProgressionState): ProgressionState {
  return JSON.parse(JSON.stringify(p)) as ProgressionState;
}

export interface GainResult {
  state: ProgressionState;
  levelsGained: number;
}

export function addWeaponXp(p: ProgressionState, family: WeaponFamily, xp: number): GainResult {
  const s = clone(p);
  const wm = s.weaponMastery[family] ?? { level: 1, xp: 0 };
  let levels = 0;
  if (Number.isFinite(xp) && xp > 0) {
    wm.xp += xp;
    while (wm.level < WEAPON_MASTERY_MAX && wm.xp >= weaponXpToNext(wm.level)) {
      wm.xp -= weaponXpToNext(wm.level);
      wm.level++;
      levels++;
    }
    if (wm.level >= WEAPON_MASTERY_MAX) wm.xp = 0;
  }
  s.weaponMastery[family] = wm;
  return { state: s, levelsGained: levels };
}

export function addAdventurerXp(p: ProgressionState, xp: number): GainResult {
  const s = clone(p);
  let levels = 0;
  if (Number.isFinite(xp) && xp > 0) {
    s.adventurer.xp += xp;
    while (s.adventurer.rank < ADVENTURER_RANK_MAX && s.adventurer.xp >= adventurerXpToNext(s.adventurer.rank)) {
      s.adventurer.xp -= adventurerXpToNext(s.adventurer.rank);
      s.adventurer.rank++;
      levels++;
    }
  }
  return { state: s, levelsGained: levels };
}

export function addSmithXp(p: ProgressionState, xp: number): GainResult {
  const s = clone(p);
  const b = s.professions.blacksmithing;
  let levels = 0;
  if (Number.isFinite(xp) && xp > 0) {
    b.xp += Math.min(xp, 1e7);
    // Guard loop count against pathological inputs.
    let guard = 0;
    while (b.xp >= smithXpToNext(b.mastery) && guard++ < 10000) {
      b.xp -= smithXpToNext(b.mastery);
      b.mastery++;
      levels++;
    }
  }
  return { state: s, levelsGained: levels };
}

/** Blacksmith XP for a craft: masterwork rewards forging quality (meaningful production, GDD 4.3). */
export function craftXp(base: number, mode: 'quick' | 'masterwork', score: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  const s = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  return Math.round(mode === 'quick' ? base : base * (0.5 + s));
}

/** Weapon mastery XP per hit; only from live, legitimate targets (no dummies, GDD 2.3). */
export function weaponXpForHit(targetKind: string, damage: number): number {
  if (targetKind === 'dummy' || !(damage > 0)) return 0;
  return Math.min(10, 1 + damage / 15);
}
