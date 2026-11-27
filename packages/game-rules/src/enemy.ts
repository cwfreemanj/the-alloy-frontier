/**
 * Enemy archetypes and a small explicit AI state machine (GDD 3.1, 6.1 "small explicit
 * ability/state machine first"). Pure logic: the client maps intents to movement.
 */
import type { DamageType } from '@alloy/item-gen';
import type { AttributeLevels } from './attributes';
import { SwingTracker } from './combat';

export type EnemyState =
  | 'idle'
  | 'patrol'
  | 'alert'
  | 'chase'
  | 'guard'
  | 'telegraph'
  | 'attack'
  | 'recover'
  | 'stagger'
  | 'return'
  | 'dead';

export interface EnemyAttackDef {
  id: string;
  name: string;
  /** Telegraph duration (readable windup). */
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  /** Max distance at which the AI chooses this attack. */
  range: number;
  minRange?: number;
  shape: 'arc' | 'circle';
  arcDeg?: number;
  /** For circle attacks: centre offset in front of the enemy, and radius. */
  circleOffset?: number;
  circleRadius?: number;
  /** Forward movement during the active window (m). */
  lunge?: number;
  heavy: boolean;
  weight: number;
}

export interface EnemyArchetype {
  id: string;
  name: string;
  kind: 'melee' | 'construct' | 'elite' | 'dummy';
  /**
   * Level shown above the enemy's head, on the same scale as the player's adventurer rank.
   * Fixed per kind for now; the adaptive world can raise it per area later.
   */
  level: number;
  maxHealth: number;
  defense: number;
  poise: number;
  staggerDuration: number;
  walkSpeed: number;
  chaseSpeed: number;
  turnRate: number;
  detectRange: number;
  leashRange: number;
  attackCooldown: [number, number];
  attacks: EnemyAttackDef[];
  guard?: { chance: number; duration: number; damageTaken: number };
  /** Elite: does not get interrupted by poise breaks during the active window. */
  hyperArmorActive?: boolean;
  phase2?: { healthFraction: number; windupMult: number; speedMult: number };
  xp: number;
  coins: [number, number];
  respawnSeconds: number | null;
  radius: number;
  /** Visual height scale. */
  scale: number;
  /** Attributes compared with the player's (stagger, crits, how hard hits land). */
  attributes: AttributeLevels;
  /** Damage-type multipliers after defense (missing = x1). */
  resist?: Partial<Record<DamageType, number>>;
}

export const ENEMIES: Record<string, EnemyArchetype> = {
  scavenger: {
    id: 'scavenger',
    name: 'Ironwood Scavenger',
    kind: 'melee',
    level: 1,
    maxHealth: 90,
    defense: 10,
    poise: 40,
    staggerDuration: 0.9,
    walkSpeed: 1.6,
    chaseSpeed: 4.1,
    turnRate: 5,
    detectRange: 13,
    leashRange: 32,
    attackCooldown: [1.1, 2.0],
    attacks: [
      { id: 'slash', name: 'Hatchet Slash', windup: 0.55, active: 0.15, recovery: 0.6, damage: 12, range: 2.3, shape: 'arc', arcDeg: 100, lunge: 0.6, heavy: false, weight: 3 },
      { id: 'overhead', name: 'Overhead Chop', windup: 0.9, active: 0.15, recovery: 0.8, damage: 22, range: 2.5, shape: 'arc', arcDeg: 60, lunge: 0.9, heavy: true, weight: 1 },
    ],
    xp: 20,
    coins: [3, 6],
    respawnSeconds: 90,
    radius: 0.45,
    scale: 1,
    attributes: { strength: 2, dexterity: 3, vitality: 2, endurance: 2 },
    // Hide armor: a bit weak to piercing, shrugs off some blunt force.
    resist: { pierce: 1.2, blunt: 0.9 },
  },
  sentinel: {
    id: 'sentinel',
    name: 'Quarry Sentinel',
    kind: 'construct',
    level: 2,
    maxHealth: 210,
    defense: 35,
    poise: 70,
    staggerDuration: 1.3,
    walkSpeed: 1.2,
    chaseSpeed: 2.8,
    turnRate: 2.6,
    detectRange: 15,
    leashRange: 30,
    attackCooldown: [1.4, 2.4],
    attacks: [
      { id: 'piston', name: 'Piston Jab', windup: 0.7, active: 0.18, recovery: 0.7, damage: 20, range: 2.8, shape: 'arc', arcDeg: 50, lunge: 0.8, heavy: false, weight: 2 },
      { id: 'quake', name: 'Ironglass Quake', windup: 1.15, active: 0.2, recovery: 1.1, damage: 30, range: 3.6, shape: 'circle', circleOffset: 1.2, circleRadius: 3.0, heavy: true, weight: 1 },
    ],
    guard: { chance: 0.45, duration: 2.2, damageTaken: 0.15 },
    xp: 45,
    coins: [6, 10],
    respawnSeconds: 120,
    radius: 0.75,
    scale: 1.35,
    attributes: { strength: 4, dexterity: 1, vitality: 5, endurance: 3 },
    // Stone and iron construct: blades skid off, hammers crack it, it conducts magic.
    resist: { slash: 0.75, pierce: 0.6, blunt: 1.35, magic: 1.15 },
  },
  warden: {
    id: 'warden',
    name: 'Foundry Warden',
    kind: 'elite',
    level: 4,
    maxHealth: 760,
    defense: 40,
    poise: 150,
    staggerDuration: 1.6,
    walkSpeed: 1.5,
    chaseSpeed: 3.5,
    turnRate: 3.0,
    detectRange: 20,
    leashRange: 40,
    attackCooldown: [0.9, 1.7],
    attacks: [
      { id: 'sweep', name: 'Furnace Sweep', windup: 0.75, active: 0.2, recovery: 0.75, damage: 28, range: 3.9, shape: 'arc', arcDeg: 150, lunge: 0.4, heavy: false, weight: 3 },
      { id: 'slam', name: 'Core Slam', windup: 1.1, active: 0.2, recovery: 1.1, damage: 42, range: 4.5, shape: 'circle', circleOffset: 2.0, circleRadius: 3.4, heavy: true, weight: 2 },
      { id: 'lunge', name: 'Rail Lunge', windup: 0.85, active: 0.35, recovery: 0.95, damage: 32, range: 9, minRange: 4, shape: 'arc', arcDeg: 60, lunge: 6.5, heavy: true, weight: 2 },
    ],
    hyperArmorActive: true,
    phase2: { healthFraction: 0.5, windupMult: 0.8, speedMult: 1.15 },
    xp: 200,
    coins: [40, 40],
    respawnSeconds: null,
    radius: 1.1,
    scale: 1.8,
    attributes: { strength: 6, dexterity: 3, vitality: 8, endurance: 6 },
    // Plated furnace core: piercing finds few gaps, heavy blows dent it, magic overloads it.
    resist: { pierce: 0.85, blunt: 1.15, magic: 1.2 },
  },
  // Raids on Emberhold (AF-011, docs/raids.md): server-spawned, never respawn on their own.
  raider: {
    id: 'raider',
    name: 'Ember Raider',
    kind: 'melee',
    level: 1,
    maxHealth: 90,
    defense: 10,
    poise: 40,
    staggerDuration: 0.9,
    walkSpeed: 1.8,
    chaseSpeed: 4.1,
    turnRate: 5,
    detectRange: 18,
    leashRange: 45,
    attackCooldown: [1.1, 2.0],
    attacks: [
      { id: 'slash', name: 'Hatchet Slash', windup: 0.55, active: 0.15, recovery: 0.6, damage: 12, range: 2.3, shape: 'arc', arcDeg: 100, lunge: 0.6, heavy: false, weight: 3 },
      { id: 'overhead', name: 'Overhead Chop', windup: 0.9, active: 0.15, recovery: 0.8, damage: 22, range: 2.5, shape: 'arc', arcDeg: 60, lunge: 0.9, heavy: true, weight: 1 },
    ],
    xp: 24,
    coins: [4, 8],
    respawnSeconds: null,
    radius: 0.45,
    scale: 1,
    attributes: { strength: 2, dexterity: 3, vitality: 2, endurance: 2 },
    resist: { pierce: 1.2, blunt: 0.9 },
  },
  raider_captain: {
    id: 'raider_captain',
    name: 'Raider Captain',
    kind: 'elite',
    level: 1,
    maxHealth: 360,
    defense: 16,
    poise: 140,
    staggerDuration: 1.2,
    walkSpeed: 1.8,
    chaseSpeed: 3.8,
    turnRate: 4,
    detectRange: 20,
    leashRange: 50,
    attackCooldown: [1.0, 1.8],
    attacks: [
      { id: 'slash', name: 'Hatchet Slash', windup: 0.55, active: 0.15, recovery: 0.6, damage: 16, range: 2.6, shape: 'arc', arcDeg: 100, lunge: 0.6, heavy: false, weight: 3 },
      { id: 'overhead', name: 'Overhead Chop', windup: 0.9, active: 0.15, recovery: 0.8, damage: 26, range: 2.8, shape: 'arc', arcDeg: 60, lunge: 0.9, heavy: true, weight: 2 },
      { id: 'torch_sweep', name: 'Torch Sweep', windup: 0.85, active: 0.2, recovery: 0.9, damage: 24, range: 3.4, shape: 'arc', arcDeg: 170, lunge: 0.3, heavy: false, weight: 2 },
    ],
    hyperArmorActive: true,
    xp: 120,
    coins: [30, 40],
    respawnSeconds: null,
    radius: 0.55,
    scale: 1.3,
    attributes: { strength: 4, dexterity: 3, vitality: 5, endurance: 4 },
    resist: { pierce: 1.1, blunt: 0.9 },
  },
  dummy: {
    id: 'dummy',
    name: 'Training Post',
    kind: 'dummy',
    level: 1,
    maxHealth: 9999,
    defense: 0,
    poise: 60,
    staggerDuration: 0.6,
    walkSpeed: 0,
    chaseSpeed: 0,
    turnRate: 0,
    detectRange: 0,
    leashRange: 0,
    attackCooldown: [99, 99],
    attacks: [],
    xp: 0,
    coins: [0, 0],
    respawnSeconds: null,
    radius: 0.4,
    scale: 1,
    attributes: { strength: 1, dexterity: 1, vitality: 1, endurance: 1 },
  },
};

export interface EnemyPerception {
  distToPlayer: number;
  /** Absolute angle between enemy facing and the direction to the player (radians). */
  angleToPlayer: number;
  playerAlive: boolean;
  distFromHome: number;
  atWaypoint: boolean;
  hasPatrol: boolean;
}

export type MoveIntent = 'none' | 'toPlayer' | 'toHome' | 'toWaypoint' | 'lunge';

export interface EnemyIntent {
  move: MoveIntent;
  speed: number;
  facePlayer: boolean;
  turnRate: number;
}

export interface EnemyHitInput {
  damage: number;
  stagger: number;
  guardBreak: boolean;
}

export interface EnemyHitResult {
  damage: number;
  killed: boolean;
  staggered: boolean;
  guarded: boolean;
  guardBroken: boolean;
  ignored: boolean;
}

export class EnemyBrain {
  def: EnemyArchetype;
  state: EnemyState;
  health: number;
  poiseDamage = 0;
  stateTime = 0;
  cooldown = 0;
  attack: EnemyAttackDef | null = null;
  waypointIndex = 0;
  phase2 = false;
  timeSinceHit = 99;
  guardUsedThisCycle = false;
  /** Seconds during which poise damage is ignored (prevents stagger-locking). */
  staggerImmunity = 0;
  readonly swing = new SwingTracker();
  private rng: () => number;

  constructor(def: EnemyArchetype, rng: () => number, startState: EnemyState = 'idle') {
    this.def = def;
    this.rng = rng;
    this.state = startState;
    this.health = def.maxHealth;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get guarding(): boolean {
    return this.state === 'guard';
  }

  /** Windup duration, accelerated in phase 2. */
  windupFor(a: EnemyAttackDef): number {
    return a.windup * (this.phase2 && this.def.phase2 ? this.def.phase2.windupMult : 1);
  }

  /** 0..1 progress of the current telegraph (for readable visuals). */
  telegraphProgress(): number {
    if (this.state !== 'telegraph' || !this.attack) return 0;
    return Math.min(1, this.stateTime / this.windupFor(this.attack));
  }

  hitWindowOpen(): boolean {
    return this.state === 'attack' && this.attack !== null;
  }

  tryHitPlayer(): boolean {
    return this.hitWindowOpen() && this.swing.tryRegister('player');
  }

  private enter(s: EnemyState): void {
    this.state = s;
    this.stateTime = 0;
  }

  private speedMult(): number {
    return this.phase2 && this.def.phase2 ? this.def.phase2.speedMult : 1;
  }

  update(dt: number, p: EnemyPerception): EnemyIntent {
    const idle: EnemyIntent = { move: 'none', speed: 0, facePlayer: false, turnRate: this.def.turnRate };
    if (!(dt > 0)) return idle;
    this.stateTime += dt;
    this.timeSinceHit += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.staggerImmunity = Math.max(0, this.staggerImmunity - dt);
    if (this.timeSinceHit > 2.5) this.poiseDamage = Math.max(0, this.poiseDamage - this.def.poise * 0.5 * dt);
    if (this.def.kind === 'dummy') {
      if (this.state === 'stagger' && this.stateTime >= this.def.staggerDuration) this.enter('idle');
      if (this.timeSinceHit > 3) this.health = this.def.maxHealth;
      return idle;
    }

    const d = this.def;
    const sees = p.playerAlive && p.distToPlayer <= d.detectRange;

    switch (this.state) {
      case 'dead':
        return idle;
      case 'idle':
        if (sees) {
          this.enter('alert');
          return { ...idle, facePlayer: true };
        }
        if (p.hasPatrol && this.stateTime > 2.5) this.enter('patrol');
        return idle;
      case 'patrol':
        if (sees) {
          this.enter('alert');
          return { ...idle, facePlayer: true };
        }
        if (p.atWaypoint) {
          this.waypointIndex++;
          this.enter('idle');
          return idle;
        }
        return { move: 'toWaypoint', speed: d.walkSpeed, facePlayer: false, turnRate: d.turnRate };
      case 'alert':
        if (this.stateTime >= 0.45) this.enter('chase');
        return { ...idle, facePlayer: true, turnRate: d.turnRate * 1.5 };
      case 'return':
        this.health = Math.min(d.maxHealth, this.health + d.maxHealth * 0.25 * dt);
        if (p.distFromHome < 1.5) {
          this.health = d.maxHealth;
          this.phase2 = false;
          this.enter('idle');
          return idle;
        }
        return { move: 'toHome', speed: d.chaseSpeed, facePlayer: false, turnRate: d.turnRate };
      case 'chase': {
        if (!p.playerAlive || p.distFromHome > d.leashRange) {
          this.enter('return');
          return idle;
        }
        const options = d.attacks.filter((a) => p.distToPlayer <= a.range * 0.92 && p.distToPlayer >= (a.minRange ?? 0));
        if (this.cooldown <= 0 && options.length > 0 && p.angleToPlayer < (35 * Math.PI) / 180) {
          this.attack = this.weightedPick(options);
          this.guardUsedThisCycle = false;
          this.enter('telegraph');
          return { ...idle, facePlayer: true };
        }
        const closest = Math.min(...d.attacks.map((a) => a.range));
        if (d.guard && !this.guardUsedThisCycle && this.cooldown > 0 && p.distToPlayer < closest + 1.5) {
          this.guardUsedThisCycle = true;
          if (this.rng() < d.guard.chance) {
            this.enter('guard');
            return { ...idle, facePlayer: true };
          }
        }
        const holdDistance = closest * 0.75;
        if (p.distToPlayer > holdDistance) {
          return { move: 'toPlayer', speed: d.chaseSpeed * this.speedMult(), facePlayer: true, turnRate: d.turnRate };
        }
        return { ...idle, facePlayer: true };
      }
      case 'guard':
        if (this.stateTime >= (d.guard?.duration ?? 0)) this.enter('chase');
        return { ...idle, facePlayer: true, turnRate: d.turnRate * 0.7 };
      case 'telegraph': {
        const a = this.attack!;
        if (this.stateTime >= this.windupFor(a)) {
          this.swing.begin();
          this.enter('attack');
          return { move: a.lunge ? 'lunge' : 'none', speed: (a.lunge ?? 0) / a.active, facePlayer: false, turnRate: 0 };
        }
        // Track the player during the first 70% of the telegraph, then commit (readable + dodgeable).
        const tracking = this.stateTime < this.windupFor(a) * 0.7;
        return { ...idle, facePlayer: tracking, turnRate: d.turnRate * 1.2 };
      }
      case 'attack': {
        const a = this.attack!;
        if (this.stateTime >= a.active) {
          this.enter('recover');
          return idle;
        }
        return { move: a.lunge ? 'lunge' : 'none', speed: (a.lunge ?? 0) / a.active, facePlayer: false, turnRate: 0 };
      }
      case 'recover': {
        const a = this.attack!;
        if (this.stateTime >= a.recovery) {
          const [lo, hi] = d.attackCooldown;
          this.cooldown = lo + (hi - lo) * this.rng();
          this.attack = null;
          this.enter('chase');
        }
        return idle;
      }
      case 'stagger':
        if (this.stateTime >= d.staggerDuration * (this.lastStaggerScale || 1)) {
          this.cooldown = Math.max(this.cooldown, 0.4);
          this.staggerImmunity = d.kind === 'elite' ? 5 : 1;
          this.enter('chase');
        }
        return idle;
    }
    return idle;
  }

  private lastStaggerScale = 1;

  private weightedPick(options: EnemyAttackDef[]): EnemyAttackDef {
    const total = options.reduce((s, a) => s + a.weight, 0);
    let r = this.rng() * total;
    for (const a of options) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return options[options.length - 1];
  }

  receiveHit(hit: EnemyHitInput): EnemyHitResult {
    const res: EnemyHitResult = { damage: 0, killed: false, staggered: false, guarded: false, guardBroken: false, ignored: false };
    if (this.state === 'dead' || this.state === 'return') return { ...res, ignored: true };
    let damage = Number.isFinite(hit.damage) ? Math.max(0, hit.damage) : 0;
    let stagger = Number.isFinite(hit.stagger) ? Math.max(0, hit.stagger) : 0;
    this.timeSinceHit = 0;
    let forceStagger = 0;

    if (this.state === 'guard' && this.def.guard) {
      if (hit.guardBreak) {
        res.guardBroken = true;
        damage *= 1.25;
        forceStagger = 1.8;
      } else {
        res.guarded = true;
        damage *= this.def.guard.damageTaken;
        stagger *= 0.3;
      }
    }

    res.damage = Math.round(damage * 10) / 10;
    this.health = Math.max(0, this.health - res.damage);
    if (this.health <= 0 && this.def.kind !== 'dummy') {
      this.health = 0;
      this.attack = null;
      this.enter('dead');
      res.killed = true;
      return res;
    }
    if (this.def.kind === 'dummy' && this.health <= 0) this.health = this.def.maxHealth;

    if (this.def.phase2 && !this.phase2 && this.health <= this.def.maxHealth * this.def.phase2.healthFraction) {
      this.phase2 = true;
    }

    if (this.staggerImmunity <= 0 && this.state !== 'stagger') this.poiseDamage += stagger;
    const armored = this.def.hyperArmorActive && this.state === 'attack';
    if ((forceStagger > 0 && this.state !== 'stagger') || (this.poiseDamage >= this.def.poise && !armored)) {
      this.poiseDamage = 0;
      this.attack = null;
      this.lastStaggerScale = forceStagger > 0 ? forceStagger : 1;
      this.enter('stagger');
      res.staggered = true;
    } else if (this.def.kind !== 'dummy' && (this.state === 'idle' || this.state === 'patrol' || this.state === 'alert')) {
      this.enter('chase');
    }
    return res;
  }

  /** Switch to another version of the archetype (a new level), keeping the health fraction. */
  setDef(def: EnemyArchetype): void {
    if (def === this.def) return;
    const frac = this.def.maxHealth > 0 ? this.health / this.def.maxHealth : 1;
    this.def = def;
    if (this.attack) this.attack = def.attacks.find((a) => a.id === this.attack!.id) ?? null;
    this.health = this.alive ? Math.max(1, Math.round(def.maxHealth * frac * 10) / 10) : 0;
  }

  /** Reset to full health at home (used after player death / respawn). */
  reset(): void {
    this.health = this.def.maxHealth;
    this.poiseDamage = 0;
    this.attack = null;
    this.phase2 = false;
    this.cooldown = 0;
    this.enter('idle');
  }
}
