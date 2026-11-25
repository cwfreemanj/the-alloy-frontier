/**
 * The world observer: what players are doing, area by area, as tallies that fade over time
 * (half-life ADAPT.halfLifeSec). It is the server's view of the world for the adaptive systems:
 * for now it turns "pressure" from over-levelled players into area enemy levels; later events
 * (raids, protection fees) can read the same tallies.
 *
 * Only signed-in characters count: the server knows their rank. Time is real time, so tallies
 * keep fading while the world is empty, and while the server is asleep: `save()` and `restore()`
 * carry them across restarts (see worldState.ts), fading them by the time the server was down.
 */
import { ADAPT, decayFactor, nextBonus, overlevel, type Vec2 } from '@alloy/game-rules';
import { ZONES, zoneAt, type Zone } from '@alloy/world';

export type AreaId = Zone['id'];

export interface AreaTally {
  /** Players in the area right now (signed-in, alive or not). */
  players: number;
  /** Highest rank among them right now. */
  topRank: number;
  /** Decaying tallies. */
  playerSeconds: number;
  pressure: number;
  kills: number;
  deaths: number;
  gathers: number;
  searches: number;
  /** Levels the area's enemies are currently raised by. */
  bonus: number;
}

export interface ObservedPlayer {
  pos: Vec2;
  rank: number;
}

/** What `save()` writes and `restore()` reads: the decaying tallies and levels, per area. */
export interface SavedWorldState {
  v: 1;
  /** When it was saved (ms since 1970). */
  savedAt: number;
  areas: Partial<Record<AreaId, SavedArea>>;
}
export type SavedArea = Pick<AreaTally, 'playerSeconds' | 'pressure' | 'kills' | 'deaths' | 'gathers' | 'searches' | 'bonus'>;
const SAVED_FIELDS = ['playerSeconds', 'pressure', 'kills', 'deaths', 'gathers', 'searches'] as const;
/** A tally read back from storage: a finite number, at least 0, within reason. */
const tally = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 1e9) : 0);

export type AreaChange = { area: AreaId; name: string; from: number; to: number; level: number };

const blank = (): AreaTally => ({ players: 0, topRank: 0, playerSeconds: 0, pressure: 0, kills: 0, deaths: 0, gathers: 0, searches: 0, bonus: 0 });

export class WorldObserver {
  readonly areas: Record<AreaId, AreaTally> = Object.fromEntries(ZONES.map((z) => [z.id, blank()])) as Record<AreaId, AreaTally>;
  private last: number | null = null;
  /** Something worth saving happened since the last save (players present, or an event). */
  dirty = false;

  constructor(private now: () => number = () => Date.now()) {}

  /** The area's enemy level: its own plus what pressure has raised it by. */
  levelOf(area: AreaId): number {
    const z = ZONES.find((x) => x.id === area)!;
    return z.level + this.areas[area].bonus;
  }

  areaAt(pos: Vec2): AreaId {
    return zoneAt(pos).id;
  }

  /**
   * Advance the tallies to now with the players currently in the world, and return the areas
   * whose enemy level changed.
   */
  observe(players: ObservedPlayer[]): AreaChange[] {
    const t = this.now();
    const dt = this.last === null ? 0 : Math.max(0, (t - this.last) / 1000);
    this.last = t;
    const k = decayFactor(dt);
    for (const a of Object.values(this.areas)) {
      a.playerSeconds *= k;
      a.pressure *= k;
      a.kills *= k;
      a.deaths *= k;
      a.gathers *= k;
      a.searches *= k;
      a.players = 0;
      a.topRank = 0;
    }
    if (players.length) this.dirty = true;
    for (const p of players) {
      const z = zoneAt(p.pos);
      const a = this.areas[z.id];
      a.players++;
      a.topRank = Math.max(a.topRank, p.rank);
      a.playerSeconds += dt;
      a.pressure += overlevel(p.rank, z.level) * dt;
    }
    const changes: AreaChange[] = [];
    for (const z of ZONES) {
      const a = this.areas[z.id];
      const b = nextBonus(a.pressure, a.bonus);
      if (b !== a.bonus) {
        changes.push({ area: z.id, name: z.name, from: z.level + a.bonus, to: z.level + b, level: z.level + b });
        a.bonus = b;
        this.dirty = true;
      }
    }
    return changes;
  }

  /** A kill in an area, by players of these ranks. */
  kill(pos: Vec2, ranks: number[]): void {
    const z = zoneAt(pos);
    const a = this.areas[z.id];
    a.kills++;
    this.dirty = true;
    for (const r of ranks) a.pressure += ADAPT.killWeight * overlevel(r, z.level);
  }

  death(pos: Vec2): void {
    this.areas[zoneAt(pos).id].deaths++;
    this.dirty = true;
  }

  activity(pos: Vec2, kind: 'gather' | 'search'): void {
    const a = this.areas[zoneAt(pos).id];
    if (kind === 'gather') a.gathers++;
    else a.searches++;
    this.dirty = true;
  }

  /** The tallies and levels to keep across a restart. */
  save(): SavedWorldState {
    const areas: SavedWorldState['areas'] = {};
    for (const z of ZONES) {
      const a = this.areas[z.id];
      areas[z.id] = { playerSeconds: a.playerSeconds, pressure: a.pressure, kills: a.kills, deaths: a.deaths, gathers: a.gathers, searches: a.searches, bonus: a.bonus };
    }
    return { v: 1, savedAt: this.now(), areas };
  }

  /**
   * Take back what `save()` wrote, faded by the time since it was saved (the world kept
   * settling while the server was down). Bad or unknown data is ignored: the area starts fresh.
   * Returns false when nothing usable was found.
   */
  restore(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as Partial<SavedWorldState>;
    if (s.v !== 1 || typeof s.savedAt !== 'number' || !Number.isFinite(s.savedAt) || !s.areas || typeof s.areas !== 'object') return false;
    const t = this.now();
    const k = decayFactor(Math.max(0, (t - s.savedAt) / 1000));
    for (const z of ZONES) {
      const saved = (s.areas as Record<string, unknown>)[z.id];
      const a = (this.areas[z.id] = blank());
      if (!saved || typeof saved !== 'object') continue;
      const v = saved as Record<string, unknown>;
      for (const f of SAVED_FIELDS) a[f] = tally(v[f]) * k;
      const bonus = Math.min(ADAPT.maxBonus, Math.floor(tally(v.bonus)));
      // A long sleep can bring the level down; hysteresis as usual (nextBonus).
      a.bonus = nextBonus(a.pressure, bonus);
    }
    this.last = t;
    this.dirty = false;
    return true;
  }

  /** For /world-info: rounded tallies per area (no player names). */
  snapshot(): Record<AreaId, { level: number; players: number; topRank: number; pressure: number; activeMinutes: number; kills: number; deaths: number; gathers: number; searches: number }> {
    const r = (v: number) => Math.round(v * 10) / 10;
    return Object.fromEntries(
      ZONES.map((z) => {
        const a = this.areas[z.id];
        return [z.id, { level: this.levelOf(z.id), players: a.players, topRank: a.topRank, pressure: Math.round(a.pressure), activeMinutes: r(a.playerSeconds / 60), kills: r(a.kills), deaths: r(a.deaths), gathers: r(a.gathers), searches: r(a.searches) }];
      }),
    ) as ReturnType<WorldObserver['snapshot']>;
  }
}

/** The announcement for an area's level change. */
export function noticeFor(c: AreaChange): string {
  return c.to > c.from
    ? `Word of a seasoned fighter spreads through the ${c.name}. Its foes grow bolder (level ${c.level}).`
    : `The ${c.name} settles. Its foes are less bold (level ${c.level}).`;
}
