import { describe, expect, it } from 'vitest';
import { FASTEST_LEGIT_SPEED, MOVE_LIMITS, SPRINT_SPEED, checkMove, newMoveGuard, resetMoveGuard } from '../src';

describe('movement speed check', () => {
  it('refills faster than any legitimate movement', () => {
    expect(MOVE_LIMITS.maxSpeed).toBeGreaterThan(FASTEST_LEGIT_SPEED);
    expect(FASTEST_LEGIT_SPEED).toBeGreaterThanOrEqual(SPRINT_SPEED);
  });

  it('accepts sprinting forever and refuses sustained double speed', () => {
    const g = newMoveGuard(0, 0, 0);
    let x = 0;
    for (let t = 50; t <= 60_000; t += 50) expect(checkMove(g, (x += SPRINT_SPEED * 0.05), 0, t)).toBe(true);
    const h = newMoveGuard(0, 0, 0);
    let refused = 0;
    let hx = 0;
    for (let t = 50; t <= 10_000; t += 50) if (!checkMove(h, (hx = h.x + 2 * SPRINT_SPEED * 0.05), 0, t)) refused++;
    expect(refused).toBeGreaterThan(50);
    expect(hx).toBeGreaterThan(0);
  });

  it('banks at most the burst, and a refused move leaves the guard in place', () => {
    const g = newMoveGuard(0, 0, 0);
    expect(checkMove(g, MOVE_LIMITS.burst + 1, 0, 60_000)).toBe(false);
    expect(g.x).toBe(0);
    expect(checkMove(g, MOVE_LIMITS.burst - 0.5, 0, 60_000)).toBe(true);
    resetMoveGuard(g, 100, 100, 60_000);
    expect(checkMove(g, 101, 100, 60_000)).toBe(true);
  });
});
