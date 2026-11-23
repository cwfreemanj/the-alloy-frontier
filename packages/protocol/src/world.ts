/**
 * Shared-world protocol (GDD 6.10 follow-up): one persistent world on the server that
 * every player joins automatically. Small JSON messages over one WebSocket.
 *
 * Authority today: the server owns enemies (AI, health, attacks, deaths, respawns) and
 * kill credit. Clients own their own movement and their own progression/inventory, and
 * report hits with damage computed from their equipped weapon; the server checks range,
 * rate and caps. Moving inventory and progression to the server is the next authority step.
 */
export const WORLD_PROTOCOL = 1;

/** Compact animation state of a player avatar. */
export interface AvatarState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Horizontal speed (m/s) for the walk cycle. */
  spd: number;
  /** Phase: idle | windup | active | recovery | dodge | stagger | dead | gather | block | air. */
  ph: string;
  /** Attack id while attacking. */
  atk: string | null;
  /** 0..1 progress within the phase. */
  pr: number;
  hp: number;
  mhp: number;
  /** Equipped weapon look. */
  wpn: { bp: string; spec: string; imb: boolean; rar: string } | null;
  /** Chosen character model (e.g. 'maria', 'exo'). Optional: older clients omit it. */
  mdl?: string;
}

export interface EnemyNetState {
  id: string;
  x: number;
  z: number;
  yaw: number;
  s: string;
  a: string | null;
  st: number;
  hp: number;
  p2: boolean;
  cx?: number;
  cz?: number;
}

export interface WorldPlayerInfo {
  id: string;
  name: string;
  state: AvatarState | null;
}

export interface HitVerdict {
  enemyId: string;
  damage: number;
  guarded: boolean;
  staggered: boolean;
  guardBroken: boolean;
  killed: boolean;
  ignored: boolean;
  crit: boolean;
}

export type WorldClientMsg =
  | { t: 'hello'; name: string; protocol: number }
  | { t: 'state'; s: AvatarState }
  | { t: 'hit'; enemyId: string; attackId: string; damage: number; stagger: number; guardBreak: boolean; crit: boolean };

export type WorldServerMsg =
  | { t: 'welcome'; id: string; players: WorldPlayerInfo[]; enemies: EnemyNetState[]; protocol: number }
  | { t: 'joined'; player: WorldPlayerInfo }
  | { t: 'left'; id: string; name: string }
  | { t: 'players'; list: Array<{ id: string; s: AvatarState }> }
  | { t: 'enemies'; list: EnemyNetState[] }
  | ({ t: 'hitResult' } & HitVerdict)
  | { t: 'playerHit'; enemyId: string; damage: number; heavy: boolean }
  | { t: 'kill'; enemyId: string; type: string; contributors: string[] }
  | { t: 'error'; error: string };

/** Hard caps the server enforces. */
export const WORLD_LIMITS = {
  maxMessageBytes: 16_000,
  maxMessagesPerSecond: 60,
  maxHitDamage: 200,
  maxHitsPerSecond: 8,
  worldBound: 2000,
  maxPlayers: 64,
  maxNameLength: 20,
} as const;

const num = (v: unknown, bound = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= bound;
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';

function avatar(v: unknown): v is AvatarState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const W = WORLD_LIMITS.worldBound;
  const w = s.wpn as Record<string, unknown> | null | undefined;
  return (
    num(s.x, W) &&
    num(s.y, W) &&
    num(s.z, W) &&
    num(s.yaw) &&
    num(s.spd, 100) &&
    str(s.ph, 16) &&
    (s.atk === null || str(s.atk, 32)) &&
    num(s.pr, 10) &&
    num(s.hp, 1e4) &&
    num(s.mhp, 1e4) &&
    (w === null || (!!w && str(w.bp, 64) && str(w.spec, 32) && bool(w.imb) && str(w.rar, 16))) &&
    (s.mdl === undefined || (str(s.mdl, 16) && /^[a-z]+$/.test(s.mdl)))
  );
}

/** Player-chosen display names: letters, digits, spaces, - _ ' only. */
export function cleanName(raw: string): string {
  const n = raw
    .replace(/[^\p{L}\p{N} _'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WORLD_LIMITS.maxNameLength);
  return n || 'Smith';
}

/** Validate an untrusted client message. Returns null for anything malformed. */
export function parseWorldClientMsg(raw: unknown): WorldClientMsg | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > WORLD_LIMITS.maxMessageBytes) return null;
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      return str(o.name, 64) && o.protocol === WORLD_PROTOCOL ? { t: 'hello', name: cleanName(o.name), protocol: WORLD_PROTOCOL } : null;
    case 'state':
      return avatar(o.s) ? { t: 'state', s: o.s } : null;
    case 'hit':
      return str(o.enemyId) && str(o.attackId, 32) && num(o.damage) && o.damage >= 0 && o.damage <= WORLD_LIMITS.maxHitDamage && num(o.stagger, 1000) && bool(o.guardBreak) && bool(o.crit)
        ? { t: 'hit', enemyId: o.enemyId, attackId: o.attackId, damage: o.damage, stagger: o.stagger, guardBreak: o.guardBreak, crit: o.crit }
        : null;
    default:
      return null;
  }
}
