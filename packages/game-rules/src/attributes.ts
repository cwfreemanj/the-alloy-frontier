/**
 * Attributes, in two layers that add up to one total per attribute:
 * - trained: grows by use. XP comes from things the authority observes (hits that land,
 *   hits aimed at the player, gathering, forging, kills).
 * - allocated: stat points the player spends (3 per adventurer rank; free respec for now).
 * Enemies have attributes too; some outcomes compare the player's totals with theirs.
 */
import { STAMINA_CONFIG } from './stamina';

export const ATTRIBUTE_IDS = ['strength', 'dexterity', 'vitality', 'endurance'] as const;
export type AttributeId = (typeof ATTRIBUTE_IDS)[number];
export type AttributeState = Record<AttributeId, { level: number; xp: number }>;

/** Highest trained level (by use). */
export const ATTRIBUTE_MAX = 30;
/** Most points that can be put into one attribute. */
export const ALLOCATED_MAX = 50;
export const STAT_POINTS_PER_RANK = 3;
export type AttributeLevels = Record<AttributeId, number>;
export const BASE_MAX_HEALTH = 200;

export const ATTRIBUTES: Record<AttributeId, { name: string; grows: string; effect: string }> = {
  strength: { name: 'Strength', grows: 'Heavy hits, Guardbreaker and Storm Arc that land; mining ore; forging', effect: '+1% damage per level' },
  dexterity: { name: 'Dexterity', grows: 'Light hits that land; critical hits', effect: '+0.25% critical chance per level' },
  vitality: { name: 'Vitality', grows: 'Taking enemy attacks; defeating elites', effect: '+5 max health per level' },
  endurance: { name: 'Endurance', grows: 'Gathering; defeating enemies', effect: '+1.5 max stamina per level' },
};

export const attributeXpToNext = (level: number) => 25 + 15 * level;

export function createAttributes(): AttributeState {
  return { strength: { level: 1, xp: 0 }, dexterity: { level: 1, xp: 0 }, vitality: { level: 1, xp: 0 }, endurance: { level: 1, xp: 0 } };
}

/** Fill in missing or malformed attributes (older saves have none). */
export function normalizeAttributes(a: Partial<AttributeState> | undefined): AttributeState {
  const out = createAttributes();
  for (const id of ATTRIBUTE_IDS) {
    const v = a?.[id];
    if (v && Number.isInteger(v.level) && v.level >= 1 && Number.isFinite(v.xp) && v.xp >= 0) {
      out[id] = { level: Math.min(ATTRIBUTE_MAX, v.level), xp: v.level >= ATTRIBUTE_MAX ? 0 : v.xp };
    }
  }
  return out;
}

/** Add XP to one attribute in place. Returns the levels gained. */
export function addAttributeXp(a: AttributeState, id: AttributeId, xp: number): number {
  const s = a[id];
  if (!s || !Number.isFinite(xp) || xp <= 0 || s.level >= ATTRIBUTE_MAX) return 0;
  s.xp += Math.min(xp, 1000);
  let levels = 0;
  while (s.level < ATTRIBUTE_MAX && s.xp >= attributeXpToNext(s.level)) {
    s.xp -= attributeXpToNext(s.level);
    s.level++;
    levels++;
  }
  if (s.level >= ATTRIBUTE_MAX) s.xp = 0;
  return levels;
}

export interface AttributeBonuses {
  /** Added to the damage bonus (0.01 = +1%). */
  damageBonus: number;
  /** Added to the weapon's crit chance (0.0025 = +0.25 percentage points). */
  critChance: number;
  maxHealth: number;
  maxStamina: number;
}

/** Stat points earned by an adventurer rank. */
export const earnedStatPoints = (rank: number) => STAT_POINTS_PER_RANK * Math.max(0, Math.floor(rank) - 1);

export function createAllocated(): AttributeLevels {
  return { strength: 0, dexterity: 0, vitality: 0, endurance: 0 };
}

/** Fill in missing or malformed allocations (older saves have none). */
export function normalizeAllocated(a: Partial<AttributeLevels> | undefined): AttributeLevels {
  const out = createAllocated();
  for (const id of ATTRIBUTE_IDS) {
    const v = a?.[id];
    if (Number.isInteger(v) && (v as number) > 0) out[id] = Math.min(ALLOCATED_MAX, v as number);
  }
  return out;
}

export const spentStatPoints = (a: AttributeLevels) => ATTRIBUTE_IDS.reduce((n, id) => n + a[id], 0);

/** One total per attribute: trained level + allocated points. */
export function attributeTotals(trained: AttributeState, allocated: AttributeLevels): AttributeLevels {
  const out = createAllocated();
  for (const id of ATTRIBUTE_IDS) out[id] = Math.min(ATTRIBUTE_MAX, trained[id]?.level ?? 1) + Math.min(ALLOCATED_MAX, allocated[id] ?? 0);
  return out;
}

/** What attribute totals add to the character. */
export function attributeBonuses(levels: AttributeLevels): AttributeBonuses {
  const above = (id: AttributeId) => Math.max(0, Math.min(ATTRIBUTE_MAX + ALLOCATED_MAX, levels[id] ?? 1) - 1);
  return {
    damageBonus: 0.01 * above('strength'),
    critChance: 0.0025 * above('dexterity'),
    maxHealth: BASE_MAX_HEALTH + 5 * above('vitality'),
    maxStamina: Math.round(STAMINA_CONFIG.max + 1.5 * above('endurance')),
  };
}

/** XP gains: one place for every source, so the server and guests agree. */
export const ATTRIBUTE_XP = {
  /** A hit that landed on a live (non-dummy) target. */
  hit(heavy: boolean, crit: boolean, damage: number): Array<[AttributeId, number]> {
    if (!(damage > 0)) return [];
    const out: Array<[AttributeId, number]> = heavy ? [['strength', Math.min(5, 2 + damage / 30)]] : [['dexterity', Math.min(4, 1 + damage / 40)]];
    if (crit) out.push(['dexterity', 2]);
    return out;
  },
  /** An enemy attack aimed at the player (raw damage, before dodge or block). */
  hitTaken(rawDamage: number): Array<[AttributeId, number]> {
    return rawDamage > 0 ? [['vitality', Math.min(6, 1 + rawDamage / 25)]] : [];
  },
  gather(material: string): Array<[AttributeId, number]> {
    const out: Array<[AttributeId, number]> = [['endurance', 2]];
    if (material === 'iron_ore' || material === 'ironglass') out.push(['strength', 2]);
    return out;
  },
  forge(): Array<[AttributeId, number]> {
    return [['strength', 3]];
  },
  kill(kind: string): Array<[AttributeId, number]> {
    if (kind === 'dummy') return [];
    const out: Array<[AttributeId, number]> = [['endurance', 2]];
    if (kind === 'elite') out.push(['vitality', 10]);
    return out;
  },
};

// ---------------- Contests: the player's totals against an enemy's attributes ----------------
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Stagger the player deals: x0.6 .. x1.5, 2% per point of Strength difference. */
export const staggerContest = (playerStr: number, enemyStr: number) => clamp(1 + 0.02 * (playerStr - enemyStr), 0.6, 1.5);
/** Added to the player's crit chance: 0.4 percentage points per point of Dexterity difference. */
export const critContest = (playerDex: number, enemyDex: number) => 0.004 * (playerDex - enemyDex);
/** How hard an enemy's hit lands on the player: x0.7 .. x1.3, 1.5% per point of enemy Strength over player Vitality. */
export const incomingContest = (enemyStr: number, playerVit: number) => clamp(1 + 0.015 * (enemyStr - playerVit), 0.7, 1.3);
