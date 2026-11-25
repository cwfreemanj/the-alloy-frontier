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
});
