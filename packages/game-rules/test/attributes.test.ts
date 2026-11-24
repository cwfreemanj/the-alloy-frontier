import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_MAX, ATTRIBUTE_XP, BASE_MAX_HEALTH, STAMINA_CONFIG, addAttributeXp, attributeBonuses, attributeXpToNext, createAttributes, createProgression, normalizeAttributes } from '../src';

describe('attributes', () => {
  it('start at level 1 with no bonus', () => {
    const b = attributeBonuses(createAttributes());
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
    const a = createAttributes();
    a.strength.level = 11;
    a.dexterity.level = 5;
    a.vitality.level = 3;
    a.endurance.level = 2;
    const b = attributeBonuses(a);
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
