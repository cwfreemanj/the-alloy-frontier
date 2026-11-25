import { describe, expect, it } from 'vitest';
import { BREWS, addMaterial, brew, consume, consumableEffect, createInventory, materialTotal, type InventoryState } from '../src';

const withLeaves = (n: number, quality: number, inv: InventoryState = createInventory('p')) => {
  const r = addMaterial(inv, { materialId: 'emberleaf', quantity: n, quality, origin: `t${quality}` });
  if (!r.ok) throw new Error('add failed');
  return r.inventory;
};

describe('alchemy', () => {
  it('brews from the best leaves first; the potion quality is their average', () => {
    const inv = withLeaves(2, 0.9, withLeaves(4, 0.3));
    const r = brew(inv, 'healing_salve', 1);
    if (!r.ok) throw new Error(r.message);
    expect(r.quality).toBe(0.9);
    expect(materialTotal(r.inventory, 'healing_salve')).toBe(1);
    expect(materialTotal(r.inventory, 'emberleaf')).toBe(4);
  });

  it('refuses without enough herbs or with bad input, and changes nothing', () => {
    const inv = withLeaves(2, 0.5);
    expect(brew(inv, 'stamina_tonic', 1)).toMatchObject({ ok: false, error: 'missing_materials' });
    expect(brew(inv, 'elixir', 1)).toMatchObject({ ok: false, error: 'unknown_recipe' });
    expect(brew(inv, 'healing_salve', 0)).toMatchObject({ ok: false, error: 'invalid_quantity' });
    expect(materialTotal(inv, 'emberleaf')).toBe(2);
    expect(BREWS.stamina_tonic.inputs.emberleaf).toBe(3);
  });

  it('uses the best potion, with an effect that grows with quality', () => {
    let inv = withLeaves(4, 0.2);
    const a = brew(inv, 'healing_salve', 2);
    if (!a.ok) throw new Error(a.message);
    inv = a.inventory;
    const used = consume(inv, 'healing_salve');
    if (!used.ok) throw new Error(used.message);
    expect(used.effect.heal).toBe(consumableEffect('healing_salve', 0.2).heal);
    expect(consumableEffect('healing_salve', 1).heal).toBeGreaterThan(consumableEffect('healing_salve', 0).heal);
    expect(consume(createInventory('p'), 'healing_salve')).toMatchObject({ ok: false, error: 'none_left' });
    expect(consume(inv, 'iron_ore')).toMatchObject({ ok: false, error: 'not_consumable' });
  });
});
