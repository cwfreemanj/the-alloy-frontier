/**
 * The adaptive world (first piece): areas react to who is playing in them.
 *
 * The world server keeps decaying tallies per area. When players ranked well above an area's
 * level spend time or kill there, the area's "pressure" builds, and its enemies gain levels;
 * when those players leave, the pressure fades and the levels settle back.
 *
 * Pure rules, shared by the server (which decides) and the browser (which shows the same
 * scaled stats for the level the server sends).
 */
import type { EnemyArchetype } from './enemy';

export const ADAPT = {
  /** Tallies halve every this many seconds of real time. */
  halfLifeSec: 1200,
  /** A player counts as over-levelled for an area this many ranks above its level. */
  overlevelMargin: 2,
  /** Pressure per enemy level gained (over-levelled rank × seconds). */
  unit: 900,
  /** Pressure an over-levelled kill adds, per rank over. */
  killWeight: 45,
  /** At most this many levels above an area's own. */
  maxBonus: 3,
  /** A level is dropped only when pressure falls this far (in units) below its threshold. */
  hysteresis: 0.2,
} as const;

/** How much a tally keeps after `dt` seconds. */
export const decayFactor = (dt: number): number => (dt > 0 ? Math.pow(0.5, dt / ADAPT.halfLifeSec) : 1);

/** Ranks above an area's level beyond the margin (0 for players who belong there). */
export const overlevel = (rank: number, areaLevel: number): number => Math.max(0, Math.floor(rank) - areaLevel - ADAPT.overlevelMargin);

/**
 * The area's level bonus for a pressure, moving from the current bonus with hysteresis so a
 * level doesn't flicker around a threshold.
 */
export function nextBonus(pressure: number, current: number): number {
  const p = Number.isFinite(pressure) ? Math.max(0, pressure) : 0;
  let b = Math.max(0, Math.min(ADAPT.maxBonus, Math.floor(current)));
  const target = Math.min(ADAPT.maxBonus, Math.floor(p / ADAPT.unit));
  if (target > b) return target;
  while (b > 0 && p < (b - ADAPT.hysteresis) * ADAPT.unit) b--;
  return b;
}

const scaleCache = new Map<string, EnemyArchetype>();

/**
 * An enemy archetype at a given level: each level above its own adds health, damage, defense,
 * poise and attribute ranks, and makes the kill worth more.
 */
export function scaledArchetype(def: EnemyArchetype, level: number): EnemyArchetype {
  const L = Math.max(0, Math.floor(level) - def.level);
  if (L === 0 || def.kind === 'dummy') return def;
  const key = `${def.id}:${L}`;
  const hit = scaleCache.get(key);
  if (hit) return hit;
  const k = (per: number) => 1 + per * L;
  const scaled: EnemyArchetype = {
    ...def,
    level: def.level + L,
    maxHealth: Math.round(def.maxHealth * k(0.3)),
    defense: Math.round(def.defense * k(0.1) * 10) / 10,
    poise: Math.round(def.poise * k(0.15)),
    attacks: def.attacks.map((a) => ({ ...a, damage: Math.round(a.damage * k(0.15)) })),
    attributes: Object.fromEntries(Object.entries(def.attributes).map(([id, v]) => [id, v + L])) as EnemyArchetype['attributes'],
    xp: Math.round(def.xp * k(0.35)),
    coins: [Math.round(def.coins[0] * k(0.25)), Math.round(def.coins[1] * k(0.25))],
  };
  scaleCache.set(key, scaled);
  return scaled;
}
