/**
 * The shared world (one persistent instance). Transport-agnostic so tests can drive it.
 *
 * Server-owned: every enemy (AI, movement, health, attacks, deaths, respawns), who an
 * enemy targets, whether an enemy attack reached a player, and kill credit. For signed-in
 * players also the character: actions ('act'), kill rewards, weapon XP and hit damage
 * (computed from the server-side weapon). Client-owned: the player's own movement
 * (sanity-checked), and a guest's character (kept in their browser).
 */
import { ATTACKS, checkMove, finisherMultiplier, heightOk, dist2, forwardPoint, inArc, inCircle, isNear, newMoveGuard, resetMoveGuard, type AttackId, type MoveGuard, type Vec2 } from '@alloy/game-rules';
import { WORLD_LIMITS, WORLD_PROTOCOL, parseWorldClientMsg, type AvatarState, type CharAction, type EnemyNetState, type WorldPlayerInfo, type WorldServerMsg } from '@alloy/protocol';
import { GATHER_SECONDS, RANGE_SLACK, applyAction, damageAgainst, playerHit, rewardHit, rewardHitTaken, rewardKill } from '@alloy/session';
import type { CharacterHost, LiveCharacter } from './characters';
import { ENEMY_SPAWNS, EnemySim, RESPAWN_POINT, buildWorldColliders, terrainHeight, type ColliderWorld } from '@alloy/world';

const PLAYER_RADIUS = 0.4;
const CREDIT_WINDOW_MS = 30_000;
/** Extra reach allowed on reported hits (latency and enemy movement between frames). */
const HIT_SLACK = 2.5;
/** The Foundry Warden has no respawn in single-player; in the shared world it returns. */
const ELITE_SHARED_RESPAWN = 180;
const RESPAWN_CLEAR_RADIUS = 35;
/** Minimum time between two gathers (the browser channels for GATHER_SECONDS). */
const MIN_GATHER_INTERVAL_MS = GATHER_SECONDS * 900;
/** At most this often, a character update caused by hits/XP is sent (actions reply at once). */
const CHAR_PUSH_INTERVAL_MS = 250;

interface Member {
  id: string;
  name: string;
  /** Signed-in account (null for guests). */
  accountId: string | null;
  close: () => void;
  state: AvatarState | null;
  send: (m: WorldServerMsg) => void;
  windowStart: number;
  msgs: number;
  hits: number;
  /** The server-owned character of a signed-in player (null for guests). */
  char: LiveCharacter | null;
  /** Speed check of reported positions (null until the first position). */
  move: MoveGuard | null;
  lastCorrectAt: number;
  /** When each cooldown attack was last used (server time, ms). */
  lastUse: Map<string, number>;
}

/** Hits of one use of a cooldown attack (e.g. a spin hitting several enemies) arrive within this window. */
const USE_WINDOW_MS = 1200;
/** Latency slack on cooldowns. */
const COOLDOWN_SLACK_MS = 1000;

export interface WorldStats {
  malformed: number;
  rateLimited: number;
  rejectedHits: number;
  acceptedHits: number;
  enemyHitsOnPlayers: number;
  kills: number;
  acts: number;
  rejectedActs: number;
  /** Reported positions refused by the speed check. */
  speedRejected: number;
  /** Reported positions refused for an impossible height (flying, sinking). */
  heightRejected: number;
  /**
   * Damage signed-in players dealt, by damage type and by weapon family (unarmed: 'unarmed').
   * Groundwork for an adapting world (docs/design-backlog.md); not persisted yet.
   */
  damageByType: Record<string, number>;
  damageByFamily: Record<string, number>;
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
  stats: WorldStats = { malformed: 0, rateLimited: 0, rejectedHits: 0, acceptedHits: 0, enemyHitsOnPlayers: 0, kills: 0, acts: 0, rejectedActs: 0, speedRejected: 0, heightRejected: 0, damageByType: {}, damageByFamily: {} };

  constructor(
    private now: () => number = () => Date.now(),
    private host: CharacterHost | null = null,
    private rng: () => number = Math.random,
    /** Skip the speed check (debug teleports in local tests). Never set on a hosted server. */
    readonly allowTeleport = false,
  ) {
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
      if (msg.protocol !== WORLD_PROTOCOL) {
        send({ t: 'error', error: 'outdated_client' });
        return connId;
      }
      // Guests are marked so nobody can pass as a signed-in player.
      return this.join(`${msg.name} (guest)`, send, null, () => {});
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
      const wasDead = me.state?.ph === 'dead';
      if (!this.allowTeleport) msg.s = this.guardMove(me, msg.s, wasDead, t);
      me.state = msg.s;
      if (me.char) this.trackAvatar(me.char, msg.s, wasDead);
      // Players appear to others once they are actually in the world (not on the title screen).
      if (first) this.broadcast({ t: 'joined', player: { id: me.id, name: me.name, state: me.state } }, me.id);
    }
    else if (msg.t === 'hit') this.hit(me, msg.enemyId, msg.attackId, msg.damage, msg.stagger, msg.guardBreak, msg.crit);
    else if (msg.t === 'act') this.act(me, msg.id, msg.a);
    return me.id;
  }

  /**
   * Speed check: a reported position that moves further than the player could have is
   * replaced with the last accepted one (others never see the jump; range checks use it)
   * and the browser is told to move back. Respawning at the respawn point after a death is
   * allowed. A signed-in player's first position must be near where the server saved them,
   * so reconnecting can't be used to teleport.
   */
  private guardMove(me: Member, s: AvatarState, wasDead: boolean, t: number): AvatarState {
    const g = me.move;
    if (!g) {
      const saved = me.char?.session.data.player;
      if (saved && !isNear(s, saved) && !isNear(s, RESPAWN_POINT)) {
        me.move = newMoveGuard(saved.x, saved.z, t);
        return this.refuseMove(me, s, t);
      }
      me.move = newMoveGuard(s.x, s.z, t);
      return s;
    }
    if (wasDead && s.ph !== 'dead' && isNear(s, RESPAWN_POINT)) {
      resetMoveGuard(g, s.x, s.z, t);
      return s;
    }
    // Flying or sinking: the height must be one a player can reach from the terrain.
    if (!heightOk(s.y, terrainHeight(s.x, s.z))) {
      this.stats.heightRejected++;
      return this.refuseMove(me, s, t);
    }
    return checkMove(g, s.x, s.z, t) ? s : this.refuseMove(me, s, t);
  }

  private refuseMove(me: Member, s: AvatarState, t: number): AvatarState {
    const g = me.move!;
    this.stats.speedRejected++;
    // At most two corrections a second: the browser needs a moment to apply one.
    if (t - me.lastCorrectAt >= 500) {
      me.lastCorrectAt = t;
      me.send({ t: 'correct', x: g.x, z: g.z });
    }
    return { ...s, x: g.x, y: terrainHeight(g.x, g.z), z: g.z, spd: 0 };
  }

  /** The character follows the avatar: position for the save, and deaths for the stats. */
  private trackAvatar(c: LiveCharacter, s: AvatarState, wasDead: boolean): void {
    const p = c.session.data.player;
    p.x = Math.round(s.x * 100) / 100;
    p.z = Math.round(s.z * 100) / 100;
    p.yaw = Math.round(s.yaw * 1000) / 1000;
    p.health = Math.max(1, Math.round(s.hp));
    if (s.ph === 'dead' && !wasDead) c.session.data.stats.deaths++;
    this.host?.changed(c);
  }

  private act(me: Member, id: number, a: CharAction): void {
    const c = me.char;
    const refuse = (error: string, message: string): void => {
      this.stats.rejectedActs++;
      me.send({ t: 'actResult', id, ok: false, error, message });
    };
    if (!c) return refuse('guest', 'Guests keep their character in their browser.');
    if (me.state && (me.state.hp <= 0 || me.state.ph === 'dead')) return refuse('dead', 'You are down.');
    const t = this.now();
    if (a.k === 'gather' && t - c.lastGatherAt < MIN_GATHER_INTERVAL_MS) return refuse('too_fast', 'Still gathering.');
    const pos = me.state ? { x: me.state.x, z: me.state.z } : null;
    const r = applyAction(c.session, a, { pos, slack: RANGE_SLACK });
    if (!r.ok) return refuse(r.error, r.message);
    this.stats.acts++;
    if (a.k === 'gather') c.lastGatherAt = t;
    this.host?.changed(c);
    me.send({ t: 'actResult', id, ok: true, ...(r.item ? { item: r.item } : {}) });
    this.pushChar(me, r.events, true);
  }

  /** Send the character now, or soon (coalesced) for frequent changes like weapon XP. */
  private pushChar(me: Member, events: LiveCharacter['pending'], now: boolean): void {
    const c = me.char;
    if (!c) return;
    c.pending.push(...events);
    c.due = true;
    if (now) this.sendChar(me);
  }

  private sendChar(me: Member): void {
    const c = me.char;
    if (!c) return;
    const events = c.pending;
    c.pending = [];
    c.due = false;
    c.lastSentAt = this.now();
    me.send({ t: 'char', data: c.session.data, events });
  }

  /**
   * Join the world. For a signed-in account, an older connection of the same account is
   * signed out of the world first, so one character is never played twice at once.
   */
  join(name: string, send: (m: WorldServerMsg) => void, accountId: string | null, close: () => void, char: LiveCharacter | null = null): string | null {
    if (accountId) {
      for (const old of [...this.members.values()]) {
        if (old.accountId !== accountId) continue;
        old.send({ t: 'error', error: 'signed_in_elsewhere' });
        this.leave(old.id);
        old.close();
      }
    }
    if (this.members.size >= WORLD_LIMITS.maxPlayers) {
      send({ t: 'error', error: 'world_full' });
      if (char) this.host?.release(char);
      return null;
    }
    const id = `p${this.nextId++}`;
    const m: Member = { id, name, accountId, close, state: null, send, windowStart: this.now(), msgs: 0, hits: 0, char, move: null, lastCorrectAt: 0, lastUse: new Map() };
    this.members.set(id, m);
    send({ t: 'welcome', id, players: this.infos(), enemies: this.enemies.map(netState), protocol: WORLD_PROTOCOL });
    if (char) this.sendChar(m);
    return id;
  }

  leave(id: string | null): void {
    const m = id ? this.members.get(id) : undefined;
    if (!m) return;
    this.members.delete(m.id);
    if (m.char) this.host?.release(m.char);
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
    // Attacks with a cooldown (Guardbreaker, Storm Arc, skills): one use per cooldown. Hits of
    // the same use land within a short window; a new use before the cooldown is refused.
    if (atk.cooldown) {
      const t = this.now();
      const last = me.lastUse.get(atk.id);
      if (last !== undefined && t - last > USE_WINDOW_MS && t - last < atk.cooldown * 1000 - COOLDOWN_SLACK_MS) return reject();
      if (last === undefined || t - last > USE_WINDOW_MS) me.lastUse.set(atk.id, t);
    }
    let dealtType: string | null = null;
    if (me.char) {
      // Signed in: the damage comes from the server's copy of the weapon, not the report.
      const out = playerHit(me.char.session, attackId, this.rng, e.def.attributes);
      if (!out) return reject();
      // Defense, then the enemy's resistance to the weapon's damage type.
      const landed = damageAgainst(me.char.session, out.damage, e.def, attackId);
      // Finishers hit harder on staggered or badly wounded enemies.
      damage = landed.damage * finisherMultiplier(attackId, { staggered: e.brain.state === 'stagger', healthFraction: e.brain.health / e.def.maxHealth });
      dealtType = landed.type;
      stagger = out.stagger;
      crit = out.crit;
      guardBreak = out.guardBreak;
    }
    // Guard-break is only legitimate on the Guardbreaker attack.
    const res = e.brain.receiveHit({ damage, stagger, guardBreak: guardBreak && atk.guardBreak });
    this.stats.acceptedHits++;
    if (!res.ignored) this.credit(e.id, me.id);
    if (me.char && !res.ignored && res.damage > 0) {
      const family = me.char.session.weaponFamily ?? 'unarmed';
      if (dealtType) this.stats.damageByType[dealtType] = (this.stats.damageByType[dealtType] ?? 0) + res.damage;
      this.stats.damageByFamily[family] = (this.stats.damageByFamily[family] ?? 0) + res.damage;
      this.pushChar(me, rewardHit(me.char.session, e.spawn.type, res.damage, attackId, crit), false);
      this.host?.changed(me.char);
    }
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
    // Rewards for signed-in contributors are rolled here; guests roll their own.
    for (const id of list) {
      const m = this.members.get(id);
      if (!m?.char) continue;
      const r = rewardKill(m.char.session, e.spawn.type, e.id, this.rng);
      this.host?.changed(m.char);
      const loot = `${e.def.name} defeated · +${r.coins} coins${r.flux ? ` · +${r.flux} Binding Flux` : ''}`;
      this.pushChar(m, [{ type: 'toast', text: loot, tone: 'good' }, ...r.events], true);
    }
  }

  private livingPlayers(): Array<{ m: Member; pos: Vec2; y: number }> {
    const out: Array<{ m: Member; pos: Vec2; y: number }> = [];
    for (const m of this.members.values()) if (m.state && m.state.hp > 0 && m.state.ph !== 'dead') out.push({ m, pos: { x: m.state.x, z: m.state.z }, y: m.state.y });
    return out;
  }

  /** Advance the world. Called at a fixed rate by the transport (and directly by tests). */
  step(dt: number): void {
    if (this.members.size === 0) return;
    for (const m of this.members.values()) if (m.char && m.state) m.char.session.data.playTime += dt;
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
      if (p.m.char) {
        this.pushChar(p.m, rewardHitTaken(p.m.char.session, a.damage), false);
        this.host?.changed(p.m.char);
      }
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
    const t = this.now();
    for (const m of this.members.values()) if (m.char?.due && t - m.char.lastSentAt >= CHAR_PUSH_INTERVAL_MS) this.sendChar(m);
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
