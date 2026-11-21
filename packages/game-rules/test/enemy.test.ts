import { describe, expect, it } from 'vitest';
import { ENEMIES, EnemyBrain, type EnemyPerception } from '../src';

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const near: EnemyPerception = { distToPlayer: 2, angleToPlayer: 0, playerAlive: true, distFromHome: 3, atWaypoint: false, hasPatrol: true };
const far: EnemyPerception = { ...near, distToPlayer: 50 };
const run = (b: EnemyBrain, p: EnemyPerception, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) b.update(1 / 60, p);
};

describe('enemy state machine (Phase A)', () => {
  it('idles, patrols, detects, alerts and pursues', () => {
    const b = new EnemyBrain(ENEMIES.scavenger, seq([0.1]));
    run(b, far, 3);
    expect(b.state).toBe('patrol');
    b.update(1 / 60, { ...near, distToPlayer: 10 });
    expect(b.state).toBe('alert');
    run(b, { ...near, distToPlayer: 10 }, 0.5);
    expect(b.state).toBe('chase');
    const intent = b.update(1 / 60, { ...near, distToPlayer: 10 });
    expect(intent.move).toBe('toPlayer');
  });

  it('telegraphs for the full windup before the attack becomes active', () => {
    const b = new EnemyBrain(ENEMIES.scavenger, seq([0.1]));
    b.state = 'chase';
    b.update(1 / 60, near);
    expect(b.state).toBe('telegraph');
    expect(b.tryHitPlayer()).toBe(false);
    const windup = b.windupFor(b.attack!);
    run(b, near, windup - 0.05);
    expect(b.state).toBe('telegraph');
    run(b, near, 0.08);
    expect(b.state).toBe('attack');
    expect(b.tryHitPlayer()).toBe(true);
    expect(b.tryHitPlayer()).toBe(false);
    run(b, near, 0.3);
    expect(b.state).toBe('recover');
  });

  it('poise break staggers and interrupts a telegraph', () => {
    const b = new EnemyBrain(ENEMIES.scavenger, seq([0.1]));
    b.state = 'chase';
    b.update(1 / 60, near);
    expect(b.state).toBe('telegraph');
    const r = b.receiveHit({ damage: 5, stagger: 100, guardBreak: false });
    expect(r.staggered).toBe(true);
    expect(b.state).toBe('stagger');
    expect(b.attack).toBeNull();
  });

  it('construct guard reduces damage; Guardbreaker breaks it', () => {
    const b = new EnemyBrain(ENEMIES.sentinel, seq([0.1]));
    b.state = 'guard';
    const guarded = b.receiveHit({ damage: 100, stagger: 10, guardBreak: false });
    expect(guarded.guarded).toBe(true);
    expect(guarded.damage).toBeCloseTo(15);
    b.state = 'guard';
    const broken = b.receiveHit({ damage: 40, stagger: 10, guardBreak: true });
    expect(broken.guardBroken).toBe(true);
    expect(broken.staggered).toBe(true);
    expect(b.state).toBe('stagger');
  });

  it('dies and then ignores further damage', () => {
    const b = new EnemyBrain(ENEMIES.scavenger, seq([0.5]));
    const r = b.receiveHit({ damage: 1000, stagger: 0, guardBreak: false });
    expect(r.killed).toBe(true);
    expect(b.state).toBe('dead');
    expect(b.receiveHit({ damage: 10, stagger: 0, guardBreak: false }).ignored).toBe(true);
  });

  it('leashes back home and heals', () => {
    const b = new EnemyBrain(ENEMIES.scavenger, seq([0.5]));
    b.state = 'chase';
    b.health = 10;
    b.update(1 / 60, { ...near, distToPlayer: 8, distFromHome: 40 });
    expect(b.state).toBe('return');
    run(b, { ...near, distToPlayer: 30, distFromHome: 10 }, 5);
    b.update(1 / 60, { ...near, distToPlayer: 30, distFromHome: 1 });
    expect(b.state).toBe('idle');
    expect(b.health).toBe(ENEMIES.scavenger.maxHealth);
  });

  it('elite has hyper-armor during attacks and enters phase 2', () => {
    const b = new EnemyBrain(ENEMIES.warden, seq([0.1]));
    b.state = 'attack';
    b.attack = ENEMIES.warden.attacks[0];
    const r = b.receiveHit({ damage: 10, stagger: 1000, guardBreak: false });
    expect(r.staggered).toBe(false);
    b.receiveHit({ damage: ENEMIES.warden.maxHealth * 0.6, stagger: 0, guardBreak: false });
    expect(b.phase2).toBe(true);
    expect(b.windupFor(ENEMIES.warden.attacks[0])).toBeLessThan(ENEMIES.warden.attacks[0].windup);
  });

  it('training dummy never dies', () => {
    const b = new EnemyBrain(ENEMIES.dummy, seq([0.5]));
    const r = b.receiveHit({ damage: 99999, stagger: 0, guardBreak: false });
    expect(r.killed).toBe(false);
    expect(b.alive).toBe(true);
  });
});
