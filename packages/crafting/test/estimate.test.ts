/**
 * Estimated stats on blueprints: the range shown on a scroll must contain what the forge really makes
 * (before rarity affixes and perks), and grow with skill.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, estimateStats, generateBlueprint } from '@alloy/item-gen';
import { addMaterial, createInventory, executeForge, type InventoryState } from '../src';

function stocked(quality: number): InventoryState {
  let inv = createInventory('p1', 100);
  for (const [m, q] of [['iron_ore', 40], ['ironwood', 10], ['ironglass', 20], ['binding_flux', 40], ['emberleaf', 20]] as const) {
    const r = addMaterial(inv, { materialId: m, quantity: q, quality, origin: 'test' });
    if (!r.ok) throw new Error(r.message);
    inv = r.inventory;
  }
  return inv;
}

describe('estimated stats on blueprints', () => {
  it('gives a damage range for weapons, a defense range for armor, and none for bonus-only pieces', () => {
    const sword = estimateStats(BLUEPRINTS.iron_longsword)!;
    expect(sword.stat).toBe('damage');
    expect(sword.low).toBeLessThan(sword.high);
    expect(estimateStats(BLUEPRINTS.iron_helmet)!.stat).toBe('defense');
    expect(estimateStats(BLUEPRINTS.iron_band)).toBeNull();
  });

  it('rises with skill', () => {
    const at0 = estimateStats(BLUEPRINTS.iron_longsword, 0)!;
    const at50 = estimateStats(BLUEPRINTS.iron_longsword, 50)!;
    expect(at50.low).toBeGreaterThan(at0.low);
    expect(at50.high).toBeGreaterThan(at0.high);
  });

  it('contains what the forge makes at that level, worst and best materials, when no affix changes it', () => {
    let checked = 0;
    for (const id of ['iron_longsword', 'iron_mace', 'iron_chestplate', 'ironglass_shield']) {
      const bp = BLUEPRINTS[id];
      const est = estimateStats(bp, 10)!;
      for (const quality of [0, 0.5, 1]) {
        for (let i = 0; i < 20; i++) {
          const r = executeForge(stocked(quality), { txId: `tx-${id}-${quality}-${i}`, blueprintId: id, mode: 'quick', bufferQuantity: bp.buffer.min, maker: { id: 'p1', name: 'Smith', mastery: 10 }, createdAt: 1 });
          if (!r.ok) throw new Error(r.message);
          if (r.item.result.affixes.length) continue;
          const v = est.stat === 'defense' ? r.item.result.defense! : r.item.result.damage;
          expect(v).toBeGreaterThanOrEqual(est.low);
          expect(v).toBeLessThanOrEqual(est.high);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('works on found blueprints', () => {
    const bp = generateBlueprint('seed-1', { area: 'quarry', source: 'chest', sourceId: 'quarry_chest', level: 4 });
    const est = estimateStats(bp.piece, bp.requirement.level);
    expect(est).not.toBeNull();
    expect(est!.level).toBe(bp.requirement.level);
  });
});
