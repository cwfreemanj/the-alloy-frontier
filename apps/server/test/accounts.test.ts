/** Accounts, sessions, server-side saves, the HTTP API, and signed-in world joins. */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { newDb } from 'pg-mem';
import { WORLD_PROTOCOL, type WorldServerMsg } from '@alloy/protocol';
import { serialize } from '@alloy/save';
import { newSessionData } from '@alloy/session';
import { MemoryKV, PostgresKV, cleanDbUrl, kvFromEnv, strictTls, type KV, type PgLike } from '../src/accounts/kv';
import { AccountService, MAX_IMPORT_COINS } from '../src/accounts/service';
import { startWorldServer, type RunningWorldServer } from '../src/worldServer';

const goodSave = (x = 0) => {
  const d = newSessionData(1);
  d.player.x = x;
  return serialize(d, Date.now());
};

let server: RunningWorldServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function pgMemKV(): KV {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return new PostgresKV(new Pool() as unknown as PgLike);
}

for (const [label, make] of [
  ['memory', () => new MemoryKV()],
  ['postgres (pg-mem)', pgMemKV],
] as const) {
  describe(`account service on ${label} storage`, () => {
    it('registers, logs in, resolves sessions and logs out', async () => {
      const svc = new AccountService(make());
      const r = await svc.register('Neal_01', 'correct horse', '1.1.1.1');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((await svc.accountFor(r.value.token))?.username).toBe('Neal_01');
      const l = await svc.login('neal_01', 'correct horse', '1.1.1.1'); // usernames ignore case
      expect(l.ok).toBe(true);
      await svc.logout(r.value.token);
      expect(await svc.accountFor(r.value.token)).toBeNull();
      if (l.ok) expect(await svc.accountFor(l.value.token)).not.toBeNull(); // other device still signed in
    });

    it('stores only hashes: no password or token appears in storage', async () => {
      const kv = make();
      const svc = new AccountService(kv);
      const r = await svc.register('Hasher', 'super-secret-pw', 'ip');
      if (!r.ok) throw new Error('register failed');
      const acct = await svc.accountFor(r.value.token);
      const raw = JSON.stringify(await kv.get(`acct:${acct!.id}`));
      expect(raw).not.toContain('super-secret-pw');
      expect(await kv.get(`sess:${r.value.token}`)).toBeNull();
    });

    it('rejects duplicate (any case), bad and reserved usernames, short passwords', async () => {
      const svc = new AccountService(make());
      expect((await svc.register('Smith', 'password1', 'ip')).ok).toBe(true);
      const dup = await svc.register('SMITH', 'password1', 'ip');
      expect(dup.ok === false && dup.error).toBe('username_taken');
      for (const bad of ['ab', 'has space', '<script>', 'x'.repeat(21)]) expect((await svc.register(bad, 'password1', 'ip')).ok).toBe(false);
      expect((await svc.register('Admin', 'password1', 'ip')).ok).toBe(false);
      expect((await svc.register('shortpw', '1234567', 'ip')).ok).toBe(false);
    });

    it('gives the same answer for an unknown user and a wrong password, and locks after 5 misses', async () => {
      const svc = new AccountService(make());
      await svc.register('Locky', 'right-password', 'ip');
      const unknown = await svc.login('Nobody', 'whatever1', 'ip');
      const wrong = await svc.login('Locky', 'wrong-password', 'ip');
      expect(unknown.ok === false && unknown.message).toBe(wrong.ok === false && wrong.message);
      for (let i = 0; i < 4; i++) await svc.login('Locky', 'wrong-password', 'ip');
      const locked = await svc.login('Locky', 'right-password', 'ip');
      expect(locked.ok === false && locked.error).toBe('locked');
    });

    it('imports a guest character once, then only the server writes it', async () => {
      const svc = new AccountService(make());
      const r = await svc.register('Saver', 'password1', 'ip');
      if (!r.ok) throw new Error('register failed');
      const id = (await svc.accountFor(r.value.token))!.id;
      expect(await svc.getSave(id)).toBeNull();
      const i1 = await svc.importCharacter(id, goodSave(1));
      expect(i1.ok && i1.value.revision).toBe(1);
      const again = await svc.importCharacter(id, goodSave(2));
      expect(again.ok === false && again.error).toBe('has_character');
      expect((await svc.serverPutSave(id, goodSave(3), 3)).revision).toBe(2);
      expect(JSON.parse((await svc.getSave(id))!.raw).data.player.x).toBe(3);
    });

    it('rejects tampered, corrupted and oversized imports, and caps imported coins', async () => {
      const svc = new AccountService(make());
      const r = await svc.register('Cheater', 'password1', 'ip');
      if (!r.ok) throw new Error('register failed');
      const id = (await svc.accountFor(r.value.token))!.id;
      const env = JSON.parse(goodSave());
      env.data.inventory.coins = 999999; // edited without fixing the checksum
      expect((await svc.importCharacter(id, JSON.stringify(env))).ok).toBe(false);
      expect((await svc.importCharacter(id, '{not json')).ok).toBe(false);
      expect((await svc.importCharacter(id, 'x'.repeat(600 * 1024))).ok).toBe(false);
      const rich = newSessionData(1);
      rich.inventory.coins = 999999;
      expect((await svc.importCharacter(id, serialize(rich, 1))).ok).toBe(true);
      expect(JSON.parse((await svc.getSave(id))!.raw).data.inventory.coins).toBe(MAX_IMPORT_COINS);
    });
  });
}

describe('HTTP API and signed-in world', () => {
  async function boot() {
    server = await startWorldServer({ port: 0, accounts: new AccountService(new MemoryKV()), allowedOrigins: ['https://alloy-frontier.vercel.app'] });
    return `http://127.0.0.1:${server.port}`;
  }
  const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('register → import a guest character → load it from a "second device"; uploads are refused', async () => {
    const base = await boot();
    const reg = await (await post(base, '/api/register', { username: 'Traveler', password: 'password1' })).json();
    expect(reg.username).toBe('Traveler');
    const auth = { authorization: `Bearer ${reg.token}` };
    const imp = await post(base, '/api/character/import', { save: goodSave(7) }, auth);
    expect((await imp.json()).revision).toBe(1);
    // Second device logs in with the password and gets the same character.
    const login = await (await post(base, '/api/login', { username: 'traveler', password: 'password1' })).json();
    const got = await (await fetch(`${base}/api/save`, { headers: { authorization: `Bearer ${login.token}` } })).json();
    expect(got.revision).toBe(1);
    expect(JSON.parse(got.save).data.player.x).toBe(7);
    expect((await fetch(`${base}/api/save`)).status).toBe(401);
    // A browser can no longer write a character directly, even a valid one.
    const put = await fetch(`${base}/api/save`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ save: goodSave(9), revision: 1 }) });
    expect(put.status).toBe(410);
    // Slot 1 is taken: "new" never overwrites a character.
    const taken = await post(base, '/api/character/new', {}, auth);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe('slot_taken');
    // A second character goes into slot 2; slot 1 is kept.
    const second = await post(base, '/api/character/new', { slot: 2 }, auth);
    expect((await second.json()).revision).toBe(1);
    expect(JSON.parse((await (await fetch(`${base}/api/save?slot=2`, { headers: auth })).json()).save).data.player.x).toBe(0);
    expect(JSON.parse((await (await fetch(`${base}/api/save?slot=1`, { headers: auth })).json()).save).data.player.x).toBe(7);
    expect((await fetch(`${base}/api/save?slot=3`, { headers: auth })).status).toBe(400);
    const list = (await (await fetch(`${base}/api/characters`, { headers: auth })).json()).slots;
    expect(list.map((x: { slot: number; exists: boolean }) => [x.slot, x.exists])).toEqual([[1, true], [2, true]]);
    expect(list[0]).toMatchObject({ rank: 1, questStep: 0, questDone: false });
    // Deleting needs the typed confirmation; then the slot is empty and can start over.
    expect((await post(base, '/api/character/delete', { slot: 2 }, auth)).status).toBe(400);
    expect((await post(base, '/api/character/delete', { slot: 2, confirm: 'delete' }, auth)).status).toBe(400);
    expect((await post(base, '/api/character/delete', { slot: 2, confirm: 'DELETE' }, auth)).status).toBe(200);
    expect((await (await fetch(`${base}/api/save?slot=2`, { headers: auth })).json()).save).toBeNull();
    expect((await post(base, '/api/character/delete', { slot: 2, confirm: 'DELETE' }, auth)).status).toBe(404);
    expect(JSON.parse((await (await fetch(`${base}/api/save?slot=1`, { headers: auth })).json()).save).data.player.x).toBe(7);
    const again = await post(base, '/api/character/new', { slot: 2 }, auth);
    expect(again.status).toBe(200);
  });

  it('deleting a character keeps it in a dated trash record (undo by hand)', async () => {
    const kv = new MemoryKV();
    let t = 5_000;
    const svc = new AccountService(kv, () => t);
    const reg = await svc.register('Trashy', 'password123', '1.1.1.1');
    if (!reg.ok) throw new Error('register');
    const id = (await svc.accountFor(reg.value.token))!.id;
    expect((await svc.newCharacter(id, 2, goodSave(3))).ok).toBe(true);
    t = 9_000;
    const del = await svc.deleteCharacter(id, 2);
    if (!del.ok) throw new Error('delete');
    expect(del.value.trashKey).toBe(`trash:${id}~2:9000`);
    const kept = await kv.get<{ raw: string; deletedAt: number }>(del.value.trashKey);
    expect(kept?.deletedAt).toBe(9000);
    expect(JSON.parse(kept!.raw).data.player.x).toBe(3);
    expect(await svc.getSave(id, 2)).toBeNull();
  });

  it('allows the configured Vercel origin and refuses other websites', async () => {
    const base = await boot();
    const pre = await fetch(`${base}/api/login`, { method: 'OPTIONS', headers: { origin: 'https://alloy-frontier.vercel.app' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://alloy-frontier.vercel.app');
    const evil = await post(base, '/api/login', { username: 'x', password: 'y' }, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
  });

  it('signed-in players appear under their username; logging in elsewhere signs the old device out of the world', async () => {
    const base = await boot();
    const reg = await (await post(base, '/api/register', { username: 'OneOnly', password: 'password1' })).json();
    const ws = base.replace('http', 'ws') + '/world';
    const open = (c: WebSocket) => new Promise((r) => c.once('open', r));
    const inbox = (c: WebSocket) => {
      const box: WorldServerMsg[] = [];
      c.on('message', (d) => box.push(JSON.parse(d.toString())));
      return box;
    };
    const waitFor = async (box: WorldServerMsg[], pred: (m: WorldServerMsg) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const m = box.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error('timeout');
    };
    const first = new WebSocket(ws);
    const firstBox = inbox(first);
    await open(first);
    first.send(JSON.stringify({ t: 'hello', name: 'ignored', protocol: WORLD_PROTOCOL, token: reg.token }));
    await waitFor(firstBox, (m) => m.t === 'welcome');
    expect(server!.room.playerNames()).toEqual(['OneOnly']);
    const closed = new Promise<number>((r) => first.once('close', (code) => r(code)));

    const second = new WebSocket(ws);
    const secondBox = inbox(second);
    await open(second);
    second.send(JSON.stringify({ t: 'hello', name: 'ignored', protocol: WORLD_PROTOCOL, token: reg.token }));
    await waitFor(secondBox, (m) => m.t === 'welcome');
    await waitFor(firstBox, (m) => m.t === 'error' && m.error === 'signed_in_elsewhere');
    expect(await closed).toBe(4001);
    expect(server!.room.playerNames()).toEqual(['OneOnly']);

    // A bad token is refused rather than silently joining as a guest.
    const bad = new WebSocket(ws);
    const badBox = inbox(bad);
    await open(bad);
    bad.send(JSON.stringify({ t: 'hello', name: 'x', protocol: WORLD_PROTOCOL, token: 'nope' }));
    await waitFor(badBox, (m) => m.t === 'error' && m.error === 'signed_out');
    second.close();
    bad.close();
  });

  it('the server owns a signed-in character: it applies actions and saves the result itself', async () => {
    const svc = new AccountService(new MemoryKV());
    server = await startWorldServer({ port: 0, accounts: svc, allowTeleport: true }); // the test places the player at Orla directly
    const base = `http://127.0.0.1:${server.port}`;
    const reg = await (await post(base, '/api/register', { username: 'Owner', password: 'password1' })).json();
    const c = new WebSocket(base.replace('http', 'ws') + '/world');
    const box: WorldServerMsg[] = [];
    c.on('message', (d) => box.push(JSON.parse(d.toString())));
    await new Promise((r) => c.once('open', r));
    const waitFor = async (pred: (m: WorldServerMsg) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const m = box.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error('timeout');
    };
    c.send(JSON.stringify({ t: 'hello', name: 'x', protocol: WORLD_PROTOCOL, token: reg.token }));
    await waitFor((m) => m.t === 'char');
    // Stand next to Orla and talk: the server grants the starter sword.
    c.send(JSON.stringify({ t: 'state', s: { x: -9, y: 0, z: 7.5, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null } }));
    c.send(JSON.stringify({ t: 'act', id: 1, a: { k: 'talk', npc: 'orla' } }));
    expect(await waitFor((m) => m.t === 'actResult' && m.id === 1)).toMatchObject({ ok: true });
    // While the character is in the world, the title-screen endpoints can't replace or delete it.
    const blocked = await post(base, '/api/character/new', {}, { authorization: `Bearer ${reg.token}` });
    expect(blocked.status).toBe(409);
    const noDelete = await post(base, '/api/character/delete', { slot: 1, confirm: 'DELETE' }, { authorization: `Bearer ${reg.token}` });
    expect(noDelete.status).toBe(409);
    expect((await noDelete.json()).error).toBe('in_world');
    c.close();
    await server.close(); // writes changed characters before stopping
    server = null;
    const id = (await svc.accountFor(reg.token))!.id;
    const saved = JSON.parse((await svc.getSave(id))!.raw).data;
    expect(saved.inventory.equipped.weapon).toBeTruthy();
    expect(saved.quest.stepIndex).toBe(1);
  });

  it('joining with slot 2 plays (and saves) the second character, leaving slot 1 alone', async () => {
    const svc = new AccountService(new MemoryKV());
    server = await startWorldServer({ port: 0, accounts: svc, allowTeleport: true });
    const base = `http://127.0.0.1:${server.port}`;
    const reg = await (await post(base, '/api/register', { username: 'TwoSlots', password: 'password1' })).json();
    const auth = { authorization: `Bearer ${reg.token}` };
    expect((await post(base, '/api/character/new', { slot: 1 }, auth)).status).toBe(200);
    expect((await post(base, '/api/character/new', { slot: 2 }, auth)).status).toBe(200);
    const c = new WebSocket(base.replace('http', 'ws') + '/world');
    const box: WorldServerMsg[] = [];
    c.on('message', (d) => box.push(JSON.parse(d.toString())));
    await new Promise((r) => c.once('open', r));
    const waitFor = async (pred: (m: WorldServerMsg) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const m = box.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error('timeout');
    };
    c.send(JSON.stringify({ t: 'hello', name: 'x', protocol: WORLD_PROTOCOL, token: reg.token, slot: 2 }));
    await waitFor((m) => m.t === 'char');
    c.send(JSON.stringify({ t: 'state', s: { x: -9, y: 0, z: 7.5, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null } }));
    c.send(JSON.stringify({ t: 'act', id: 1, a: { k: 'talk', npc: 'orla' } }));
    expect(await waitFor((m) => m.t === 'actResult' && m.id === 1)).toMatchObject({ ok: true });
    // Slot 2 is in the world (can't be deleted); slot 1 isn't (could be).
    expect((await post(base, '/api/character/delete', { slot: 2, confirm: 'DELETE' }, auth)).status).toBe(409);
    c.close();
    await server.close();
    server = null;
    const id = (await svc.accountFor(reg.token))!.id;
    expect(JSON.parse((await svc.getSave(id, 2))!.raw).data.quest.stepIndex).toBe(1);
    expect(JSON.parse((await svc.getSave(id, 1))!.raw).data.quest.stepIndex).toBe(0);
  });
});

describe('database connection settings', () => {
  const url = 'postgresql://user:s3cret-pw@db.example.test/neondb?sslmode=require';
  it('ignores surrounding spaces and one pair of quotes pasted with the value', () => {
    expect(cleanDbUrl(`"${url}"`)).toBe(url);
    expect(cleanDbUrl(` '${url}' \n`)).toBe(url);
    expect(cleanDbUrl(url)).toBe(url);
    expect(cleanDbUrl(`"${url}`)).toBe(`"${url}`); // unmatched quote: left alone (and then rejected)
    expect(strictTls(`"${url}"`)).toContain('sslmode=verify-full');
  });

  it('never puts the connection string (and its password) in the error', () => {
    for (const bad of [`"${url}`, 'not a url', 'https://user:s3cret-pw@example.test/']) {
      let err: unknown = null;
      try {
        strictTls(bad, 'DATABASE_URL');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      const shown = `${String(err)} ${JSON.stringify(err)} ${(err as Error).stack}`;
      expect(shown).toContain('DATABASE_URL');
      expect(shown).not.toContain('s3cret-pw');
    }
  });

  it('treats a blank or quotes-only setting as no database', () => {
    expect(kvFromEnv({ DATABASE_URL: '  ' }, ':memory-test-unused').kind).toBe('file');
    expect(kvFromEnv({ DATABASE_URL: '""' }, ':memory-test-unused').kind).toBe('file');
  });
});
