/**
 * The shared world (one persistent instance). Transport-agnostic so tests can drive it.
 *
 * Server-owned: every enemy (AI, movement, health, attacks, deaths, respawns), who an
 * enemy targets, whether an enemy attack reached a player, and kill credit.
 * Client-owned for now: the player's own movement (sanity-checked) and progression.
 */
import { ATTACKS, dist2, forwardPoint, inArc, inCircle, type AttackId, type Vec2 } from '@alloy/game-rules';
import { WORLD_LIMITS, WORLD_PROTOCOL, parseWorldClientMsg, type AvatarState, type EnemyNetState, type WorldPlayerInfo, type WorldServerMsg } from '@alloy/protocol';
import { ENEMY_SPAWNS, EnemySim, buildWorldColliders, type ColliderWorld } from '@alloy/world';

const PLAYER_RADIUS = 0.4;
const CREDIT_WINDOW_MS = 30_000;
/** Extra reach allowed on reported hits (latency and enemy movement between frames). */
const HIT_SLACK = 2.5;
/** The Foundry Warden has no respawn in single-player; in the shared world it returns. */
const ELITE_SHARED_RESPAWN = 180;
const RESPAWN_CLEAR_RADIUS = 35;

interface Member {
  id: string;
  name: string;
  state: AvatarState | null;
  send: (m: WorldServerMsg) => void;
  windowStart: number;
  msgs: number;
  hits: number;
}

export interface WorldStats {
  malformed: number;
  rateLimited: number;
  rejectedHits: number;
  acceptedHits: number;
  enemyHitsOnPlayers: number;
  kills: number;
}

let sharedColliders: ColliderWorld | null = null;
/** Same deterministic colliders the browser builds from the baked Emberhold scene. */
export function worldColliders(): ColliderWorld {
  sharedColliders ??= buildWorldColliders();
  return sharedColliders;
}

export class WorldRoom {
  private members = new Map<string, Member>();
  readonly enemies: EnemySim[];
  private contributors = new Map<string, Map<string, number>>();
  private lastSent = new Map<string, string>();
  private nextId = 1;
  stats: WorldStats = { malformed: 0, rateLimited: 0, rejectedHits: 0, acceptedHits: 0, enemyHitsOnPlayers: 0, kills: 0 };

  constructor(private now: () => number = () => Date.now()) {
    const colliders = worldColliders();
    this.enemies = ENEMY_SPAWNS.filter((s) => s.type !== 'dummy').map((s) => new EnemySim(s, colliders));
  }

  get playerCount(): number {
    return this.members.size;
  }
  playerNames(): string[] {
    return [...this.members.values()].map((m) => m.name);
  }
  /** Players actually in the world (past the title screen). */
  get activeCount(): number {
    return [...this.members.values()].filter((m) => m.state).length;
  }

  handle(connId: string | null, raw: unknown, send: (m: WorldServerMsg) => void): string | null {
    const msg = parseWorldClientMsg(raw);
    if (!msg) {
      this.stats.malformed++;
      send({ t: 'error', error: 'malformed' });
      return connId;
    }
    if (msg.t === 'hello') {
      if (connId && this.members.has(connId)) return connId;
      return this.join(msg.name, send);
    }
    const me = connId ? this.members.get(connId) : undefined;
    if (!me) {
      send({ t: 'error', error: 'not_joined' });
      return connId;
    }
    const t = this.now();
    if (t - me.windowStart >= 1000) {
      me.windowStart = t;
      me.msgs = 0;
      me.hits = 0;
    }
    if (++me.msgs > WORLD_LIMITS.maxMessagesPerSecond) {
      this.stats.rateLimited++;
      return me.id;
    }
    if (msg.t === 'state') {
      const first = me.state === null;
      me.state = msg.s;
      // Players appear to others once they are actually in the world (not on the title screen).
      if (first) this.broadcast({ t: 'joined', player: { id: me.id, name: me.name, state: me.state } }, me.id);
    }
    else if (msg.t === 'hit') this.hit(me, msg.enemyId, msg.attackId, msg.damage, msg.stagger, msg.guardBreak, msg.crit);
    return me.id;
  }

  private join(name: string, send: (m: WorldServerMsg) => void): string | null {
    if (this.members.size >= WORLD_LIMITS.maxPlayers) {
      send({ t: 'error', error: 'world_full' });
      return null;
    }
    const id = `p${this.nextId++}`;
    const m: Member = { id, name, state: null, send, windowStart: this.now(), msgs: 0, hits: 0 };
    this.members.set(id, m);
    send({ t: 'welcome', id, players: this.infos(), enemies: this.enemies.map(netState), protocol: WORLD_PROTOCOL });
    return id;
  }

  leave(id: string | null): void {
    const m = id ? this.members.get(id) : undefined;
    if (!m) return;
    this.members.delete(m.id);
    if (m.state) this.broadcast({ t: 'left', id: m.id, name: m.name });
  }

  private hit(me: Member, enemyId: string, attackId: string, damage: number, stagger: number, guardBreak: boolean, crit: boolean): void {
    const e = this.enemies.find((x) => x.id === enemyId);
    const atk = (ATTACKS as Record<string, (typeof ATTACKS)[AttackId] | undefined>)[attackId];
    const p = me.state;
    const reject = (): void => {
      this.stats.rejectedHits++;
      me.send({ t: 'hitResult', enemyId, damage: 0, guarded: false, staggered: false, guardBroken: false, killed: false, ignored: true, crit: false });
    };
    if (!e || !atk || !p || !e.brain.alive || p.hp <= 0) return reject();
    if (++me.hits > WORLD_LIMITS.maxHitsPerSecond) {
      this.stats.rateLimited++;
      return reject();
    }
    if (dist2({ x: p.x, z: p.z }, e.pos2) > atk.range + e.def.radius + HIT_SLACK) return reject();
    // Guard-break is only legitimate on the Guardbreaker attack.
    const res = e.brain.receiveHit({ damage, stagger, guardBreak: guardBreak && atk.guardBreak });
    this.stats.acceptedHits++;
    if (!res.ignored) this.credit(e.id, me.id);
    me.send({ t: 'hitResult', enemyId, damage: res.damage, guarded: res.guarded, staggered: res.staggered, guardBroken: res.guardBroken, killed: res.killed, ignored: res.ignored, crit });
    if (res.killed) this.kill(e);
  }

  private credit(enemyId: string, playerId: string): void {
    let m = this.contributors.get(enemyId);
    if (!m) this.contributors.set(enemyId, (m = new Map()));
    m.set(playerId, this.now());
  }

  private kill(e: EnemySim): void {
    const t = this.now();
    const list = [...(this.contributors.get(e.id) ?? new Map<string, number>()).entries()].filter(([id, at]) => t - at < CREDIT_WINDOW_MS && this.members.has(id)).map(([id]) => id);
    this.contributors.delete(e.id);
    this.stats.kills++;
    this.broadcast({ t: 'enemies', list: [netState(e)] });
    this.broadcast({ t: 'kill', enemyId: e.id, type: e.spawn.type, contributors: list });
  }

  private livingPlayers(): Array<{ m: Member; pos: Vec2; y: number }> {
    const out: Array<{ m: Member; pos: Vec2; y: number }> = [];
    for (const m of this.members.values()) if (m.state && m.state.hp > 0 && m.state.ph !== 'dead') out.push({ m, pos: { x: m.state.x, z: m.state.z }, y: m.state.y });
    return out;
  }

  /** Advance the world. Called at a fixed rate by the transport (and directly by tests). */
  step(dt: number): void {
    if (this.members.size === 0) return;
    const players = this.livingPlayers();
    for (const e of this.enemies) {
      // Target: the nearest living player.
      let target = players[0];
      let best = Infinity;
      for (const p of players) {
        const d = dist2(e.pos2, p.pos);
        if (d < best) {
          best = d;
          target = p;
        }
      }
      e.step(dt, target ? { pos: target.pos, alive: true } : { pos: e.home, alive: false });
      this.resolveEnemyAttack(e, players);
      this.respawnCheck(e);
    }
  }

  private resolveEnemyAttack(e: EnemySim, players: Array<{ m: Member; pos: Vec2; y: number }>): void {
    const b = e.brain;
    if (!b.hitWindowOpen() || !b.attack) return;
    const a = b.attack;
    for (const p of players) {
      let inside: boolean;
      if (a.shape === 'circle') {
        const c = e.attackCenter ?? forwardPoint(e.pos2, e.yaw, a.circleOffset ?? 0);
        inside = inCircle(c, a.circleRadius ?? 3, p.pos, PLAYER_RADIUS) && Math.abs(e.y - p.y) <= 1.6;
      } else inside = inArc(e.pos2, e.yaw, p.pos, a.range, a.arcDeg ?? 90, PLAYER_RADIUS);
      if (!inside || !b.swing.tryRegister(p.m.id)) continue;
      this.stats.enemyHitsOnPlayers++;
      // The victim's client applies dodge i-frames and blocking to this raw hit.
      p.m.send({ t: 'playerHit', enemyId: e.id, damage: a.damage, heavy: !!a.heavy });
    }
  }

  private respawnCheck(e: EnemySim): void {
    if (e.brain.alive) return;
    const r = e.def.respawnSeconds ?? (e.def.kind === 'elite' ? ELITE_SHARED_RESPAWN : null);
    if (r === null || e.deadFor < r) return;
    for (const m of this.members.values()) if (m.state && dist2({ x: m.state.x, z: m.state.z }, e.home) < RESPAWN_CLEAR_RADIUS) return;
    e.reset();
  }

  /** Relay avatars and changed enemies (called at the network rate). */
  publish(): void {
    if (this.members.size === 0) return;
    if (this.members.size > 1) {
      const list = [...this.members.values()].filter((m) => m.state).map((m) => ({ id: m.id, s: m.state! }));
      if (list.length) this.broadcast({ t: 'players', list });
    }
    const changed: EnemyNetState[] = [];
    for (const e of this.enemies) {
      const s = netState(e);
      // stateTime advances every tick; clients run it locally, so it doesn't count as a change.
      const key = JSON.stringify({ ...s, st: 0 });
      if (this.lastSent.get(e.id) !== key) {
        this.lastSent.set(e.id, key);
        changed.push(s);
      }
    }
    if (changed.length) this.broadcast({ t: 'enemies', list: changed });
  }

  private infos(): WorldPlayerInfo[] {
    return [...this.members.values()].filter((m) => m.state).map((m) => ({ id: m.id, name: m.name, state: m.state }));
  }

  private broadcast(msg: WorldServerMsg, except?: string): void {
    for (const m of this.members.values()) if (m.id !== except) m.send(msg);
  }
}

export function netState(e: EnemySim): EnemyNetState {
  const b = e.brain;
  const s: EnemyNetState = {
    id: e.id,
    x: Math.round(e.x * 100) / 100,
    z: Math.round(e.z * 100) / 100,
    yaw: Math.round(e.yaw * 1000) / 1000,
    s: b.state,
    a: b.attack?.id ?? null,
    st: Math.round(b.stateTime * 100) / 100,
    hp: Math.round(b.health * 100) / 100,
    p2: b.phase2,
  };
  if (e.attackCenter) {
    s.cx = Math.round(e.attackCenter.x * 100) / 100;
    s.cz = Math.round(e.attackCenter.z * 100) / 100;
  }
  return s;
}
