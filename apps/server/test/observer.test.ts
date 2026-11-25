import { describe, expect, it } from 'vitest';
import { ADAPT } from '@alloy/game-rules';
import { ENEMY_SPAWNS, ZONES } from '@alloy/world';
import { WorldObserver, noticeFor } from '../src/worldObserver';

const trail = ZONES.find((z) => z.id === 'trail')!;
const village = ZONES.find((z) => z.id === 'village')!;

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (s: number) => (t += s * 1000) };
}
/** Run the observer for `seconds` with these players, 2 s at a time; returns every change. */
function run(o: WorldObserver, c: ReturnType<typeof clock>, seconds: number, players: Array<{ pos: { x: number; z: number }; rank: number }>) {
  const changes = [];
  for (let s = 0; s < seconds; s += 2) {
    c.advance(2);
    changes.push(...o.observe(players));
  }
  return changes;
}

describe('world observer', () => {
  it('leaves an area alone while players of its level play there', () => {
    const c = clock();
    const o = new WorldObserver(c.now);
    run(o, c, 3600, [{ pos: trail.center, rank: 3 }]);
    expect(o.levelOf('trail')).toBe(trail.level);
    expect(o.areas.trail.playerSeconds).toBeGreaterThan(1000);
    expect(o.areas.trail.players).toBe(1);
  });

  it('raises an area while a much stronger player lingers, and settles after they leave', () => {
    const c = clock();
    const o = new WorldObserver(c.now);
    const changes = run(o, c, 15 * 60, [{ pos: trail.center, rank: 8 }]);
    expect(o.levelOf('trail')).toBe(trail.level + ADAPT.maxBonus);
    expect(changes[0]).toMatchObject({ area: 'trail', from: trail.level, to: trail.level + 1 });
    expect(noticeFor(changes[0])).toContain('Ironwood Trail');
    // Other areas untouched.
    expect(o.levelOf('village')).toBe(village.level);
    // The player leaves for the village: the trail settles back over the next couple of hours.
    const back = run(o, c, 3 * 3600, [{ pos: village.center, rank: 8 }]);
    expect(o.levelOf('trail')).toBe(trail.level);
    expect(back.some((x) => x.area === 'trail' && x.to < x.from)).toBe(true);
    expect(noticeFor(back.find((x) => x.area === 'trail')!)).toContain('settles');
  });

  it('counts kills by strong players as extra pressure, and keeps fading while the world is empty', () => {
    const c = clock();
    const o = new WorldObserver(c.now);
    const scav = ENEMY_SPAWNS.find((s) => s.type === 'scavenger')!;
    o.observe([]);
    for (let i = 0; i < 10; i++) o.kill(scav.pos, [9]);
    o.kill(scav.pos, [1]); // a player of the area's level adds a kill but no pressure
    expect(o.areas.trail.kills).toBe(11);
    expect(o.areas.trail.pressure).toBe(10 * ADAPT.killWeight * 6);
    c.advance(ADAPT.halfLifeSec);
    o.observe([]);
    expect(o.areas.trail.pressure).toBeCloseTo(5 * ADAPT.killWeight * 6, 0);
    const snap = o.snapshot();
    expect(snap.trail).toMatchObject({ level: trail.level + 1, players: 0 }); // 1350 pressure left: one level up
    expect(Object.keys(snap)).toEqual(ZONES.map((z) => z.id));
  });

  it('saves and restores its tallies and levels, faded by the time the server was down', () => {
    const c = clock();
    const o = new WorldObserver(c.now);
    run(o, c, 15 * 60, [{ pos: trail.center, rank: 8 }]);
    expect(o.dirty).toBe(true);
    const saved = JSON.parse(JSON.stringify(o.save())); // as it comes back from storage
    const raised = o.levelOf('trail');
    expect(raised).toBe(trail.level + ADAPT.maxBonus);

    // Restarted at once: everything as it was.
    const same = new WorldObserver(c.now);
    expect(same.restore(saved)).toBe(true);
    expect(same.levelOf('trail')).toBe(raised);
    expect(same.areas.trail.pressure).toBeCloseTo(o.areas.trail.pressure, 6);
    expect(same.areas.trail.playerSeconds).toBeCloseTo(o.areas.trail.playerSeconds, 6);
    expect(same.dirty).toBe(false);

    // Down for one half-life: tallies halved.
    c.advance(ADAPT.halfLifeSec);
    const later = new WorldObserver(c.now);
    later.restore(saved);
    expect(later.areas.trail.pressure).toBeCloseTo(o.areas.trail.pressure / 2, 3);
    expect(later.areas.trail.kills).toBeCloseTo(o.areas.trail.kills / 2, 6);

    // Down for a day: the trail has settled back to its own level.
    c.advance(24 * 3600);
    const nextDay = new WorldObserver(c.now);
    nextDay.restore(saved);
    expect(nextDay.levelOf('trail')).toBe(trail.level);
    // And it keeps fading from there, not from the save time.
    c.advance(2);
    nextDay.observe([]);
    expect(nextDay.areas.trail.pressure).toBeLessThan(1);
  });

  it('ignores saved data it cannot trust', () => {
    const c = clock();
    for (const bad of [null, 42, 'x', {}, { v: 2, savedAt: 1, areas: {} }, { v: 1, savedAt: NaN, areas: {} }, { v: 1, savedAt: 1 }]) {
      expect(new WorldObserver(c.now).restore(bad)).toBe(false);
    }
    const o = new WorldObserver(c.now);
    const ok = o.restore({
      v: 1,
      savedAt: c.now() + 3_600_000, // a clock from the future doesn't raise anything
      areas: {
        trail: { pressure: -5, kills: 'lots', deaths: Infinity, gathers: 3, bonus: 99 },
        nowhere: { pressure: 1e12, bonus: 3 },
      },
    });
    expect(ok).toBe(true);
    expect(o.areas.trail).toMatchObject({ pressure: 0, kills: 0, deaths: 0, gathers: 3 });
    // No pressure behind it: a saved bonus of 99 can't stand.
    expect(o.levelOf('trail')).toBe(trail.level);
    expect(Object.keys(o.areas)).toEqual(ZONES.map((z) => z.id));
  });

  it('marks itself changed only when players or events are in play', () => {
    const c = clock();
    const o = new WorldObserver(c.now);
    o.observe([]);
    c.advance(600);
    o.observe([]);
    expect(o.dirty).toBe(false); // an empty world only fades, which restore() works out itself
    o.activity(trail.center, 'gather');
    expect(o.dirty).toBe(true);
  });
});
