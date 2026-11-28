/**
 * The Crafting branch (AF-021): rings, necklaces and capes made at the workbench, with bonuses scaled by
 * craftsmanship, gated on Crafting level, and the Jeweler and Tailor perks.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, validateItem } from '@alloy/item-gen';
import { addMaterial, createInventory, equipItem, executeForge, type ForgeRequest, type InventoryState } from '../src';

function stocked(): InventoryState {
  let inv = createInventory('p1', 100);
  for (const [m, q] of [['iron_ore', 40], ['ironwood', 10], ['ironglass', 20], ['binding_flux', 40], ['emberleaf', 20]] as const) {
    const r = addMaterial(inv, { materialId: m, quantity: q, quality: 0.6, origin: 'test' });
    if (!r.ok) throw new Error(r.message);
    inv = r.inventory;
  }
  return inv;
}
const craft = (blueprintId: string, level = 20, perks: string[] = [], over: Partial<ForgeRequest> = {}) =>
  executeForge(stocked(), { txId: `tx-${blueprintId}`, blueprintId, mode: 'quick', bufferQuantity: BLUEPRINTS[blueprintId].buffer.min, maker: { id: 'p1', name: 'Crafter', mastery: level, perks }, createdAt: 1, ...over });

describe('the Crafting branch: accessories', () => {
  it('has four workbench recipes (rings, a necklace, a cape), Quick only', () => {
    const ids = Object.values(BLUEPRINTS).filter((b) => b.branch === 'crafting').map((b) => b.id);
    expect(ids).toEqual(['iron_band', 'ironglass_ring', 'ember_pendant', 'emberleaf_cloak']);
    for (const id of ids) expect(BLUEPRINTS[id].modes).toEqual(['quick']);
  });

  it('makes a ring with its bonuses (no defense) that goes in a ring slot, and a cape with a little defense', () => {
    const ring = craft('iron_band');
    if (!ring.ok) throw new Error(ring.message);
    expect(ring.item.result.bonuses?.attributes?.strength).toBeGreaterThanOrEqual(1);
    expect(ring.item.result.defense).toBeUndefined();
    expect(validateItem(ring.item)).toBe(true);
    const eq = equipItem(ring.inventory, ring.item.itemId, 2);
    if (!eq.ok) throw new Error(eq.message);
    expect(eq.slot).toBe('ring1');
    const cape = craft('emberleaf_cloak');
    if (!cape.ok) throw new Error(cape.message);
    expect(cape.item.result.defense).toBeGreaterThan(0);
    expect(cape.item.result.bonuses?.maxStamina).toBeGreaterThanOrEqual(8);
  });

  it('needs the Crafting level, and higher Crafting makes stronger bonuses', () => {
    expect(craft('ironglass_ring', 4)).toMatchObject({ ok: false, error: 'mastery_too_low', message: expect.stringContaining('Crafting 5') });
    const low = craft('ember_pendant', 3);
    const high = craft('ember_pendant', 90);
    if (!low.ok || !high.ok) throw new Error('craft failed');
    // Same materials and roll: Crafting 90 makes a pendant of about +22 health where Crafting 3 makes +12.
    expect(high.item.result.bonuses!.maxHealth!).toBeGreaterThan(low.item.result.bonuses!.maxHealth! + 5);
    expect(high.item.result.rating).toBeGreaterThan(low.item.result.rating);
  });

  it('Jeweler adds an affix to rings and necklaces; Tailor adds stamina to capes; neither touches the other', () => {
    const plain = craft('iron_band');
    const jeweler = craft('iron_band', 20, ['jeweler']);
    if (!plain.ok || !jeweler.ok) throw new Error('craft failed');
    expect(jeweler.item.result.affixes.length).toBe(plain.item.result.affixes.length + 1);
    expect(jeweler.item.forge.perks).toEqual(['jeweler']);
    const cape = craft('emberleaf_cloak');
    const tailored = craft('emberleaf_cloak', 20, ['tailor', 'jeweler']);
    if (!cape.ok || !tailored.ok) throw new Error('craft failed');
    expect(tailored.item.result.bonuses!.maxStamina!).toBe(cape.item.result.bonuses!.maxStamina! + 5);
    expect(tailored.item.forge.perks).toEqual(['tailor']);
    // Smithing perks don't apply at the workbench.
    const smith = craft('iron_band', 20, ['weaponsmith', 'masterwork_eye']);
    if (!smith.ok) throw new Error(smith.message);
    expect(smith.item.forge.perks).toBeUndefined();
  });
});
