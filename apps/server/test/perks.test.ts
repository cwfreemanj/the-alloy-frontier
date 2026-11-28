/**
 * Perk choices on the server (proficiency tree, step 2): chosen and re-picked through checked actions,
 * applied by the server, never taken from the client.
 */
import { describe, expect, it } from 'vitest';
import { POTION_COOLDOWN } from '@alloy/crafting';
import { PERK_EFFECTS } from '@alloy/game-rules';
import type { AvatarState, WorldServerMsg } from '@alloy/protocol';
import { FORGE_ANVIL, HERB_NODES, NPCS } from '@alloy/world';
import { CharacterHost, MemoryCharacterStore } from '../src/characters';
import { WorldRoom } from '../src/worldRoom';

const avatar = (x: number, z: number): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null });

async function setup(accountId: string) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const host = new CharacterHost(new MemoryCharacterStore(), clock.now);
  const room = new WorldRoom(clock.now, host, () => 0.99, true);
  const inbox: WorldServerMsg[] = [];
  const char = await host.open(accountId);
  const id = room.join(accountId, (m) => inbox.push(m), accountId, () => {}, char)!;
  let n = 0;
  const send = (m: unknown) => room.handle(id, JSON.stringify(m), (x) => inbox.push(x));
  const act = (a: unknown) => {
    const rid = ++n;
    send({ t: 'act', id: rid, a });
    return inbox.find((m) => m.t === 'actResult' && m.id === rid) as Extract<WorldServerMsg, { t: 'actResult' }>;
  };
  const at = (x: number, z: number) => send({ t: 'state', s: avatar(x, z) });
  return { room, char, s: char.session, act, at, inbox };
}

describe('perks on the server', () => {
  it('chooses a perk once per milestone; re-picking needs Orla and a fee that doubles', async () => {
    const { s, act, at } = await setup('acct-perk');
    expect(act({ k: 'perk', perk: 'flux_saver' })).toMatchObject({ ok: false }); // Smithing 20 not reached
    expect(act({ k: 'perk', perk: 'weaponsmith' })).toMatchObject({ ok: true });
    expect(act({ k: 'perk', perk: 'armorsmith' })).toMatchObject({ ok: false });
    expect(s.data.progression.perks).toEqual({ 'smithing:10': 'weaponsmith' });

    at(FORGE_ANVIL.x + 30, FORGE_ANVIL.z + 30);
    expect(act({ k: 'perkRespec', branch: 'smithing' })).toMatchObject({ ok: false, error: 'out_of_range' });
    at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    s.data.inventory.coins = 200; // a new character has 40
    const coins = s.data.inventory.coins;
    expect(act({ k: 'perkRespec', branch: 'smithing' })).toMatchObject({ ok: true });
    expect(s.data.inventory.coins).toBe(coins - 50);
    expect(s.data.progression.perks).toEqual({});
    expect(act({ k: 'perk', perk: 'armorsmith' })).toMatchObject({ ok: true });
    s.data.inventory.coins = 99;
    expect(act({ k: 'perkRespec', branch: 'smithing' })).toMatchObject({ ok: false }); // now 100
  });

  it('applies Weaponsmith from the server’s own copy of the character, not from the request', async () => {
    const { s, act, at } = await setup('acct-perk-forge');
    for (const m of ['iron_ore', 'ironwood', 'binding_flux'] as const) s.gather('test', m, 30, 0.6, {});
    at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    act({ k: 'talk', npc: 'orla' });
    at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    // A client claiming a perk it doesn't have gets nothing from it.
    const fake = act({ k: 'forge', req: { txId: 'tx-1', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2, maker: { id: 'x', name: 'x', mastery: 999, perks: ['weaponsmith'] } } });
    if (fake.ok) expect(fake.item?.forge.perks).toBeUndefined();
    expect(act({ k: 'perk', perk: 'weaponsmith' })).toMatchObject({ ok: true });
    const mastery = s.smithMastery;
    const r = act({ k: 'forge', req: { txId: 'tx-2', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 } });
    expect(r).toMatchObject({ ok: true });
    expect(r.item?.forge.perks).toEqual(['weaponsmith']);
    expect(r.item?.forge.mastery).toBe(mastery); // the server's mastery, not the 999 claimed above
  });

  it('Alchemy perks: Distiller brews one more, Brewer and Quick Hands change potions, Herbal Lore picks one more herb', async () => {
    const { s, act, at, inbox } = await setup('acct-perk-alch');
    s.data.progression.professions.alchemy = { level: 20, xp: 0 };
    s.gather('test', 'emberleaf', 40, 0.5, {});
    expect(act({ k: 'perk', perk: 'distiller' })).toMatchObject({ ok: true });
    expect(act({ k: 'perk', perk: 'quick_hands' })).toMatchObject({ ok: true });
    const salves = () => s.data.inventory.lots.filter((l) => l.materialId === 'healing_salve').reduce((a, l) => a + l.quantity, 0);
    expect(act({ k: 'brew', recipe: 'healing_salve', qty: 2 })).toMatchObject({ ok: true });
    expect(salves()).toBe(2 + PERK_EFFECTS.distillerExtra);
    expect(act({ k: 'consume', item: 'healing_salve' })).toMatchObject({ ok: true });
    expect(s.data.player.potionReadyAt! - s.data.playTime).toBe(POTION_COOLDOWN - PERK_EFFECTS.quickHandsSeconds);

    // Re-pick Alchemy to take Brewer and Herbal Lore instead.
    at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    s.data.inventory.coins = 500;
    expect(act({ k: 'perkRespec', branch: 'alchemy' })).toMatchObject({ ok: true });
    expect(act({ k: 'perk', perk: 'brewer' })).toMatchObject({ ok: true });
    expect(act({ k: 'perk', perk: 'herbal_lore' })).toMatchObject({ ok: true });
    s.data.player.potionReadyAt = 0;
    expect(act({ k: 'consume', item: 'healing_salve' })).toMatchObject({ ok: true });
    const used = inbox.flatMap((m) => (m.t === 'char' ? m.events : [])).filter((e) => e.type === 'consumed') as Array<{ heal: number }>;
    expect(used.at(-1)!.heal).toBeGreaterThan(used[0].heal); // Brewer: stronger

    const herb = HERB_NODES[0];
    at(herb.pos.x, herb.pos.z);
    const before = s.totals().emberleaf;
    const r = act({ k: 'gather', node: herb.id });
    expect(r).toMatchObject({ ok: true });
    expect(s.totals().emberleaf - before).toBeGreaterThanOrEqual(2); // 1 + Herbal Lore
  });

  it('refuses malformed perk actions', async () => {
    const { room, act } = await setup('acct-perk-bad');
    const before = room.stats.malformed;
    act({ k: 'perk' });
    act({ k: 'perkRespec', branch: 'fishing' });
    expect(room.stats.malformed).toBe(before + 2);
  });
});
