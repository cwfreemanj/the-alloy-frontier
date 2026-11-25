/**
 * The world observer: what players are doing, area by area, as tallies that fade over time
 * (half-life ADAPT.halfLifeSec). It is the server's view of the world for the adaptive systems:
 * for now it turns "pressure" from over-levelled players into area enemy levels; later events
 * (raids, protection fees) can read the same tallies.
 *
 * Only signed-in characters count: the server knows their rank. Time is real time, so tallies
 * keep fading while the world is empty.
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

export type AreaChange = { area: AreaId; name: string; from: number; to: number; level: number };

const blank = (): AreaTally => ({ players: 0, topRank: 0, playerSeconds: 0, pressure: 0, kills: 0, deaths: 0, gathers: 0, searches: 0, bonus: 0 });

export class WorldObserver {
  readonly areas: Record<AreaId, AreaTally> = Object.fromEntries(ZONES.map((z) => [z.id, blank()])) as Record<AreaId, AreaTally>;
  private last: number | null = null;

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
      }
    }
    return changes;
  }

  /** A kill in an area, by players of these ranks. */
  kill(pos: Vec2, ranks: number[]): void {
    const z = zoneAt(pos);
    const a = this.areas[z.id];
    a.kills++;
    for (const r of ranks) a.pressure += ADAPT.killWeight * overlevel(r, z.level);
  }

  death(pos: Vec2): void {
    this.areas[zoneAt(pos).id].deaths++;
  }

  activity(pos: Vec2, kind: 'gather' | 'search'): void {
    const a = this.areas[zoneAt(pos).id];
    if (kind === 'gather') a.gathers++;
    else a.searches++;
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
