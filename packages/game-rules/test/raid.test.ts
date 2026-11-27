import { describe, expect, it } from 'vitest';
import { ENEMIES, RAID, raidReward, raidSize, raiderLevel, scaledArchetype, shouldStartRaid } from '../src';

describe('raids on Emberhold: rules', () => {
  it('sizes a raid at 3 + 2 per defender, from 5 to 10, in two waves', () => {
    const table = [0, 1, 2, 3, 4, 7].map((d) => {
      const s = raidSize(d);
      return [d, s.total, s.firstWave, s.secondWave];
    });
    expect(table).toEqual([
      [0, 5, 3, 2],
      [1, 5, 3, 2],
      [2, 7, 4, 3],
      [3, 9, 5, 4],
      [4, 10, 5, 5],
      [7, 10, 5, 5],
    ]);
  });

  it("sets the raiders' level from the defenders' ranks, from 1 to 4", () => {
    expect(raiderLevel([])).toBe(1);
    expect(raiderLevel([1])).toBe(1);
    expect(raiderLevel([3])).toBe(2);
    expect(raiderLevel([3, 6])).toBe(4); // average 4.5 rounds to 5, minus 1
    expect(raiderLevel([12])).toBe(RAID.maxLevel);
  });

  it('starts a raid only when ready, past the cooldown, with a rank-2 defender in the village', () => {
    const due = { readiness: RAID.readinessToRaid, minutesSinceLastRaid: null, villageRanks: [2] };
    expect(shouldStartRaid(due)).toBe(true);
    expect(shouldStartRaid({ ...due, readiness: RAID.readinessToRaid - 0.1 })).toBe(false);
    expect(shouldStartRaid({ ...due, villageRanks: [] })).toBe(false);
    expect(shouldStartRaid({ ...due, villageRanks: [1, 1] })).toBe(false); // brand-new players only
    expect(shouldStartRaid({ ...due, minutesSinceLastRaid: RAID.cooldownMinutes - 1 })).toBe(false);
    expect(shouldStartRaid({ ...due, minutesSinceLastRaid: RAID.cooldownMinutes })).toBe(true);
  });

  it('rewards a won raid more at higher levels', () => {
    expect(raidReward(1)).toEqual({ coins: 30, xp: 75 });
    expect(raidReward(4).coins).toBeGreaterThan(raidReward(1).coins);
    expect(raidReward(9)).toEqual(raidReward(4));
  });

  it('makes the Captain a tougher, scalable elite and raiders never respawn on their own', () => {
    const r = ENEMIES.raider;
    const c = ENEMIES.raider_captain;
    expect(c.kind).toBe('elite');
    expect(c.maxHealth).toBe(4 * r.maxHealth);
    expect(c.attacks.map((a) => a.id)).toContain('torch_sweep');
    expect(r.respawnSeconds).toBeNull();
    expect(c.respawnSeconds).toBeNull();
    expect(scaledArchetype(c, 3).maxHealth).toBeGreaterThan(c.maxHealth);
  });
});
