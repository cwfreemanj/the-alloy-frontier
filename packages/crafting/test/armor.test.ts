/**
 * Forge expansion, phase 1: a mace and armor (shields, helmets, chestplates, platelegs) are forged,
 * sealed and equipped like swords, with defense instead of damage.
 */
import { describe, expect, it } from 'vitest';
import { mitigate } from '@alloy/game-rules';
import { ARMOR_AFFIXES, BLUEPRINTS, CRAFTABLE_BLUEPRINTS, generateItem, validateItem, type GenerationInput } from '@alloy/item-gen';
import { addMaterial, createInventory, equipItem, executeForge, slotOf, type ForgeRequest, type InventoryState } from '../src';

function stocked(): InventoryState {
  let inv = createInventory('p1', 100);
  for (const [m, q] of [['iron_ore', 40], ['ironwood', 10], ['ironglass', 20], ['binding_flux', 60]] as const) {
    const r = addMaterial(inv, { materialId: m, quantity: q, quality: 0.6, origin: 'test' });
    if (!r.ok) throw new Error(r.message);
    inv = r.inventory;
  }
  return inv;
}

const NEW = ['iron_mace', 'ironglass_mace', 'iron_shield', 'ironglass_shield', 'iron_helmet', 'ironglass_helmet', 'iron_chestplate', 'ironglass_chestplate', 'iron_platelegs', 'ironglass_platelegs'];
const ARMOR = NEW.filter((id) => !id.endsWith('_mace'));

const input = (blueprintId: string, over: Partial<GenerationInput> = {}): GenerationInput => ({
  itemId: `itm-${blueprintId}`,
  seed: `seed-${blueprintId}`,
  blueprintId,
  source: 'quick_forge',
  mode: 'quick',
  materials: BLUEPRINTS[blueprintId].materials.map((m, i) => ({ lotId: `l${i}`, materialId: m.materialId, quantity: m.quantity, quality: 0.6 })),
  bufferQuantity: BLUEPRINTS[blueprintId].buffer.standardBatch,
  maker: { id: 'p1', name: 'Tester', mastery: 10 },
  createdAt: 1000,
  ...over,
});

describe('forge expansion: mace and armor blueprints', () => {
  it('adds ten craftable blueprints with a slot, a family and a workshop look', () => {
    for (const id of NEW) {
      const bp = BLUEPRINTS[id];
      expect(bp, id).toBeDefined();
      expect(CRAFTABLE_BLUEPRINTS).toContain(bp);
      expect(bp.look?.type).toBeTruthy();
    }
    expect(BLUEPRINTS.iron_mace.family).toBe('mace');
    expect(BLUEPRINTS.iron_shield.equip?.slot).toBe('offhand');
    expect(BLUEPRINTS.iron_helmet.equip?.slot).toBe('head');
    expect(BLUEPRINTS.iron_chestplate.equip?.slot).toBe('chest');
    expect(BLUEPRINTS.iron_platelegs.equip?.slot).toBe('legs');
    // Armor allows only the standard pattern (specializations are weapon handling).
    for (const id of ARMOR) expect(BLUEPRINTS[id].allowedSpecializations).toEqual(['balanced']);
  });

  it('gives armor defense that grows with craftsmanship, and neutral weapon stats', () => {
    const low = generateItem(input('iron_chestplate', { maker: { id: 'p1', name: 'T', mastery: 0 } }));
    const high = generateItem(input('iron_chestplate', { maker: { id: 'p1', name: 'T', mastery: 80 } }));
    expect(low.result.defense).toBeGreaterThan(0);
    expect(high.result.defense!).toBeGreaterThan(low.result.defense!);
    expect(low.result).toMatchObject({ damage: 1, stagger: 0, imbuements: [] });
    expect(low.result.rating).toBeGreaterThan(0);
    expect(validateItem(low)).toBe(true);
    // Same inputs, same item.
    expect(generateItem(input('iron_chestplate', { maker: { id: 'p1', name: 'T', mastery: 0 } }))).toEqual(low);
    // Defense halves a hit at 100 (docs/equipment-contract.md).
    expect(mitigate(100, 100)).toBe(50);
  });

  it('rolls armor affixes (not weapon ones) on rarer pieces', () => {
    const ids = new Set(ARMOR_AFFIXES.map((a) => a.id));
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      const it = generateItem(input('iron_helmet', { seed: `s${i}`, mode: 'masterwork', source: 'masterwork_forge', forgeScore: 1, maker: { id: 'p1', name: 'T', mastery: 100 } }));
      for (const a of it.result.affixes) {
        expect(ids.has(a.id)).toBe(true);
        seen++;
      }
      if (it.result.affixes.some((a) => a.id === 'padded')) expect(it.result.bonuses?.maxHealth).toBeGreaterThanOrEqual(12);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('gives the mace more stagger and less speed than the iron longsword', () => {
    const mace = generateItem(input('iron_mace'));
    const sword = generateItem(input('iron_longsword'));
    expect(mace.result.stagger).toBeGreaterThan(sword.result.stagger);
    expect(mace.result.attackSpeed).toBeLessThan(sword.result.attackSpeed);
    expect(mace.result.defense).toBeUndefined();
  });

  it('forges every new blueprint through the normal transaction, and each goes in its own slot', () => {
    let inv = stocked();
    const slots: Record<string, string> = {};
    for (const [i, id] of NEW.entries()) {
      const req: ForgeRequest = { txId: `tx-${i}`, blueprintId: id, mode: 'quick', bufferQuantity: BLUEPRINTS[id].buffer.standardBatch, maker: { id: 'p1', name: 'Smith', mastery: 20 }, createdAt: i + 1 };
      const r = executeForge(inv, req);
      if (!r.ok) throw new Error(`${id}: ${r.message}`);
      inv = r.inventory;
      const e = equipItem(inv, r.item.itemId, i + 1);
      if (!e.ok) throw new Error(`${id}: ${e.message}`);
      inv = e.inventory;
      slots[id] = e.slot;
      expect(slotOf(inv, r.item.itemId)).toBe(e.slot);
    }
    expect(slots).toMatchObject({ iron_shield: 'offhand', iron_helmet: 'head', iron_chestplate: 'chest', iron_platelegs: 'legs', ironglass_mace: 'weapon' });
  });
});
