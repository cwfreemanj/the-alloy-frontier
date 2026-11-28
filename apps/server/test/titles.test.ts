/** Titles and scroll sales on the server: the title others see is the one the server knows. */
import { describe, expect, it } from 'vitest';
import { WORLD_PROTOCOL, type AvatarState, type WorldServerMsg } from '@alloy/protocol';
import { generateBlueprint } from '@alloy/item-gen';
import { NPCS } from '@alloy/world';
import { CharacterHost, MemoryCharacterStore } from '../src/characters';
import { WorldRoom } from '../src/worldRoom';

const avatar = (x: number, z: number, extra: Partial<AvatarState> = {}): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null, ...extra });

function setup() {
  const host = new CharacterHost(new MemoryCharacterStore(), () => 1_000_000);
  const room = new WorldRoom(() => 1_000_000, host, () => 0.99, true);
  const player = async (acct: string | null) => {
    const inbox: WorldServerMsg[] = [];
    const char = acct ? await host.open(acct) : null;
    let id: string;
    if (acct) id = room.join(acct, (m) => inbox.push(m), acct, () => {}, char)!;
    else id = room.handle(null, JSON.stringify({ t: 'hello', name: 'Guest', protocol: WORLD_PROTOCOL }), (m) => inbox.push(m))!;
    let n = 0;
    const send = (m: unknown) => room.handle(id, JSON.stringify(m), (x) => inbox.push(x));
    const act = (a: unknown) => {
      const rid = ++n;
      send({ t: 'act', id: rid, a });
      return inbox.find((m) => m.t === 'actResult' && m.id === rid) as Extract<WorldServerMsg, { t: 'actResult' }>;
    };
    return { id, char, inbox, send, act };
  };
  const seen = (inbox: WorldServerMsg[], id: string) =>
    inbox.filter((m) => m.t === 'players').flatMap((m) => (m as Extract<WorldServerMsg, { t: 'players' }>).list).filter((x) => x.id === id).at(-1)?.s;
  return { room, player, seen };
}

describe('titles and scroll sales on the server', () => {
  it('shows others the title the server knows, never one a client claims', async () => {
    const { room, player, seen } = setup();
    const a = await player('acct-title-a');
    const b = await player('acct-title-b');
    const g = await player(null);
    // Claimed but not earned: stripped.
    a.send({ t: 'state', s: avatar(0, 0, { ttl: 'master_smith' }) });
    g.send({ t: 'state', s: avatar(1, 1, { ttl: 'master_smith' }) });
    b.send({ t: 'state', s: avatar(2, 0) });
    room.publish();
    expect(seen(b.inbox, a.id)?.ttl).toBeUndefined();
    expect(seen(b.inbox, g.id)?.ttl).toBeUndefined();
    // Earned and chosen: shown, whatever the client sends.
    expect(a.act({ k: 'title', title: 'forgewright' })).toMatchObject({ ok: false });
    a.char!.session.data.progression.professions.blacksmithing.mastery = 55;
    expect(a.act({ k: 'title', title: 'forgewright' })).toMatchObject({ ok: true });
    a.send({ t: 'state', s: avatar(0, 0) });
    room.publish();
    expect(seen(b.inbox, a.id)?.ttl).toBe('forgewright');
    const bad = room.stats.malformed;
    a.act({ k: 'title', title: 'Not A Title!' });
    expect(room.stats.malformed).toBe(bad + 1);
  });

  it('sells a scroll to Bram only near him', async () => {
    const { player } = setup();
    const p = await player('acct-sell');
    const s = p.char!.session;
    const scroll = s.addBlueprint(generateBlueprint('srv-sell', { area: 'trail', source: 'chest', sourceId: 'x', level: 2 }))!;
    p.send({ t: 'state', s: avatar(-30, -30) });
    expect(p.act({ k: 'sellScroll', scroll })).toMatchObject({ ok: false, error: 'out_of_range' });
    p.send({ t: 'state', s: avatar(NPCS.bram.pos.x, NPCS.bram.pos.z) });
    const coins = s.data.inventory.coins;
    expect(p.act({ k: 'sellScroll', scroll })).toMatchObject({ ok: true });
    expect(s.data.inventory.coins).toBeGreaterThan(coins);
    expect(s.data.inventory.scrolls?.[scroll]).toBeUndefined();
  });
});
