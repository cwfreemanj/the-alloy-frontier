/**
 * Perk choices (docs/proficiency-tree.md, step 2): the rules for choosing and re-picking, and the
 * Smithing perks' effects in the forge.
 */
import { describe, expect, it } from 'vitest';
import { PERKS, PERK_EFFECTS, addProficiencyXp, choosePerk, chosenPerks, clearPerks, createProgression, milestones, pendingChoices, respecFee } from '@alloy/game-rules';
import { validateItem } from '@alloy/item-gen';
import { addMaterial, createInventory, executeForge, type ForgeRequest, type InventoryState } from '../src';

describe('perk choices', () => {
  it('offers two perks at every 10th level; only milestones whose perks both work are offered', () => {
    for (const b of ['smithing', 'crafting', 'alchemy'] as const) for (const m of milestones(b)) expect(m.perks).toHaveLength(2);
    expect(milestones('smithing').every((m) => m.ready)).toBe(true);
    expect(milestones('crafting').some((m) => m.ready)).toBe(false); // nothing trains Crafting yet
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
  });

  it('lets a smith choose one perk per reached milestone, and re-pick for a doubling fee', () => {
    const p = createProgression(); // blacksmithing mastery 10: the first Smithing milestone is reached
    expect(pendingChoices(p)).toEqual([{ branch: 'smithing', level: 10 }]);
    expect(choosePerk(p, 'flux_saver')).toMatchObject({ ok: false, error: 'level_too_low' });
    expect(choosePerk(p, 'cook')).toMatchObject({ ok: false, error: 'not_ready' });
    expect(choosePerk(p, 'nope')).toMatchObject({ ok: false, error: 'unknown_perk' });
    expect(choosePerk(p, 'weaponsmith')).toMatchObject({ ok: true });
    expect(choosePerk(p, 'armorsmith')).toMatchObject({ ok: false, error: 'already_chosen' });
    expect(pendingChoices(p)).toEqual([]);
    expect(respecFee(p, 'smithing')).toBe(50);
    expect(clearPerks(p, 'smithing')).toBe(1);
    expect(chosenPerks(p)).toEqual([]);
    expect(respecFee(p, 'smithing')).toBe(100);
    expect(choosePerk(p, 'armorsmith')).toMatchObject({ ok: true });
    // Alchemy's first milestone opens at Alchemy 10.
    addProficiencyXp(p, 'alchemy', 5000);
    expect(pendingChoices(p).some((c) => c.branch === 'alchemy')).toBe(true);
  });
});

describe('Smithing perks in the forge', () => {
  function stocked(): InventoryState {
    let inv = createInventory('p1', 100);
    for (const [m, q] of [['iron_ore', 60], ['ironwood', 20], ['ironglass', 40], ['binding_flux', 80]] as const) {
      const r = addMaterial(inv, { materialId: m, quantity: q, quality: 0.6, origin: 'test' });
      if (!r.ok) throw new Error(r.message);
      inv = r.inventory;
    }
    return inv;
  }
  const forge = (blueprintId: string, perks: string[] = [], over: Partial<ForgeRequest> = {}) =>
    executeForge(stocked(), { txId: 'tx', blueprintId, mode: 'quick', bufferQuantity: 2, maker: { id: 'p1', name: 'Smith', mastery: 20, perks }, createdAt: 1, ...over });

  it('Weaponsmith: +5% damage on weapons, recorded on the item', () => {
    const plain = forge('iron_longsword');
    const perked = forge('iron_longsword', ['weaponsmith']);
    if (!plain.ok || !perked.ok) throw new Error('forge failed');
    expect(perked.item.result.damage).toBe(Math.round(plain.item.result.damage * PERK_EFFECTS.weaponsmithDamage));
    expect(perked.item.forge.perks).toEqual(['weaponsmith']);
    expect(plain.item.forge.perks).toBeUndefined(); // no perks: the item is exactly as before
    expect(validateItem(perked.item)).toBe(true);
    // It doesn't touch armor.
    const shield = forge('iron_shield', ['weaponsmith']);
    if (!shield.ok) throw new Error(shield.message);
    expect(shield.item.forge.perks).toBeUndefined();
  });

  it('Armorsmith: +8% defense on armor and shields', () => {
    const plain = forge('iron_chestplate', [], { bufferQuantity: 3 });
    const perked = forge('iron_chestplate', ['armorsmith'], { bufferQuantity: 3 });
    if (!plain.ok || !perked.ok) throw new Error('forge failed');
    expect(perked.item.result.defense!).toBeGreaterThan(plain.item.result.defense!);
  });

  it('Flux Saver: one less flux; Ironglass Adept: ironglass recipes 3 levels sooner', () => {
    expect(forge('iron_longsword', [], { bufferQuantity: 1 })).toMatchObject({ ok: false, error: 'invalid_buffer' });
    expect(forge('iron_longsword', ['flux_saver'], { bufferQuantity: 1 }).ok).toBe(true);
    const low = { maker: { id: 'p1', name: 'Smith', mastery: 3 } };
    expect(forge('ironglass_longsword', [], { ...low, bufferQuantity: 3 })).toMatchObject({ ok: false, error: 'mastery_too_low' }); // needs 5
    expect(forge('ironglass_longsword', ['ironglass_adept'], { maker: { ...low.maker, perks: ['ironglass_adept'] }, bufferQuantity: 3 }).ok).toBe(true);
    expect(forge('iron_mace', ['ironglass_adept'], { maker: { id: 'p1', name: 'Smith', mastery: 1, perks: ['ironglass_adept'] } })).toMatchObject({ ok: false, error: 'mastery_too_low' }); // not ironglass
  });
});
