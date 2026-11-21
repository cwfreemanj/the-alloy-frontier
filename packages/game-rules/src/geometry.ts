/** Minimal 2D (ground-plane) geometry shared by client and future server. */
export interface Vec2 {
  x: number;
  z: number;
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Facing angle (radians) for a direction, with 0 = +Z, increasing toward +X. */
export function yawTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxStep);
}

/** Is `target` inside a sector of `range` and total angle `arcDeg` centred on `facing`? */
export function inArc(origin: Vec2, facing: number, target: Vec2, range: number, arcDeg: number, targetRadius = 0): boolean {
  const d = dist2(origin, target);
  if (d > range + targetRadius) return false;
  if (arcDeg >= 360 || d < 0.001) return true;
  const ang = Math.abs(angleDelta(facing, yawTo(origin, target)));
  // Allow the target's body radius to widen the effective arc slightly at close range.
  const slack = targetRadius > 0 ? Math.atan2(targetRadius, Math.max(d, 0.001)) : 0;
  return ang <= (arcDeg * Math.PI) / 360 + slack;
}

export function inCircle(center: Vec2, radius: number, target: Vec2, targetRadius = 0): boolean {
  return dist2(center, target) <= radius + targetRadius;
}

export function forwardPoint(origin: Vec2, facing: number, distance: number): Vec2 {
  return { x: origin.x + Math.sin(facing) * distance, z: origin.z + Math.cos(facing) * distance };
}
