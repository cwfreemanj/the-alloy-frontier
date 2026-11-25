/**
 * Saved world state (AF-013): the world observer's tallies and area levels, kept in the same
 * key-value storage as accounts (Postgres on the live server), so a restart, a deploy or the free
 * host's sleep doesn't reset how hard players have pushed each area.
 *
 * One row (`world:observer`). It is written at most once a minute, and only when players were in
 * the world or something happened since the last write; an empty world isn't written at all
 * (restore() fades the tallies by the time that passed). That keeps database use tiny on the
 * free plan. It is also written when the server stops.
 */
import type { KV } from './accounts/kv';
import type { WorldRoom } from './worldRoom';

export const WORLD_STATE_KEY = 'world:observer';
export const WORLD_SAVE_EVERY_MS = 60_000;

export class WorldStateStore {
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private kv: KV,
    private room: WorldRoom,
  ) {}

  /** Read the saved state into the observer and set enemy levels to match. Never throws. */
  async load(): Promise<boolean> {
    try {
      const raw = await this.kv.get<unknown>(WORLD_STATE_KEY);
      if (raw === null) return false;
      const ok = this.room.observer.restore(raw);
      if (ok) this.room.applyAreaLevels();
      else console.warn('Saved world state was unreadable; starting the world fresh.');
      return ok;
    } catch (e) {
      console.error(`Could not load the world state; starting fresh: ${(e as Error).message.split('\n')[0]}`);
      return false;
    }
  }

  /** Write the state if something changed since the last write (or always, with force). Never throws. */
  save(force = false): Promise<void> {
    const o = this.room.observer;
    if (!force && !o.dirty) return this.writing;
    o.dirty = false;
    const state = o.save();
    this.writing = this.writing.then(() =>
      this.kv.put(WORLD_STATE_KEY, state).catch((e: unknown) => {
        o.dirty = true; // try again next time
        console.error(`Could not save the world state: ${(e as Error).message.split('\n')[0]}`);
      }),
    );
    return this.writing;
  }
}
