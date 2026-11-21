import { describe, expect, it } from 'vitest';
import { ATTACKS, DODGE, PlayerCombat, computeOutgoingHit, inArc, mitigate, type CombatContext } from '../src';

const weapon = { damage: 20, attackSpeed: 1, stagger: 20, staminaCostMultiplier: 1, critChance: 0 };
const ctx: CombatContext = { weapon };
const step = (c: PlayerCombat, seconds: number, cx = ctx) => {
  const events = [];
  const dt = 1 / 120;
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...c.update(dt, cx, { sprinting: false }));
  return events;
};

describe('longsword moveset (GDD 3.3)', () => {
  it('chains a three-hit light combo through buffered input', () => {
    const c = new PlayerCombat();
    expect(c.request('light', ctx)).toBe('started');
    expect(c.attack?.id).toBe('light1');
    step(c, 0.15);
    expect(c.request('light', ctx)).toBe('buffered');
    step(c, 0.15);
    expect(c.attack?.id).toBe('light2');
    step(c, 0.15);
    c.request('light', ctx);
    step(c, 0.2);
    expect(c.attack?.id).toBe('light3');
    step(c, 2);
    expect(c.phase).toBe('idle');
  });

  it('opens a hit window only during the active phase', () => {
    const c = new PlayerCombat();
    c.request('heavy', ctx);
    expect(c.hitWindowOpen()).toBe(false);
    expect(c.tryRegisterHit('e1')).toBe(false);
    step(c, ATTACKS.heavy.windup + 0.01);
    expect(c.hitWindowOpen()).toBe(true);
  });

  it('never hits the same target twice in one swing (M1 acceptance 6)', () => {
    const c = new PlayerCombat();
    c.request('light', ctx);
    step(c, ATTACKS.light1.windup + 0.01);
    expect(c.tryRegisterHit('e1')).toBe(true);
    expect(c.tryRegisterHit('e1')).toBe(false);
    expect(c.tryRegisterHit('e2')).toBe(true);
    for (let i = 0; i < 50; i++) expect(c.tryRegisterHit('e1')).toBe(false);
  });

  it('a new swing can hit the target again', () => {
    const c = new PlayerCombat();
    c.request('light', ctx);
    step(c, ATTACKS.light1.windup + 0.01);
    expect(c.tryRegisterHit('e1')).toBe(true);
    c.request('light', ctx);
    step(c, 0.28);
    expect(c.attack?.id).toBe('light2');
    expect(c.phase).toBe('active');
    expect(c.tryRegisterHit('e1')).toBe(true);
  });

  it('spends exact stamina costs and respects weapon efficiency', () => {
    const c = new PlayerCombat();
    c.request('light', ctx);
    expect(c.stamina.current).toBeCloseTo(98.5);
    const c2 = new PlayerCombat();
    c2.request('guardbreaker', { weapon: { ...weapon, staminaCostMultiplier: 0.8 } });
    expect(c2.stamina.current).toBeCloseTo(100 - 6 * 0.8);
  });

  it('enforces the Guardbreaker cooldown (8s)', () => {
    const c = new PlayerCombat();
    expect(c.request('guardbreaker', ctx)).toBe('started');
    step(c, 2);
    expect(c.request('guardbreaker', ctx)).toBe('cooldown');
    step(c, 6.1);
    expect(c.request('guardbreaker', ctx)).toBe('started');
  });

  it('Storm Arc is only available with the imbuement', () => {
    const c = new PlayerCombat();
    expect(c.request('storm_arc', ctx)).toBe('unavailable');
    expect(c.request('storm_arc', { ...ctx, abilities: ['storm_arc'] })).toBe('started');
  });

  it('attack speed shortens timings', () => {
    const fast = new PlayerCombat();
    fast.request('heavy', { weapon: { ...weapon, attackSpeed: 1.25 } });
    expect(fast.durations.windup).toBeCloseTo(ATTACKS.heavy.windup / 1.25);
  });
});

describe('defence', () => {
  it('blocking mitigates frontal damage and costs stamina', () => {
    const c = new PlayerCombat(200);
    c.setBlock(true);
    const out = c.receiveHit({ rawDamage: 20, facingDot: 1, heavy: false });
    expect(out.blocked).toBe(true);
    expect(out.damage).toBeCloseTo(4);
    expect(c.stamina.current).toBeCloseTo(94);
  });
  it('blocking does not protect from behind', () => {
    const c = new PlayerCombat(200);
    c.setBlock(true);
    const out = c.receiveHit({ rawDamage: 20, facingDot: -1, heavy: false });
    expect(out.blocked).toBe(false);
    expect(out.damage).toBe(20);
  });
  it('guard breaks when stamina is insufficient', () => {
    const c = new PlayerCombat(200);
    c.stamina = { current: 1, max: 100, regenDelayRemaining: 0 };
    c.setBlock(true);
    const out = c.receiveHit({ rawDamage: 40, facingDot: 1, heavy: true });
    expect(out.guardBroken).toBe(true);
    expect(c.phase).toBe('stagger');
  });
  it('dodge grants a limited invulnerability window', () => {
    const c = new PlayerCombat(200);
    c.request('dodge', ctx);
    step(c, DODGE.iframeStart + 0.02);
    expect(c.receiveHit({ rawDamage: 50, facingDot: 1, heavy: true }).dodged).toBe(true);
    expect(c.health).toBe(200);
    step(c, DODGE.iframeEnd);
    expect(c.isInvulnerable()).toBe(false);
  });
  it('dies at zero health and ignores further hits', () => {
    const c = new PlayerCombat(30);
    c.receiveHit({ rawDamage: 50, facingDot: 1, heavy: false });
    expect(c.phase).toBe('dead');
    expect(c.receiveHit({ rawDamage: 50, facingDot: 1, heavy: false }).damage).toBe(0);
    expect(c.request('light', ctx)).toBe('busy');
  });
});

describe('damage resolution', () => {
  it('scales with weapon damage, attack multiplier and mitigation', () => {
    const h = computeOutgoingHit(weapon, ATTACKS.light3, 0, 1);
    expect(h.damage).toBeCloseTo(29);
    expect(h.crit).toBe(false);
    expect(mitigate(100, 100)).toBe(50);
    expect(mitigate(100, -50)).toBe(100);
    const crit = computeOutgoingHit({ ...weapon, critChance: 1 }, ATTACKS.light1, 0, 0.5);
    expect(crit.crit).toBe(true);
    expect(crit.damage).toBeCloseTo(30);
  });
  it('arc hit test respects range and angle', () => {
    expect(inArc({ x: 0, z: 0 }, 0, { x: 0, z: 2 }, 2.6, 120)).toBe(true);
    expect(inArc({ x: 0, z: 0 }, 0, { x: 0, z: -2 }, 2.6, 120)).toBe(false);
    expect(inArc({ x: 0, z: 0 }, 0, { x: 0, z: 4 }, 2.6, 120)).toBe(false);
  });
});
