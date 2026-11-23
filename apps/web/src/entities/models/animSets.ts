/**
 * Which clip each game state uses, per character role, and how attack clips are fitted to the
 * rules' windup/active/recovery timing. Tune the PhaseShape numbers to change how much of a clip
 * plays in each phase; the rules timing itself (and so the hit window) never changes here.
 * Clip ids are the keys of apps/web/public/models/manifest.json "clips".
 */
import type { CharacterId, LocoSet, PhaseShape } from './Characters';

export interface AttackAnim {
  clip: string;
  shape?: Partial<PhaseShape>;
}

export interface RoleAnims {
  model: CharacterId;
  heightM: number;
  loco: LocoSet;
  attacks: Record<string, AttackAnim>;
  stagger?: string;
  death?: string;
  guard?: string;
  block?: string;
  dodge?: string;
  jump?: string;
  gather?: string;
  idleLoop?: string;
}

const PLAYER_LOCO: LocoSet = { idle: 'p_idle', walk: 'p_walk', run: 'p_run', back: 'p_back', left: 'p_strafe_l', right: 'p_strafe_r' };

/** Player attacks keyed by @alloy/game-rules AttackId. */
const PLAYER_ATTACKS: Record<string, AttackAnim> = {
  light1: { clip: 'p_light1', shape: { lead: 0.35, after: 0.12, tail: 0.45 } }, // forehand diagonal
  light2: { clip: 'p_light2', shape: { lead: 0.35, after: 0.12, tail: 0.4 } }, // backhand return
  light3: { clip: 'p_light3', shape: { lead: 0.6, after: 0.12, tail: 0.55 } }, // leaping overhead finisher
  heavy: { clip: 'p_heavy', shape: { lead: 0.5, after: 0.12, tail: 0.5 } }, // two-handed great-sword slash
  guardbreaker: { clip: 'p_guardbreaker', shape: { lead: 0.45, after: 0.12, tail: 0.6 } }, // shield-breaking kick
  storm_arc: { clip: 'p_storm_arc', shape: { lead: 0.8, before: 0.1, after: 0.2, tail: 0.5 } }, // 360° spin
};

export const PLAYER_HEIGHT: Record<'maria' | 'exo', number> = { maria: 1.75, exo: 1.8 };

export function playerAnims(model: 'maria' | 'exo'): RoleAnims {
  return {
    model,
    heightM: PLAYER_HEIGHT[model],
    loco: PLAYER_LOCO,
    attacks: PLAYER_ATTACKS,
    stagger: 'p_stagger',
    death: 'p_death',
    block: 'p_block',
    dodge: 'p_dodge',
    jump: 'p_jump',
    gather: 'chop',
  };
}

/** Enemies keyed by EnemySpawn.type; types not listed keep their procedural rig. */
export const ENEMY_ANIMS: Partial<Record<string, RoleAnims>> = {
  scavenger: {
    model: 'heraklios',
    heightM: 1.9,
    loco: { idle: 'sc_idle', walk: 'sc_walk', run: 'sc_run' },
    attacks: {
      slash: { clip: 'sc_slash', shape: { lead: 0.8, after: 0.12, tail: 0.9 } },
      overhead: { clip: 'chop', shape: { lead: 0.8, after: 0.12, tail: 0.9 } },
    },
    stagger: 'sc_stagger',
    death: 'sc_death',
    guard: 'sc_guard',
  },
  warden: {
    model: 'maw',
    heightM: 3.3,
    loco: { idle: 'bo_idle', walk: 'bo_walk', run: 'bo_run' },
    attacks: {
      sweep: { clip: 'bo_sweep', shape: { lead: 0.37, after: 0.15, tail: 0.8 } },
      slam: { clip: 'bo_slam', shape: { lead: 1.0, after: 0.15, tail: 1.0 } },
      lunge: { clip: 'bo_lunge', shape: { lead: 0.45, before: 0.1, after: 0.25, tail: 0.7 } },
    },
    stagger: 'bo_stagger',
    death: 'bo_death',
  },
};

/** NPCs keyed by NPC id. */
export const NPC_ANIMS: Record<string, { model: CharacterId; heightM: number; idle: string }> = {
  orla: { model: 'eve', heightM: 1.7, idle: 'npc_happy' },
  bram: { model: 'demon', heightM: 2.15, idle: 'npc_look' },
};
