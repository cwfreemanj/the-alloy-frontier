import { describe, expect, it } from 'vitest';
import { ATTACKS, PlayerCombat, SKILLS, finisherMultiplier, learnedSkills, normalizeSkillBar, type CombatContext } from '../src';

const ctx = (abilities: string[] = []): CombatContext => ({ weapon: { damage: 10, attackSpeed: 1, stagger: 10, staminaCostMultiplier: 1, critChance: 0 }, abilities });

describe('skills', () => {
  it('unlock at their weapon mastery milestone', () => {
    expect(learnedSkills({ longsword: { level: 1 } })).toEqual([]);
    expect(learnedSkills({ longsword: { level: 3 } }).map((s) => s.id)).toEqual(['lunging_thrust']);
    expect(learnedSkills({ longsword: { level: 6 } }).map((s) => s.id).sort()).toEqual(['final_slash', 'lunging_thrust']);
    expect(learnedSkills({ mace: { level: 30 } })).toEqual([]);
  });

  it('every skill has an attack, a cooldown and a stamina cost', () => {
    for (const s of Object.values(SKILLS)) {
      expect(ATTACKS[s.id].id).toBe(s.id);
      expect(ATTACKS[s.id].cooldown).toBeGreaterThan(0);
    }
  });

  it('can only be used when granted, and not again during the cooldown', () => {
    const c = new PlayerCombat(200);
    expect(c.request('lunging_thrust', ctx())).toBe('unavailable');
    expect(c.request('lunging_thrust', ctx(['lunging_thrust']))).toBe('started');
    for (let i = 0; i < 40; i++) c.update(0.05, ctx(['lunging_thrust']), { sprinting: false });
    expect(c.phase).toBe('idle');
    expect(c.request('lunging_thrust', ctx(['lunging_thrust']))).toBe('cooldown');
  });

  it('Final Slash hits harder on staggered or badly wounded enemies', () => {
    expect(finisherMultiplier('final_slash', { staggered: false, healthFraction: 0.9 })).toBe(1);
    expect(finisherMultiplier('final_slash', { staggered: true, healthFraction: 0.9 })).toBe(1.5);
    expect(finisherMultiplier('final_slash', { staggered: false, healthFraction: 0.2 })).toBe(1.5);
    expect(finisherMultiplier('light1', { staggered: true, healthFraction: 0.1 })).toBe(1);
  });

  it('keeps the skill bar to learned skills, without duplicates', () => {
    expect(normalizeSkillBar(['final_slash', 'lunging_thrust', 'lunging_thrust', 'nope', 'x'], ['lunging_thrust'])).toEqual([null, 'lunging_thrust', null, null]);
    expect(normalizeSkillBar(undefined, [])).toEqual([null, null, null, null]);
  });
});
