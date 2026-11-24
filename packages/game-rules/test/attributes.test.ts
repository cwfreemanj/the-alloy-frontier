import { describe, expect, it } from 'vitest';
import { ALLOCATED_MAX, ATTRIBUTE_MAX, ATTRIBUTE_XP, BASE_MAX_HEALTH, ENEMIES, STAMINA_CONFIG, addAttributeXp, attributeBonuses, attributeTotals, attributeXpToNext, createAllocated, createAttributes, createProgression, critContest, earnedStatPoints, incomingContest, normalizeAllocated, normalizeAttributes, staggerContest } from '../src';

describe('attributes', () => {
  it('start at level 1 with no bonus', () => {
    const b = attributeBonuses(attributeTotals(createAttributes(), createAllocated()));
    expect(b).toEqual({ damageBonus: 0, critChance: 0, maxHealth: BASE_MAX_HEALTH, maxStamina: STAMINA_CONFIG.max });
    expect(createProgression().attributes).toEqual(createAttributes());
  });

  it('level up from XP, carry the remainder, and stop at the cap', () => {
    const a = createAttributes();
    expect(addAttributeXp(a, 'strength', attributeXpToNext(1) + 3)).toBe(1);
    expect(a.strength).toEqual({ level: 2, xp: 3 });
    for (let i = 0; i < 1000; i++) addAttributeXp(a, 'strength', 1000);
    expect(a.strength).toEqual({ level: ATTRIBUTE_MAX, xp: 0 });
    expect(addAttributeXp(a, 'strength', 50)).toBe(0);
  });

  it('ignore bad XP values', () => {
    const a = createAttributes();
    for (const v of [NaN, -5, 0, Infinity]) expect(addAttributeXp(a, 'dexterity', v)).toBe(0);
    expect(a.dexterity).toEqual({ level: 1, xp: 0 });
  });

  it('give the documented bonuses per level above 1', () => {
    const b = attributeBonuses({ strength: 11, dexterity: 5, vitality: 3, endurance: 2 });
    expect(b.damageBonus).toBeCloseTo(0.1);
    expect(b.critChance).toBeCloseTo(0.01);
    expect(b.maxHealth).toBe(BASE_MAX_HEALTH + 10);
    expect(b.maxStamina).toBe(Math.round(STAMINA_CONFIG.max + 1.5));
  });

  it('fill in missing or malformed attributes from older saves', () => {
    expect(normalizeAttributes(undefined)).toEqual(createAttributes());
    const n = normalizeAttributes({ strength: { level: 4, xp: 7 }, dexterity: { level: -2, xp: 1 } as never, vitality: { level: 99, xp: 5 } });
    expect(n.strength).toEqual({ level: 4, xp: 7 });
    expect(n.dexterity).toEqual({ level: 1, xp: 0 });
    expect(n.vitality).toEqual({ level: ATTRIBUTE_MAX, xp: 0 });
  });

  it('grow from the right activities', () => {
    expect(ATTRIBUTE_XP.hit(true, false, 30).map(([id]) => id)).toEqual(['strength']);
    expect(ATTRIBUTE_XP.hit(false, true, 30).map(([id]) => id)).toEqual(['dexterity', 'dexterity']);
    expect(ATTRIBUTE_XP.hit(false, false, 0)).toEqual([]);
    expect(ATTRIBUTE_XP.gather('iron_ore').map(([id]) => id).sort()).toEqual(['endurance', 'strength']);
    expect(ATTRIBUTE_XP.gather('ironwood').map(([id]) => id)).toEqual(['endurance']);
    expect(ATTRIBUTE_XP.kill('dummy')).toEqual([]);
    expect(ATTRIBUTE_XP.kill('elite').map(([id]) => id)).toContain('vitality');
    for (const [, xp] of [...ATTRIBUTE_XP.hit(true, true, 1e6), ...ATTRIBUTE_XP.hitTaken(1e6)]) expect(xp).toBeLessThanOrEqual(6);
  });
});

describe('stat points', () => {
  it('earn 3 per adventurer rank above 1', () => {
    expect(earnedStatPoints(1)).toBe(0);
    expect(earnedStatPoints(2)).toBe(3);
    expect(earnedStatPoints(50)).toBe(147);
  });

  it('add to trained levels for one total, each layer capped', () => {
    const t = createAttributes();
    t.strength.level = 6;
    expect(attributeTotals(t, { ...createAllocated(), strength: 7 }).strength).toBe(13);
    expect(attributeTotals(t, { ...createAllocated(), strength: 999 }).strength).toBe(6 + ALLOCATED_MAX);
    expect(normalizeAllocated({ strength: -3, dexterity: 2.5, vitality: 4 } as never)).toEqual({ strength: 0, dexterity: 0, vitality: 4, endurance: 0 });
  });
});

describe('contests against enemy attributes', () => {
  it('are neutral when equal and bounded at the extremes', () => {
    expect(staggerContest(5, 5)).toBe(1);
    expect(critContest(5, 5)).toBe(0);
    expect(incomingContest(5, 5)).toBe(1);
    expect(staggerContest(500, 1)).toBe(1.5);
    expect(staggerContest(1, 500)).toBe(0.6);
    expect(incomingContest(500, 1)).toBe(1.3);
    expect(incomingContest(1, 500)).toBe(0.7);
  });

  it('favour the stronger side', () => {
    expect(staggerContest(10, 2)).toBeGreaterThan(1);
    expect(critContest(10, 2)).toBeGreaterThan(0);
    expect(incomingContest(ENEMIES.warden.attributes.strength, 1)).toBeGreaterThan(1);
    expect(incomingContest(ENEMIES.warden.attributes.strength, 20)).toBeLessThan(1);
  });

  it('every enemy type has all four attributes', () => {
    for (const e of Object.values(ENEMIES)) for (const v of Object.values(e.attributes)) expect(v).toBeGreaterThanOrEqual(1);
  });
});
