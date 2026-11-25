import { describe, expect, it } from 'vitest';
import { CONTAINERS, FORGE_PLAN, REFILL, containerDef, terrainHeight } from '@alloy/world';
import { Session, applyAction, containerCooldown, newSessionData, rollLoot } from '../src';

const fresh = (t = 1000) => new Session(newSessionData(t));
const barrel = CONTAINERS.find((c) => c.kind === 'barrel')!;
const cache = CONTAINERS.find((c) => c.kind === 'cache')!;
const at = (c: { pos: { x: number; z: number } }, y?: number) => ({ pos: { x: c.pos.x + 1, z: c.pos.z }, y });

describe('searching containers', () => {
  it('needs to be in range (and on the right floor)', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'search', id: barrel.id }, { pos: { x: barrel.pos.x + 9, z: barrel.pos.z } })).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'search', id: 'nope' }, at(barrel))).toMatchObject({ ok: false, error: 'unknown_container' });
    // The loft chest can't be searched from the floor below it.
    const chest = containerDef('forge-loft-chest')!;
    const g = terrainHeight(chest.pos.x, chest.pos.z);
    expect(applyAction(s, { k: 'search', id: chest.id }, at(chest, g))).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'search', id: chest.id }, at(chest, g + FORGE_PLAN.loft.y))).toMatchObject({ ok: true });
  });

  it('gives the rolled loot once, then refills after its play time', () => {
    const s = fresh();
    const coins = s.data.inventory.coins;
    const expected = rollLoot('cache', String(s.data.createdAt), cache.id, 0);
    expect(expected.coins).toBeGreaterThanOrEqual(12);
    const r = applyAction(s, { k: 'search', id: cache.id }, at(cache));
    expect(r.ok).toBe(true);
    expect(s.data.inventory.coins).toBe(coins + expected.coins);
    for (const it of expected.items) expect(s.totals()[it.material]).toBeGreaterThanOrEqual(it.qty);
    expect(r.ok && r.events.some((e) => e.type === 'searched' && e.id === cache.id)).toBe(true);
    // Searched: refused until it refills.
    expect(applyAction(s, { k: 'search', id: cache.id }, at(cache))).toMatchObject({ ok: false, error: 'searched' });
    expect(containerCooldown(s, cache.id)).toBe(REFILL.cache);
    s.data.playTime += REFILL.cache;
    expect(applyAction(s, { k: 'search', id: cache.id }, at(cache)).ok).toBe(true);
    expect(s.data.world.containers![cache.id].n).toBe(2);
  });

  it('rolls per character and per search, the same on server and browser', () => {
    expect(rollLoot('barrel', '1', 'barrel-0', 0)).toEqual(rollLoot('barrel', '1', 'barrel-0', 0));
    const rolls = new Set(Array.from({ length: 40 }, (_, n) => JSON.stringify(rollLoot('barrel', '1', 'barrel-0', n))));
    expect(rolls.size).toBeGreaterThan(3);
    const empties = Array.from({ length: 200 }, (_, n) => rollLoot('barrel', 'x', 'barrel-1', n)).filter((l) => !l.coins && !l.items.length).length;
    expect(empties).toBeGreaterThan(30);
    expect(empties).toBeLessThan(110);
  });
});
