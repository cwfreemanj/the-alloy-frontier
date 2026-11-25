/**
 * Player combat state machine and damage resolution (GDD 3.2, 3.3; AF-003).
 * Renderer-independent: the 3D client reads phases for animation and asks this
 * module whether a hit window is open and whether a target may be hit.
 */
import type { WeaponStats } from '@alloy/item-gen';
import {
  STAMINA_CONFIG,
  canAfford,
  createStamina,
  effectiveCost,
  multiplierToReduction,
  spend,
  tickStamina,
  type StaminaAction,
  type StaminaState,
} from './stamina';

export type AttackId = 'light1' | 'light2' | 'light3' | 'heavy' | 'guardbreaker' | 'storm_arc' | 'lunging_thrust' | 'final_slash';
/** Skill attacks (see skills.ts): learned at mastery milestones, used from the skill bar. */
export type SkillAttackId = 'lunging_thrust' | 'final_slash';
export type ActionKind = 'light' | 'heavy' | 'guardbreaker' | 'dodge' | 'storm_arc' | SkillAttackId;

export interface AttackDefinition {
  id: AttackId;
  name: string;
  stamina: StaminaAction;
  /** Seconds at attackSpeed 1. */
  windup: number;
  active: number;
  recovery: number;
  damageMult: number;
  staggerMult: number;
  range: number;
  arcDeg: number;
  /** Forward movement (m) spread over windup+active. */
  lunge: number;
  guardBreak: boolean;
  comboNext?: AttackId;
  cooldown?: number;
  /** Heavy-class hits interrupt targets more readily. */
  heavy: boolean;
}

export const ATTACKS: Record<AttackId, AttackDefinition> = {
  light1: { id: 'light1', name: 'Light I', stamina: 'light', windup: 0.13, active: 0.12, recovery: 0.3, damageMult: 1, staggerMult: 1, range: 2.6, arcDeg: 130, lunge: 0.7, guardBreak: false, comboNext: 'light2', heavy: false },
  light2: { id: 'light2', name: 'Light II', stamina: 'light', windup: 0.12, active: 0.12, recovery: 0.3, damageMult: 1.05, staggerMult: 1, range: 2.6, arcDeg: 130, lunge: 0.7, guardBreak: false, comboNext: 'light3', heavy: false },
  light3: { id: 'light3', name: 'Light III', stamina: 'light', windup: 0.2, active: 0.14, recovery: 0.45, damageMult: 1.45, staggerMult: 1.6, range: 2.8, arcDeg: 90, lunge: 1.3, guardBreak: false, heavy: false },
  heavy: { id: 'heavy', name: 'Heavy Strike', stamina: 'heavy', windup: 0.42, active: 0.16, recovery: 0.5, damageMult: 2.0, staggerMult: 2.6, range: 2.9, arcDeg: 100, lunge: 1.0, guardBreak: false, heavy: true },
  guardbreaker: { id: 'guardbreaker', name: 'Guardbreaker', stamina: 'guardbreaker', windup: 0.48, active: 0.16, recovery: 0.55, damageMult: 1.5, staggerMult: 4.0, range: 2.9, arcDeg: 80, lunge: 1.8, guardBreak: true, cooldown: 8, heavy: true },
  storm_arc: { id: 'storm_arc', name: 'Storm Arc', stamina: 'storm_arc', windup: 0.25, active: 0.2, recovery: 0.4, damageMult: 1.3, staggerMult: 2.2, range: 4.5, arcDeg: 360, lunge: 0, guardBreak: false, cooldown: 12, heavy: true },
  // Skills (skills.ts says who may use them)
  lunging_thrust: { id: 'lunging_thrust', name: 'Lunging Thrust', stamina: 'lunging_thrust', windup: 0.22, active: 0.14, recovery: 0.4, damageMult: 1.6, staggerMult: 1.8, range: 3.0, arcDeg: 50, lunge: 4.0, guardBreak: false, cooldown: 6, heavy: false },
  final_slash: { id: 'final_slash', name: 'Final Slash', stamina: 'final_slash', windup: 0.6, active: 0.18, recovery: 0.65, damageMult: 3.0, staggerMult: 3.5, range: 3.0, arcDeg: 110, lunge: 1.2, guardBreak: false, cooldown: 15, heavy: true },
};

export const DODGE = { duration: 0.45, iframeStart: 0.04, iframeEnd: 0.32, distance: 3.6 };
export const INPUT_BUFFER_SECONDS = 0.35;
export const BLOCK_DAMAGE_TAKEN = 0.2;
export const BLOCK_FRONT_DOT = Math.cos((75 * Math.PI) / 180);

export type CombatPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'dodge' | 'stagger' | 'dead';

export interface CombatContext {
  weapon: WeaponStats;
  /** Extra stamina reductions (accessories, buffs). */
  reductions?: number[];
  /** Active imbuement abilities the equipped weapon grants. */
  abilities?: readonly string[];
  /** Cooldown overrides from imbuement definitions. */
  abilityCooldowns?: Record<string, number>;
}

export type RequestResult = 'started' | 'buffered' | 'no_stamina' | 'cooldown' | 'busy' | 'unavailable';

export type CombatEvent =
  | { type: 'attack_start'; attack: AttackDefinition; swingId: number }
  | { type: 'active_start'; attack: AttackDefinition; swingId: number }
  | { type: 'active_end'; attack: AttackDefinition; swingId: number }
  | { type: 'dodge_start' }
  | { type: 'rejected'; action: ActionKind; reason: RequestResult };

export interface IncomingHit {
  rawDamage: number;
  /** Dot product of defender facing vs direction to attacker (1 = directly in front). */
  facingDot: number;
  heavy: boolean;
}

export interface HitOutcome {
  damage: number;
  dodged: boolean;
  blocked: boolean;
  guardBroken: boolean;
  staggered: boolean;
  killed: boolean;
}

/** Ensures a single swing can damage each target at most once (M1 acceptance 6). */
export class SwingTracker {
  private swingId = 0;
  private hits = new Set<string>();
  begin(): number {
    this.swingId++;
    this.hits.clear();
    return this.swingId;
  }
  get id(): number {
    return this.swingId;
  }
  tryRegister(targetId: string): boolean {
    if (this.hits.has(targetId)) return false;
    this.hits.add(targetId);
    return true;
  }
  count(): number {
    return this.hits.size;
  }
}

export class PlayerCombat {
  stamina: StaminaState;
  health: number;
  maxHealth: number;
  phase: CombatPhase = 'idle';
  attack: AttackDefinition | null = null;
  /** Time within the current phase. */
  t = 0;
  /** Scaled phase durations for the current attack. */
  durations = { windup: 0, active: 0, recovery: 0 };
  blockHeld = false;
  buffered: { kind: ActionKind; ttl: number } | null = null;
  cooldowns: Record<string, number> = {};
  staggerRemaining = 0;
  readonly swing = new SwingTracker();
  private events: CombatEvent[] = [];

  constructor(maxHealth = 200, maxStamina = STAMINA_CONFIG.max) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.stamina = createStamina(maxStamina);
  }

  get blocking(): boolean {
    return this.blockHeld && this.phase === 'idle';
  }

  get alive(): boolean {
    return this.phase !== 'dead';
  }

  isInvulnerable(): boolean {
    return this.phase === 'dodge' && this.t >= DODGE.iframeStart && this.t <= DODGE.iframeEnd;
  }

  hitWindowOpen(): boolean {
    return this.phase === 'active' && this.attack !== null;
  }

  tryRegisterHit(targetId: string): boolean {
    return this.hitWindowOpen() && this.swing.tryRegister(targetId);
  }

  /** Movement is locked during attacks and stagger (dodge movement is driven separately). */
  canMove(): boolean {
    return this.phase === 'idle';
  }

  actionCost(kind: ActionKind, ctx: CombatContext): number {
    const base = STAMINA_CONFIG.costs[kind === 'light' ? 'light' : kind];
    if (kind === 'dodge') return effectiveCost(base, ctx.reductions ?? []);
    return effectiveCost(base, [multiplierToReduction(ctx.weapon.staminaCostMultiplier), ...(ctx.reductions ?? [])]);
  }

  setBlock(held: boolean): void {
    this.blockHeld = held;
  }

  /** Request an action. Inputs during an attack are buffered so combos feel responsive. */
  request(kind: ActionKind, ctx: CombatContext): RequestResult {
    if (this.phase === 'dead' || this.phase === 'stagger') return this.reject(kind, 'busy');
    // Abilities and skills must be granted by the context (imbued weapon, learned skill in hand).
    if ((kind === 'storm_arc' || kind === 'lunging_thrust' || kind === 'final_slash') && !(ctx.abilities ?? []).includes(kind)) return this.reject(kind, 'unavailable');
    const cdKey = kind !== 'dodge' && kind !== 'light' && ATTACKS[kind].cooldown ? kind : null;
    if (cdKey && (this.cooldowns[cdKey] ?? 0) > 0) return this.reject(kind, 'cooldown');

    if (this.phase === 'idle') return this.start(kind, ctx);

    // Dodge may cancel attack recovery (not windup/active) for responsiveness.
    if (kind === 'dodge' && this.phase === 'recovery') return this.start(kind, ctx);

    // Otherwise buffer the input (latest input wins).
    this.buffered = { kind, ttl: INPUT_BUFFER_SECONDS };
    return 'buffered';
  }

  private reject(kind: ActionKind, reason: RequestResult): RequestResult {
    this.events.push({ type: 'rejected', action: kind, reason });
    return reason;
  }

  private start(kind: ActionKind, ctx: CombatContext): RequestResult {
    const cost = this.actionCost(kind, ctx);
    const staminaAction: StaminaAction = kind;
    if (!canAfford(this.stamina, staminaAction, cost)) return this.reject(kind, 'no_stamina');
    this.stamina = spend(this.stamina, cost);
    this.buffered = null;

    if (kind === 'dodge') {
      this.phase = 'dodge';
      this.t = 0;
      this.attack = null;
      this.events.push({ type: 'dodge_start' });
      return 'started';
    }

    let id: AttackId;
    if (kind === 'light') {
      const chain = this.phase === 'recovery' && this.attack?.comboNext;
      id = chain ? this.attack!.comboNext! : 'light1';
    } else {
      id = kind;
    }
    const def = ATTACKS[id];
    const speed = Math.max(0.25, ctx.weapon.attackSpeed || 1);
    this.attack = def;
    this.durations = { windup: def.windup / speed, active: def.active / speed, recovery: def.recovery / speed };
    this.phase = 'windup';
    this.t = 0;
    const cd = ctx.abilityCooldowns?.[def.id] ?? def.cooldown;
    if (cd) this.cooldowns[def.id] = cd;
    const swingId = this.swing.begin();
    this.events.push({ type: 'attack_start', attack: def, swingId });
    return 'started';
  }

  /** Advance timers. Returns events generated since the last update. */
  update(dt: number, ctx: CombatContext, movement: { sprinting: boolean }): CombatEvent[] {
    if (!(dt > 0)) return this.drain();
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.buffered) {
      this.buffered.ttl -= dt;
      if (this.buffered.ttl <= 0) this.buffered = null;
    }

    this.stamina = tickStamina(this.stamina, dt, {
      sprinting: movement.sprinting && this.phase === 'idle',
      blocking: this.blocking,
    });

    if (this.phase === 'dead') return this.drain();
    this.t += dt;

    switch (this.phase) {
      case 'windup':
        if (this.t >= this.durations.windup) {
          this.phase = 'active';
          this.t -= this.durations.windup;
          this.events.push({ type: 'active_start', attack: this.attack!, swingId: this.swing.id });
        }
        break;
      case 'active':
        if (this.t >= this.durations.active) {
          this.phase = 'recovery';
          this.t -= this.durations.active;
          this.events.push({ type: 'active_end', attack: this.attack!, swingId: this.swing.id });
        }
        break;
      case 'recovery': {
        // Combo cancel window: buffered light chains as soon as recovery begins.
        if (this.buffered) {
          const b = this.buffered;
          if (b.kind !== 'light' || this.attack?.comboNext || this.t >= this.durations.recovery * 0.5) {
            const res = this.start(b.kind, ctx);
            if (res === 'started') break;
            this.buffered = null;
          }
        }
        if (this.t >= this.durations.recovery) {
          this.phase = 'idle';
          this.t = 0;
          this.attack = null;
        }
        break;
      }
      case 'dodge':
        if (this.t >= DODGE.duration) {
          this.phase = 'idle';
          this.t = 0;
        }
        break;
      case 'stagger':
        this.staggerRemaining -= dt;
        if (this.staggerRemaining <= 0) {
          this.phase = 'idle';
          this.t = 0;
        }
        break;
      case 'idle':
        if (this.buffered) {
          const b = this.buffered;
          this.buffered = null;
          this.start(b.kind, ctx);
        }
        break;
    }
    return this.drain();
  }

  private drain(): CombatEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  receiveHit(hit: IncomingHit): HitOutcome {
    const none: HitOutcome = { damage: 0, dodged: false, blocked: false, guardBroken: false, staggered: false, killed: false };
    if (this.phase === 'dead') return none;
    if (this.isInvulnerable()) return { ...none, dodged: true };
    const raw = Number.isFinite(hit.rawDamage) ? Math.max(0, hit.rawDamage) : 0;
    let damage = raw;
    const out: HitOutcome = { ...none };

    if (this.blocking && hit.facingDot >= BLOCK_FRONT_DOT) {
      const cost = raw * STAMINA_CONFIG.blockHitCostRatio;
      if (this.stamina.current >= cost) {
        this.stamina = spend(this.stamina, cost);
        damage = raw * BLOCK_DAMAGE_TAKEN;
        out.blocked = true;
      } else {
        this.stamina = spend(this.stamina, this.stamina.current);
        damage = raw * 0.6;
        out.guardBroken = true;
        this.stagger(0.8);
        out.staggered = true;
      }
    } else if (hit.heavy) {
      this.stagger(0.45);
      out.staggered = true;
    }

    out.damage = Math.round(damage * 10) / 10;
    this.health = Math.max(0, this.health - out.damage);
    if (this.health <= 0) {
      this.phase = 'dead';
      this.attack = null;
      out.killed = true;
    }
    return out;
  }

  stagger(seconds: number): void {
    if (this.phase === 'dead') return;
    this.phase = 'stagger';
    this.staggerRemaining = seconds;
    this.attack = null;
    this.buffered = null;
    this.t = 0;
  }

  heal(amount: number): void {
    if (this.phase === 'dead' || !Number.isFinite(amount)) return;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
  }

  revive(): void {
    this.phase = 'idle';
    this.health = this.maxHealth;
    this.stamina = createStamina(this.stamina.max);
    this.attack = null;
    this.buffered = null;
    this.cooldowns = {};
    this.t = 0;
  }
}

/** Outgoing damage before target mitigation. */
export function computeOutgoingHit(
  weapon: WeaponStats,
  attack: AttackDefinition,
  masteryBonus: number,
  critRoll: number,
): { damage: number; stagger: number; crit: boolean } {
  const crit = critRoll < weapon.critChance;
  const bonus = Number.isFinite(masteryBonus) ? Math.max(0, masteryBonus) : 0;
  const damage = weapon.damage * attack.damageMult * (1 + bonus) * (crit ? 1.5 : 1);
  return { damage, stagger: weapon.stagger * attack.staggerMult, crit };
}

/** Defense mitigation: damage × 100 / (100 + defense). */
export function mitigate(damage: number, defense: number): number {
  const d = Number.isFinite(defense) ? Math.max(0, defense) : 0;
  return (Math.max(0, damage) * 100) / (100 + d);
}
