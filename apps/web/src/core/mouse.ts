/**
 * Mouse-look filtering. In pointer lock, browsers (Chrome on Windows especially) sometimes report a
 * single movement far larger than the hand made, and the first movement after the lock is granted
 * can be a jump from wherever the cursor was. Applied as-is, either snaps the camera to a new
 * direction in one frame. A real flick spreads over many small events, so a lone huge one is dropped.
 */

/** Movements larger than this (pixels, in one event) are treated as glitches. */
export const MAX_MOUSE_EVENT = 300;

export class MouseFilter {
  private skipNext = true;

  /** The pointer lock was (re)granted: the next movement may be a jump, so it is ignored. */
  locked(): void {
    this.skipNext = true;
  }

  /** The movement to apply for one mouse event (null: ignore it). */
  accept(dx: number, dy: number): [number, number] | null {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (this.skipNext) {
      this.skipNext = false;
      return null;
    }
    if (Math.abs(dx) > MAX_MOUSE_EVENT || Math.abs(dy) > MAX_MOUSE_EVENT) return null;
    return [dx, dy];
  }
}
