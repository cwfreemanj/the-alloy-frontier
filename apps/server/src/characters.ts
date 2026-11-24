/**
 * Live characters of signed-in players, owned by the server.
 *
 * While a player is in the world, the server holds their character in memory, applies
 * every change with the shared rules (@alloy/session), and writes it to storage itself:
 * a few seconds after a change, and right away when the player leaves. The same character
 * object is shared if the account reconnects (or signs in on another device) before the
 * old connection is gone, so two copies never diverge.
 */
import { deserialize, serialize, type SessionData } from '@alloy/save';
import { Session, ensureNodes, newSessionData, type SessionEvent } from '@alloy/session';
import type { AccountService } from './accounts/service';

/** Where characters are loaded from and saved to. */
export interface CharacterStore {
  load(accountId: string): Promise<SessionData | null>;
  save(accountId: string, data: SessionData): Promise<void>;
}

export function accountCharacterStore(svc: AccountService, now: () => number = Date.now): CharacterStore {
  return {
    async load(accountId) {
      const rec = await svc.getSave(accountId);
      if (!rec) return null;
      const r = deserialize(rec.raw);
      if (!r.ok) throw new Error(`Stored character for ${accountId} is invalid: ${r.reason}`);
      return r.data;
    },
    async save(accountId, data) {
      const t = now();
      await svc.serverPutSave(accountId, serialize(data, t), t);
    },
  };
}

/** In-memory store for tests. */
export class MemoryCharacterStore implements CharacterStore {
  readonly saved = new Map<string, SessionData>();
  writes = 0;
  async load(id: string) {
    const d = this.saved.get(id);
    return d ? (JSON.parse(JSON.stringify(d)) as SessionData) : null;
  }
  async save(id: string, data: SessionData) {
    this.writes++;
    this.saved.set(id, JSON.parse(JSON.stringify(data)) as SessionData);
  }
}

export interface LiveCharacter {
  accountId: string;
  session: Session;
  /** Changed since the last write. */
  dirty: boolean;
  changedAt: number;
  lastGatherAt: number;
  /** Events waiting to go to the client with the next 'char' message. */
  pending: SessionEvent[];
  /** A 'char' message is owed to the client. */
  due: boolean;
  lastSentAt: number;
}

/** How long a changed character waits before it is written (writes are batched). */
export const SAVE_DELAY_MS = 5000;

export class CharacterHost {
  private live = new Map<string, { c: LiveCharacter; refs: number }>();
  private writing = new Map<string, Promise<void>>();
  /** Last storage error, for logs and tests. */
  lastError: string | null = null;

  constructor(
    private store: CharacterStore,
    private now: () => number = Date.now,
  ) {}

  /** Take a reference to an account's character, loading it (or creating a new one) if needed. */
  async open(accountId: string): Promise<LiveCharacter> {
    const cur = this.live.get(accountId);
    if (cur) {
      cur.refs++;
      return cur.c;
    }
    await this.writing.get(accountId); // a just-closed copy may still be saving
    const again = this.live.get(accountId);
    if (again) {
      again.refs++;
      return again.c;
    }
    const data = (await this.store.load(accountId)) ?? newSessionData(this.now());
    ensureNodes(data);
    const c: LiveCharacter = { accountId, session: new Session(data), dirty: false, changedAt: 0, lastGatherAt: 0, pending: [], due: true, lastSentAt: 0 };
    const raced = this.live.get(accountId);
    if (raced) {
      raced.refs++;
      return raced.c;
    }
    this.live.set(accountId, { c, refs: 1 });
    return c;
  }

  /** Drop a reference; the last one writes the character (if changed) and unloads it. */
  release(c: LiveCharacter): void {
    const e = this.live.get(c.accountId);
    if (!e || e.c !== c) return;
    if (--e.refs > 0) return;
    this.live.delete(c.accountId);
    if (c.dirty) void this.write(c);
  }

  changed(c: LiveCharacter): void {
    if (!c.dirty) c.changedAt = this.now();
    c.dirty = true;
  }

  /** Write characters that have been changed for a while (call about once a second). */
  flushDue(delayMs = SAVE_DELAY_MS): void {
    const t = this.now();
    for (const { c } of this.live.values()) if (c.dirty && t - c.changedAt >= delayMs) void this.write(c);
  }

  /** Write everything now (shutdown). */
  async flushAll(): Promise<void> {
    for (const { c } of this.live.values()) if (c.dirty) void this.write(c);
    await Promise.all([...this.writing.values()]);
  }

  get loadedCount(): number {
    return this.live.size;
  }

  private write(c: LiveCharacter): Promise<void> {
    const prev = this.writing.get(c.accountId) ?? Promise.resolve();
    c.dirty = false;
    const snapshot = JSON.parse(JSON.stringify(c.session.data)) as SessionData;
    const p = prev
      .then(() => this.store.save(c.accountId, snapshot))
      .catch((e: unknown) => {
        // Keep it dirty so the next flush retries.
        this.lastError = (e as Error).message;
        c.dirty = true;
        console.error(`Could not save character ${c.accountId}: ${this.lastError}`);
      })
      .finally(() => {
        if (this.writing.get(c.accountId) === p) this.writing.delete(c.accountId);
      });
    this.writing.set(c.accountId, p);
    return p;
  }
}
