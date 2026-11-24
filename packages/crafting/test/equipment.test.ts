/** Equipment slots: where items go, two-handed weapons, rings, tools, validation. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLUEPRINTS, computeIntegrity, type BlueprintDefinition, type EquipInfo, type ItemInstance } from '@alloy/item-gen';
import { createInventory, discardItem, equipItem, equipWeapon, grantItem, normalizeEquipped, slotOf, unequip, validateInventory, type InventoryState } from '../src';

/** Stand-in blueprints until the equipment algorithm provides real ones. */
const TEST_BPS: Record<string, EquipInfo> = {
  test_greatsword: { slot: 'weapon', hands: 2 },
  test_shield: { slot: 'offhand' },
  test_helm: { slot: 'head' },
  test_ring: { slot: 'ring' },
  test_pick: { slot: 'tool', tool: { kind: 'mining', power: 2 } },
};

beforeAll(() => {
  for (const [id, equip] of Object.entries(TEST_BPS)) {
    BLUEPRINTS[id] = { ...(BLUEPRINTS.worn_longsword as BlueprintDefinition), id, name: id, equip };
  }
});
afterAll(() => {
  for (const id of Object.keys(TEST_BPS)) delete BLUEPRINTS[id];
});

let tx = 0;
function give(inv: InventoryState, bp: string, patch?: Partial<ItemInstance['result']>): { inv: InventoryState; id: string } {
  const r = grantItem(inv, `t-${++tx}`, bp, 1000);
  if (!r.ok || !r.item) throw new Error('grant failed');
  if (patch) {
    const it = r.inventory.items[r.item.itemId];
    Object.assign(it.result, patch);
    it.integrity = computeIntegrity(it);
  }
  return { inv: r.inventory, id: r.item.itemId };
}
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe('equipment slots', () => {
  it('puts each item in its own slot and refuses the wrong one', () => {
    let inv = createInventory('p');
    let helm: string;
    ({ inv, id: helm } = give(inv, 'test_helm', { defense: 12 }));
    expect(equipItem(inv, helm, 1, 'chest')).toMatchObject({ ok: false, error: 'wrong_slot' });
    expect(equipWeapon(inv, helm, 1)).toMatchObject({ ok: false, error: 'wrong_slot' });
    inv = ok(equipItem(inv, helm, 1)).inventory;
    expect(inv.equipped.head).toBe(helm);
    expect(validateInventory(inv)).toEqual({ ok: true });
  });

  it('fills the empty ring slot first and can move a ring between slots', () => {
    let inv = createInventory('p');
    let a: string, b: string;
    ({ inv, id: a } = give(inv, 'test_ring'));
    ({ inv, id: b } = give(inv, 'test_ring'));
    inv = ok(equipItem(inv, a, 1)).inventory;
    inv = ok(equipItem(inv, b, 1)).inventory;
    expect([inv.equipped.ring1, inv.equipped.ring2]).toEqual([a, b]);
    inv = ok(equipItem(inv, a, 1, 'ring2')).inventory;
    expect([inv.equipped.ring1, inv.equipped.ring2]).toEqual([null, a]);
    expect(validateInventory(inv)).toEqual({ ok: true });
  });

  it('a two-handed weapon empties the off-hand and keeps it empty', () => {
    let inv = createInventory('p');
    let shield: string, gs: string, sword: string;
    ({ inv, id: shield } = give(inv, 'test_shield'));
    ({ inv, id: gs } = give(inv, 'test_greatsword'));
    ({ inv, id: sword } = give(inv, 'worn_longsword'));
    inv = ok(equipItem(inv, shield, 1)).inventory;
    inv = ok(equipItem(inv, gs, 1)).inventory;
    expect(inv.equipped.offhand).toBeNull();
    expect(equipItem(inv, shield, 1)).toMatchObject({ ok: false, error: 'two_handed' });
    inv = ok(equipItem(inv, sword, 1)).inventory;
    inv = ok(equipItem(inv, shield, 1)).inventory;
    expect(inv.equipped.offhand).toBe(shield);
  });

  it('unequips, and refuses to discard equipped items or the last tool of a kind', () => {
    let inv = createInventory('p');
    let pick: string, helm: string;
    ({ inv, id: pick } = give(inv, 'test_pick'));
    ({ inv, id: helm } = give(inv, 'test_helm'));
    inv = ok(equipItem(inv, helm, 1)).inventory;
    expect(discardItem(inv, helm)).toMatchObject({ ok: false, error: 'equipped' });
    inv = ok(unequip(inv, 'head')).inventory;
    expect(slotOf(inv, helm)).toBeNull();
    expect(unequip(inv, 'head')).toMatchObject({ ok: false, error: 'empty' });
    expect(discardItem(inv, helm).ok).toBe(true);
    expect(discardItem(inv, pick)).toMatchObject({ ok: false, error: 'last_tool' });
    let pick2: string;
    ({ inv, id: pick2 } = give(inv, 'test_pick'));
    expect(discardItem(inv, pick).ok).toBe(true);
    expect(pick2).toBeTruthy();
  });

  it('rejects tampered equipment layouts on load', () => {
    let inv = createInventory('p');
    let helm: string, shield: string, gs: string;
    ({ inv, id: helm } = give(inv, 'test_helm'));
    ({ inv, id: shield } = give(inv, 'test_shield'));
    ({ inv, id: gs } = give(inv, 'test_greatsword'));
    expect(validateInventory({ ...inv, equipped: { weapon: null, chest: helm } }).ok).toBe(false);
    expect(validateInventory({ ...inv, equipped: { weapon: null, ring1: helm, head: helm } }).ok).toBe(false);
    expect(validateInventory({ ...inv, equipped: { weapon: gs, offhand: shield } }).ok).toBe(false);
  });

  it('fills the new slots into an old save that only had a main hand', () => {
    const inv = createInventory('p');
    (inv as { equipped: unknown }).equipped = { weapon: null };
    normalizeEquipped(inv);
    expect(inv.equipped.head).toBeNull();
    expect(inv.equipped.tool).toBeNull();
    expect(validateInventory(inv)).toEqual({ ok: true });
  });
});
