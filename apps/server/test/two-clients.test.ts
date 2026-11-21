/**
 * Phase C network proof (AF-007): two real WebSocket clients against a local authoritative room,
 * with simulated latency. Feasibility evidence only, not MMO scalability or production security.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateItem } from '@alloy/item-gen';
import { ProofClient, sleep } from '../src/client';
import { startServer, type RunningServer } from '../src/server';

let server: RunningServer;

/** Walk legitimately (under the speed limit) toward a point. */
async function walk(c: ProofClient, from: { x: number; z: number }, to: { x: number; z: number }) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(d / 0.5));
  for (let i = 1; i <= steps; i++) {
    c.move(from.x + ((to.x - from.x) * i) / steps, from.z + ((to.z - from.z) * i) / steps);
    await sleep(150);
  }
}
let url: string;

beforeAll(async () => {
  server = await startServer(0, 20);
  url = `ws://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
});

describe('two-client authoritative room', () => {
  it('shares movement, enemy state and equipment ownership; rejects cheats; survives reconnect', async () => {
    const a = new ProofClient(url, [20, 80]);
    const b = new ProofClient(url, [40, 120]);
    await a.connect('Alpha');
    await b.connect('Bravo');
    expect(a.playerId).not.toBe(b.playerId);

    // --- Movement replicated to the other client
    await sleep(200);
    const start = server.room.snapshot().players.find((p) => p.id === a.playerId)!;
    await walk(a, start, { x: 1, z: 3 });
    await sleep(400);
    const seenByB = b.lastSnapshot?.players.find((p) => p.id === a.playerId);
    expect(seenByB?.x).toBeCloseTo(1);
    expect(seenByB?.z).toBeCloseTo(3);

    // --- Speed hack corrected by the server
    a.move(200, 200);
    await sleep(400);
    expect(a.corrections.length).toBeGreaterThan(0);
    expect(server.room.snapshot().players.find((p) => p.id === a.playerId)?.x).toBeCloseTo(1);

    // --- Server-side forge: client sends intent; server computes the item
    const forge = await a.request({ t: 'forge', request: { txId: 'net-tx-1', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 } });
    expect(forge.ok).toBe(true);
    const itemId = forge.item!.itemId;
    expect(forge.item!.forge.makerId).toBe(a.playerId);
    // Replay of the same transaction does not duplicate
    const replay = await a.request({ t: 'forge', request: { txId: 'net-tx-1', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 } });
    expect(replay.ok).toBe(true);
    expect(Object.keys(a.inventory!.items)).toHaveLength(1);
    // Masterwork without replayable evidence is rejected
    const fakeMw = await a.request({ t: 'forge', request: { txId: 'net-tx-2', blueprintId: 'iron_longsword', mode: 'masterwork', bufferQuantity: 2, evidence: { heat: 'cherry', strikes: Array(50).fill({ x: 0, y: 0, kind: 'focused' }) } } });
    expect(fakeMw.ok).toBe(false);

    // --- Equipment ownership
    expect((await a.request({ t: 'equip', itemId })).ok).toBe(true);
    const steal = await b.request({ t: 'equip', itemId });
    expect(steal.ok).toBe(false);
    expect(steal.error).toBe('not_owned');

    // --- Client-forged items are never accepted
    const forged = generateItem({ itemId: 'evil', seed: 'x', blueprintId: 'iron_longsword', source: 'masterwork_forge', mode: 'masterwork', materials: [], bufferQuantity: 0, maker: { id: b.playerId, name: 'Bravo', mastery: 1e6 }, forgeScore: 1, createdAt: 0 });
    const inj = await b.request({ t: 'inject_item', item: forged });
    expect(inj.ok).toBe(false);
    expect(server.room.snapshot().players.find((p) => p.id === b.playerId)?.equippedItemId).toBeNull();

    // --- Shared enemy state: A attacks, both clients see the same HP
    await walk(a, { x: 1, z: 3 }, { x: 0.5, z: 3.5 });
    await sleep(300);
    const hit = await a.request({ t: 'attack', targetId: 'sentinel-proof', attackId: 'heavy' });
    expect(hit.ok).toBe(true);
    // B is too far away to hit
    const far = await b.request({ t: 'attack', targetId: 'sentinel-proof', attackId: 'heavy' });
    expect(far.ok).toBe(false);
    await sleep(400);
    const hpA = a.lastSnapshot!.enemies[0].health;
    const hpB = b.lastSnapshot!.enemies[0].health;
    expect(hpA).toBeLessThan(a.lastSnapshot!.enemies[0].maxHealth);
    expect(hpA).toBeCloseTo(hpB);

    // --- Stale / replayed sequence numbers rejected
    const stale = await a.request({ t: 'attack', targetId: 'sentinel-proof', attackId: 'light1' }, 1);
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe('stale_or_replayed_seq');

    // --- Disconnect / reconnect keeps authoritative inventory and equipment
    const token = a.token;
    const oldId = a.playerId;
    await a.close();
    await sleep(250);
    expect(server.room.snapshot().players.find((p) => p.id === oldId)?.connected).toBe(false);
    const a2 = new ProofClient(url, [20, 80]);
    await a2.connect('Alpha', token);
    expect(a2.playerId).toBe(oldId);
    expect(a2.inventory!.equipped.weapon).toBe(itemId);
    expect(a2.inventory!.items[itemId].result).toEqual(forge.item!.result);
    await sleep(300);
    expect(b.lastSnapshot?.players.find((p) => p.id === oldId)?.connected).toBe(true);

    // --- Malformed input is rejected without crashing
    a2.raw('{"t":"move","seq":"NaN"}');
    a2.raw('not json');
    await sleep(300);
    expect(server.room.stats.malformed).toBeGreaterThanOrEqual(2);
    expect(server.room.audit()).toBe(true);

    await a2.close();
    await b.close();
  });
});
