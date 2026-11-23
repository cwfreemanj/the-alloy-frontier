/**
 * Browser save slot (guest play) on top of the shared save format in @alloy/save.
 * A backup of the previous good save is kept.
 */
import { deserialize, serialize, type LoadResult, type SessionData } from '@alloy/save';

export { SAVE_FORMAT, deserialize, serialize, type LoadResult } from '@alloy/save';
export const SAVE_KEY = 'alloy-frontier.save.v1';
export const BACKUP_KEY = 'alloy-frontier.save.v1.bak';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
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
