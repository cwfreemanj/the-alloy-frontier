import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES, ENEMIES, WEAPON_FAMILIES, damageTypeOf, isWeaponFamily, resistanceMultiplier } from '../src';

describe('damage types', () => {
  it('give every weapon family a default type, which a blueprint can override', () => {
    for (const f of Object.values(WEAPON_FAMILIES)) expect(DAMAGE_TYPES).toContain(f.damageType);
    expect(damageTypeOf('longsword')).toBe('slash');
    expect(damageTypeOf('mace')).toBe('blunt');
    expect(damageTypeOf('dagger')).toBe('pierce');
    expect(damageTypeOf('staff')).toBe('magic');
    expect(damageTypeOf('longsword', 'magic')).toBe('magic');
    expect(damageTypeOf('tool')).toBe('blunt');
    expect(isWeaponFamily('tool')).toBe(false);
  });

  it('apply resistances as bounded multipliers (missing = x1)', () => {
    expect(resistanceMultiplier(undefined, 'slash')).toBe(1);
    expect(resistanceMultiplier({ slash: 0.5 }, 'slash')).toBe(0.5);
    expect(resistanceMultiplier({ slash: 0.01 }, 'slash')).toBe(0.25);
    expect(resistanceMultiplier({ slash: 9 }, 'slash')).toBe(2);
    expect(resistanceMultiplier({ slash: NaN }, 'slash')).toBe(1);
  });

  it('keep the starter quest balance: scavengers and the Warden take slash at x1', () => {
    expect(resistanceMultiplier(ENEMIES.scavenger.resist, 'slash')).toBe(1);
    expect(resistanceMultiplier(ENEMIES.warden.resist, 'slash')).toBe(1);
    // The construct resists blades but cracks under blunt force.
    expect(resistanceMultiplier(ENEMIES.sentinel.resist, 'slash')).toBeLessThan(1);
    expect(resistanceMultiplier(ENEMIES.sentinel.resist, 'blunt')).toBeGreaterThan(1);
  });
});
