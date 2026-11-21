/**
 * Versioned commands, events and snapshots shared by the browser client and the
 * authoritative-server proof (GDD 6.5, 6.8, 6.10). Pure data + validation only.
 */
import type { ForgeRequest, InventoryState } from '@alloy/crafting';
import type { ItemInstance } from '@alloy/item-gen';

export const PROTOCOL_VERSION = 1;

export interface MoveCommand {
  t: 'move';
  seq: number;
  x: number;
  z: number;
  yaw: number;
}
export interface AttackCommand {
  t: 'attack';
  seq: number;
  targetId: string;
  attackId: string;
}
export interface ForgeCommand {
  t: 'forge';
  seq: number;
  request: Omit<ForgeRequest, 'maker' | 'createdAt'>;
}
export interface EquipCommand {
  t: 'equip';
  seq: number;
  itemId: string;
}
export interface JoinCommand {
  t: 'join';
  name: string;
  /** Reconnect token returned by a previous welcome. */
  token?: string;
  protocol: number;
}
/** Deliberately-malicious test command: a client attempting to push its own item. */
export interface InjectItemCommand {
  t: 'inject_item';
  seq: number;
  item: ItemInstance;
}

export type ClientCommand = JoinCommand | MoveCommand | AttackCommand | ForgeCommand | EquipCommand | InjectItemCommand;

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  connected: boolean;
  equippedItemId: string | null;
  equippedRating: number | null;
}

export interface EnemySnapshot {
  id: string;
  health: number;
  maxHealth: number;
  alive: boolean;
}

export interface WorldSnapshot {
  t: 'snapshot';
  tick: number;
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
}

export type ServerMessage =
  | { t: 'welcome'; playerId: string; token: string; inventory: InventoryState; protocol: number }
  | WorldSnapshot
  | { t: 'ack'; seq: number; ok: boolean; error?: string; item?: ItemInstance; inventory?: InventoryState }
  | { t: 'correction'; seq: number; x: number; z: number }
  | { t: 'error'; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Validate an untrusted client message. Returns null for anything malformed. */
export function parseClientCommand(raw: unknown): ClientCommand | null {
  let msg: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 64_000) return null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  switch (m.t) {
    case 'join':
      return isStr(m.name, 32) && m.protocol === PROTOCOL_VERSION && (m.token === undefined || isStr(m.token, 128))
        ? (m as unknown as JoinCommand)
        : null;
    case 'move':
      return isNum(m.seq) && isNum(m.x) && isNum(m.z) && isNum(m.yaw) ? (m as unknown as MoveCommand) : null;
    case 'attack':
      return isNum(m.seq) && isStr(m.targetId, 64) && isStr(m.attackId, 32) ? (m as unknown as AttackCommand) : null;
    case 'equip':
      return isNum(m.seq) && isStr(m.itemId, 128) ? (m as unknown as EquipCommand) : null;
    case 'forge': {
      const r = m.request as Record<string, unknown> | undefined;
      if (!isNum(m.seq) || !r || !isStr(r.txId, 128) || !isStr(r.blueprintId, 64) || !isNum(r.bufferQuantity)) return null;
      return m as unknown as ForgeCommand;
    }
    case 'inject_item':
      return isNum(m.seq) && m.item && typeof m.item === 'object' ? (m as unknown as InjectItemCommand) : null;
    default:
      return null;
  }
}

/**
 * The authority boundary the browser slice talks to. The offline build uses a local
 * implementation; a networked build would implement the same calls over a transport.
 */
export interface AuthorityResult<T = undefined> {
  ok: boolean;
  error?: string;
  message?: string;
  value?: T;
}
export * from './world';
