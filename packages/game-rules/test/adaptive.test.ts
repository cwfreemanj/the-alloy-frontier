import { describe, expect, it } from 'vitest';
import { ADAPT, ENEMIES, decayFactor, nextBonus, overlevel, scaledArchetype } from '../src';

describe('adaptive world rules', () => {
  it('counts only players well above an area as over-levelled', () => {
    expect(overlevel(1, 1)).toBe(0);
    expect(overlevel(3, 1)).toBe(0);
    expect(overlevel(4, 1)).toBe(1);
    expect(overlevel(10, 1)).toBe(7);
    expect(overlevel(5, 4)).toBe(0);
  });

  it('decays by half every half-life', () => {
    expect(decayFactor(ADAPT.halfLifeSec)).toBeCloseTo(0.5, 6);
    expect(decayFactor(0)).toBe(1);
  });

  it('raises the bonus at each threshold, lowers it only below a margin, and caps it', () => {
    const u = ADAPT.unit;
    expect(nextBonus(0, 0)).toBe(0);
    expect(nextBonus(u - 1, 0)).toBe(0);
    expect(nextBonus(u, 0)).toBe(1);
    expect(nextBonus(2.5 * u, 0)).toBe(2);
    // Just under the threshold: kept (hysteresis), well under: dropped.
    expect(nextBonus(0.95 * u, 1)).toBe(1);
    expect(nextBonus(0.7 * u, 1)).toBe(0);
    expect(nextBonus(100 * u, 0)).toBe(ADAPT.maxBonus);
    expect(nextBonus(Number.NaN, 2)).toBe(0);
  });

  it('scales an enemy up by level, and leaves its own level untouched', () => {
    const s = ENEMIES.scavenger;
    expect(scaledArchetype(s, s.level)).toBe(s);
    const up = scaledArchetype(s, s.level + 2);
    expect(up.level).toBe(s.level + 2);
    expect(up.maxHealth).toBe(Math.round(s.maxHealth * 1.6));
    expect(up.attacks[0].damage).toBeGreaterThan(s.attacks[0].damage);
    expect(up.xp).toBeGreaterThan(s.xp);
    expect(up.attributes.strength).toBe(s.attributes.strength + 2);
    expect(scaledArchetype(s, s.level + 2)).toBe(up); // cached
    expect(scaledArchetype(ENEMIES.dummy, 9)).toBe(ENEMIES.dummy);
  });
});
