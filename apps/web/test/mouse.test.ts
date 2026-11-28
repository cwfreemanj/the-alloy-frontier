import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../src/core/Input';
import { MAX_MOUSE_EVENT, MouseFilter } from '../src/core/mouse';

describe('mouse-look filtering (the camera turning on its own)', () => {
  it('ignores the first movement after the pointer lock is granted', () => {
    const f = new MouseFilter();
    expect(f.accept(800, -300)).toBeNull(); // the jump from wherever the cursor was
    expect(f.accept(4, -2)).toEqual([4, -2]);
    f.locked(); // menu closed, lock granted again
    expect(f.accept(500, 0)).toBeNull();
    expect(f.accept(3, 1)).toEqual([3, 1]);
  });

  it('drops a lone glitched jump but keeps every normal movement, fast flicks included', () => {
    const f = new MouseFilter();
    f.accept(0, 0);
    const flick = Array.from({ length: 20 }, () => f.accept(120, 10));
    expect(flick.every((m) => m !== null)).toBe(true);
    expect(f.accept(MAX_MOUSE_EVENT + 1, 0)).toBeNull();
    expect(f.accept(0, -2000)).toBeNull();
    expect(f.accept(Number.NaN, 0)).toBeNull();
    expect(f.accept(-MAX_MOUSE_EVENT, MAX_MOUSE_EVENT)).toEqual([-MAX_MOUSE_EVENT, MAX_MOUSE_EVENT]);
  });

  it('does not lock on with the middle mouse button (pressing the scroll wheel locked on by accident)', () => {
    expect(DEFAULT_BINDINGS.lock).not.toContain('Mouse1');
    expect(DEFAULT_BINDINGS.lock).toContain('Tab');
  });
});
