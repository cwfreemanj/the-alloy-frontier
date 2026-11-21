import { describe, expect, it } from 'vitest';
import {
  BLUEPRINTS,
  GENERATOR_VERSION,
  Rng,
  bufferFactor,
  equipmentRating,
  formulaDamage,
  generateItem,
  rarityIndex,
  smithFactor,
  validateItem,
  verifyIntegrity,
  type GenerationInput,
} from '../src';

const baseInput = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  itemId: 'itm-test-1',
  seed: 'abc123',
  blueprintId: 'iron_longsword',
  source: 'quick_forge',
  mode: 'quick',
  materials: [
    { lotId: 'l1', materialId: 'iron_ore', quantity: 3, quality: 0.5 },
    { lotId: 'l2', materialId: 'ironwood', quantity: 1, quality: 0.5 },
  ],
  bufferQuantity: 0,
  maker: { id: 'p1', name: 'Tester', mastery: 0 },
  createdAt: 1000,
  ...over,
});

describe('mastery scaling (GDD 4.11)', () => {
  it('SmithFactor matches the GDD reference values', () => {
    expect(smithFactor(0)).toBe(1);
    expect(smithFactor(100)).toBeCloseTo(2.075, 3);
  });
  it('turns a 20-damage steel blade into ~42 at mastery 100', () => {
    expect(formulaDamage(20, smithFactor(100), 1, 1, 1)).toBe(42);
    expect(formulaDamage(20, smithFactor(0), 1, 1, 1)).toBe(20);
  });
  it('is monotonic and has no arbitrary cap', () => {
    let prev = 0;
    for (let m = 0; m <= 5000; m += 7) {
      const f = smithFactor(m);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(smithFactor(1e6)).toBeGreaterThan(smithFactor(1e4));
  });
  it('is safe against extreme / invalid inputs', () => {
    for (const bad of [NaN, -5, Infinity, -Infinity, 1e300]) {
      expect(Number.isFinite(smithFactor(bad))).toBe(true);
      expect(Number.isFinite(bufferFactor(bad, 2))).toBe(true);
    }
    expect(Number.isFinite(formulaDamage(1e308, smithFactor(1e300), 1.2, 2, 1.25))).toBe(true);
  });
});

describe('buffer diminishing returns (GDD 4.12)', () => {
  it('never makes the outcome worse and each unit adds less', () => {
    let prev = bufferFactor(0, 3);
    let prevGain = Infinity;
    expect(prev).toBe(1);
    for (let q = 1; q <= 500; q++) {
      const f = bufferFactor(q, 3);
      const gain = f - prev;
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(prevGain + 1e-12);
      prev = f;
      prevGain = gain;
    }
  });
  it('has no hard maximum', () => {
    expect(bufferFactor(9999, 1)).toBeGreaterThan(bufferFactor(5000, 1));
  });
});

describe('procedural generation determinism (AF-004)', () => {
  it('same seed + inputs + version => identical item', () => {
    const a = generateItem(baseInput({ mode: 'masterwork', source: 'masterwork_forge', forgeScore: 0.8, specialization: 'keen', temper: 'water' }));
    const b = generateItem(baseInput({ mode: 'masterwork', source: 'masterwork_forge', forgeScore: 0.8, specialization: 'keen', temper: 'water' }));
    expect(a).toEqual(b);
    expect(a.generatorVersion).toBe(GENERATOR_VERSION);
  });
  it('records all required provenance fields', () => {
    const it = generateItem(baseInput());
    for (const k of ['itemId', 'seed', 'generatorVersion', 'blueprintId', 'materials', 'materialQuality', 'forge', 'result', 'balanceVersion', 'integrity'] as const) {
      expect(it[k]).toBeDefined();
    }
    expect(it.forge.mastery).toBe(0);
    expect(it.forge.makerName).toBe('Tester');
    expect(it.result.rarity).toBeDefined();
    expect(Array.isArray(it.potentialImbuements)).toBe(true);
  });
  it('different seeds produce different roll streams', () => {
    const r1 = new Rng('a');
    const r2 = new Rng('b');
    expect(r1.next()).not.toBe(r2.next());
  });
  it('detects tampering with the final-stat snapshot', () => {
    const item = generateItem(baseInput());
    expect(verifyIntegrity(item)).toBe(true);
    expect(validateItem(item)).toBe(true);
    const forged = { ...item, result: { ...item.result, damage: 9999 } };
    expect(verifyIntegrity(forged)).toBe(false);
    expect(validateItem(forged)).toBe(false);
  });
  it('snapshot does not change when balance definitions change later', () => {
    const item = generateItem(baseInput());
    const snapshot = JSON.stringify(item.result);
    const bp = BLUEPRINTS.iron_longsword;
    const old = bp.baseDamage;
    bp.baseDamage = 999;
    try {
      expect(JSON.stringify(item.result)).toBe(snapshot);
      expect(verifyIntegrity(item)).toBe(true);
    } finally {
      bp.baseDamage = old;
    }
  });
});

describe('novice vs master with the same basic steel (GDD 5.6 required)', () => {
  it('produces clearly different stats', () => {
    const novice = generateItem(baseInput({ maker: { id: 'n', name: 'Novice', mastery: 0 } }));
    const master = generateItem(baseInput({ maker: { id: 'm', name: 'Master', mastery: 100 } }));
    expect(novice.result.damage).toBe(20);
    expect(master.result.damage).toBeGreaterThanOrEqual(40);
    expect(master.result.rating).toBeGreaterThan(novice.result.rating);
  });
  it('a master masterwork beats a master quick forge', () => {
    const quick = generateItem(baseInput({ maker: { id: 'm', name: 'M', mastery: 100 } }));
    const mw = generateItem(baseInput({ mode: 'masterwork', source: 'masterwork_forge', forgeScore: 1, maker: { id: 'm', name: 'M', mastery: 100 } }));
    expect(mw.forge.formulaDamage).toBeGreaterThan(quick.forge.formulaDamage);
  });
});

describe('rating, rarity, imbuement are independent axes (GDD 2.6)', () => {
  it('rating reflects actual combat value', () => {
    const base = { damage: 20, attackSpeed: 1, stagger: 20, staminaCostMultiplier: 1, critChance: 0.05 };
    expect(equipmentRating({ ...base, damage: 30 }, [])).toBeGreaterThan(equipmentRating(base, []));
    expect(equipmentRating({ ...base, staminaCostMultiplier: 0.8 }, [])).toBeGreaterThan(equipmentRating(base, []));
    expect(equipmentRating(base, ['storm_arc'])).toBeGreaterThan(equipmentRating(base, []));
  });
  it('quick forge never exceeds Uncommon', () => {
    for (let i = 0; i < 200; i++) {
      const it = generateItem(baseInput({ seed: `s${i}`, maker: { id: 'm', name: 'M', mastery: 500 } }));
      expect(rarityIndex(it.result.rarity)).toBeLessThanOrEqual(rarityIndex('uncommon'));
    }
  });
  it('Storm Arc awakens only from a strong masterwork with ironglass', () => {
    const mats = [
      { lotId: 'a', materialId: 'iron_ore' as const, quantity: 2, quality: 0.6 },
      { lotId: 'b', materialId: 'ironglass' as const, quantity: 3, quality: 0.7 },
      { lotId: 'c', materialId: 'ironwood' as const, quantity: 1, quality: 0.5 },
    ];
    const q = generateItem(baseInput({ blueprintId: 'ironglass_longsword', materials: mats }));
    const weak = generateItem(baseInput({ blueprintId: 'ironglass_longsword', materials: mats, mode: 'masterwork', source: 'masterwork_forge', forgeScore: 0.3 }));
    const strong = generateItem(baseInput({ blueprintId: 'ironglass_longsword', materials: mats, mode: 'masterwork', source: 'masterwork_forge', forgeScore: 0.85 }));
    expect(q.result.imbuements).toEqual([]);
    expect(weak.result.imbuements).toEqual([]);
    expect(strong.result.imbuements).toEqual(['storm_arc']);
    expect(strong.potentialImbuements).toEqual(['storm_arc']);
  });
});
