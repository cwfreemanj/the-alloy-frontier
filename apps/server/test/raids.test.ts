/**
 * Raids on Emberhold (AF-011, docs/raids.md), run by the world room on a fake clock: what starts
 * one, the horn and the waves, a win with its rewards, a loss that leaves the Captain camped on
 * the trail, and what is saved.
 */
import { describe, expect, it } from 'vitest';
import { CAPTAIN_FLUX, RAID, raidReward } from '@alloy/game-rules';
import type { AvatarState, WorldServerMsg } from '@alloy/protocol';
import { RAID_POINTS, ZONES } from '@alloy/world';
import { CharacterHost, MemoryCharacterStore } from '../src/characters';
import { RAID_NOTICES } from '../src/raids';
import { WorldRoom } from '../src/worldRoom';
import type { EnemySim } from '@alloy/world';

const avatar = (x: number, z: number): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null });
const village = ZONES.find((z) => z.id === 'village')!.center;
const trail = { x: -10, z: 95 };

function setup(allowTeleport = true) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const host = new CharacterHost(new MemoryCharacterStore(), clock.now);
  // 0.99: no crits, top of coin range, no random flux drops.
  const room = new WorldRoom(clock.now, host, () => 0.99, allowTeleport);
  /** Run the world for `seconds`, a quarter second at a time. */
  const run = (seconds: number) => {
    for (let s = 0; s < seconds; s += 0.25) {
      clock.advance(250);
      room.step(0.25);
    }
  };
  return { clock, host, room, run };
}

async function signedIn(ctx: ReturnType<typeof setup>, accountId: string, rank: number) {
  const inbox: WorldServerMsg[] = [];
  const char = await ctx.host.open(accountId);
  char.session.data.progression.adventurer.rank = rank;
  const id = ctx.room.join(accountId, (m) => inbox.push(m), accountId, () => {}, char)!;
  const send = (m: unknown) => ctx.room.handle(id, JSON.stringify(m), (x) => inbox.push(x));
  const p = {
    id,
    char,
    inbox,
    send,
    at: (x: number, z: number) => send({ t: 'state', s: avatar(x, z) }),
    /** Finish off a raider: stand next to it and land a hit (its health set to 1 first). */
    kill: (e: EnemySim) => {
      e.brain.health = 1;
      p.at(e.x, e.z + 1);
      ctx.clock.advance(1100); // a fresh hit-rate window
      send({ t: 'hit', enemyId: e.id, attackId: 'light1', damage: 50, stagger: 0, guardBreak: false, crit: false });
      expect(e.brain.alive).toBe(false);
    },
    notices: () => inbox.filter((m) => m.t === 'notice').map((m) => (m as { text: string }).text),
    raids: () => inbox.filter((m) => m.t === 'raid').map((m) => (m as Extract<WorldServerMsg, { t: 'raid' }>).raid),
    toasts: () => inbox.flatMap((m) => (m.t === 'char' ? m.events.filter((e) => e.type === 'toast').map((e) => (e as { text: string }).text) : [])),
  };
  p.at(village.x, village.z);
  return p;
}

const raiders = (room: WorldRoom) => room.enemies.filter((e) => e.spawn.type === 'raider' && e.brain.alive);
const captain = (room: WorldRoom) => room.enemies.find((e) => e.spawn.type === 'raider_captain');

describe('raids on Emberhold', () => {
  it('builds readiness from play time and sounds the horn when a raid is due', async () => {
    const ctx = setup();
    ctx.room.raids.enabled = true;
    const p = await signedIn(ctx, 'acct-due', 2);
    ctx.run((RAID.readinessToRaid - 1) * 60);
    expect(ctx.room.raids.phase).toBe('idle');
    expect(ctx.room.raids.readiness).toBeCloseTo(RAID.readinessToRaid - 1, 0);
    ctx.run(90);
    expect(ctx.room.raids.phase).toBe('warning');
    expect(p.notices()).toContain(RAID_NOTICES.horn);
    expect(p.raids()[0]).toMatchObject({ phase: 'warning', left: RAID.warningSeconds });
  });

  it("doesn't start on its own when raids are off, or with only a rank-1 player in the village", async () => {
    const off = setup();
    await signedIn(off, 'acct-off', 5);
    off.run(40 * 60);
    expect(off.room.raids.phase).toBe('idle');

    const fresh = setup();
    fresh.room.raids.enabled = true;
    await signedIn(fresh, 'acct-new', 1);
    fresh.run(40 * 60);
    expect(fresh.room.raids.phase).toBe('idle');
    expect(fresh.room.raids.readiness).toBeGreaterThan(RAID.readinessToRaid);
  });

  it('runs a raid to a win: two waves, the Captain, rewards and clean-up', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-win', 3);
    p.send({ t: 'debugRaid', warn: 3 });
    expect(ctx.room.raids.phase).toBe('warning');
    ctx.run(3.5);
    // One defender: 5 raiders, 3 in the first wave, at level 2 (rank 3 - 1), entering from the trail.
    expect(ctx.room.raids.phase).toBe('fighting');
    const first = raiders(ctx.room);
    expect(first).toHaveLength(3);
    expect(first.every((e) => e.level === 2)).toBe(true);
    expect(first.every((e) => Math.hypot(e.x - RAID_POINTS.entry.x, e.z - RAID_POINTS.entry.z) < 4)).toBe(true);
    const spawned = p.inbox.filter((m) => m.t === 'spawn').flatMap((m) => (m as Extract<WorldServerMsg, { t: 'spawn' }>).list);
    expect(spawned.map((s) => s.type)).toEqual(['raider', 'raider', 'raider']);
    expect(captain(ctx.room)).toBeUndefined();

    // They walk into the village, and the area level never overrides theirs.
    ctx.run(20);
    expect(raiders(ctx.room).every((e) => e.level === 2)).toBe(true);
    expect(raiders(ctx.room).some((e) => Math.hypot(e.x - RAID_POINTS.home.x, e.z - RAID_POINTS.home.z) < 30)).toBe(true);

    for (const e of raiders(ctx.room)) p.kill(e);
    p.at(village.x, village.z);
    ctx.run(0.5);
    // The second wave and the Captain.
    expect(raiders(ctx.room)).toHaveLength(2);
    const cap = captain(ctx.room)!;
    expect(cap.level).toBe(2);
    expect(p.notices()).toContain(RAID_NOTICES.captain);
    expect(p.raids().at(-1)).toMatchObject({ phase: 'fighting', raiders: 3, captain: true, wave: 2 });

    for (const e of raiders(ctx.room)) p.kill(e);
    p.kill(cap);
    expect(p.toasts().some((t) => t.startsWith('Raider Captain defeated') && t.includes(`+${CAPTAIN_FLUX} Binding Flux`))).toBe(true);
    p.at(village.x, village.z);
    ctx.run(0.5);
    expect(ctx.room.raids.phase).toBe('idle');
    expect(p.notices()).toContain(RAID_NOTICES.won);
    expect(p.raids().at(-1)?.phase).toBe('won');
    const r = raidReward(2);
    expect(p.toasts()).toContain(`Raid repelled · +${r.coins} coins · +${r.xp} XP`);
    expect(ctx.room.raids.readiness).toBe(0);
    expect(ctx.room.raids.camp).toBeNull();

    // The fallen are removed a few seconds later.
    ctx.run(7);
    expect(ctx.room.enemies.some((e) => e.id.startsWith('raid'))).toBe(false);
    expect(p.inbox.filter((m) => m.t === 'despawn').flatMap((m) => (m as { ids: string[] }).ids)).toHaveLength(6);
  });

  it('is lost when nobody defends the village; the Captain then camps on the trail until defeated', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-lose', 2);
    p.send({ t: 'debugRaid', warn: 1 });
    ctx.run(1.5);
    expect(raiders(ctx.room)).toHaveLength(3);
    p.at(trail.x, trail.z); // everyone runs
    ctx.run(RAID.abandonedSeconds + 1);
    expect(ctx.room.raids.phase).toBe('idle');
    expect(p.notices()).toContain(RAID_NOTICES.lost);
    expect(raiders(ctx.room)).toHaveLength(0);
    const camp = captain(ctx.room)!;
    expect(camp.id).toMatch(/^raid-camp-/);
    expect(Math.hypot(camp.x - RAID_POINTS.camp.x, camp.z - RAID_POINTS.camp.z)).toBeLessThan(1);
    expect(ctx.room.raids.camp).toEqual({ level: 1 });
    expect(ctx.room.raids.save()).toMatchObject({ readiness: 0, camp: { level: 1 }, count: 1 });

    // A joining player is told about the camp.
    const inbox: WorldServerMsg[] = [];
    ctx.room.join('Late', (m) => inbox.push(m), null, () => {});
    const welcome = inbox.find((m) => m.t === 'welcome') as Extract<WorldServerMsg, { t: 'welcome' }>;
    expect(welcome.spawns?.map((s) => s.id)).toEqual([camp.id]);

    p.kill(camp);
    expect(ctx.room.raids.camp).toBeNull();
    expect(p.notices()).toContain(RAID_NOTICES.campCleared);
    ctx.run(7);
    expect(captain(ctx.room)).toBeUndefined();
  });

  it('is lost when the time runs out with the Captain still standing', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-slow', 2);
    p.send({ t: 'debugRaid', warn: 1 });
    ctx.run(RAID.timeLimitSeconds + 2);
    expect(p.notices()).toContain(RAID_NOTICES.lost);
    expect(ctx.room.raids.camp).not.toBeNull();
  });

  it('saves readiness, the last raid and the camp; bad data starts fresh', async () => {
    const ctx = setup();
    ctx.room.raids.restore({ readiness: 12.5, lastRaidAt: 999, camp: { level: 3 }, count: 4 });
    expect(ctx.room.raids.save()).toEqual({ readiness: 12.5, lastRaidAt: 999, camp: { level: 3 }, count: 4 });
    const camp = captain(ctx.room)!;
    expect(camp.id).toBe('raid-camp-4');
    expect(camp.level).toBe(3);

    const bad = setup();
    bad.room.raids.restore({ readiness: 'lots', camp: { level: 'x' }, count: -3 });
    expect(bad.room.raids.save()).toEqual({ readiness: 0, lastRaidAt: null, camp: null, count: 0 });
    expect(captain(bad.room)).toBeUndefined();
    bad.room.raids.restore(undefined);
    expect(bad.room.raids.readiness).toBe(0);
  });

  it('ignores the test command on a hosted server', async () => {
    const ctx = setup(false);
    const p = await signedIn(ctx, 'acct-hosted', 3);
    p.send({ t: 'debugRaid', warn: 1 });
    expect(ctx.room.raids.phase).toBe('idle');
  });
});
