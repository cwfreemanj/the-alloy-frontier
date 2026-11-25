/**
 * Player movement speeds, and the speed check the server runs on reported positions.
 *
 * Clients move their own avatar and report positions. The server can't simulate movement
 * exactly (input, collisions, frame timing), so it checks a budget instead: distance allowance
 * refills at a little above the fastest legitimate speed and can bank up to a burst, so dodges,
 * lunges and network lag are fine, but sustained speed hacks and teleports are not.
 */
import { DODGE } from './combat';

export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 7.6;
export const BLOCK_SPEED = 2.2;

export const MOVE_LIMITS = {
  /** Budget refill (m/s): above sprint (7.6) and dodge (3.6 m in 0.45 s = 8 m/s). */
  maxSpeed: 8.5,
  /** Most distance that can be banked (m): about 1.5 s of sprinting, for lag spikes. */
  burst: 12,
  /** Distance (m) from a known point (saved position, respawn point) that counts as "there". */
  nearRadius: 5,
  /**
   * Height above the terrain (m). Players walk on the terrain and a jump peaks about 1 m up
   * (6.2 m/s against 20 m/s²); the rest is slack for slopes and lag.
   */
  maxAboveGround: 1.6,
  /** Depth below the terrain (m) still accepted (the browser eases onto slopes). */
  maxBelowGround: 1.0,
} as const;

/** The fastest a legitimate player moves on average (for documentation and tests). */
export const FASTEST_LEGIT_SPEED = Math.max(SPRINT_SPEED, DODGE.distance / DODGE.duration);

export interface MoveGuard {
  /** Last accepted position. */
  x: number;
  z: number;
  /** Distance allowance left (m). */
  budget: number;
  /** Server time (ms) of the last check. */
  at: number;
}

export const newMoveGuard = (x: number, z: number, at: number): MoveGuard => ({ x, z, budget: MOVE_LIMITS.burst, at });

/**
 * Check a reported position against the guard. Accepted moves spend budget and become the
 * new position; rejected ones leave the guard at the last accepted position.
 */
export function checkMove(g: MoveGuard, x: number, z: number, at: number): boolean {
  const dt = Math.max(0, (at - g.at) / 1000);
  g.at = at;
  g.budget = Math.min(MOVE_LIMITS.burst, g.budget + MOVE_LIMITS.maxSpeed * dt);
  const d = Math.hypot(x - g.x, z - g.z);
  if (d > g.budget) return false;
  g.budget -= d;
  g.x = x;
  g.z = z;
  return true;
}

/** Place the guard somewhere without a speed check (e.g. respawning), with a full budget. */
export function resetMoveGuard(g: MoveGuard, x: number, z: number, at: number): void {
  g.x = x;
  g.z = z;
  g.budget = MOVE_LIMITS.burst;
  g.at = at;
}

/** Is a reported height possible at a spot whose terrain height is `ground`? */
/**
 * Is height y reachable? `ground` is the terrain; `floor` the highest floor someone there could
 * have stepped or dropped from (a loft, stairs nearby), defaulting to the terrain.
 */
export const heightOk = (y: number, ground: number, floor = ground): boolean => y <= Math.max(ground, floor) + MOVE_LIMITS.maxAboveGround && y >= ground - MOVE_LIMITS.maxBelowGround;

export const isNear = (a: { x: number; z: number }, b: { x: number; z: number }, r: number = MOVE_LIMITS.nearRadius) => Math.hypot(a.x - b.x, a.z - b.z) <= r;
