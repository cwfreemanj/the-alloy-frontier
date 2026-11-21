/**
 * Versioned local save/load (GDD 6.11 stage 1, 8.4 #6). Saves are validated on load,
 * integrity-checked per item, and a backup of the previous good save is kept.
 */
import { validateInventory } from '@alloy/crafting';
import { QUESTS } from '@alloy/game-rules';
import { hashHex, stableStringify } from '@alloy/item-gen';
import type { SessionData } from './Session';

export const SAVE_KEY = 'alloy-frontier.save.v1';
export const BACKUP_KEY = 'alloy-frontier.save.v1.bak';
export const SAVE_FORMAT = 1;

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

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
  return { ok: true, data: d, source: 'primary' };
}

export class SaveSystem {
  constructor(private store: KeyValueStore) {}

  hasSave(): boolean {
    try {
      return this.store.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  save(data: SessionData, now = Date.now()): { ok: boolean; bytes: number; error?: string } {
    try {
      const raw = serialize(data, now);
      const prev = this.store.getItem(SAVE_KEY);
      if (prev && deserialize(prev).ok) this.store.setItem(BACKUP_KEY, prev);
      this.store.setItem(SAVE_KEY, raw);
      // Verify the write round-trips.
      const check = deserialize(this.store.getItem(SAVE_KEY) ?? '');
      return check.ok ? { ok: true, bytes: raw.length } : { ok: false, bytes: raw.length, error: check.reason };
    } catch (e) {
      return { ok: false, bytes: 0, error: (e as Error).message };
    }
  }

  load(): LoadResult {
    let primary: string | null = null;
    try {
      primary = this.store.getItem(SAVE_KEY);
    } catch {
      return { ok: false, reason: 'Storage unavailable' };
    }
    if (!primary) return { ok: false, reason: 'No save found' };
    const r = deserialize(primary);
    if (r.ok) return r;
    const bak = this.store.getItem(BACKUP_KEY);
    if (bak) {
      const b = deserialize(bak);
      if (b.ok) return { ...b, source: 'backup' };
    }
    return r;
  }

  clear(): void {
    try {
      this.store.removeItem(SAVE_KEY);
      this.store.removeItem(BACKUP_KEY);
    } catch {
      /* ignore */
    }
  }
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
