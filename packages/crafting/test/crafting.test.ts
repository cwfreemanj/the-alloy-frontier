import { describe, expect, it } from 'vitest';
import {
  addMaterial,
  applyStrike,
  boardFor,
  buy,
  createInventory,
  equipWeapon,
  evaluateHammerEvidence,
  executeForge,
  forecastBuffer,
  grantItem,
  materialTotal,
  planForge,
  startHammering,
  suggestStrike,
  validateInventory,
  type ForgeRequest,
  type InventoryState,
  type Strike,
} from '../src';
import type { HeatLevel } from '@alloy/item-gen';

function stocked(over: Partial<Record<'iron_ore' | 'ironwood' | 'ironglass' | 'binding_flux', number>> = {}): InventoryState {
  let inv = createInventory('p1', 100);
  const add = (materialId: 'iron_ore' | 'ironwood' | 'ironglass' | 'binding_flux', quantity: number, quality: number) => {
    if (quantity <= 0) return;
    const r = addMaterial(inv, { materialId, quantity, quality, origin: 'test' });
    if (!r.ok) throw new Error(r.message);
    inv = r.inventory;
  };
  add('iron_ore', over.iron_ore ?? 10, 0.6);
  add('ironwood', over.ironwood ?? 4, 0.5);
  add('ironglass', over.ironglass ?? 6, 0.7);
  add('binding_flux', over.binding_flux ?? 40, 0.5);
  return inv;
}

const maker = { id: 'p1', name: 'Apprentice', mastery: 10 };
const quick = (over: Partial<ForgeRequest> = {}): ForgeRequest => ({
  txId: 'tx-1',
  blueprintId: 'iron_longsword',
  mode: 'quick',
  bufferQuantity: 2,
  maker,
  createdAt: 1,
  ...over,
});

function solve(inv: InventoryState, blueprintId: string, heat: HeatLevel, mastery: number): Strike[] {
  const board = boardFor(inv, blueprintId);
  let st = startHammering(board, heat, mastery);
  for (;;) {
    const s = suggestStrike(st, board.size, heat);
    if (!s) break;
    st = applyStrike(st, board.size, s)!.state;
  }
  return st.log;
}

describe('Quick Forge transaction (AF-005)', () => {
  it('valid craft produces the item and consumes materials exactly once', () => {
    const inv = stocked();
    const r = executeForge(inv, quick());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(materialTotal(r.inventory, 'iron_ore')).toBe(7);
    expect(materialTotal(r.inventory, 'ironwood')).toBe(3);
    expect(materialTotal(r.inventory, 'binding_flux')).toBe(38);
    expect(Object.keys(r.inventory.items)).toHaveLength(1);
    expect(r.item.source).toBe('quick_forge');
    expect(r.item.forge.mastery).toBe(10);
    // Original state untouched (atomic, functional).
    expect(materialTotal(inv, 'iron_ore')).toBe(10);
    const eq = equipWeapon(r.inventory, r.item.itemId, 2);
    expect(eq.ok).toBe(true);
    if (eq.ok) expect(eq.inventory.equipped.weapon).toBe(r.item.itemId);
  });

  it('invalid crafting consumes nothing', () => {
    const inv = stocked({ iron_ore: 2 });
    const before = JSON.stringify(inv);
    const r = executeForge(inv, quick());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('insufficient_materials');
    expect(JSON.stringify(inv)).toBe(before);
  });

  it.each([
    ['unknown blueprint', { blueprintId: 'nope' }, 'unknown_blueprint'],
    ['non-craftable', { blueprintId: 'merchant_steel_longsword' }, 'not_craftable'],
    ['buffer below minimum', { bufferQuantity: 1 }, 'invalid_buffer'],
    ['fractional buffer', { bufferQuantity: 2.5 }, 'invalid_buffer'],
    ['absurd buffer', { bufferQuantity: 1e9 }, 'invalid_buffer'],
    ['buffer not owned', { bufferQuantity: 41 }, 'insufficient_buffer'],
    ['quick specialization', { specialization: 'keen' as const }, 'invalid_specialization'],
    ['mastery too low', { blueprintId: 'tempered_longsword', maker: { ...maker, mastery: 2 } }, 'mastery_too_low'],
    ['masterwork without evidence', { mode: 'masterwork' as const }, 'missing_evidence'],
  ])('rejects %s without side effects', (_n, over, code) => {
    const inv = stocked();
    const before = JSON.stringify(inv);
    const r = executeForge(inv, quick(over as Partial<ForgeRequest>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(code);
    expect(JSON.stringify(inv)).toBe(before);
  });

  it('repeated requests cannot duplicate materials or equipment', () => {
    const inv = stocked();
    const r1 = executeForge(inv, quick());
    if (!r1.ok) throw new Error(r1.message);
    const r2 = executeForge(r1.inventory, quick({ createdAt: 999 }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.duplicate).toBe(true);
    expect(r2.item.itemId).toBe(r1.item.itemId);
    expect(Object.keys(r2.inventory.items)).toHaveLength(1);
    expect(materialTotal(r2.inventory, 'iron_ore')).toBe(7);
    const conflict = executeForge(r1.inventory, quick({ bufferQuantity: 5 }));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error).toBe('tx_conflict');
  });

  it('generates unique item ids across many crafts', () => {
    let inv = stocked({ iron_ore: 300, ironwood: 100, binding_flux: 1000 });
    const ids = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const r = executeForge(inv, quick({ txId: `tx-${i}` }));
      if (!r.ok) throw new Error(r.message);
      ids.add(r.item.itemId);
      inv = r.inventory;
    }
    expect(ids.size).toBe(80);
    expect(validateInventory(inv).ok).toBe(true);
  });

  it('is deterministic for identical state and request', () => {
    const inv = stocked();
    const a = executeForge(inv, quick());
    const b = executeForge(inv, quick());
    expect(a.ok && b.ok && JSON.stringify(a.item) === JSON.stringify(b.item)).toBe(true);
  });
});

describe('crafted stats depend on mastery and inputs', () => {
  it('higher mastery yields a stronger item from the same steel', () => {
    const inv = stocked();
    const lo = planForge(inv, quick({ maker: { ...maker, mastery: 0 } }));
    const hi = planForge(inv, quick({ maker: { ...maker, mastery: 100 } }));
    if (!lo.ok || !hi.ok) throw new Error('plan failed');
    expect(hi.plan.item.result.damage).toBeGreaterThan(lo.plan.item.result.damage * 1.8);
  });

  it('more buffer is never worse, with diminishing benefit (forecast)', () => {
    const inv = stocked({ binding_flux: 200 });
    let prev = 0;
    for (let q = 2; q <= 150; q += 4) {
      const r = planForge(inv, quick({ bufferQuantity: q }));
      if (!r.ok) throw new Error(r.message);
      expect(r.plan.item.forge.formulaDamage).toBeGreaterThanOrEqual(prev);
      prev = r.plan.item.forge.formulaDamage;
    }
    const f = forecastBuffer(inv, quick({ bufferQuantity: 6 }));
    expect(f?.plusBatch?.forge.bufferFactor).toBeGreaterThan(f!.chosen!.forge.bufferFactor);
    expect(f!.chosen!.forge.bufferFactor).toBeGreaterThan(f!.min!.forge.bufferFactor);
  });

  it('higher-quality material lots improve the result', () => {
    let good = createInventory('p1');
    let poor = createInventory('p1');
    for (const [id, q] of [
      ['iron_ore', 3],
      ['ironwood', 1],
      ['binding_flux', 2],
    ] as const) {
      good = (addMaterial(good, { materialId: id, quantity: q, quality: 1, origin: 'rich' }) as { inventory: InventoryState }).inventory;
      poor = (addMaterial(poor, { materialId: id, quantity: q, quality: 0.1, origin: 'poor' }) as { inventory: InventoryState }).inventory;
    }
    const g = planForge(good, quick());
    const p = planForge(poor, quick());
    if (!g.ok || !p.ok) throw new Error('plan failed');
    expect(g.plan.item.result.damage).toBeGreaterThan(p.plan.item.result.damage);
  });
});

describe('Masterwork Forge puzzle and evidence (AF-006)', () => {
  it('replays honest evidence and rewards a better score', () => {
    const inv = stocked();
    const strikes = solve(inv, 'iron_longsword', 'cherry', maker.mastery);
    const good = executeForge(inv, quick({ mode: 'masterwork', specialization: 'heavy', temper: 'oil', evidence: { heat: 'cherry', strikes } }));
    const lazy = executeForge(inv, quick({ txId: 'tx-lazy', mode: 'masterwork', specialization: 'heavy', temper: 'oil', evidence: { heat: 'cherry', strikes: strikes.slice(0, 1) } }));
    if (!good.ok || !lazy.ok) throw new Error('forge failed');
    expect(good.item.forge.forgeScore).toBeGreaterThan(lazy.item.forge.forgeScore);
    expect(good.item.forge.formulaDamage).toBeGreaterThanOrEqual(lazy.item.forge.formulaDamage);
    expect(good.item.forge.specialization).toBe('heavy');
    expect(good.item.forge.stages.map((s) => s.stage)).toEqual(['heating', 'hammering', 'tempering']);
  });

  it('a good masterwork outperforms Quick Forge with the same materials', () => {
    const inv = stocked();
    const strikes = solve(inv, 'iron_longsword', 'cherry', maker.mastery);
    const mw = planForge(inv, quick({ mode: 'masterwork', temper: 'oil', evidence: { heat: 'cherry', strikes } }));
    const q = planForge(inv, quick());
    if (!mw.ok || !q.ok) throw new Error('plan failed');
    expect(mw.plan.hammer!.score).toBeGreaterThan(0.5);
    expect(mw.plan.item.result.damage).toBeGreaterThan(q.plan.item.result.damage);
  });

  it('rejects forged / impossible evidence without consuming anything', () => {
    const inv = stocked();
    const before = JSON.stringify(inv);
    const tooMany = Array.from({ length: 40 }, () => ({ x: 0, y: 0, kind: 'focused' as const }));
    const bounds = [{ x: 9, y: 0, kind: 'focused' as const }];
    for (const strikes of [tooMany, bounds, 'cheat' as unknown as Strike[]]) {
      const r = executeForge(inv, quick({ mode: 'masterwork', evidence: { heat: 'cherry', strikes } }));
      expect(r.ok).toBe(false);
    }
    expect(JSON.stringify(inv)).toBe(before);
  });

  it('interactive play and authority replay agree', () => {
    const inv = stocked();
    const board = boardFor(inv, 'iron_longsword');
    const strikes = solve(inv, 'iron_longsword', 'bright', 10);
    const evalA = evaluateHammerEvidence(board, 'bright', strikes, 10);
    const evalB = evaluateHammerEvidence(board, 'bright', strikes, 10);
    expect(evalA).toEqual(evalB);
    expect(evalA.ok).toBe(true);
  });

  it('a poor forge is a tradeoff, never destruction', () => {
    const inv = stocked();
    const r = executeForge(inv, quick({ mode: 'masterwork', evidence: { heat: 'cherry', strikes: [] } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.result.damage).toBeGreaterThan(0);
  });
});

describe('merchant and grants', () => {
  it('buys atomically and idempotently', () => {
    const inv = stocked();
    const r = buy(inv, { txId: 'b1', stockId: 'steel_longsword', quantity: 1, createdAt: 1 });
    if (!r.ok) throw new Error(r.message);
    expect(r.inventory.coins).toBe(65);
    expect(r.item?.result.damage).toBe(20);
    expect(r.item?.result.rarity).toBe('common');
    const again = buy(r.inventory, { txId: 'b1', stockId: 'steel_longsword', quantity: 1, createdAt: 5 });
    expect(again.ok && again.duplicate && again.inventory.coins === 65).toBe(true);
    const poor = createInventory('p2', 3);
    const fail = buy(poor, { txId: 'b2', stockId: 'steel_longsword', quantity: 1, createdAt: 1 });
    expect(fail.ok).toBe(false);
    expect(poor.coins).toBe(3);
  });
  it('grants quest items once', () => {
    const inv = createInventory('p1');
    const a = grantItem(inv, 'grant-worn', 'worn_longsword', 1);
    if (!a.ok) throw new Error('grant failed');
    const b = grantItem(a.inventory, 'grant-worn', 'worn_longsword', 2);
    expect(b.ok && Object.keys(b.inventory.items).length).toBe(1);
  });
  it('validateInventory catches tampered items', () => {
    const inv = createInventory('p1');
    const a = grantItem(inv, 'g', 'worn_longsword', 1);
    if (!a.ok) throw new Error('grant failed');
    const t = JSON.parse(JSON.stringify(a.inventory)) as InventoryState;
    const id = t.itemOrder[0];
    t.items[id].result.damage = 500;
    expect(validateInventory(t).ok).toBe(false);
  });
});
