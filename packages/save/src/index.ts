/**
 * Character save format shared by the browser and the server (GDD 6.11): a versioned,
 * checksummed envelope around the player's session. The server runs the same
 * validation on every upload that the game runs on load.
 */
import { validateInventory, type InventoryState } from '@alloy/crafting';
import { QUESTS, type ProgressionState, type QuestState } from '@alloy/game-rules';
import { hashHex, stableStringify } from '@alloy/item-gen';

export interface NodeState {
  charges: number;
  respawnAt: number;
  gathers: number;
}

export interface SessionData {
  version: 1;
  /** The character's name (shown to other players). Older saves have none. */
  name?: string;
  createdAt: number;
  playTime: number;
  /** potionReadyAt: play time (s) when the next potion may be used (optional in older saves). */
  player: { x: number; z: number; yaw: number; health: number; potionReadyAt?: number };
  inventory: InventoryState;
  progression: ProgressionState;
  quest: QuestState;
  world: {
    wardenDefeated: boolean;
    nodes: Record<string, NodeState>;
    introSeen: boolean;
    /** Searched containers: play time when each refills, and times searched (optional in older saves). */
    containers?: Record<string, { readyAt: number; n: number }>;
  };
  stats: { kills: Record<string, number>; crafted: number; deaths: number; startedAt: number; completedAt: number | null };
  /** Snapshot taken when the quest ends (for the summary screen). */
  summary: { itemId: string | null; masteryAtStart: number; weaponLevelAtStart: number } | null;
}

export const SAVE_FORMAT = 1;

interface SaveEnvelope {
  format: number;
  savedAt: number;
  checksum: string;
  data: SessionData;
}

export type LoadResult = { ok: true; data: SessionData; source: 'primary' | 'backup' } | { ok: false; reason: string };

export function serialize(data: SessionData, now: number): string {
  const env: SaveEnvelope = { format: SAVE_FORMAT, savedAt: now, checksum: hashHex(stableStringify(data)), data };
  return JSON.stringify(env);
}

/** Migration hook: upgrade older formats here as the schema evolves. */
function migrate(env: SaveEnvelope): SaveEnvelope {
  return env;
}

export function deserialize(raw: string): LoadResult {
  let env: SaveEnvelope;
  try {
    env = JSON.parse(raw) as SaveEnvelope;
  } catch {
    return { ok: false, reason: 'Save is not valid JSON' };
  }
  if (!env || typeof env !== 'object' || typeof env.format !== 'number') return { ok: false, reason: 'Save envelope missing' };
  if (env.format > SAVE_FORMAT) return { ok: false, reason: `Save format ${env.format} is newer than this build` };
  env = migrate(env);
  const d = env.data;
  if (!d || d.version !== 1) return { ok: false, reason: 'Unsupported session version' };
  if (hashHex(stableStringify(d)) !== env.checksum) return { ok: false, reason: 'Save checksum mismatch (corrupted or edited)' };
  const inv = validateInventory(d.inventory);
  if (!inv.ok) return { ok: false, reason: `Inventory invalid: ${inv.message}` };
  const q = QUESTS[d.quest?.questId];
  if (!q || !Number.isInteger(d.quest.stepIndex) || d.quest.stepIndex < 0 || d.quest.stepIndex > q.steps.length) {
    return { ok: false, reason: 'Quest state invalid' };
  }
  const p = d.progression;
  if (!p || !Number.isFinite(p.professions?.blacksmithing?.mastery) || !Number.isFinite(p.weaponMastery?.longsword?.level)) {
    return { ok: false, reason: 'Progression invalid' };
  }
  if (!Number.isFinite(d.player?.x) || !Number.isFinite(d.player?.z)) return { ok: false, reason: 'Player position invalid' };
  if (d.name !== undefined && (typeof d.name !== 'string' || d.name.length > 32)) return { ok: false, reason: 'Character name invalid' };
  return { ok: true, data: d, source: 'primary' };
}


/** Largest save the server accepts (bytes). Current saves are a few KB. */
export const MAX_SAVE_BYTES = 512 * 1024;

/** When the envelope was written (0 if unreadable). */
export function savedAtOf(raw: string): number {
  try {
    const t = (JSON.parse(raw) as { savedAt?: unknown }).savedAt;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}
