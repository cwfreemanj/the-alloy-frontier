import { describe, expect, it } from 'vitest';
import { FORGE_ANVIL, NPCS, RESOURCE_NODES } from '@alloy/world';
import { NODE_MAX_CHARGES, NODE_RESPAWN_SECONDS, RANGE_SLACK, Session, applyAction, characterStats, newSessionData, playerHit, rewardHit, rewardHitTaken, rewardKill } from '../src';
import { BASE_MAX_HEALTH, attributeXpToNext } from '@alloy/game-rules';

const fresh = () => new Session(newSessionData(1000));
const ore = RESOURCE_NODES.find((n) => n.material === 'iron_ore')!;
const at = (p: { x: number; z: number }) => ({ pos: { x: p.x, z: p.z } });
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('applyAction', () => {
  it('gathers only in range, with server-decided quantity and quality', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: { x: ore.pos.x + 10, z: ore.pos.z } })).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: null })).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'gather', node: 'nope' }, at(ore.pos))).toMatchObject({ ok: false, error: 'unknown_node' });
    const r = applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos));
    expect(r.ok).toBe(true);
    expect(s.totals().iron_ore).toBe(r.ok ? r.gathered!.qty : -1);
    expect(s.data.world.nodes[ore.id].charges).toBe(NODE_MAX_CHARGES - 1);
  });

  it('allows the latency slack only when the context grants it', () => {
    const s = fresh();
    const just = { x: ore.pos.x + 2.6 + RANGE_SLACK - 0.1, z: ore.pos.z };
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: just }).ok).toBe(false);
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: just, slack: RANGE_SLACK }).ok).toBe(true);
  });

  it('depletes a node and regrows it after the respawn time', () => {
    const s = fresh();
    for (let i = 0; i < NODE_MAX_CHARGES; i++) expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos)).ok).toBe(true);
    expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos))).toMatchObject({ ok: false, error: 'depleted' });
    s.data.playTime += NODE_RESPAWN_SECONDS + 1;
    expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos)).ok).toBe(true);
  });

  it('gates forging on range and on the quest, and forges with the session\'s own mastery', () => {
    const s = fresh();
    s.gather('test', 'iron_ore', 3, 0.6, {});
    s.gather('test', 'ironwood', 1, 0.6, {});
    const req = { txId: 'tx-1', blueprintId: 'iron_longsword', mode: 'quick' as const, bufferQuantity: 2 };
    expect(applyAction(s, { k: 'forge', req }, at(FORGE_ANVIL))).toMatchObject({ ok: false, error: 'quest_gate' });
    expect(applyAction(s, { k: 'talk', npc: 'orla' }, at({ x: 50, z: 50 }))).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'talk', npc: 'orla' }, at(NPCS.orla.pos)).ok).toBe(true);
    expect(applyAction(s, { k: 'forge', req }, at({ x: 0, z: 0 }))).toMatchObject({ ok: false, error: 'out_of_range' });
    const r = applyAction(s, { k: 'forge', req }, at(FORGE_ANVIL));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.item?.blueprintId).toBe('iron_longsword');
      // The maker's mastery comes from the character (before this forge's XP), not from the request.
      expect(r.item?.forge.mastery).toBeLessThanOrEqual(s.smithMastery);
    }
    expect(s.totals().iron_ore).toBe(0);
    // Same transaction again: no second sword, no extra materials consumed.
    const before = Object.keys(s.inventory.items).length;
    applyAction(s, { k: 'forge', req }, at(FORGE_ANVIL));
    expect(Object.keys(s.inventory.items).length).toBe(before);
  });

  it('refuses a masterwork forge without replayable evidence', () => {
    const s = fresh();
    s.talk('orla');
    s.gather('test', 'iron_ore', 3, 0.6, {});
    s.gather('test', 'ironwood', 1, 0.6, {});
    const r = applyAction(s, { k: 'forge', req: { txId: 'tx-m', blueprintId: 'iron_longsword', mode: 'masterwork', bufferQuantity: 2 } }, at(FORGE_ANVIL));
    expect(r).toMatchObject({ ok: false, error: 'missing_evidence' });
    expect(s.totals().iron_ore).toBe(3);
  });

  it('buys only next to the trader and never into negative coins', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'buy', stock: 'binding_flux', qty: 5 }, at({ x: 0, z: 0 }))).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'buy', stock: 'binding_flux', qty: 0 }, at(NPCS.bram.pos))).toMatchObject({ ok: false, error: 'invalid_quantity' });
    const coins = s.inventory.coins;
    expect(applyAction(s, { k: 'buy', stock: 'binding_flux', qty: 5 }, at(NPCS.bram.pos)).ok).toBe(true);
    expect(s.inventory.coins).toBe(coins - 5);
    expect(applyAction(s, { k: 'buy', stock: 'steel_longsword', qty: 99 }, at(NPCS.bram.pos)).ok).toBe(false);
    expect(s.inventory.coins).toBe(coins - 5);
  });

  it('equips and discards only owned items', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'equip', item: 'itm-fake' }, { pos: null }).ok).toBe(false);
    s.talk('orla'); // grants the worn longsword and equips it
    const id = s.equipped()!.itemId;
    expect(applyAction(s, { k: 'discard', item: id }, { pos: null })).toMatchObject({ ok: false, error: 'discard' });
  });
});

describe('rewards', () => {
  it('rolls kill rewards from the given random source and records the kill', () => {
    const s = fresh();
    const coins = s.inventory.coins;
    const r = rewardKill(s, 'scavenger', 'scav-1', seq(0.99, 0.1, 0.99));
    expect(r.coins).toBe(6);
    expect(r.flux).toBe(2);
    expect(s.inventory.coins).toBe(coins + 6);
    expect(s.data.stats.kills.scavenger).toBe(1);
    expect(rewardKill(s, 'nonsense', 'x', Math.random)).toEqual({ coins: 0, flux: 0, events: [] });
  });

  it('computes hit damage from the equipped weapon, and refuses abilities the weapon lacks', () => {
    const s = fresh();
    const bare = playerHit(s, 'light1', () => 0.99)!;
    s.talk('orla');
    const armed = playerHit(s, 'light1', () => 0.99)!;
    expect(armed.damage).toBeGreaterThan(bare.damage);
    expect(playerHit(s, 'storm_arc', () => 0.5)).toBeNull();
    expect(playerHit(s, 'not-an-attack', () => 0.5)).toBeNull();
    expect(playerHit(s, 'guardbreaker', () => 0.99)!.guardBreak).toBe(true);
  });
});

describe('attributes in the session', () => {
  it('fills attributes into an old save that has none', () => {
    const d = newSessionData(1000);
    delete d.progression.attributes;
    const s = new Session(d);
    expect(s.attributes.strength).toEqual({ level: 1, xp: 0 });
    expect(characterStats(s).maxHealth).toBe(BASE_MAX_HEALTH);
  });

  it('grows Strength and Endurance from mining, through the shared action', () => {
    const s = fresh();
    applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos));
    expect(s.attributes.strength.xp).toBeGreaterThan(0);
    expect(s.attributes.endurance.xp).toBeGreaterThan(0);
  });

  it('grows Dexterity from light hits and Strength from heavy ones, never from dummies', () => {
    const s = fresh();
    rewardHit(s, 'scavenger', 20, 'light1');
    expect(s.attributes.dexterity.xp).toBeGreaterThan(0);
    rewardHit(s, 'scavenger', 20, 'heavy');
    expect(s.attributes.strength.xp).toBeGreaterThan(0);
    const before = JSON.stringify(s.attributes);
    rewardHit(s, 'dummy', 50, 'heavy');
    expect(JSON.stringify(s.attributes)).toBe(before);
  });

  it('announces a level-up and applies its bonus to damage and health', () => {
    const s = fresh();
    s.talk('orla');
    const base = playerHit(s, 'light1', () => 0.99)!.damage;
    const ups: unknown[] = [];
    s.on((e) => e.type === 'progress' && e.kind === 'attribute' && ups.push(e));
    s.gainAttributes([['strength', attributeXpToNext(1)]]);
    expect(ups).toEqual([{ type: 'progress', kind: 'attribute', attr: 'strength', levels: 1 }]);
    expect(playerHit(s, 'light1', () => 0.99)!.damage).toBeGreaterThan(base);
    for (let i = 0; i < 40; i++) rewardHitTaken(s, 100);
    expect(characterStats(s).maxHealth).toBeGreaterThan(BASE_MAX_HEALTH);
  });
});
