/**
 * Server-owned characters for signed-in players: actions are applied by the server with
 * its own position, clock and random numbers; kill rewards, weapon XP and hit damage come
 * from the server's copy of the character; characters are saved and reloaded by the server.
 */
import { describe, expect, it } from 'vitest';
import { ENEMIES, mitigate } from '@alloy/game-rules';
import { WORLD_PROTOCOL, type AvatarState, type WorldServerMsg } from '@alloy/protocol';
import { Session, characterStats, newSessionData, playerHit } from '@alloy/session';
import { ENEMY_SPAWNS, FORGE_ANVIL, FORGE_PLAN, NPCS, RESOURCE_NODES, RESPAWN_POINT, containerDef, terrainHeight } from '@alloy/world';
import { CharacterHost, MemoryCharacterStore, SAVE_DELAY_MS } from '../src/characters';
import { WorldRoom } from '../src/worldRoom';

const avatar = (x: number, z: number, extra: Partial<AvatarState> = {}): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null, ...extra });
const ore = RESOURCE_NODES.find((n) => n.material === 'iron_ore')!;
const scav = ENEMY_SPAWNS.find((s) => s.type === 'scavenger')!;

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const store = new MemoryCharacterStore();
  const host = new CharacterHost(store, clock.now);
  // 0.99: no crits, top of coin range. allowTeleport: these tests jump between places; the speed check has its own tests.
  const room = new WorldRoom(clock.now, host, () => 0.99, true);
  return { clock, store, host, room };
}

/** A signed-in player in the room, driven directly (the transport does this after the token check). */
async function signedIn(ctx: ReturnType<typeof setup>, accountId: string) {
  const inbox: WorldServerMsg[] = [];
  const char = await ctx.host.open(accountId);
  const id = ctx.room.join(accountId, (m) => inbox.push(m), accountId, () => {}, char)!;
  let n = 0;
  const send = (m: unknown) => ctx.room.handle(id, JSON.stringify(m), (x) => inbox.push(x));
  return {
    id,
    char,
    inbox,
    at: (x: number, z: number, extra: Partial<AvatarState> = {}) => send({ t: 'state', s: avatar(x, z, extra) }),
    act: (a: unknown) => {
      const rid = ++n;
      send({ t: 'act', id: rid, a });
      return inbox.filter((m) => m.t === 'actResult').find((m) => m.t === 'actResult' && m.id === rid) as Extract<WorldServerMsg, { t: 'actResult' }>;
    },
    hit: (enemyId: string, attackId: string, damage: number) => send({ t: 'hit', enemyId, attackId, damage, stagger: 0, guardBreak: false, crit: false }),
    lastChar: () => [...inbox].reverse().find((m) => m.t === 'char') as Extract<WorldServerMsg, { t: 'char' }> | undefined,
  };
}

describe('server-owned characters', () => {
  it('raises the trail while a strong player lingers there: notice, enemy levels, scaled stats', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-adapt');
    p.char.session.data.progression.adventurer.rank = 8;
    const scav = ctx.room.enemies.find((e) => e.spawn.type === 'scavenger')!;
    expect(scav.level).toBe(ENEMIES.scavenger.level);
    // On the Ironwood Trail, out of the scavengers' sight, for 15 minutes.
    for (let i = 0; i < 450; i++) {
      p.at(-10, 95);
      ctx.clock.advance(2000);
      ctx.room.step(2);
    }
    const notices = p.inbox.filter((m) => m.t === 'notice');
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0]).toMatchObject({ t: 'notice' });
    expect(scav.level).toBe(ENEMIES.scavenger.level + 3);
    expect(scav.def.maxHealth).toBeGreaterThan(ENEMIES.scavenger.maxHealth);
    expect(scav.brain.health).toBe(scav.def.maxHealth);
    ctx.room.publish();
    const sent = p.inbox.filter((m) => m.t === 'enemies').flatMap((m) => (m.t === 'enemies' ? m.list : [])).filter((x) => x.id === scav.id);
    expect(sent.at(-1)?.lv).toBe(ENEMIES.scavenger.level + 3);
    // The quarry and foundry are untouched.
    expect(ctx.room.enemies.find((e) => e.spawn.type === 'sentinel')!.level).toBe(ENEMIES.sentinel.level);
    expect((ctx.room.observer.snapshot() as Record<string, { players: number }>).trail.players).toBe(1);
  });

  it('searches containers with the server position, including the height of the loft', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-search');
    const chest = containerDef('forge-loft-chest')!;
    const g = terrainHeight(chest.pos.x, chest.pos.z);
    p.at(chest.pos.x + 0.5, chest.pos.z, { y: g });
    expect(p.act({ k: 'search', id: chest.id })).toMatchObject({ ok: false, error: 'out_of_range' }); // on the floor below
    p.at(chest.pos.x + 0.5, chest.pos.z, { y: g + FORGE_PLAN.loft.y });
    const coins = p.char.session.data.inventory.coins;
    expect(p.act({ k: 'search', id: chest.id }).ok).toBe(true);
    expect(p.lastChar()!.data.inventory.coins).toBeGreaterThan(coins);
    expect(p.act({ k: 'search', id: chest.id })).toMatchObject({ ok: false, error: 'searched' });
  });

  it('sends the character on join, and applies actions only where the player is', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-1');
    expect(p.lastChar()?.data.inventory).toBeTruthy();

    expect(p.act({ k: 'gather', node: ore.id })).toMatchObject({ ok: false, error: 'out_of_range' }); // no position yet
    p.at(ore.pos.x + 30, ore.pos.z);
    expect(p.act({ k: 'gather', node: ore.id })).toMatchObject({ ok: false, error: 'out_of_range' });
    p.at(ore.pos.x + 1, ore.pos.z);
    expect(p.act({ k: 'gather', node: ore.id }).ok).toBe(true);
    const got = p.lastChar()!.data.inventory.lots.filter((l) => l.materialId === 'iron_ore').reduce((a, l) => a + l.quantity, 0);
    expect(got).toBeGreaterThan(0);
    expect(p.lastChar()!.events.some((e) => e.type === 'toast' && e.text.includes('Iron'))).toBe(true);

    // Gathering is paced like the browser's 1-second channel.
    expect(p.act({ k: 'gather', node: ore.id })).toMatchObject({ ok: false, error: 'too_fast' });
    ctx.clock.advance(1000);
    expect(p.act({ k: 'gather', node: ore.id }).ok).toBe(true);
  });

  it('refuses actions from guests and from downed players', async () => {
    const ctx = setup();
    const inbox: WorldServerMsg[] = [];
    const gid = ctx.room.handle(null, JSON.stringify({ t: 'hello', name: 'G', protocol: WORLD_PROTOCOL }), (m) => inbox.push(m))!;
    ctx.room.handle(gid, JSON.stringify({ t: 'act', id: 1, a: { k: 'gather', node: ore.id } }), (m) => inbox.push(m));
    expect(inbox.find((m) => m.t === 'actResult')).toMatchObject({ ok: false, error: 'guest' });

    const p = await signedIn(ctx, 'acct-2');
    p.at(ore.pos.x, ore.pos.z, { hp: 0, ph: 'dead' });
    expect(p.act({ k: 'gather', node: ore.id })).toMatchObject({ ok: false, error: 'dead' });
    expect(ctx.room.stats.rejectedActs).toBe(2);
  });

  it('forges at the anvil with the server-side character only after the quest allows it', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-3');
    p.char.session.gather('test', 'iron_ore', 3, 0.6, {});
    p.char.session.gather('test', 'ironwood', 1, 0.6, {});
    const forge = { k: 'forge', req: { txId: 'tx-a', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 } };
    p.at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    expect(p.act(forge)).toMatchObject({ ok: false, error: 'quest_gate' });
    p.at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    expect(p.act({ k: 'talk', npc: 'orla' }).ok).toBe(true);
    p.at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    const r = p.act(forge);
    expect(r.ok).toBe(true);
    expect(r.item?.blueprintId).toBe('iron_longsword');
    expect(p.lastChar()!.data.inventory.items[r.item!.itemId]).toBeTruthy();
  });

  it('forges and equips armor and a mace on the server: defense counts, the quest only counts weapons (forge expansion)', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-armor');
    for (const m of ['iron_ore', 'ironwood', 'binding_flux'] as const) p.char.session.gather('test', m, 30, 0.6, {});
    p.char.session.data.progression.professions.blacksmithing.mastery = 5;
    p.at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    expect(p.act({ k: 'talk', npc: 'orla' }).ok).toBe(true);
    const step = p.char.session.data.quest.stepIndex;
    p.at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    const made: Record<string, string> = {};
    for (const bp of ['iron_helmet', 'iron_shield', 'iron_chestplate', 'iron_platelegs', 'iron_mace']) {
      const r = p.act({ k: 'forge', req: { txId: `tx-${bp}`, blueprintId: bp, mode: 'quick', bufferQuantity: 3 } });
      expect(r, bp).toMatchObject({ ok: true });
      made[bp] = r.item!.itemId;
      if (bp !== 'iron_mace') {
        // Armor isn't the quest's blade: forging it doesn't move the quest.
        expect(p.char.session.data.quest.stepIndex).toBe(step);
        expect(r.item!.result.defense).toBeGreaterThan(0);
      }
    }
    const before = characterStats(p.char.session).defense;
    for (const bp of ['iron_helmet', 'iron_shield', 'iron_chestplate', 'iron_platelegs']) expect(p.act({ k: 'equip', item: made[bp] }).ok).toBe(true);
    const eq = p.lastChar()!.data.inventory.equipped;
    expect(eq).toMatchObject({ head: made.iron_helmet, offhand: made.iron_shield, chest: made.iron_chestplate, legs: made.iron_platelegs });
    const items = p.char.session.inventory.items;
    const sum = ['iron_helmet', 'iron_shield', 'iron_chestplate', 'iron_platelegs'].reduce((a, bp) => a + items[made[bp]].result.defense!, 0);
    expect(characterStats(p.char.session).defense).toBe(before + sum);
    // The mace goes in the main hand and hits blunt.
    expect(p.act({ k: 'equip', item: made.iron_mace }).ok).toBe(true);
    expect(p.char.session.weaponFamily).toBe('mace');
  });

  it('relays worn gear (shield, helmet) to other players, and refuses anything else in it', async () => {
    const ctx = setup();
    const a = await signedIn(ctx, 'acct-gear-a');
    const b = await signedIn(ctx, 'acct-gear-b');
    a.at(0, 0, { gr: { o: 'iron_shield', or: 'rare', h: 'iron_helmet', hr: 'common' } });
    b.at(1, 0);
    ctx.room.publish();
    const seen = b.inbox.filter((m) => m.t === 'players').flatMap((m) => (m as Extract<WorldServerMsg, { t: 'players' }>).list).find((x) => x.id === a.id);
    expect(seen?.s.gr).toEqual({ o: 'iron_shield', or: 'rare', h: 'iron_helmet', hr: 'common' });
    const bad = ctx.room.stats.malformed;
    a.at(0, 0, { gr: { o: '<script>' } } as never);
    a.at(0, 0, { gr: { o: 'iron_shield', extra: 'x' } } as never);
    expect(ctx.room.stats.malformed).toBe(bad + 2);
  });

  it('rejects malformed or invented actions at the protocol boundary', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-4');
    const before = ctx.room.stats.malformed;
    for (const a of [{ k: 'give', item: 'x' }, { k: 'buy', stock: 'binding_flux', qty: 1e6 }, { k: 'forge', req: { txId: 'x', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2, evidence: { heat: 'hot', strikes: 'lots' } } }])
      p.act(a);
    expect(ctx.room.stats.malformed).toBe(before + 3);
  });

  it('computes hit damage from the server-side weapon, ignoring the reported damage', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-5');
    const e = ctx.room.enemies.find((x) => x.id === scav.id)!;
    p.at(e.x + 1.2, e.z);
    const hp = e.brain.health;
    p.hit(e.id, 'light1', 200);
    // Unarmed fists are blunt; scavengers resist blunt a little.
    const expected = mitigate(playerHit(new Session(newSessionData(0)), 'light1', () => 0.99)!.damage, ENEMIES.scavenger.defense) * ENEMIES.scavenger.resist!.blunt!;
    expect(hp - e.brain.health).toBeCloseTo(expected, 1); // enemies round damage to 0.1
    // The server counts damage by type and family (unarmed here: blunt fists).
    expect(ctx.room.stats.damageByType.blunt).toBeCloseTo(expected, 1);
    expect(ctx.room.stats.damageByFamily.unarmed).toBeCloseTo(expected, 1);
    expect(expected).toBeLessThan(20);
    // An ability the server-side weapon doesn't have is refused outright.
    const before = ctx.room.stats.rejectedHits;
    p.hit(e.id, 'storm_arc', 50);
    expect(ctx.room.stats.rejectedHits).toBe(before + 1);
  });

  it('refuses skills a character has not learned, and reuse during the cooldown', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-skill');
    p.char.session.talk('orla');
    const e = ctx.room.enemies.find((x) => x.id === scav.id)!;
    p.at(e.x + 1.2, e.z);
    const before = ctx.room.stats.rejectedHits;
    p.hit(e.id, 'lunging_thrust', 10);
    expect(ctx.room.stats.rejectedHits).toBe(before + 1); // not learned
    while (p.char.session.weaponLevel < 3) p.char.session.gainWeaponXp(50);
    ctx.clock.advance(1000);
    p.hit(e.id, 'lunging_thrust', 10);
    expect(ctx.room.stats.rejectedHits).toBe(before + 1); // learned: accepted
    ctx.clock.advance(2000);
    p.hit(e.id, 'lunging_thrust', 10);
    expect(ctx.room.stats.rejectedHits).toBe(before + 2); // 6 s cooldown
    ctx.clock.advance(6000);
    p.hit(e.id, 'lunging_thrust', 10);
    expect(ctx.room.stats.rejectedHits).toBe(before + 2);
  });

  it('rolls kill rewards on the server for signed-in contributors', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-6');
    p.char.session.talk('orla'); // the starter longsword: weapon XP needs a weapon in hand
    const coins = p.char.session.inventory.coins;
    const e = ctx.room.enemies.find((x) => x.id === scav.id)!;
    p.at(e.x + 1.2, e.z);
    for (let i = 0; i < 60 && e.brain.alive; i++) {
      ctx.clock.advance(1000); // stay under the hit rate limit
      p.hit(e.id, i % 2 ? 'light1' : 'heavy', 1);
    }
    expect(e.brain.alive).toBe(false);
    const data = p.lastChar()!.data;
    expect(data.inventory.coins).toBe(coins + ENEMIES.scavenger.coins[1]);
    expect(data.stats.kills.scavenger).toBe(1);
    expect(data.progression.weaponMastery.longsword.xp + data.progression.weaponMastery.longsword.level).toBeGreaterThan(1);
    // Attributes grow from the hits the server accepted and from the kill.
    const at = data.progression.attributes!;
    expect(at.dexterity.xp + at.dexterity.level).toBeGreaterThan(1);
    expect(at.strength.xp + at.strength.level).toBeGreaterThan(1);
    expect(at.endurance.xp + at.endurance.level).toBeGreaterThan(1);
  });

  it('lets a signed-in player spend only the stat points the server says they earned', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-pts');
    expect(p.act({ k: 'allocate', attr: 'strength', n: 3 })).toMatchObject({ ok: false, error: 'no_points' });
    p.char.session.gainAdventurer(100); // rank 2: 3 points
    expect(p.act({ k: 'allocate', attr: 'strength', n: 3 }).ok).toBe(true);
    expect(p.lastChar()!.data.progression.allocated!.strength).toBe(3);
    expect(p.act({ k: 'allocate', attr: 'strength', n: 1 })).toMatchObject({ ok: false, error: 'no_points' });
    // Malformed requests never reach the rules.
    const before = ctx.room.stats.malformed;
    p.act({ k: 'allocate', attr: 'luck', n: 1 });
    p.act({ k: 'allocate', attr: 'strength', n: -5 });
    expect(ctx.room.stats.malformed).toBe(before + 2);
    expect(p.act({ k: 'respec' }).ok).toBe(true);
    expect(p.lastChar()!.data.progression.allocated!.strength).toBe(0);
  });

  it('checks equipment changes and the tool requirement on the server', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-gear');
    p.at(ore.pos.x, ore.pos.z);
    expect(p.act({ k: 'unequip', slot: 'tool' }).ok).toBe(true);
    expect(p.lastChar()!.data.inventory.equipped.tool).toBeNull();
    expect(p.act({ k: 'gather', node: ore.id })).toMatchObject({ ok: false, error: 'no_tool' });
    const pick = Object.values(p.char.session.inventory.items).find((i) => i.blueprintId === 'worn_pickaxe')!;
    expect(p.act({ k: 'equip', item: pick.itemId, slot: 'head' })).toMatchObject({ ok: false });
    expect(p.act({ k: 'equip', item: pick.itemId }).ok).toBe(true);
    expect(p.act({ k: 'gather', node: ore.id }).ok).toBe(true);
    const before = ctx.room.stats.malformed;
    p.act({ k: 'equip', item: pick.itemId, slot: 'pocket' });
    p.act({ k: 'unequip', slot: 42 });
    expect(ctx.room.stats.malformed).toBe(before + 2);
  });

  it('brews and uses potions on the server, with the cooldown on the server clock', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-potion');
    p.char.session.gather('test', 'emberleaf', 4, 0.5, {});
    expect(p.act({ k: 'brew', recipe: 'healing_salve', qty: 2 }).ok).toBe(true);
    expect(p.act({ k: 'consume', item: 'healing_salve' }).ok).toBe(true);
    expect(p.lastChar()!.events.some((e) => e.type === 'consumed')).toBe(true);
    expect(p.act({ k: 'consume', item: 'healing_salve' })).toMatchObject({ ok: false, error: 'cooldown' });
    const before = ctx.room.stats.malformed;
    p.act({ k: 'brew', recipe: 'healing_salve', qty: 500 });
    expect(ctx.room.stats.malformed).toBe(before + 1);
  });

  it('grows Vitality from the enemy attacks the server aims at a signed-in player', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-vit');
    const e = ctx.room.enemies.find((x) => x.id === scav.id)!;
    for (let i = 0; i < 20 * 20 && ctx.room.stats.enemyHitsOnPlayers === 0; i++) {
      p.at(e.x + 1, e.z);
      ctx.clock.advance(50);
      ctx.room.step(0.05);
    }
    expect(ctx.room.stats.enemyHitsOnPlayers).toBeGreaterThan(0);
    expect(p.char.session.attributes.vitality.xp).toBeGreaterThan(0);
  });

  it('saves changed characters after a delay and on leaving, and reloads them', async () => {
    const ctx = setup();
    const p = await signedIn(ctx, 'acct-7');
    p.char.session.addCoins(5);
    ctx.host.changed(p.char);
    ctx.host.flushDue();
    expect(ctx.store.writes).toBe(0);
    ctx.clock.advance(SAVE_DELAY_MS);
    ctx.host.flushDue();
    await ctx.host.flushAll();
    expect(ctx.store.writes).toBe(1);

    p.char.session.addCoins(7);
    ctx.host.changed(p.char);
    const coins = p.char.session.inventory.coins;
    ctx.room.leave(p.id);
    expect(ctx.host.loadedCount).toBe(0);
    await ctx.host.flushAll();
    const again = await ctx.host.open('acct-7');
    expect(again.session.inventory.coins).toBe(coins);
  });

  it('shares one character between a new sign-in and the old connection it replaces', async () => {
    const ctx = setup();
    const a = await signedIn(ctx, 'acct-8');
    const b = await signedIn(ctx, 'acct-8'); // signs a out of the world
    expect(b.char).toBe(a.char);
    expect(a.inbox.some((m) => m.t === 'error' && m.error === 'signed_in_elsewhere')).toBe(true);
    expect(ctx.host.loadedCount).toBe(1);
    ctx.room.leave(b.id);
    expect(ctx.host.loadedCount).toBe(0);
  });

  it('tells outdated clients to reload, and advances play time only while in the world', async () => {
    const ctx = setup();
    const inbox: WorldServerMsg[] = [];
    ctx.room.handle(null, JSON.stringify({ t: 'hello', name: 'Old', protocol: WORLD_PROTOCOL - 1 }), (m) => inbox.push(m));
    expect(inbox).toEqual([{ t: 'error', error: 'outdated_client' }]);
    const p = await signedIn(ctx, 'acct-9');
    const t0 = p.char.session.data.playTime;
    ctx.room.step(1);
    expect(p.char.session.data.playTime).toBe(t0); // still on the title screen
    p.at(0, 0);
    ctx.room.step(1);
    expect(p.char.session.data.playTime).toBe(t0 + 1);
  });
});

describe('movement speed check', () => {
  /** A room with the speed check on (the default). */
  function checked() {
    let t = 1_000_000;
    const clock = { now: () => t, advance: (ms: number) => (t += ms) };
    const host = new CharacterHost(new MemoryCharacterStore(), clock.now);
    const room = new WorldRoom(clock.now, host, () => 0.99);
    return { clock, host, room };
  }
  const corrections = (inbox: WorldServerMsg[]) => inbox.filter((m) => m.t === 'correct') as Array<Extract<WorldServerMsg, { t: 'correct' }>>;

  it('accepts sprinting speed and refuses a teleport, keeping the last good position', async () => {
    const ctx = checked();
    const p = await signedIn(ctx as never, 'acct-run');
    const start = { ...p.char.session.data.player };
    p.at(start.x, start.z);
    // 2 s of sprinting in 100 ms steps (7.6 m/s).
    for (let i = 1; i <= 20; i++) {
      ctx.clock.advance(100);
      p.at(start.x + 0.76 * i, start.z);
    }
    expect(ctx.room.stats.speedRejected).toBe(0);
    expect(p.char.session.data.player.x).toBeCloseTo(start.x + 15.2, 1);
    ctx.clock.advance(100);
    p.at(start.x + 200, start.z);
    expect(ctx.room.stats.speedRejected).toBe(1);
    expect(corrections(p.inbox).at(-1)).toMatchObject({ x: expect.closeTo(start.x + 15.2, 1) });
    // Range checks use the accepted position: Orla is far away, and stays far away.
    expect(p.char.session.data.player.x).toBeCloseTo(start.x + 15.2, 1);
  });

  it('refuses sustained speed hacks even in small steps', async () => {
    const ctx = checked();
    const p = await signedIn(ctx as never, 'acct-fast');
    const start = { ...p.char.session.data.player };
    p.at(start.x, start.z);
    for (let i = 1; i <= 40; i++) {
      ctx.clock.advance(100);
      p.at(start.x + 2 * i, start.z); // 20 m/s
    }
    expect(ctx.room.stats.speedRejected).toBeGreaterThan(10);
    // Corrections are throttled to two a second.
    expect(corrections(p.inbox).length).toBeLessThanOrEqual(9);
  });

  it('allows a dodge plus lag burst, and respawning at the respawn point after a death', async () => {
    const ctx = checked();
    const p = await signedIn(ctx as never, 'acct-dodge');
    const start = { ...p.char.session.data.player };
    p.at(start.x, start.z);
    ctx.clock.advance(1000);
    p.at(start.x + 10, start.z); // a second of lag arriving at once
    expect(ctx.room.stats.speedRejected).toBe(0);
    p.at(start.x + 10, start.z, { ph: 'dead', hp: 0 });
    ctx.clock.advance(50);
    p.at(RESPAWN_POINT.x, RESPAWN_POINT.z);
    expect(ctx.room.stats.speedRejected).toBe(0);
  });

  it("puts a signed-in player back where the server saved them if they connect somewhere else", async () => {
    const ctx = checked();
    const p = await signedIn(ctx as never, 'acct-tp');
    const saved = { ...p.char.session.data.player };
    p.at(saved.x + 60, saved.z + 60);
    expect(ctx.room.stats.speedRejected).toBe(1);
    expect(corrections(p.inbox)[0]).toMatchObject({ x: saved.x, z: saved.z });
  });
});

describe('movement height check', () => {
  function checked() {
    let t = 1_000_000;
    const clock = { now: () => t, advance: (ms: number) => (t += ms) };
    const host = new CharacterHost(new MemoryCharacterStore(), clock.now);
    const room = new WorldRoom(clock.now, host, () => 0.99);
    return { clock, host, room };
  }

  it('accepts walking and jumping heights, refuses flying and sinking', async () => {
    const ctx = checked();
    const p = await signedIn(ctx as never, 'acct-fly');
    const at = { ...p.char.session.data.player };
    const ground = terrainHeight(at.x, at.z);
    p.at(at.x, at.z, { y: ground });
    ctx.clock.advance(100);
    p.at(at.x, at.z, { y: ground + 0.95 }); // top of a jump
    expect(ctx.room.stats.heightRejected).toBe(0);
    ctx.clock.advance(100);
    p.at(at.x, at.z, { y: ground + 12 }); // flying
    ctx.clock.advance(100);
    p.at(at.x, at.z, { y: ground - 8 }); // under the world
    expect(ctx.room.stats.heightRejected).toBe(2);
    expect(p.inbox.some((m) => m.t === 'correct')).toBe(true);
  });
});
