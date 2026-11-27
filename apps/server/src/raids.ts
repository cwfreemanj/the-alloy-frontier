/**
 * Raids on Emberhold (AF-011): the server runs them. Design: docs/raids.md. Rules and numbers:
 * `@alloy/game-rules` raid.ts.
 *
 * Readiness builds while signed-in players are online. When a raid is due and someone can defend
 * the village, the lookout sounds the horn; a minute later the first wave walks in from the trail,
 * then the second with the Raider Captain. Defeat the Captain within the time limit and the village
 * wins; otherwise the raiders withdraw and the Captain camps on the Ironwood Trail until someone
 * defeats him there.
 *
 * Raiders are ordinary server enemies (the world room damages them, rewards their kills and
 * streams them), added when they arrive and removed a few seconds after they die or the raid ends.
 * The readiness, the time of the last raid and the Captain's camp are saved with the world state;
 * a raid in progress isn't (a restart cancels it).
 */
import { RAID, raidReward, raidSize, raiderLevel, shouldStartRaid, type RaidSize, type Vec2 } from '@alloy/game-rules';
import type { EnemySpawnInfo, RaidInfo, WorldServerMsg } from '@alloy/protocol';
import { EnemySim, RAID_POINTS, terrainHeight, type ColliderWorld, type EnemySpawn } from '@alloy/world';

export type RaidPhase = 'idle' | 'warning' | 'fighting';

/** A player in the world, as the raid sees them. */
export interface RaidPlayer {
  id: string;
  /** Adventurer rank of a signed-in character; null for guests. */
  rank: number | null;
  inVillage: boolean;
  alive: boolean;
}

/** What the raid needs from the world room. */
export interface RaidHost {
  now(): number;
  players(): RaidPlayer[];
  /** Put a raider into the world and tell everyone. */
  addEnemy(e: EnemySim): void;
  /** Take a raider out of the world and tell everyone. */
  removeEnemy(id: string): void;
  broadcast(msg: WorldServerMsg): void;
  /** The win bonus for one player who fought (signed-in players only; guests are skipped). */
  rewardWin(playerId: string, coins: number, xp: number): void;
}

/** What is saved with the world state. */
export interface SavedRaidState {
  readiness: number;
  lastRaidAt: number | null;
  /** The Captain's camp after a lost raid (null: no camp). */
  camp: { level: number } | null;
  /** Raids so far (names raiders uniquely). */
  count: number;
}

/** Dead raiders stay this long (their death plays) before they are removed. */
const REMOVE_DEAD_AFTER = 6;
/** How often (seconds) a due raid is checked for. */
const CHECK_EVERY = 5;
const MINUTE = 60_000;

export const RAID_NOTICES = {
  horn: "The lookout's horn! Raiders on the Ironwood Trail, coming for Emberhold.",
  arrive: 'The raiders are in the village!',
  captain: 'The Raider Captain joins the attack!',
  won: 'Emberhold holds! The raiders scatter into the Ironwood.',
  lost: 'Emberhold has fallen. The Raider Captain will be back for tribute.',
  campCleared: 'The Raider Captain is dead. His camp on the Ironwood Trail is broken.',
};

export class RaidDirector {
  /** Raids start on their own only when enabled (server setting); the test command works regardless. */
  enabled = false;
  /** Something worth saving changed. */
  dirty = false;
  readiness = 0;
  lastRaidAt: number | null = null;
  camp: { level: number } | null = null;
  count = 0;
  phase: RaidPhase = 'idle';

  private warningEndsAt = 0;
  private arrivedAt = 0;
  private lastDefendedAt = 0;
  private secondWaveIn = false;
  private level = 1;
  private size: RaidSize | null = null;
  private checkTimer = 0;
  /** Raiders in the world (alive, or dead and waiting to be removed). */
  private raiders = new Map<string, EnemySim>();
  private firstWave = new Set<string>();
  private captainId: string | null = null;
  private campEnemy: EnemySim | null = null;
  /** Players who hit a raider in this raid. */
  private fought = new Set<string>();

  constructor(
    private host: RaidHost,
    private colliders: ColliderWorld,
  ) {}

  /** Whether an enemy belongs to the raid (raiders, the Captain, his camp). */
  owns(id: string): boolean {
    return this.raiders.has(id) || this.campEnemy?.id === id;
  }

  /** Raid enemies a joining player needs to create. */
  spawnInfos(): EnemySpawnInfo[] {
    const all = [...this.raiders.values()];
    if (this.campEnemy) all.push(this.campEnemy);
    return all.map(spawnInfo);
  }

  /** The raid's state for the HUD (null when there is none). */
  info(): RaidInfo | null {
    const t = this.host.now();
    if (this.phase === 'warning') return { phase: 'warning', left: Math.max(0, Math.ceil((this.warningEndsAt - t) / 1000)), raiders: 0, captain: false, wave: 1 };
    if (this.phase === 'fighting') {
      const left = Math.max(0, Math.ceil((this.arrivedAt + RAID.timeLimitSeconds * 1000 - t) / 1000));
      const alive = [...this.raiders.values()].filter((e) => e.brain.alive);
      return { phase: 'fighting', left, raiders: alive.length, captain: alive.some((e) => e.id === this.captainId), wave: this.secondWaveIn ? 2 : 1 };
    }
    return null;
  }

  /** A forge, brew, purchase or sale in the village: a busy village draws raiders sooner. */
  villageActivity(): void {
    if (this.phase !== 'idle') return;
    this.readiness += RAID.perVillageActivity;
    this.dirty = true;
  }

  /** A player hit a raider (counts them for the win bonus). */
  hitBy(enemyId: string, playerId: string): void {
    if (this.raiders.has(enemyId)) this.fought.add(playerId);
  }

  /** An enemy died. Returns true if it was the Raider Captain (in a raid or at his camp). */
  killed(enemyId: string): boolean {
    if (this.campEnemy?.id === enemyId) {
      this.camp = null;
      this.dirty = true;
      this.host.broadcast({ t: 'notice', text: RAID_NOTICES.campCleared });
      return true;
    }
    if (!this.raiders.has(enemyId)) return false;
    this.sendInfo();
    return enemyId === this.captainId;
  }

  /** Start a raid now (local test command), with a shorter warning if asked. */
  debugStart(warnSeconds: number): boolean {
    if (this.phase !== 'idle') return false;
    this.start(Math.max(1, Math.min(RAID.warningSeconds, warnSeconds)));
    return true;
  }

  /** Advance the raid. Called by the world room every tick while anyone is online. */
  step(dt: number): void {
    const t = this.host.now();
    this.removeDead(dt);
    if (this.phase === 'idle') {
      if (!this.enabled) return;
      const players = this.host.players();
      const signedIn = players.filter((p) => p.rank !== null).length;
      if (signedIn) {
        this.readiness += (dt / 60) * RAID.perPlayerMinute * signedIn;
        this.dirty = true;
      }
      this.checkTimer += dt;
      if (this.checkTimer < CHECK_EVERY) return;
      this.checkTimer = 0;
      const villageRanks = players.filter((p) => p.inVillage && p.alive && p.rank !== null).map((p) => p.rank!);
      const minutesSinceLastRaid = this.lastRaidAt === null ? null : (t - this.lastRaidAt) / MINUTE;
      if (shouldStartRaid({ readiness: this.readiness, minutesSinceLastRaid, villageRanks })) this.start(RAID.warningSeconds);
      return;
    }
    if (this.phase === 'warning') {
      if (t >= this.warningEndsAt) this.arrive();
      return;
    }
    // Fighting.
    if (this.host.players().some((p) => p.inVillage && p.alive)) this.lastDefendedAt = t;
    const alive = (id: string) => this.raiders.get(id)?.brain.alive ?? false;
    if (!this.secondWaveIn && ([...this.firstWave].every((id) => !alive(id)) || t - this.arrivedAt >= RAID.secondWaveAfterSeconds * 1000)) this.secondWave();
    const captainDown = this.secondWaveIn && !alive(this.captainId!);
    if (this.secondWaveIn && ![...this.raiders.values()].some((e) => e.brain.alive)) return this.end('won');
    if (t - this.arrivedAt >= RAID.timeLimitSeconds * 1000) return this.end(captainDown ? 'won' : 'lost');
    if (t - this.lastDefendedAt >= RAID.abandonedSeconds * 1000) return this.end('lost');
  }

  private start(warnSeconds: number): void {
    this.phase = 'warning';
    this.count++;
    this.warningEndsAt = this.host.now() + warnSeconds * 1000;
    this.dirty = true;
    this.host.broadcast({ t: 'notice', text: RAID_NOTICES.horn });
    this.sendInfo();
  }

  /** The first wave walks in. Size and level come from who is in the village now. */
  private arrive(): void {
    const t = this.host.now();
    const defenders = this.host.players().filter((p) => p.inVillage && p.alive);
    this.size = raidSize(defenders.length);
    this.level = raiderLevel(defenders.filter((p) => p.rank !== null).map((p) => p.rank!));
    this.phase = 'fighting';
    this.arrivedAt = t;
    this.lastDefendedAt = t;
    this.secondWaveIn = false;
    this.fought.clear();
    this.firstWave.clear();
    this.captainId = null;
    for (let i = 0; i < this.size.firstWave; i++) this.firstWave.add(this.spawnRaider('raider', i).id);
    this.host.broadcast({ t: 'notice', text: RAID_NOTICES.arrive });
    this.sendInfo();
  }

  private secondWave(): void {
    this.secondWaveIn = true;
    const size = this.size!;
    for (let i = 0; i < size.secondWave; i++) this.spawnRaider('raider', size.firstWave + i);
    this.captainId = this.spawnRaider('raider_captain', size.total).id;
    this.host.broadcast({ t: 'notice', text: RAID_NOTICES.captain });
    this.sendInfo();
  }

  private spawnRaider(type: 'raider' | 'raider_captain', i: number): EnemySim {
    const id = `raid${this.count}-${type === 'raider_captain' ? 'captain' : i + 1}`;
    // Each raider starts its patrol at a different point, so they spread through the village.
    const route = RAID_POINTS.patrol;
    const patrol = route.map((_, k) => route[(k + i) % route.length]);
    const spawn: EnemySpawn = { id, type, pos: { ...RAID_POINTS.home }, yaw: Math.PI, patrol };
    const e = new EnemySim(spawn, this.colliders);
    e.setLevel(this.level);
    e.reset();
    // Appear at the trail's mouth, spread out, and walk in.
    const at: Vec2 = { x: RAID_POINTS.entry.x + ((i % 3) - 1) * 1.6, z: RAID_POINTS.entry.z + Math.floor(i / 3) * 1.6 };
    e.x = at.x;
    e.z = at.z;
    e.y = terrainHeight(at.x, at.z);
    this.raiders.set(id, e);
    this.host.addEnemy(e);
    return e;
  }

  private end(outcome: 'won' | 'lost'): void {
    const t = this.host.now();
    // Raiders still standing withdraw now; the fallen stay a few seconds (removeDead).
    for (const [id, e] of [...this.raiders]) if (e.brain.alive) this.remove(id);
    if (outcome === 'won') {
      const r = raidReward(this.level);
      for (const id of this.fought) this.host.rewardWin(id, r.coins, r.xp);
      this.host.broadcast({ t: 'notice', text: RAID_NOTICES.won });
    } else {
      this.camp = { level: this.level };
      this.spawnCamp();
      this.host.broadcast({ t: 'notice', text: RAID_NOTICES.lost });
    }
    this.host.broadcast({ t: 'raid', raid: { phase: outcome, left: 0, raiders: 0, captain: outcome === 'lost', wave: 2 } });
    this.phase = 'idle';
    this.readiness = 0;
    this.lastRaidAt = t;
    this.fought.clear();
    this.firstWave.clear();
    this.captainId = null;
    this.dirty = true;
  }

  /** The Captain's camp on the Ironwood Trail (after a lost raid, and on start-up if saved). */
  private spawnCamp(): void {
    if (!this.camp || this.campEnemy) return;
    const spawn: EnemySpawn = { id: `raid-camp-${this.count}`, type: 'raider_captain', pos: { ...RAID_POINTS.camp }, yaw: Math.PI };
    const e = new EnemySim(spawn, this.colliders);
    e.setLevel(this.camp.level);
    e.reset();
    this.campEnemy = e;
    this.host.addEnemy(e);
  }

  private removeDead(dt: number): void {
    for (const [id, e] of this.raiders) if (!e.brain.alive && e.deadFor + dt >= REMOVE_DEAD_AFTER) this.remove(id);
    const c = this.campEnemy;
    if (c && !c.brain.alive && c.deadFor + dt >= REMOVE_DEAD_AFTER) {
      this.campEnemy = null;
      this.host.removeEnemy(c.id);
    }
  }

  private remove(id: string): void {
    if (!this.raiders.delete(id)) return;
    this.host.removeEnemy(id);
  }

  private sendInfo(): void {
    const raid = this.info();
    if (raid) this.host.broadcast({ t: 'raid', raid });
  }

  save(): SavedRaidState {
    return { readiness: Math.round(this.readiness * 100) / 100, lastRaidAt: this.lastRaidAt, camp: this.camp, count: this.count };
  }

  /** Take back what save() wrote (missing or bad data: start fresh). Spawns a saved camp. */
  restore(raw: unknown): void {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<SavedRaidState>;
    const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
    this.readiness = num(s.readiness, 0, RAID.readinessToRaid * 10) ?? 0;
    this.lastRaidAt = num(s.lastRaidAt, 0, 1e15);
    this.count = Math.floor(num(s.count, 0, 1e9) ?? 0);
    const level = s.camp && typeof s.camp === 'object' ? num((s.camp as { level?: unknown }).level, 1, RAID.maxLevel) : null;
    this.camp = level === null ? null : { level: Math.floor(level) };
    this.spawnCamp();
    this.dirty = false;
  }
}

export function spawnInfo(e: EnemySim): EnemySpawnInfo {
  return { id: e.id, type: e.spawn.type, x: Math.round(e.x * 100) / 100, z: Math.round(e.z * 100) / 100, yaw: Math.round(e.yaw * 1000) / 1000 };
}
