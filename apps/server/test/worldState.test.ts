import { afterEach, describe, expect, it } from 'vitest';
import { ADAPT } from '@alloy/game-rules';
import { ZONES } from '@alloy/world';
import { MemoryKV } from '../src/accounts/kv';
import { AccountService } from '../src/accounts/service';
import { startWorldServer, type RunningWorldServer } from '../src/worldServer';
import { WORLD_STATE_KEY } from '../src/worldState';

const trail = ZONES.find((z) => z.id === 'trail')!;

/** Counts writes, and can be told to fail. */
class CountingKV extends MemoryKV {
  writes = 0;
  fail = false;
  override async put<T>(key: string, value: T): Promise<void> {
    if (key === WORLD_STATE_KEY) {
      if (this.fail) throw new Error('database unavailable');
      this.writes++;
    }
    return super.put(key, value);
  }
}

let server: RunningWorldServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** Push the trail's enemies up as a long stay by a strong player would. */
function raiseTrail(s: RunningWorldServer): void {
  const o = s.room.observer;
  o.areas.trail.pressure = ADAPT.unit * ADAPT.maxBonus + 100;
  o.observe([]);
  expect(o.levelOf('trail')).toBe(trail.level + ADAPT.maxBonus);
}

describe('saved world state (AF-013)', () => {
  it('survives a restart: area levels, tallies and enemy levels come back', async () => {
    const kv = new CountingKV();
    server = await startWorldServer({ port: 0, accounts: new AccountService(kv) });
    raiseTrail(server);
    server.room.observer.kill(trail.center, [8]);
    await server.close(); // a deploy or the host's sleep
    server = null;
    expect(kv.writes).toBe(1);

    server = await startWorldServer({ port: 0, accounts: new AccountService(kv) });
    const o = server.room.observer;
    expect(o.levelOf('trail')).toBe(trail.level + ADAPT.maxBonus);
    expect(o.areas.trail.kills).toBeCloseTo(1, 3);
    // Enemies start at their area's restored level, before anyone joins.
    const inTrail = server.room.enemies.filter((e) => e.def.kind !== 'dummy' && o.areaAt(e.home) === 'trail');
    expect(inTrail.length).toBeGreaterThan(0);
    for (const e of inTrail) expect(e.level).toBe(trail.level + ADAPT.maxBonus);
    const info = await (await fetch(`http://127.0.0.1:${server.port}/world-info`)).json();
    expect(info.areas.trail.level).toBe(trail.level + ADAPT.maxBonus);
  });

  it("keeps the raid state too: readiness, the last raid and the Captain's camp (AF-011)", async () => {
    const kv = new CountingKV();
    server = await startWorldServer({ port: 0, accounts: new AccountService(kv), raids: true });
    expect(server.room.raids.enabled).toBe(true);
    const r = server.room.raids;
    r.restore({ readiness: 7, lastRaidAt: 123, camp: { level: 2 }, count: 3 });
    r.dirty = true; // only the raid changed
    await server.close();
    server = null;
    expect(kv.writes).toBe(1);

    server = await startWorldServer({ port: 0, accounts: new AccountService(kv) });
    expect(server.room.raids.enabled).toBe(false); // off unless the server setting is on
    expect(server.room.raids.save()).toEqual({ readiness: 7, lastRaidAt: 123, camp: { level: 2 }, count: 3 });
    expect(server.room.enemies.find((e) => e.id === 'raid-camp-3')?.level).toBe(2);
  });

  it("doesn't write while nothing happens, and keeps the world running if the database fails", async () => {
    const kv = new CountingKV();
    server = await startWorldServer({ port: 0, accounts: new AccountService(kv) });
    await server.worldState!.save();
    expect(kv.writes).toBe(0); // an empty world: nothing to write

    raiseTrail(server);
    kv.fail = true;
    await server.worldState!.save(); // logged, not thrown
    expect(kv.writes).toBe(0);
    kv.fail = false;
    await server.worldState!.save(); // retried: still marked as changed
    expect(kv.writes).toBe(1);
    await server.worldState!.save();
    expect(kv.writes).toBe(1);
  });

  it('starts fresh from unreadable saved data', async () => {
    const kv = new MemoryKV();
    await kv.put(WORLD_STATE_KEY, { v: 99, junk: true });
    server = await startWorldServer({ port: 0, accounts: new AccountService(kv) });
    for (const z of ZONES) expect(server.room.observer.levelOf(z.id)).toBe(z.level);
  });

  it('runs without storage (guest-only server): nothing to save', async () => {
    server = await startWorldServer({ port: 0 });
    expect(server.worldState).toBeNull();
  });
});
