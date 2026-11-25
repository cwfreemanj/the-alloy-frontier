/**
 * Combat skills: special attacks learned at weapon mastery milestones and used from the
 * skill bar (keys 1-4). The attacks themselves are in ATTACKS (combat.ts); this file says who
 * may use them, and their extra rules (damage type, finisher bonus).
 */
import type { DamageType, WeaponFamily } from '@alloy/item-gen';
import type { AttackId } from './combat';

export interface SkillDef {
  id: AttackId;
  name: string;
  family: WeaponFamily;
  /** Weapon mastery level that unlocks it. */
  unlockLevel: number;
  description: string;
  /** Overrides the weapon's damage type for this skill. */
  damageType?: DamageType;
  /** Extra damage against staggered or badly hurt enemies. */
  finisher?: { multiplier: number; belowHealth: number };
}

export const SKILLS: Record<string, SkillDef> = {
  lunging_thrust: {
    id: 'lunging_thrust',
    name: 'Lunging Thrust',
    family: 'longsword',
    unlockLevel: 3,
    description: 'Dash forward with a piercing thrust that closes the distance.',
    damageType: 'pierce',
  },
  final_slash: {
    id: 'final_slash',
    name: 'Final Slash',
    family: 'longsword',
    unlockLevel: 6,
    description: 'A slow, crushing finisher. Deals extra damage to staggered or badly wounded enemies.',
    finisher: { multiplier: 1.5, belowHealth: 0.3 },
  },
};

export const SKILL_BAR_SIZE = 4;
export const isSkill = (id: string): boolean => id in SKILLS;

/** Skills a character has learned, from their weapon masteries. */
export function learnedSkills(mastery: Partial<Record<WeaponFamily, { level: number }>>): SkillDef[] {
  return Object.values(SKILLS).filter((s) => (mastery[s.family]?.level ?? 1) >= s.unlockLevel);
}

/** Damage multiplier of a finisher against a target in this state (1 for anything else). */
export function finisherMultiplier(attackId: string, target: { staggered: boolean; healthFraction: number }): number {
  const f = SKILLS[attackId]?.finisher;
  if (!f) return 1;
  return target.staggered || target.healthFraction < f.belowHealth ? f.multiplier : 1;
}

/** A clean skill bar: SKILL_BAR_SIZE slots of a learned skill id or null, no duplicates. */
export function normalizeSkillBar(bar: unknown, learned: readonly string[]): Array<string | null> {
  const out: Array<string | null> = Array.from({ length: SKILL_BAR_SIZE }, () => null);
  const seen = new Set<string>();
  if (Array.isArray(bar)) {
    bar.slice(0, SKILL_BAR_SIZE).forEach((v, i) => {
      if (typeof v === 'string' && learned.includes(v) && !seen.has(v)) {
        out[i] = v;
        seen.add(v);
      }
    });
  }
  return out;
}
