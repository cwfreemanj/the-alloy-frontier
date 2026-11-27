/**
 * Found blueprints (docs/blueprint-contract.md): the stand-in generator, sealing, scrolls and learning,
 * forging from a learned blueprint, and items keeping a copy of it.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINT_LIMITS, RARITY_ORDER, generateBlueprint, sealBlueprint, validateBlueprint, validateItem, type BlueprintContext } from '@alloy/item-gen';
import { MAX_SCROLLS, addMaterial, addScroll, createInventory, discardScroll, equipItem, executeForge, learnScroll, learnedBlueprints, resolveBlueprint, validateInventory, type InventoryState } from '../src';

const ctx: BlueprintContext = { area: 'quarry', source: 'enemy', sourceId: 'sentinel', level: 5 };

function stocked(): InventoryState {
  let inv = createInventory('p1', 100);
  for (const [m, q] of [['iron_ore', 60], ['ironwood', 20], ['ironglass', 40], ['binding_flux', 80]] as const) {
    const r = addMaterial(inv, { materialId: m, quantity: q, quality: 0.6, origin: 'test' });
    if (!r.ok) throw new Error(r.message);
    inv = r.inventory;
  }
  return inv;
}

describe('found blueprints: generator and seal', () => {
  it('makes the same blueprint from the same seed and context, sealed and within bounds', () => {
    const a = generateBlueprint('seed-1', ctx);
    expect(generateBlueprint('seed-1', ctx)).toEqual(a);
    expect(generateBlueprint('seed-2', ctx).id).not.toBe(a.id);
    expect(a.id).toMatch(/^gbp_/);
    expect(a.piece.id).toBe(a.id);
    expect(validateBlueprint(a)).toBe(true);
    expect(a.name.length).toBeLessThanOrEqual(BLUEPRINT_LIMITS.name);
    expect(a.lore.length).toBeLessThanOrEqual(BLUEPRINT_LIMITS.lore);
    expect(a.requirement).toEqual({ branch: 'smithing', level: a.piece.masteryRequirement });
    // Quarry blueprints are ironglass patterns.
    expect(a.piece.materials.some((m) => m.materialId === 'ironglass')).toBe(true);
  });

  it('rejects tampering and anything out of bounds', () => {
    const a = generateBlueprint('seed-1', ctx);
    expect(validateBlueprint({ ...a, worth: a.worth + 1 })).toBe(false); // changed after sealing
    expect(validateBlueprint({ ...a, piece: { ...a.piece, baseDamage: 9999 } })).toBe(false);
    const { integrity: _i, ...body } = a;
    // Resealed, but out of bounds or broken: still refused.
    expect(validateBlueprint(sealBlueprint({ ...body, lore: 'x'.repeat(BLUEPRINT_LIMITS.lore + 1) }))).toBe(false);
    expect(validateBlueprint(sealBlueprint({ ...body, piece: { ...body.piece, materials: [{ materialId: 'gold' as never, quantity: 1 }] } }))).toBe(false);
    expect(validateBlueprint(sealBlueprint({ ...body, piece: { ...body.piece, id: 'gbp_other' } }))).toBe(false);
    expect(validateBlueprint(null)).toBe(false);
  });

  it('makes rarer blueprints, needing higher levels, in tougher areas', () => {
    const avg = (level: number) => {
      let tiers = 0;
      for (let i = 0; i < 200; i++) tiers += RARITY_ORDER.indexOf(generateBlueprint(`s${i}`, { ...ctx, level }).rarity);
      return tiers / 200;
    };
    expect(avg(10)).toBeGreaterThan(avg(1));
    const rare = Array.from({ length: 200 }, (_, i) => generateBlueprint(`r${i}`, ctx)).filter((b) => b.rarity !== 'common');
    expect(rare.length).toBeGreaterThan(0);
    for (const b of rare) expect(b.requirement.level).toBeGreaterThan(0);
  });
});

describe('found blueprints: scrolls and learning', () => {
  it('learns a scroll and keeps it; a second learn says it is already learned; discarding keeps it learned', () => {
    const bp = generateBlueprint('seed-1', ctx);
    const add = addScroll(createInventory('p1'), bp);
    if (!add.ok) throw new Error(add.message);
    const learn = learnScroll(add.inventory, add.scrollId);
    if (!learn.ok) throw new Error(learn.message);
    expect(Object.keys(learn.inventory.scrolls!)).toEqual([add.scrollId]); // the scroll stays
    expect(learnedBlueprints(learn.inventory).map((b) => b.id)).toEqual([bp.id]);
    expect(learnScroll(learn.inventory, add.scrollId)).toMatchObject({ ok: false, error: 'already_learned', message: "You've already learned this blueprint." });
    // A second copy of the same blueprint (found again, or traded) can be carried, not learned again.
    const again = addScroll(learn.inventory, bp);
    if (!again.ok) throw new Error(again.message);
    expect(learnScroll(again.inventory, again.scrollId)).toMatchObject({ ok: false, error: 'already_learned' });
    const gone = discardScroll(again.inventory, add.scrollId);
    if (!gone.ok) throw new Error(gone.message);
    expect(gone.inventory.scrolls![add.scrollId]).toBeUndefined();
    expect(learnedBlueprints(gone.inventory)).toHaveLength(1);
    expect(validateInventory(gone.inventory)).toEqual({ ok: true });
    expect(learnScroll(gone.inventory, 'scr-nope')).toMatchObject({ ok: false, error: 'unknown_scroll' });
  });

  it('refuses damaged blueprints and more than the bag holds, and a save with a tampered one', () => {
    const bp = generateBlueprint('seed-1', ctx);
    expect(addScroll(createInventory('p1'), { ...bp, worth: 1 })).toMatchObject({ ok: false, error: 'invalid_blueprint' });
    let inv = createInventory('p1');
    for (let i = 0; i < MAX_SCROLLS; i++) {
      const r = addScroll(inv, bp);
      if (!r.ok) throw new Error(r.message);
      inv = r.inventory;
    }
    expect(addScroll(inv, bp)).toMatchObject({ ok: false, error: 'scrolls_full' });
    const bad = { ...inv, scrolls: { x: { ...bp, name: 'Changed' } } };
    expect(validateInventory(bad)).toMatchObject({ ok: false });
  });
});

describe('found blueprints: forging', () => {
  const learned = (seed: string) => {
    const bp = generateBlueprint(seed, { ...ctx, area: 'trail' });
    const add = addScroll(stocked(), bp);
    if (!add.ok) throw new Error(add.message);
    const l = learnScroll(add.inventory, add.scrollId);
    if (!l.ok) throw new Error(l.message);
    return { bp, inv: l.inventory };
  };
  const forge = (inv: InventoryState, blueprintId: string, mastery = 60) =>
    executeForge(inv, { txId: `tx-${blueprintId}`, blueprintId, mode: 'quick', bufferQuantity: resolveBlueprint(inv, blueprintId)?.buffer.standardBatch ?? 2, maker: { id: 'p1', name: 'Smith', mastery }, createdAt: 5 });

  it('forges only once learned; the item keeps a copy, equips by it, and survives validation', () => {
    const bp = generateBlueprint('seed-forge', { ...ctx, area: 'trail' });
    const notYet = addScroll(stocked(), bp);
    if (!notYet.ok) throw new Error(notYet.message);
    expect(forge(notYet.inventory, bp.id)).toMatchObject({ ok: false, error: 'unknown_blueprint' });

    const { inv } = learned('seed-forge');
    const r = forge(inv, bp.id);
    if (!r.ok) throw new Error(r.message);
    expect(r.item.blueprintId).toBe(bp.id);
    expect(r.item.blueprint).toEqual(bp.piece);
    expect(validateItem(r.item)).toBe(true);
    expect(validateInventory(r.inventory)).toEqual({ ok: true });
    const eq = equipItem(r.inventory, r.item.itemId, 6);
    if (!eq.ok) throw new Error(eq.message);
    expect(eq.slot).toBe(bp.piece.equip?.slot ?? 'weapon');
    // Its copy is sealed: changing it breaks the item.
    expect(validateItem({ ...r.item, blueprint: { ...r.item.blueprint!, baseDamage: 999 } })).toBe(false);
    // The copy is enough on its own: the item is valid even where the blueprint isn't learned.
    expect(validateInventory({ ...r.inventory, learned: {} })).toEqual({ ok: true });
  });

  it('asks for the blueprint’s level', () => {
    const { bp, inv } = learned('seed-level');
    const need = bp.piece.masteryRequirement;
    if (need > 0) expect(forge(inv, bp.id, need - 1)).toMatchObject({ ok: false, error: 'mastery_too_low' });
    expect(forge(inv, bp.id, need).ok).toBe(true);
  });
});
