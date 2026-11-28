/**
 * The Crafting branch on the server (AF-021): workbench recipes are made at the workbench, train
 * Crafting (not Smithing), and need the Crafting level the server knows.
 */
import { describe, expect, it } from 'vitest';
import type { AvatarState, WorldServerMsg } from '@alloy/protocol';
import { FORGE_ANVIL, NPCS, WORKBENCH } from '@alloy/world';
import { CharacterHost, MemoryCharacterStore } from '../src/characters';
import { WorldRoom } from '../src/worldRoom';

const avatar = (x: number, z: number): AvatarState => ({ x, y: 0, z, yaw: 0, spd: 0, ph: 'idle', atk: null, pr: 0, hp: 200, mhp: 200, wpn: null });

describe('crafting at the workbench', () => {
  it('crafts only at the workbench, trains Crafting, and checks the Crafting level', async () => {
    let t = 1_000_000;
    const host = new CharacterHost(new MemoryCharacterStore(), () => t);
    const room = new WorldRoom(() => t, host, () => 0.99, true);
    const inbox: WorldServerMsg[] = [];
    const char = await host.open('acct-craft');
    const id = room.join('acct-craft', (m) => inbox.push(m), 'acct-craft', () => {}, char)!;
    let n = 0;
    const send = (m: unknown) => room.handle(id, JSON.stringify(m), (x) => inbox.push(x));
    const act = (a: unknown) => {
      const rid = ++n;
      send({ t: 'act', id: rid, a });
      return inbox.find((m) => m.t === 'actResult' && m.id === rid) as Extract<WorldServerMsg, { t: 'actResult' }>;
    };
    const at = (x: number, z: number) => send({ t: 'state', s: avatar(x, z) });
    const s = char.session;
    for (const m of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux', 'emberleaf'] as const) s.gather('test', m, 30, 0.6, {});
    at(NPCS.orla.pos.x, NPCS.orla.pos.z);
    act({ k: 'talk', npc: 'orla' });
    const smith = s.data.progression.professions.blacksmithing.mastery;

    at(FORGE_ANVIL.x, FORGE_ANVIL.z);
    expect(act({ k: 'forge', req: { txId: 'c1', blueprintId: 'iron_band', mode: 'quick', bufferQuantity: 1 } })).toMatchObject({ ok: false, error: 'out_of_range', message: 'Move closer to the workbench.' });
    at(WORKBENCH.x, WORKBENCH.z);
    const r = act({ k: 'forge', req: { txId: 'c2', blueprintId: 'iron_band', mode: 'quick', bufferQuantity: 1 } });
    expect(r).toMatchObject({ ok: true });
    expect(r.item?.family).toBe('ring');
    expect(s.data.progression.professions.crafting?.xp).toBeGreaterThan(0);
    expect(s.data.progression.professions.blacksmithing.mastery).toBe(smith);
    // The Ironglass Focus Ring needs Crafting 5: the server's level (1 + one craft) isn't enough, whatever blacksmithing mastery is.
    expect(act({ k: 'forge', req: { txId: 'c4', blueprintId: 'ironglass_ring', mode: 'quick', bufferQuantity: 1 } })).toMatchObject({ ok: false, error: 'mastery_too_low' });
    s.data.progression.professions.crafting = { level: 10, xp: 0 };
    expect(act({ k: 'forge', req: { txId: 'c5', blueprintId: 'ironglass_ring', mode: 'quick', bufferQuantity: 1 } })).toMatchObject({ ok: true });
    // Crafting 10: the Jeweler perk can be chosen.
    expect(act({ k: 'perk', perk: 'jeweler' })).toMatchObject({ ok: true });
    t += 1000;
  });
});
