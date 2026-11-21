import { describe, expect, it } from 'vitest';
import { STAMINA_CONFIG, canAfford, createStamina, effectiveCost, spend, tickStamina } from '../src';

describe('long-duration stamina (GDD 3.6)', () => {
  it('sustains ~5 minutes of uninterrupted sprinting from full', () => {
    let s = createStamina();
    let t = 0;
    const dt = 1 / 60;
    while (s.current > 0 && t < 1000) {
      s = tickStamina(s, dt, { sprinting: true, blocking: false });
      t += dt;
    }
    expect(t).toBeGreaterThan(295);
    expect(t).toBeLessThan(305);
  });

  it('regenerates 0.75/s only after a 1.5s pause', () => {
    let s = spend(createStamina(), 50);
    expect(s.current).toBe(50);
    s = tickStamina(s, 1.4, { sprinting: false, blocking: false });
    expect(s.current).toBe(50);
    s = tickStamina(s, 0.1, { sprinting: false, blocking: false });
    s = tickStamina(s, 2, { sprinting: false, blocking: false });
    expect(s.current).toBeCloseTo(51.5, 5);
  });

  it('does not regenerate while sprinting', () => {
    let s = spend(createStamina(), 10);
    for (let i = 0; i < 300; i++) s = tickStamina(s, 0.1, { sprinting: true, blocking: false });
    expect(s.current).toBeLessThan(90);
  });

  it('applies graduated low-stamina recovery', () => {
    let low = { current: 5, max: 100, regenDelayRemaining: 0 };
    low = tickStamina(low, 1, { sprinting: false, blocking: false });
    expect(low.current).toBeCloseTo(5 + 0.75 * STAMINA_CONFIG.lowRegenMultiplier, 5);
  });

  it('never exceeds max or drops below zero', () => {
    let s = createStamina();
    s = tickStamina(s, 1000, { sprinting: false, blocking: false });
    expect(s.current).toBe(100);
    s = spend(s, 1e9);
    expect(s.current).toBe(0);
    s = tickStamina(s, 1000, { sprinting: true, blocking: true });
    expect(s.current).toBe(0);
  });
});

describe('stamina efficiency modifiers', () => {
  it('compose multiplicatively', () => {
    expect(effectiveCost(6, [0.2])).toBeCloseTo(4.8);
    expect(effectiveCost(6, [0.2, 0.2])).toBeCloseTo(3.84);
  });
  it('can never create negative or zero-by-stacking costs', () => {
    expect(effectiveCost(6, [0.9, 0.9, 5, 100])).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) {
      const reductions = Array.from({ length: i }, () => 0.5);
      expect(effectiveCost(3.5, reductions)).toBeGreaterThanOrEqual(0);
    }
    expect(effectiveCost(6, [NaN, Infinity])).toBeGreaterThanOrEqual(0);
    expect(effectiveCost(-3, [])).toBe(0);
  });
  it('penalties (negative reductions) increase cost', () => {
    expect(effectiveCost(4, [-0.04])).toBeCloseTo(4.16);
  });
});

describe('graduated action restrictions', () => {
  it('allows light attacks / dodges at low stamina but restricts high-cost skills', () => {
    const s = { current: 1, max: 100, regenDelayRemaining: 0 };
    expect(canAfford(s, 'light', 1.5)).toBe(true);
    expect(canAfford(s, 'dodge', 4)).toBe(true);
    expect(canAfford(s, 'heavy', 3.5)).toBe(false);
    expect(canAfford(s, 'guardbreaker', 6)).toBe(false);
    expect(canAfford({ ...s, current: 0 }, 'light', 1.5)).toBe(false);
  });
});
