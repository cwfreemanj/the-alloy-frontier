/**
 * Shared-world protocol (GDD 6.10 follow-up): one persistent world on the server that
 * every player joins automatically. Small JSON messages over one WebSocket.
 *
 * Authority: the server owns enemies (AI, health, attacks, deaths, respawns) and kill
 * credit. For signed-in players it also owns the character: clients send actions ('act')
 * and the server applies them with the shared rules in @alloy/session and sends back the
 * resulting character ('char'); hit damage is computed from the server-side weapon.
 * Guests keep their character in the browser and report hit damage (range, rate and caps
 * are checked). Clients always own their own movement (sanity-checked).
 */
import type { SessionData } from '@alloy/save';
import type { CharAction, SessionEvent } from '@alloy/session';
import type { ItemInstance } from '@alloy/item-gen';
import { ATTRIBUTE_IDS } from '@alloy/game-rules';
import { EQUIP_SLOTS } from '@alloy/crafting';

export type { CharAction } from '@alloy/session';

/** v2: character actions for signed-in players. */
export const WORLD_PROTOCOL = 2;

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
  /** Level (adaptive world; missing from older servers = the archetype's own). */
  lv?: number;
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
  /** slot: which of the account's characters (1 or 2; older clients send none = 1). */
  | { t: 'hello'; name: string; protocol: number; token?: string; slot?: 1 | 2 }
  | { t: 'state'; s: AvatarState }
  | { t: 'hit'; enemyId: string; attackId: string; damage: number; stagger: number; guardBreak: boolean; crit: boolean }
  | { t: 'act'; id: number; a: CharAction };

export type WorldServerMsg =
  | { t: 'welcome'; id: string; players: WorldPlayerInfo[]; enemies: EnemyNetState[]; protocol: number }
  | { t: 'joined'; player: WorldPlayerInfo }
  | { t: 'left'; id: string; name: string }
  | { t: 'players'; list: Array<{ id: string; s: AvatarState }> }
  | { t: 'enemies'; list: EnemyNetState[] }
  /** A world announcement (an area grows dangerous or settles). Older clients ignore it. */
  | { t: 'notice'; text: string }
  | ({ t: 'hitResult' } & HitVerdict)
  | { t: 'playerHit'; enemyId: string; damage: number; heavy: boolean }
  | { t: 'kill'; enemyId: string; type: string; contributors: string[] }
  | { t: 'actResult'; id: number; ok: boolean; error?: string; message?: string; item?: ItemInstance }
  /** The authoritative character (signed-in players), with the events its last changes produced. */
  | { t: 'char'; data: SessionData; events: SessionEvent[] }
  /** The server refused a reported position (too fast): move back to this point. */
  | { t: 'correct'; x: number; z: number }
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
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Shape check of a character action. Content (ownership, ranges, recipes) is checked by the rules. */
function charAction(v: unknown): CharAction | null {
  if (!obj(v)) return null;
  switch (v.k) {
    case 'gather':
      return str(v.node) ? { k: 'gather', node: v.node } : null;
    case 'buy':
      return str(v.stock) && int(v.qty, 1, 99) ? { k: 'buy', stock: v.stock, qty: v.qty } : null;
    case 'equip':
      if (!str(v.item, 128)) return null;
      if (v.slot === undefined) return { k: 'equip', item: v.item };
      return (EQUIP_SLOTS as readonly unknown[]).includes(v.slot) ? { k: 'equip', item: v.item, slot: v.slot as (typeof EQUIP_SLOTS)[number] } : null;
    case 'unequip':
      return (EQUIP_SLOTS as readonly unknown[]).includes(v.slot) ? { k: 'unequip', slot: v.slot as (typeof EQUIP_SLOTS)[number] } : null;
    case 'discard':
      return str(v.item, 128) ? { k: 'discard', item: v.item } : null;
    case 'talk':
      return v.npc === 'orla' ? { k: 'talk', npc: 'orla' } : null;
    case 'event':
      return v.ev === 'open_merchant' ? { k: 'event', ev: 'open_merchant' } : null;
    case 'allocate':
      return (ATTRIBUTE_IDS as readonly unknown[]).includes(v.attr) && int(v.n, 1, 100) ? { k: 'allocate', attr: v.attr as (typeof ATTRIBUTE_IDS)[number], n: v.n } : null;
    case 'respec':
      return { k: 'respec' };
    case 'brew':
      return str(v.recipe, 32) && int(v.qty, 1, 20) ? { k: 'brew', recipe: v.recipe, qty: v.qty } : null;
    case 'search':
      return str(v.id, 40) ? { k: 'search', id: v.id } : null;
    case 'consume':
      return str(v.item, 32) ? { k: 'consume', item: v.item } : null;
    case 'skillbar':
      return int(v.slot, 0, 3) && (v.skill === null || str(v.skill, 32)) ? { k: 'skillbar', slot: v.slot, skill: v.skill as string | null } : null;
    case 'forge': {
      const r = v.req;
      if (!obj(r) || !str(r.txId, 128) || !str(r.blueprintId) || (r.mode !== 'quick' && r.mode !== 'masterwork') || !int(r.bufferQuantity, 0, 1000)) return null;
      if (r.specialization !== undefined && !str(r.specialization, 16)) return null;
      if (r.temper !== undefined && !str(r.temper, 16)) return null;
      let evidence: { heat: string; strikes: Array<{ x: number; y: number; kind: 'focused' | 'spread' }> } | undefined;
      if (r.evidence !== undefined) {
        const e = r.evidence;
        if (!obj(e) || !str(e.heat, 16) || !Array.isArray(e.strikes) || e.strikes.length > 64) return null;
        const strikes: Array<{ x: number; y: number; kind: 'focused' | 'spread' }> = [];
        for (const k of e.strikes) {
          if (!obj(k) || !int(k.x, 0, 64) || !int(k.y, 0, 64) || (k.kind !== 'focused' && k.kind !== 'spread')) return null;
          strikes.push({ x: k.x, y: k.y, kind: k.kind });
        }
        evidence = { heat: e.heat, strikes };
      }
      const req = {
        txId: r.txId,
        blueprintId: r.blueprintId,
        mode: r.mode,
        bufferQuantity: r.bufferQuantity,
        ...(r.specialization !== undefined ? { specialization: r.specialization } : {}),
        ...(r.temper !== undefined ? { temper: r.temper } : {}),
        ...(evidence ? { evidence } : {}),
      };
      // Values outside the known unions are rejected by planForge with a clear error.
      return { k: 'forge', req: req as Extract<CharAction, { k: 'forge' }>['req'] };
    }
    default:
      return null;
  }
}

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
      // Any protocol number parses, so the server can tell an outdated client to reload.
      return str(o.name, 64) && int(o.protocol, 0, 1e6) && (o.token === undefined || str(o.token, 100)) && (o.slot === undefined || o.slot === 1 || o.slot === 2)
        ? { t: 'hello', name: cleanName(o.name), protocol: o.protocol, ...(o.token ? { token: o.token as string } : {}), ...(o.slot === 2 ? { slot: 2 as const } : {}) }
        : null;
    case 'state':
      return avatar(o.s) ? { t: 'state', s: o.s } : null;
    case 'hit':
      return str(o.enemyId) && str(o.attackId, 32) && num(o.damage) && o.damage >= 0 && o.damage <= WORLD_LIMITS.maxHitDamage && num(o.stagger, 1000) && bool(o.guardBreak) && bool(o.crit)
        ? { t: 'hit', enemyId: o.enemyId, attackId: o.attackId, damage: o.damage, stagger: o.stagger, guardBreak: o.guardBreak, crit: o.crit }
        : null;
    case 'act': {
      const a = charAction(o.a);
      return int(o.id, 0, 2 ** 31) && a ? { t: 'act', id: o.id, a } : null;
    }
    default:
      return null;
  }
}
