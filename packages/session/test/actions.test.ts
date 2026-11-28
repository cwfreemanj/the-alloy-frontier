import { afterEach, describe, expect, it } from 'vitest';
import { grantItem } from '@alloy/crafting';
import { BLUEPRINTS, type BlueprintDefinition } from '@alloy/item-gen';
import { FORGE_ANVIL, GROVE_NODES, HERB_NODES, NPCS, RESOURCE_NODES } from '@alloy/world';
import { NODE_MAX_CHARGES, NODE_RESPAWN_SECONDS, RANGE_SLACK, Session, applyAction, ensureNodes, nodeState, characterStats, damageAgainst, hitAgainst, newSessionData, playerHit, rewardHit, rewardHitTaken, rewardKill } from '../src';
import { ATTACKS, BASE_MAX_HEALTH, ENEMIES, adventurerXpToNext, attributeXpToNext, mitigate, GATHER_PROFICIENCY_XP, PROFICIENCY_MAX, proficiencyXpToNext } from '@alloy/game-rules';

const fresh = () => new Session(newSessionData(1000));
const ore = RESOURCE_NODES.find((n) => n.material === 'iron_ore')!;
const at = (p: { x: number; z: number }) => ({ pos: { x: p.x, z: p.z } });
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('kill rewards by level', () => {
  it('pays more XP for a levelled-up enemy', () => {
    const a = fresh();
    const b = fresh();
    rewardKill(a, 'scavenger', 'scav-1', () => 0.5);
    rewardKill(b, 'scavenger', 'scav-1', () => 0.5, ENEMIES.scavenger.level + 2);
    const xp = (s: Session) => s.data.progression.adventurer.xp + s.data.progression.adventurer.rank * 1000;
    expect(xp(b)).toBeGreaterThan(xp(a));
  });
});

describe('applyAction', () => {
  it('gathers only in range, with server-decided quantity and quality', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: { x: ore.pos.x + 10, z: ore.pos.z } })).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: null })).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'gather', node: 'nope' }, at(ore.pos))).toMatchObject({ ok: false, error: 'unknown_node' });
    const r = applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos));
    expect(r.ok).toBe(true);
    expect(s.totals().iron_ore).toBe(r.ok ? r.gathered!.qty : -1);
    expect(s.data.world.nodes[ore.id].charges).toBe(NODE_MAX_CHARGES - 1);
  });

  it('allows the latency slack only when the context grants it', () => {
    const s = fresh();
    const just = { x: ore.pos.x + 2.6 + RANGE_SLACK - 0.1, z: ore.pos.z };
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: just }).ok).toBe(false);
    expect(applyAction(s, { k: 'gather', node: ore.id }, { pos: just, slack: RANGE_SLACK }).ok).toBe(true);
  });

  it('depletes a node and regrows it after the respawn time', () => {
    const s = fresh();
    for (let i = 0; i < NODE_MAX_CHARGES; i++) expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos)).ok).toBe(true);
    expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos))).toMatchObject({ ok: false, error: 'depleted' });
    s.data.playTime += NODE_RESPAWN_SECONDS + 1;
    expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos)).ok).toBe(true);
  });

  it('gates forging on range and on the quest, and forges with the session\'s own mastery', () => {
    const s = fresh();
    s.gather('test', 'iron_ore', 3, 0.6, {});
    s.gather('test', 'ironwood', 1, 0.6, {});
    const req = { txId: 'tx-1', blueprintId: 'iron_longsword', mode: 'quick' as const, bufferQuantity: 2 };
    expect(applyAction(s, { k: 'forge', req }, at(FORGE_ANVIL))).toMatchObject({ ok: false, error: 'quest_gate' });
    expect(applyAction(s, { k: 'talk', npc: 'orla' }, at({ x: 50, z: 50 }))).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'talk', npc: 'orla' }, at(NPCS.orla.pos)).ok).toBe(true);
    expect(applyAction(s, { k: 'forge', req }, at({ x: 0, z: 0 }))).toMatchObject({ ok: false, error: 'out_of_range' });
    const r = applyAction(s, { k: 'forge', req }, at(FORGE_ANVIL));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.item?.blueprintId).toBe('iron_longsword');
      // The maker's mastery comes from the character (before this forge's XP), not from the request.
      expect(r.item?.forge.mastery).toBeLessThanOrEqual(s.smithMastery);
    }
    expect(s.totals().iron_ore).toBe(0);
    // Same transaction again: no second sword, no extra materials consumed.
    const before = Object.keys(s.inventory.items).length;
    applyAction(s, { k: 'forge', req }, at(FORGE_ANVIL));
    expect(Object.keys(s.inventory.items).length).toBe(before);
  });

  it('refuses a masterwork forge without replayable evidence', () => {
    const s = fresh();
    s.talk('orla');
    s.gather('test', 'iron_ore', 3, 0.6, {});
    s.gather('test', 'ironwood', 1, 0.6, {});
    const r = applyAction(s, { k: 'forge', req: { txId: 'tx-m', blueprintId: 'iron_longsword', mode: 'masterwork', bufferQuantity: 2 } }, at(FORGE_ANVIL));
    expect(r).toMatchObject({ ok: false, error: 'missing_evidence' });
    expect(s.totals().iron_ore).toBe(3);
  });

  it('buys only next to the trader and never into negative coins', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'buy', stock: 'binding_flux', qty: 5 }, at({ x: 0, z: 0 }))).toMatchObject({ ok: false, error: 'out_of_range' });
    expect(applyAction(s, { k: 'buy', stock: 'binding_flux', qty: 0 }, at(NPCS.bram.pos))).toMatchObject({ ok: false, error: 'invalid_quantity' });
    const coins = s.inventory.coins;
    expect(applyAction(s, { k: 'buy', stock: 'binding_flux', qty: 5 }, at(NPCS.bram.pos)).ok).toBe(true);
    expect(s.inventory.coins).toBe(coins - 5);
    expect(applyAction(s, { k: 'buy', stock: 'steel_longsword', qty: 99 }, at(NPCS.bram.pos)).ok).toBe(false);
    expect(s.inventory.coins).toBe(coins - 5);
  });

  it('equips and discards only owned items', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'equip', item: 'itm-fake' }, { pos: null }).ok).toBe(false);
    s.talk('orla'); // grants the worn longsword and equips it
    const id = s.equipped()!.itemId;
    expect(applyAction(s, { k: 'discard', item: id }, { pos: null })).toMatchObject({ ok: false, error: 'discard' });
  });
});

describe('rewards', () => {
  it('rolls kill rewards from the given random source and records the kill', () => {
    const s = fresh();
    const coins = s.inventory.coins;
    const r = rewardKill(s, 'scavenger', 'scav-1', seq(0.99, 0.1, 0.99));
    expect(r.coins).toBe(6);
    expect(r.flux).toBe(2);
    expect(s.inventory.coins).toBe(coins + 6);
    expect(s.data.stats.kills.scavenger).toBe(1);
    expect(rewardKill(s, 'nonsense', 'x', Math.random)).toEqual({ coins: 0, flux: 0, events: [] });
  });

  it('computes hit damage from the equipped weapon, and refuses abilities the weapon lacks', () => {
    const s = fresh();
    const bare = playerHit(s, 'light1', () => 0.99)!;
    s.talk('orla');
    const armed = playerHit(s, 'light1', () => 0.99)!;
    expect(armed.damage).toBeGreaterThan(bare.damage);
    expect(playerHit(s, 'storm_arc', () => 0.5)).toBeNull();
    expect(playerHit(s, 'not-an-attack', () => 0.5)).toBeNull();
    expect(playerHit(s, 'guardbreaker', () => 0.99)!.guardBreak).toBe(true);
  });
});

describe('attributes in the session', () => {
  it('fills attributes into an old save that has none', () => {
    const d = newSessionData(1000);
    delete d.progression.attributes;
    const s = new Session(d);
    expect(s.attributes.strength).toEqual({ level: 1, xp: 0 });
    expect(characterStats(s).maxHealth).toBe(BASE_MAX_HEALTH);
  });

  it('grows Strength and Endurance from mining, through the shared action', () => {
    const s = fresh();
    applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos));
    expect(s.attributes.strength.xp).toBeGreaterThan(0);
    expect(s.attributes.endurance.xp).toBeGreaterThan(0);
  });

  it('grows Dexterity from light hits and Strength from heavy ones, never from dummies', () => {
    const s = fresh();
    rewardHit(s, 'scavenger', 20, 'light1');
    expect(s.attributes.dexterity.xp).toBeGreaterThan(0);
    rewardHit(s, 'scavenger', 20, 'heavy');
    expect(s.attributes.strength.xp).toBeGreaterThan(0);
    const before = JSON.stringify(s.attributes);
    rewardHit(s, 'dummy', 50, 'heavy');
    expect(JSON.stringify(s.attributes)).toBe(before);
  });

  it('announces a level-up and applies its bonus to damage and health', () => {
    const s = fresh();
    s.talk('orla');
    const base = playerHit(s, 'light1', () => 0.99)!.damage;
    const ups: unknown[] = [];
    s.on((e) => e.type === 'progress' && e.kind === 'attribute' && ups.push(e));
    s.gainAttributes([['strength', attributeXpToNext(1)]]);
    expect(ups).toEqual([{ type: 'progress', kind: 'attribute', attr: 'strength', levels: 1 }]);
    expect(playerHit(s, 'light1', () => 0.99)!.damage).toBeGreaterThan(base);
    for (let i = 0; i < 40; i++) rewardHitTaken(s, 100);
    expect(characterStats(s).maxHealth).toBeGreaterThan(BASE_MAX_HEALTH);
  });
});

describe('stat points in the session', () => {
  const ranked = (rank: number) => {
    const s = fresh();
    for (let r = 1; r < rank; r++) s.gainAdventurer(adventurerXpToNext(r));
    return s;
  };

  it('has no points at rank 1 and 3 per rank after', () => {
    expect(fresh().unspentPoints).toBe(0);
    expect(ranked(3).unspentPoints).toBe(6);
  });

  it('spends points only through the action, within what was earned, and respecs for free', () => {
    const s = ranked(3);
    expect(applyAction(s, { k: 'allocate', attr: 'strength', n: 7 }, { pos: null })).toMatchObject({ ok: false, error: 'no_points' });
    expect(applyAction(s, { k: 'allocate', attr: 'nonsense' as never, n: 1 }, { pos: null })).toMatchObject({ ok: false, error: 'unknown_attribute' });
    expect(applyAction(s, { k: 'allocate', attr: 'strength', n: 0 }, { pos: null }).ok).toBe(false);
    expect(applyAction(s, { k: 'allocate', attr: 'strength', n: 4 }, { pos: null }).ok).toBe(true);
    expect(applyAction(s, { k: 'allocate', attr: 'vitality', n: 2 }, { pos: null }).ok).toBe(true);
    expect(s.unspentPoints).toBe(0);
    expect(s.attributeTotals().strength).toBe(5);
    expect(characterStats(s).maxHealth).toBe(BASE_MAX_HEALTH + 10);
    const r = applyAction(s, { k: 'respec' }, { pos: null });
    expect(r.ok).toBe(true);
    expect(s.unspentPoints).toBe(6);
    expect(s.attributeTotals().strength).toBe(1);
  });

  it('fills an empty allocation into old saves', () => {
    const d = newSessionData(1000);
    delete d.progression.allocated;
    expect(new Session(d).allocated).toEqual({ strength: 0, dexterity: 0, vitality: 0, endurance: 0 });
  });

  it('contests hits against the target: more Strength staggers harder, more Dexterity crits more', () => {
    const s = ranked(11); // 30 points
    s.talk('orla');
    const weak = { strength: 1, dexterity: 1, vitality: 1, endurance: 1 };
    const tough = { strength: 20, dexterity: 20, vitality: 20, endurance: 20 };
    const atk = ATTACKS.light1;
    expect(hitAgainst(s, atk, 0.99, weak).stagger).toBeGreaterThan(hitAgainst(s, atk, 0.99, tough).stagger);
    applyAction(s, { k: 'allocate', attr: 'dexterity', n: 30 }, { pos: null });
    // A roll just above the weapon's own crit chance crits only thanks to the Dexterity contest.
    const roll = characterStats(s).weapon.critChance + 0.05;
    expect(hitAgainst(s, atk, roll, ENEMIES.scavenger.attributes).crit).toBe(true);
    expect(hitAgainst(s, atk, roll, tough).crit).toBe(false);
  });
});

describe('equipment in the session', () => {
  const wood = RESOURCE_NODES.find((n) => n.material === 'ironwood')!;

  it('gives every character a starter pickaxe (equipped) and hatchet', () => {
    const s = fresh();
    const tools = Object.values(s.inventory.items).filter((i) => i.family === 'tool');
    expect(tools.map((t) => t.blueprintId).sort()).toEqual(['worn_hatchet', 'worn_pickaxe']);
    expect(s.inventory.items[s.inventory.equipped.tool!].blueprintId).toBe('worn_pickaxe');
    // Loading the same character again grants nothing more.
    expect(Object.keys(new Session(s.data).inventory.items).length).toBe(2);
  });

  it('needs the right tool in the tool slot to gather', () => {
    const s = fresh();
    expect(applyAction(s, { k: 'gather', node: wood.id }, at(wood.pos))).toMatchObject({ ok: false, error: 'no_tool' });
    const hatchet = Object.values(s.inventory.items).find((i) => i.blueprintId === 'worn_hatchet')!;
    expect(applyAction(s, { k: 'equip', item: hatchet.itemId }, { pos: null }).ok).toBe(true);
    expect(s.inventory.equipped.tool).toBe(hatchet.itemId);
    expect(applyAction(s, { k: 'gather', node: wood.id }, at(wood.pos)).ok).toBe(true);
    expect(applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos))).toMatchObject({ ok: false, error: 'no_tool' });
    expect(applyAction(s, { k: 'unequip', slot: 'tool' }, { pos: null }).ok).toBe(true);
    expect(applyAction(s, { k: 'gather', node: wood.id }, at(wood.pos))).toMatchObject({ ok: false, error: 'no_tool' });
    expect(applyAction(s, { k: 'unequip', slot: 'nope' as never }, { pos: null })).toMatchObject({ ok: false, error: 'unknown_slot' });
  });

  it('adds gear defense and bonuses to the character', () => {
    const s = fresh();
    s.talk('orla');
    const sword = s.equipped()!;
    const before = characterStats(s);
    expect(before.defense).toBe(0);
    // Stand-in: give the equipped sword armor-like bonuses (the real ones come from the equipment algorithm).
    sword.result.defense = 20;
    sword.result.bonuses = { maxHealth: 15, attributes: { strength: 3 } };
    const after = characterStats(s);
    expect(after.defense).toBe(20);
    expect(after.maxHealth).toBe(before.maxHealth + 15);
    expect(s.attributeTotals().strength).toBe(4);
    expect(s.gearAttributes().strength).toBe(3);
  });
});

describe('weapon families', () => {
  const withMace = () => {
    BLUEPRINTS.test_mace = { ...(BLUEPRINTS.worn_longsword as BlueprintDefinition), id: 'test_mace', name: 'Test Mace', family: 'mace' };
    const s = fresh();
    s.talk('orla'); // longsword in hand
    const r = grantItem(s.inventory, 'grant-test-mace', 'test_mace', 1000);
    if (!r.ok || !r.item) throw new Error('grant failed');
    s.data.inventory = r.inventory;
    return { s, mace: r.item.itemId };
  };
  afterEach(() => delete BLUEPRINTS.test_mace);

  it('gives weapon XP to the family in hand, and none unarmed', () => {
    const { s, mace } = withMace();
    rewardHit(s, 'scavenger', 30, 'light1');
    expect(s.data.progression.weaponMastery.longsword.xp).toBeGreaterThan(0);
    s.equip(mace);
    expect(s.weaponFamily).toBe('mace');
    rewardHit(s, 'scavenger', 30, 'light1');
    expect(s.data.progression.weaponMastery.mace?.xp).toBeGreaterThan(0);
    s.unequip('weapon');
    const before = JSON.stringify(s.data.progression.weaponMastery);
    rewardHit(s, 'scavenger', 30, 'light1');
    expect(JSON.stringify(s.data.progression.weaponMastery)).toBe(before);
  });

  it('applies defense, then the enemy resistance to the weapon damage type', () => {
    const { s, mace } = withMace();
    const sentinel = ENEMIES.sentinel;
    const slash = damageAgainst(s, 100, sentinel);
    expect(slash.type).toBe('slash');
    s.equip(mace);
    const blunt = damageAgainst(s, 100, sentinel);
    expect(blunt.type).toBe('blunt');
    expect(blunt.damage).toBeGreaterThan(slash.damage);
    expect(blunt.damage).toBeCloseTo(mitigate(100, sentinel.defense) * sentinel.resist!.blunt!, 5);
  });
});

describe('gathering proficiencies', () => {
  it('mining grows from ore, woodcutting from ironwood, through the shared gather action', () => {
    const s = fresh();
    const wood = RESOURCE_NODES.find((n) => n.material === 'ironwood')!;
    applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos));
    expect(s.data.progression.professions.mining?.xp).toBe(GATHER_PROFICIENCY_XP);
    const hatchet = Object.values(s.inventory.items).find((i) => i.blueprintId === 'worn_hatchet')!;
    s.equip(hatchet.itemId);
    applyAction(s, { k: 'gather', node: wood.id }, at(wood.pos));
    expect(s.data.progression.professions.woodcutting?.xp).toBe(GATHER_PROFICIENCY_XP);
    expect(s.data.progression.professions.herbalism).toBeUndefined();
  });

  it('levels up with an event and caps at the maximum', () => {
    const s = fresh();
    const ups: unknown[] = [];
    s.on((e) => e.type === 'progress' && e.kind === 'proficiency' && ups.push(e));
    s.gainProficiency('mining', proficiencyXpToNext(1));
    expect(ups).toEqual([{ type: 'progress', kind: 'proficiency', proficiency: 'mining', levels: 1 }]);
    for (let i = 0; i < 2000; i++) s.gainProficiency('mining', 1000);
    expect(s.data.progression.professions.mining).toEqual({ level: PROFICIENCY_MAX, xp: 0 });
  });
});

describe('grove trees and node storage', () => {
  it('makes every ironwood tree of the scenery gatherable', () => {
    expect(GROVE_NODES.length).toBeGreaterThan(200);
    const tree = GROVE_NODES[123];
    const s = fresh();
    const hatchet = Object.values(s.inventory.items).find((i) => i.blueprintId === 'worn_hatchet')!;
    s.equip(hatchet.itemId);
    expect(applyAction(s, { k: 'gather', node: tree.id }, at(tree.pos)).ok).toBe(true);
    expect(s.totals().ironwood).toBeGreaterThan(0);
  });

  it('stores state only for nodes that were gathered, and tidies full ones on load', () => {
    const s = fresh();
    expect(Object.keys(s.data.world.nodes)).toEqual([]);
    expect(nodeState(s.data, ore.id).charges).toBe(NODE_MAX_CHARGES);
    applyAction(s, { k: 'gather', node: ore.id }, at(ore.pos));
    expect(Object.keys(s.data.world.nodes)).toEqual([ore.id]);
    // An old save stored every node, full: tidied away (the gathered one stays).
    s.data.world.nodes['ore-old'] = { charges: 1, respawnAt: 0, gathers: 1 };
    s.data.world.nodes[GROVE_NODES[0].id] = { charges: NODE_MAX_CHARGES, respawnAt: 0, gathers: 0 };
    ensureNodes(s.data);
    expect(Object.keys(s.data.world.nodes)).toEqual([ore.id]);
  });
});

describe('combat skills in the session', () => {
  const toLevel = (s: Session, level: number) => {
    while (s.weaponLevel < level) s.gainWeaponXp(50);
  };

  it('learns Lunging Thrust at longsword 3, announces it and puts it on key 1', () => {
    const s = fresh();
    s.talk('orla'); // longsword in hand
    const learned: unknown[] = [];
    s.on((e) => e.type === 'skill_learned' && learned.push(e));
    toLevel(s, 3);
    expect(learned).toEqual([{ type: 'skill_learned', skill: 'lunging_thrust' }]);
    expect(s.skillBar).toEqual(['lunging_thrust', null, null, null]);
    expect(s.usableSkills()).toEqual(['lunging_thrust']);
  });

  it('moves skills on the bar only through the action, and only learned ones', () => {
    const s = fresh();
    s.talk('orla');
    expect(applyAction(s, { k: 'skillbar', slot: 0, skill: 'lunging_thrust' }, { pos: null })).toMatchObject({ ok: false, error: 'not_learned' });
    toLevel(s, 6);
    expect(applyAction(s, { k: 'skillbar', slot: 3, skill: 'lunging_thrust' }, { pos: null }).ok).toBe(true);
    expect(s.skillBar).toEqual([null, 'final_slash', null, 'lunging_thrust']);
    expect(applyAction(s, { k: 'skillbar', slot: 3, skill: null }, { pos: null }).ok).toBe(true);
    expect(s.skillBar[3]).toBeNull();
    expect(applyAction(s, { k: 'skillbar', slot: 9, skill: null }, { pos: null }).ok).toBe(false);
  });

  it('refuses a skill hit when it is not learned or its weapon is not in hand', () => {
    const s = fresh();
    s.talk('orla');
    expect(playerHit(s, 'lunging_thrust', () => 0.5)).toBeNull();
    toLevel(s, 3);
    expect(playerHit(s, 'lunging_thrust', () => 0.5)).not.toBeNull();
    s.unequip('weapon');
    expect(playerHit(s, 'lunging_thrust', () => 0.5)).toBeNull();
  });

  it('Lunging Thrust deals piercing damage', () => {
    const s = fresh();
    s.talk('orla');
    expect(damageAgainst(s, 100, ENEMIES.scavenger, 'lunging_thrust').type).toBe('pierce');
    expect(damageAgainst(s, 100, ENEMIES.scavenger, 'light1').type).toBe('slash');
  });
});

describe('herbs and potions', () => {
  it('picks Emberleaf by hand (no tool) and trains Herbalism', () => {
    const s = fresh();
    s.unequip('tool');
    const herb = HERB_NODES[0];
    expect(applyAction(s, { k: 'gather', node: herb.id }, at(herb.pos)).ok).toBe(true);
    expect(s.totals().emberleaf).toBeGreaterThan(0);
    expect(s.data.progression.professions.herbalism?.xp).toBeGreaterThan(0);
  });

  it('trains Alchemy by brewing (not Herbalism), and a higher Alchemy level brews stronger potions', () => {
    const s = fresh();
    s.gather('test', 'emberleaf', 20, 0.5, {});
    expect(applyAction(s, { k: 'brew', recipe: 'healing_salve', qty: 2 }, { pos: null }).ok).toBe(true);
    expect(s.data.progression.professions.alchemy?.xp).toBeGreaterThan(0);
    expect(s.data.progression.professions.herbalism).toBeUndefined();
    const q = (id: string) => s.data.inventory.lots.filter((l) => l.materialId === id).map((l) => l.quality);
    expect(q('healing_salve')).toEqual([0.5]);
    s.data.progression.professions.alchemy = { level: 51, xp: 0 };
    expect(applyAction(s, { k: 'brew', recipe: 'stamina_tonic', qty: 1 }, { pos: null }).ok).toBe(true);
    expect(q('stamina_tonic')).toEqual([0.7]); // 0.5 herbs + 50 levels x 0.004
  });

  it('brews and uses potions through actions, one potion per cooldown', () => {
    const s = fresh();
    s.gather('test', 'emberleaf', 6, 0.7, {});
    expect(applyAction(s, { k: 'brew', recipe: 'healing_salve', qty: 2 }, { pos: null }).ok).toBe(true);
    expect(s.totals().healing_salve).toBe(2);
    const used: unknown[] = [];
    s.on((e) => e.type === 'consumed' && used.push(e));
    expect(applyAction(s, { k: 'consume', item: 'healing_salve' }, { pos: null }).ok).toBe(true);
    expect(used).toEqual([{ type: 'consumed', item: 'healing_salve', heal: 102, stamina: 0 }]);
    expect(applyAction(s, { k: 'consume', item: 'healing_salve' }, { pos: null })).toMatchObject({ ok: false, error: 'cooldown' });
    s.data.playTime += 9;
    expect(applyAction(s, { k: 'consume', item: 'healing_salve' }, { pos: null }).ok).toBe(true);
    expect(s.totals().healing_salve).toBe(0);
  });
});
