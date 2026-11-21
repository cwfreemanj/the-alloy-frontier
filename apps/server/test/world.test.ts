/**
 * Shared-world server tests over real WebSockets: auto-join, seeing each other, server-run
 * enemies, hit validation, shared kill credit, enemy attacks on players, and abuse limits.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ENEMIES } from '@alloy/game-rules';
import { WORLD_PROTOCOL, type AvatarState, type WorldServerMsg } from '@alloy/protocol';
import { ENEMY_SPAWNS } from '@alloy/world';
import { startWorldServer, type RunningWorldServer } from '../src/worldServer';
import { WorldRoom } from '../src/worldRoom';

let server: RunningWorldServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

class TestClient {
  ws: WebSocket;
  inbox: WorldServerMsg[] = [];
  id = '';
  private openP: Promise<void>;
  constructor(url: string, headers?: Record<string, string>) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString()) as WorldServerMsg));
    // Listen from the start so an early 'open' is never missed.
    this.openP = new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
    this.openP.catch(() => {});
  }
  opened(): Promise<void> {
    return this.openP;
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  async wait<T extends WorldServerMsg['t']>(t: T, pred: (m: Extract<WorldServerMsg, { t: T }>) => boolean = () => true, ms = 3000): Promise<Extract<WorldServerMsg, { t: T }>> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.inbox.findIndex((m) => m.t === t && pred(m as Extract<WorldServerMsg, { t: T }>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<WorldServerMsg, { t: T }>;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`timed out waiting for ${t}`);
  }
  async join(name: string): Promise<void> {
    await this.opened();
    this.send({ t: 'hello', name, protocol: WORLD_PROTOCOL });
    this.id = (await this.wait('welcome')).id;
  }
  close(): void {
    this.ws.close();
  }
}

const avatar = (x: number, z: number, extra: Partial<AvatarState> = {}): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null, ...extra });

async function twoPlayers() {
  server = await startWorldServer({ port: 0 });
  const url = `ws://127.0.0.1:${server.port}/world`;
  const a = new TestClient(url);
  const b = new TestClient(url);
  await a.join('Alice');
  await b.join('Bram');
  return { a, b };
}

describe('shared world (auto-join, presence)', () => {
  it('players join without codes and see each other move', async () => {
    const { a, b } = await twoPlayers();
    // Nobody is announced until they leave the title screen and send a position.
    b.send({ t: 'state', s: avatar(0, 0) });
    expect((await a.wait('joined')).player.name).toBe('Bram (guest)');
    a.send({ t: 'state', s: avatar(3, 4, { ph: 'active', atk: 'light1' }) });
    const seen = await b.wait('players', (m) => m.list.some((p) => p.id === a.id && p.s.x === 3));
    expect(seen.list.find((p) => p.id === a.id)!.s.atk).toBe('light1');
    b.close();
    expect((await a.wait('left')).name).toBe('Bram (guest)');
    a.close();
  });

  it('serves the game page and a health check from the same address', async () => {
    server = await startWorldServer({ port: 0 });
    const info = await (await fetch(`http://127.0.0.1:${server.port}/world-info`)).json();
    expect(info).toMatchObject({ ok: true, game: 'alloy-frontier' });
  });

  it('cleans player names', async () => {
    server = await startWorldServer({ port: 0 });
    const c = new TestClient(`ws://127.0.0.1:${server.port}/world`);
    await c.opened();
    c.send({ t: 'hello', name: '<img src=x onerror=alert(1)>Sam', protocol: WORLD_PROTOCOL });
    await c.wait('welcome');
    expect(server.room.playerNames()[0]).not.toMatch(/[<>=]/);
    c.close();
  });

  it('rejects pages from other websites', async () => {
    server = await startWorldServer({ port: 0 });
    const evil = new TestClient(`ws://127.0.0.1:${server.port}/world`, { origin: 'https://evil.example' });
    await expect(evil.opened()).rejects.toThrow();
    const ok = new TestClient(`ws://127.0.0.1:${server.port}/world`, { origin: `http://127.0.0.1:${server.port}` });
    await ok.opened();
    ok.close();
  });
});

describe('server-run enemies', () => {
  const scav = ENEMY_SPAWNS.find((s) => s.type === 'scavenger')!;

  it('two players hitting the same enemy both get kill credit', async () => {
    const { a, b } = await twoPlayers();
    a.send({ t: 'state', s: avatar(scav.pos.x + 1, scav.pos.z) });
    b.send({ t: 'state', s: avatar(scav.pos.x - 1, scav.pos.z) });
    await new Promise((r) => setTimeout(r, 100));
    const hp = ENEMIES.scavenger.maxHealth;
    b.send({ t: 'hit', enemyId: scav.id, attackId: 'light1', damage: 20, stagger: 0, guardBreak: false, crit: false });
    expect((await b.wait('hitResult')).ignored).toBe(false);
    let killed = false;
    for (let i = 0; i < Math.ceil(hp / 50) + 2 && !killed; i++) {
      a.send({ t: 'hit', enemyId: scav.id, attackId: 'heavy', damage: 50, stagger: 0, guardBreak: false, crit: false });
      killed = (await a.wait('hitResult')).killed;
      await new Promise((r) => setTimeout(r, 130)); // stay under the hit-rate cap
    }
    expect(killed).toBe(true);
    const kill = await b.wait('kill', (m) => m.enemyId === scav.id);
    expect(kill.contributors.sort()).toEqual([a.id, b.id].sort());
    a.close();
    b.close();
  });

  it('rejects hits from out of reach, unknown attacks and oversized damage', async () => {
    const { a, b } = await twoPlayers();
    a.send({ t: 'state', s: avatar(scav.pos.x + 40, scav.pos.z) });
    await new Promise((r) => setTimeout(r, 50));
    a.send({ t: 'hit', enemyId: scav.id, attackId: 'light1', damage: 10, stagger: 0, guardBreak: false, crit: false });
    expect((await a.wait('hitResult')).ignored).toBe(true);
    a.send({ t: 'state', s: avatar(scav.pos.x + 1, scav.pos.z) });
    await new Promise((r) => setTimeout(r, 50));
    a.send({ t: 'hit', enemyId: scav.id, attackId: 'nuke', damage: 10, stagger: 0, guardBreak: false, crit: false });
    expect((await a.wait('hitResult')).ignored).toBe(true);
    a.send({ t: 'hit', enemyId: scav.id, attackId: 'light1', damage: 99999, stagger: 0, guardBreak: false, crit: false });
    await a.wait('error');
    expect(server!.room.stats.rejectedHits).toBe(2);
    expect(server!.room.stats.malformed).toBe(1);
    a.close();
    b.close();
  });

  it('enemies chase and attack the nearest player; only that player is hit', async () => {
    const room = new WorldRoom(() => Date.now());
    const sent: Record<string, WorldServerMsg[]> = { a: [], b: [] };
    const ida = room.handle(null, JSON.stringify({ t: 'hello', name: 'A', protocol: WORLD_PROTOCOL }), (m) => sent.a.push(m))!;
    const idb = room.handle(null, JSON.stringify({ t: 'hello', name: 'B', protocol: WORLD_PROTOCOL }), (m) => sent.b.push(m))!;
    room.handle(ida, JSON.stringify({ t: 'state', s: avatar(scav.pos.x + 1.2, scav.pos.z) }), () => {});
    room.handle(idb, JSON.stringify({ t: 'state', s: avatar(scav.pos.x + 60, scav.pos.z) }), () => {});
    for (let i = 0; i < 20 * 15; i++) room.step(0.05);
    expect(sent.a.some((m) => m.t === 'playerHit')).toBe(true);
    expect(sent.b.some((m) => m.t === 'playerHit')).toBe(false);
  });

  it('dead enemies respawn on the server once nobody is standing on them', () => {
    const room = new WorldRoom(() => Date.now());
    const id = room.handle(null, JSON.stringify({ t: 'hello', name: 'A', protocol: WORLD_PROTOCOL }), () => {})!;
    room.handle(id, JSON.stringify({ t: 'state', s: avatar(-2, 2) }), () => {});
    const e = room.enemies.find((x) => x.id === scav.id)!;
    e.brain.receiveHit({ damage: 1e9, stagger: 0, guardBreak: false });
    expect(e.brain.alive).toBe(false);
    for (let i = 0; i < 20 * ((ENEMIES.scavenger.respawnSeconds ?? 0) + 2); i++) room.step(0.05);
    expect(e.brain.alive).toBe(true);
  });

  it('keeps simulating cheaply with nobody online (no work when empty)', () => {
    const room = new WorldRoom(() => Date.now());
    const before = JSON.stringify(room.enemies.map((e) => [e.x, e.z]));
    for (let i = 0; i < 100; i++) room.step(0.05);
    expect(JSON.stringify(room.enemies.map((e) => [e.x, e.z]))).toBe(before);
  });
});
