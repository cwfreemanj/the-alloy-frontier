/**
 * Long-duration endurance stamina (GDD 3.3, 3.6). Pure, renderer-independent.
 *
 * S_next = max(0, min(S_max, S + regen*dt - sprintDrain*dt - blockDrain*dt - sum(actionCost*(1-reduction))))
 * Reductions compose multiplicatively and can never produce a negative cost.
 */

export type StaminaAction = 'light' | 'heavy' | 'dodge' | 'guardbreaker' | 'storm_arc' | 'jump';

export const STAMINA_CONFIG = {
  max: 100,
  sprintDrainPerSec: 0.333,
  regenPerSec: 0.75,
  regenDelay: 1.5,
  /** PROTOTYPE DECISION: holding block drains slowly and pauses regeneration. */
  blockHoldDrainPerSec: 0.2,
  /** Fraction of incoming raw damage paid as stamina when a hit is blocked. */
  blockHitCostRatio: 0.3,
  /** Graduated low-stamina penalty (GDD 3.6): below this fraction, regeneration slows. */
  lowThreshold: 0.15,
  lowRegenMultiplier: 0.6,
  /** Highest reduction any single source may provide (prevents free actions). */
  maxSingleReduction: 0.9,
  costs: {
    light: 1.5,
    heavy: 3.5,
    dodge: 4,
    guardbreaker: 6,
    storm_arc: 5,
    /** PROTOTYPE DECISION: not in GDD table. */
    jump: 1,
  } as Record<StaminaAction, number>,
  /** Actions that may be performed while stamina is above 0 but below their cost. */
  lowCostActions: ['light', 'dodge', 'jump'] as StaminaAction[],
};

export interface StaminaState {
  current: number;
  max: number;
  /** Seconds remaining before regeneration resumes. */
  regenDelayRemaining: number;
}

export function createStamina(max = STAMINA_CONFIG.max): StaminaState {
  const m = Number.isFinite(max) && max > 0 ? max : STAMINA_CONFIG.max;
  return { current: m, max: m, regenDelayRemaining: 0 };
}

/**
 * Effective cost after multiplicative reductions. A reduction r means "r fraction cheaper";
 * negative r is a penalty (more expensive). Each reduction is clamped to [-1, 0.9].
 */
export function effectiveCost(base: number, reductions: readonly number[] = []): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  let mult = 1;
  for (const r of reductions) {
    const rr = Number.isFinite(r) ? Math.max(-1, Math.min(STAMINA_CONFIG.maxSingleReduction, r)) : 0;
    mult *= 1 - rr;
  }
  return Math.max(0, base * mult);
}

/** Convert a weapon's staminaCostMultiplier (0.9 = 10% cheaper) into a reduction. */
export function multiplierToReduction(mult: number): number {
  return Number.isFinite(mult) ? 1 - mult : 0;
}

export function canAfford(state: StaminaState, action: StaminaAction, cost: number): boolean {
  if (state.current >= cost) return true;
  return STAMINA_CONFIG.lowCostActions.includes(action) && state.current > 0;
}

export function spend(state: StaminaState, cost: number): StaminaState {
  const c = Number.isFinite(cost) && cost > 0 ? cost : 0;
  return {
    ...state,
    current: Math.max(0, state.current - c),
    regenDelayRemaining: c > 0 ? STAMINA_CONFIG.regenDelay : state.regenDelayRemaining,
  };
}

export interface StaminaTickInput {
  sprinting: boolean;
  blocking: boolean;
  /** Additional regeneration multiplier from equipment/buffs (default 1). */
  regenMultiplier?: number;
}

export function tickStamina(state: StaminaState, dt: number, input: StaminaTickInput): StaminaState {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  let { current, regenDelayRemaining } = state;
  const demanding = input.sprinting || input.blocking;
  if (input.sprinting) current -= STAMINA_CONFIG.sprintDrainPerSec * dt;
  if (input.blocking) current -= STAMINA_CONFIG.blockHoldDrainPerSec * dt;
  if (demanding) {
    // No active regeneration while sprinting/blocking; recovery waits for a pause.
    regenDelayRemaining = STAMINA_CONFIG.regenDelay;
  } else {
    let regenTime = dt;
    if (regenDelayRemaining > 0) {
      const used = Math.min(regenDelayRemaining, dt);
      regenDelayRemaining -= used;
      regenTime -= used;
      if (regenDelayRemaining < 1e-9) regenDelayRemaining = 0;
    }
    if (regenTime > 0 && regenDelayRemaining === 0) {
      const low = current < state.max * STAMINA_CONFIG.lowThreshold;
      const mult = (low ? STAMINA_CONFIG.lowRegenMultiplier : 1) * (input.regenMultiplier ?? 1);
      current += STAMINA_CONFIG.regenPerSec * Math.max(0, mult) * regenTime;
    }
  }
  current = Math.max(0, Math.min(state.max, current));
  return { current, max: state.max, regenDelayRemaining };
}
