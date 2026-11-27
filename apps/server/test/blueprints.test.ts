/**
 * Found blueprints on the server (docs/blueprint-contract.md): the server rolls drops from kills, keeps the
 * scrolls on the character, and learning, discarding and forging go through checked actions.
 */
import { describe, expect, it } from 'vitest';
import type { AvatarState, WorldServerMsg } from '@alloy/protocol';
import { FORGE_ANVIL, NPCS } from '@alloy/world';
import { CharacterHost, MemoryCharacterStore } from '../src/characters';
import { WorldRoom } from '../src/worldRoom';

const avatar = (x: number, z: number): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null });

/** rng: the server's random numbers (low: every drop roll succeeds). */
function setup(rng: () => number) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const host = new CharacterHost(new MemoryCharacterStore(), clock.now);
  const room = new WorldRoom(clock.now, host, rng, true);
  return { clock, host, room };
}

async function signedIn(ctx: ReturnType<typeof setup>, accountId: string) {
  const inbox: WorldServerMsg[] = [];
  const char = await ctx.host.open(accountId);
  const id = ctx.room.join(accountId, (m) => inbox.push(m), accountId, () => {}, char)!;
  const send = (m: unknown) => ctx.room.handle(id, JSON.stringify(m), (x) => inbox.push(x));
  let n = 0;
  return {
    char,
    inbox,
    send,
    at: (x: number, z: number) => send({ t: 'state', s: avatar(x, z) }),
    act: (a: unknown) => {
      const rid = ++n;
      send({ t: 'act', id: rid, a });
      return inbox.find((m) => m.t === 'actResult' && m.id === rid) as Extract<WorldServerMsg, { t: 'actResult' }>;
    },
    toasts: () => inbox.flatMap((m) => (m.t === 'char' ? m.events.filter((e) => e.type === 'toast').map((e) => (e as { text: string }).text) : [])),
  };
}

describe('found blueprints on the server', () => {
  it('drops a blueprint from a kill, then learns it, refuses a second learn, and forges from it', async () => {
    const ctx = setup(() => 0.01);
    const p = await signedIn(ctx, 'acct-bp');
    const scav = ctx.room.enemies.find((e) => e.spawn.type === 'scavenger')!;
    scav.brain.health = 1;
    p.at(scav.x, scav.z + 1);
    ctx.clock.advance(1100);
    p.send({ t: 'hit', enemyId: scav.id, attackId: 'light1', damage: 50, stagger: 0, guardBreak: false, crit: false });
    const inv = () => p.char.session.data.inventory;
    const scrolls = Object.entries(inv().scrolls ?? {});
    expect(scrolls).toHaveLength(1);
    const [scrollId, bp] = scrolls[0];
    expect(bp.context).toMatchObject({ area: 'trail', source: 'enemy', sourceId: 'scavenger' });
    expect(p.toasts().some((t) => t.startsWith('Found a blueprint:'))).toBe(true);

    expect(p.act({ k: 'learn', scroll: scrollId })).toMatchObject({ ok: true });
    expect(inv().learned?.[bp.id]).toBeTruthy();
    expect(inv().scrolls?.[scrollId]).toBeTruthy(); // the scroll stays
    expect(p.act({ k: 'learn', scroll: scrollId })).toMatchObject({ ok: false, message: "You've already learned this blueprint." });

    // Forge it at the anvil (quest past the forge introduction, enough mastery and materials).
    for (const m of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux'] as const) p.char.session.gather('test', m, 40, 0.6, {});
    p.char.session.data.progression.professions.blacksmithing.mastery = 60;
    p.at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    p.act({ k: 'talk', npc: 'orla' });
    p.at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    const r = p.act({ k: 'forge', req: { txId: 'tx-bp', blueprintId: bp.id, mode: 'quick', bufferQuantity: bp.piece.buffer.standardBatch } });
    expect(r).toMatchObject({ ok: true });
    expect(r.item?.blueprint?.id).toBe(bp.id);

    // Discarding the scroll keeps the blueprint learned.
    expect(p.act({ k: 'scrap', scroll: scrollId })).toMatchObject({ ok: true });
    expect(inv().scrolls?.[scrollId]).toBeUndefined();
    expect(inv().learned?.[bp.id]).toBeTruthy();
  });

  it("won't forge a blueprint the character hasn't learned, and refuses malformed blueprint actions", async () => {
    const ctx = setup(() => 0.99);
    const p = await signedIn(ctx, 'acct-bp2');
    p.at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    p.act({ k: 'talk', npc: 'orla' });
    p.at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    expect(p.act({ k: 'forge', req: { txId: 'tx-x', blueprintId: 'gbp_0123456789abcdef', mode: 'quick', bufferQuantity: 2 } })).toMatchObject({ ok: false, error: 'unknown_blueprint' });
    expect(p.act({ k: 'learn', scroll: 'scr-nope' })).toMatchObject({ ok: false });
    const before = ctx.room.stats.malformed;
    p.act({ k: 'learn', scroll: 42 });
    p.act({ k: 'scrap' });
    expect(ctx.room.stats.malformed).toBe(before + 2);
  });
});

describe('found blueprints: chests and other players', () => {
  it('sometimes finds a blueprint in a chest, the same way on every retry of the same search', async () => {
    const { Session, newSessionData, searchContainer } = await import('@alloy/session');
    const s = new Session(newSessionData(1234));
    let found = 0;
    for (let i = 0; i < 30; i++) {
      s.data.world.containers = { ...(s.data.world.containers ?? {}), 'forge-loft-chest': { readyAt: 0, n: i } };
      const before = Object.keys(s.data.inventory.scrolls ?? {}).length;
      expect(searchContainer(s, 'forge-loft-chest').ok).toBe(true);
      if (Object.keys(s.data.inventory.scrolls ?? {}).length > before) found++;
    }
    expect(found).toBeGreaterThan(0);
    const bp = Object.values(s.data.inventory.scrolls ?? {})[0];
    expect(bp.context).toMatchObject({ area: 'village', source: 'chest', sourceId: 'forge-loft-chest' });
    // The same search again finds the same thing.
    const again = new Session(newSessionData(1234));
    const first = Object.values(s.data.inventory.scrolls!)[0];
    let same = false;
    for (let i = 0; i < 30 && !same; i++) {
      again.data.world.containers = { 'forge-loft-chest': { readyAt: 0, n: i } };
      searchContainer(again, 'forge-loft-chest');
      same = Object.values(again.data.inventory.scrolls ?? {}).some((b) => b.id === first.id);
    }
    expect(same).toBe(true);
  });

  it("relays a found weapon's and shield's look to other players, and refuses a bad one", async () => {
    const ctx = setup(() => 0.99);
    const a = await signedIn(ctx, 'acct-look-a');
    const b = await signedIn(ctx, 'acct-look-b');
    a.send({ t: 'state', s: { ...avatar(0, 0), wpn: { bp: 'gbp_0123456789abcdef', spec: 'balanced', imb: false, rar: 'rare', lk: 'mace:spiked:quarry_glass' }, gr: { o: 'gbp_fedcba9876543210', or: 'epic', ol: 'shield:kite:quarry_glass' } } });
    b.at(1, 0);
    ctx.room.publish();
    const seen = b.inbox.filter((m) => m.t === 'players').flatMap((m) => (m as Extract<WorldServerMsg, { t: 'players' }>).list).find((x) => x.s.wpn?.lk);
    expect(seen?.s.wpn?.lk).toBe('mace:spiked:quarry_glass');
    expect(seen?.s.gr?.ol).toBe('shield:kite:quarry_glass');
    const bad = ctx.room.stats.malformed;
    a.send({ t: 'state', s: { ...avatar(0, 0), wpn: { bp: 'x', spec: 'balanced', imb: false, rar: 'rare', lk: '<img src=x>' } } });
    a.send({ t: 'state', s: { ...avatar(0, 0), gr: { o: 'x', ol: 'a:b:c:d' } } });
    expect(ctx.room.stats.malformed).toBe(bad + 2);
  });
});
