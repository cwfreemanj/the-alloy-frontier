/**
 * Character actions: the one place that decides what a player may do to their character.
 *
 * The server runs these authoritatively for signed-in players (with its own position,
 * clock and random numbers); the browser runs the same code locally for guests. Clients
 * only ever send the action (an intent), never its result.
 */
import { EQUIP_SLOTS, type EquipSlot, type ForgeRequest } from '@alloy/crafting';
import { ATTACKS, ATTRIBUTE_IDS, GATHER_PROFICIENCY_XP, PROFICIENCY_YIELD_BONUS, proficiencyFor, proficiencyLevel, damageTypeOf, mitigate, resistanceMultiplier, ATTRIBUTE_XP, ENEMIES, computeOutgoingHit, critContest, staggerContest, type AttackDefinition, type AttributeId, type AttributeLevels, weaponMasteryDamageBonus, weaponXpForHit, type AttackId, type Vec2 } from '@alloy/game-rules';
import { Rng, getBlueprint, materialName, type DamageType, type ItemInstance, type ToolKind, type WeaponStats } from '@alloy/item-gen';
import { FORGE_ANVIL, NPCS } from '@alloy/world';
import { NODE_RESPAWN_SECONDS, ensureNodes, nodeDef, nodeTraits, nodeYield, regrowNodes } from './nodes';
import type { Session, SessionEvent } from './session';

/** Interaction ranges in metres (what the browser offers the prompt at). */
export const RANGE = { npc: 3, anvil: 2.8, node: 2.6 } as const;

/** A forge request as a client sends it: the authority fills in the maker and the time. */
export type ClientForgeRequest = Omit<ForgeRequest, 'maker' | 'createdAt'>;

export type CharAction =
  | { k: 'gather'; node: string }
  | { k: 'buy'; stock: string; qty: number }
  | { k: 'forge'; req: ClientForgeRequest }
  | { k: 'equip'; item: string; slot?: EquipSlot }
  | { k: 'unequip'; slot: EquipSlot }
  | { k: 'discard'; item: string }
  | { k: 'talk'; npc: 'orla' }
  | { k: 'event'; ev: 'open_merchant' }
  | { k: 'allocate'; attr: AttributeId; n: number }
  | { k: 'respec' };

export interface ActionContext {
  /** Where the player is, as the authority knows it. Null = unknown (range-checked actions fail). */
  pos: Vec2 | null;
  /** Extra range allowed for latency (the server uses RANGE_SLACK; local play uses 0). */
  slack?: number;
}

export const RANGE_SLACK = 1.5;

export type ActionResult =
  | { ok: true; events: SessionEvent[]; item?: ItemInstance; gathered?: { node: string; qty: number } }
  | { ok: false; error: string; message: string; events: SessionEvent[] };

/** Run fn while recording every event the session emits. */
export function captureEvents<T>(s: Session, fn: () => T): { value: T; events: SessionEvent[] } {
  const events: SessionEvent[] = [];
  const off = s.on((e) => events.push(e));
  try {
    return { value: fn(), events };
  } finally {
    off();
  }
}

const near = (ctx: ActionContext, p: Vec2, r: number): boolean => !!ctx.pos && Math.hypot(ctx.pos.x - p.x, ctx.pos.z - p.z) <= r + (ctx.slack ?? 0);

/** Last warning toast in a list (the session reports refusals that way). */
const warnText = (events: SessionEvent[], fallback: string): string => {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'toast' && e.tone === 'warn') return e.text;
  }
  return fallback;
};

export function applyAction(s: Session, a: CharAction, ctx: ActionContext): ActionResult {
  const no = (error: string, message: string, events: SessionEvent[] = []): ActionResult => ({ ok: false, error, message, events });
  switch (a.k) {
    case 'gather': {
      const def = nodeDef(a.node);
      if (!def) return no('unknown_node', 'There is nothing to gather there.');
      if (!near(ctx, def.pos, RANGE.node)) return no('out_of_range', 'Move closer to gather.');
      ensureNodes(s.data);
      regrowNodes(s.data);
      const rt = s.data.world.nodes[def.id];
      if (rt.charges <= 0) return no('depleted', 'This deposit is depleted. It will replenish.');
      const kind = toolFor(def.material);
      const power = s.toolPower(kind);
      if (power <= 0) return no('no_tool', kind === 'mining' ? 'Put a pickaxe in your tool slot to mine this.' : 'Put a hatchet in your tool slot to cut this.');
      // Better tools (25% per point of power above 1) and proficiency (1% per level above 1)
      // add a chance of one extra unit.
      const prof = proficiencyFor(def.material);
      const chance = 0.25 * (power - 1) + PROFICIENCY_YIELD_BONUS * (proficiencyLevel(s.data.progression, prof) - 1);
      const bonus = new Rng(`tool:${def.id}:${rt.gathers}`).next() < chance ? 1 : 0;
      const qty = nodeYield(def, rt.gathers) + bonus;
      const t = nodeTraits(def);
      const { value: ok, events } = captureEvents(s, () => {
        if (!s.gather(def.id, def.material, qty, t.quality, t.traits)) return false;
        s.gainAttributes(ATTRIBUTE_XP.gather(def.material));
        s.gainProficiency(prof, GATHER_PROFICIENCY_XP);
        rt.charges--;
        rt.gathers++;
        if (rt.charges <= 0) rt.respawnAt = s.data.playTime + NODE_RESPAWN_SECONDS;
        s.notify({ type: 'toast', text: `+${qty} ${materialName(def.material)} (quality ${Math.round(t.quality * 100)}%)${t.rich ? ' · rich deposit!' : ''}`, tone: 'good' });
        return true;
      });
      if (!ok) return no('inventory', warnText(events, 'Could not gather.'), events);
      return { ok: true, events, gathered: { node: def.id, qty } };
    }
    case 'buy': {
      if (!near(ctx, NPCS.bram.pos, RANGE.npc)) return no('out_of_range', 'Move closer to the trader.');
      if (!Number.isInteger(a.qty) || a.qty < 1 || a.qty > 99) return no('invalid_quantity', 'Invalid quantity.');
      const { value: r, events } = captureEvents(s, () => s.buy(a.stock, a.qty));
      return r.ok ? { ok: true, events } : no(r.error, r.message, events);
    }
    case 'forge': {
      if (!near(ctx, FORGE_ANVIL, RANGE.anvil)) return no('out_of_range', 'Move closer to the forge.');
      if (!s.passed('commission')) return no('quest_gate', 'Speak with Master Smith Orla first.');
      const { value: r, events } = captureEvents(s, () => s.forge(a.req));
      return r.ok ? { ok: true, events, item: r.item } : no(r.error, r.message, events);
    }
    case 'equip': {
      if (a.slot !== undefined && !(EQUIP_SLOTS as readonly string[]).includes(a.slot)) return no('unknown_slot', 'Unknown slot.');
      const { value: ok, events } = captureEvents(s, () => s.equip(a.item, a.slot));
      return ok ? { ok: true, events } : no('equip', warnText(events, 'Could not equip that.'), events);
    }
    case 'unequip': {
      if (!(EQUIP_SLOTS as readonly string[]).includes(a.slot)) return no('unknown_slot', 'Unknown slot.');
      const { value: ok, events } = captureEvents(s, () => s.unequip(a.slot));
      return ok ? { ok: true, events } : no('unequip', warnText(events, 'Nothing to unequip.'), events);
    }
    case 'discard': {
      const { value: ok, events } = captureEvents(s, () => s.discard(a.item));
      return ok ? { ok: true, events } : no('discard', warnText(events, 'Could not discard that.'), events);
    }
    case 'talk': {
      if (a.npc !== 'orla') return no('unknown_npc', 'Nobody to talk to.');
      if (!near(ctx, NPCS.orla.pos, RANGE.npc)) return no('out_of_range', 'Move closer to talk.');
      const { events } = captureEvents(s, () => s.talk('orla'));
      return { ok: true, events };
    }
    case 'event': {
      if (a.ev !== 'open_merchant') return no('unknown_event', 'Unknown event.');
      if (!near(ctx, NPCS.bram.pos, RANGE.npc)) return no('out_of_range', 'Move closer to the trader.');
      const { events } = captureEvents(s, () => s.quest({ type: 'event', event: 'open_merchant' }));
      return { ok: true, events };
    }
    case 'allocate': {
      if (!(ATTRIBUTE_IDS as readonly string[]).includes(a.attr)) return no('unknown_attribute', 'Unknown attribute.');
      const { value: r, events } = captureEvents(s, () => s.allocate(a.attr, a.n));
      return r.ok ? { ok: true, events } : no(r.error, r.message, events);
    }
    case 'respec': {
      const { events } = captureEvents(s, () => {
        const n = s.respec();
        s.notify({ type: 'toast', text: n > 0 ? `${n} stat points refunded` : 'No stat points to refund', tone: n > 0 ? 'good' : 'info' });
      });
      return { ok: true, events };
    }
    default:
      return no('unknown_action', 'Unknown action.');
  }
}

/** Rewards for a kill this character took part in: coins, adventurer XP, drops, quest progress. */
export function rewardKill(s: Session, enemyType: string, enemyId: string, rng: () => number): { coins: number; flux: number; events: SessionEvent[] } {
  const def = ENEMIES[enemyType];
  if (!def) return { coins: 0, flux: 0, events: [] };
  let coins = 0;
  let flux = 0;
  const { events } = captureEvents(s, () => {
    const [lo, hi] = def.coins;
    coins = lo + Math.floor(rng() * (hi - lo + 1));
    if (coins > 0) s.addCoins(coins);
    s.gainAdventurer(def.xp);
    if (def.kind === 'melee' && rng() < 0.5) {
      flux = 1 + Math.floor(rng() * 2);
      s.gather(`drop:${enemyId}`, 'binding_flux', flux, 0.5, {});
    }
    s.gainAttributes(ATTRIBUTE_XP.kill(def.kind));
    s.recordKill(enemyType);
  });
  return { coins, flux, events };
}

/**
 * Outgoing damage of one of the player's hits, from the character's own equipped weapon
 * and mastery (before the target's defense). Null if the attack isn't allowed.
 */
export function playerHit(s: Session, attackId: string, rng: () => number, target?: AttributeLevels): { damage: number; stagger: number; crit: boolean; guardBreak: boolean } | null {
  const atk = (ATTACKS as Record<string, (typeof ATTACKS)[AttackId] | undefined>)[attackId];
  if (!atk) return null;
  const w = s.equipped();
  if (atk.id === 'storm_arc' && !w?.result.imbuements.includes('storm_arc')) return null;
  return { ...hitAgainst(s, atk, rng(), target), guardBreak: !!atk.guardBreak };
}

/** Bare-handed stats when nothing is equipped. */
export const UNARMED: WeaponStats = { damage: 8, attackSpeed: 1, stagger: 8, staminaCostMultiplier: 1, critChance: 0 };

/** Which tool a material needs. */
export const toolFor = (material: string): ToolKind => (material === 'ironwood' ? 'woodcutting' : 'mining');

export interface CharacterStats {
  maxHealth: number;
  maxStamina: number;
  /** Total armor from equipped gear (incoming hits: mitigate(damage, defense)). */
  defense: number;
  /** Total damage bonus: weapon mastery + Strength (0.1 = +10%). */
  damageBonus: number;
  /** The equipped weapon's stats with attribute bonuses applied (crit from Dexterity). */
  weapon: WeaponStats;
}

/** Derived character stats: one implementation for the server, guests and the character screen. */
export function characterStats(s: Session): CharacterStats {
  const b = s.bonuses();
  const base = s.equipped()?.result ?? UNARMED;
  let defense = 0;
  let health = 0;
  let stamina = 0;
  const pos = (v: number | undefined) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0);
  for (const { item } of s.gear()) {
    defense += pos(item.result.defense);
    health += pos(item.result.bonuses?.maxHealth);
    stamina += pos(item.result.bonuses?.maxStamina);
  }
  return {
    maxHealth: Math.round(b.maxHealth + health),
    maxStamina: Math.round(b.maxStamina + stamina),
    defense: Math.round(defense * 10) / 10,
    damageBonus: weaponMasteryDamageBonus(s.weaponLevel) + b.damageBonus,
    weapon: { ...base, critChance: Math.min(1, base.critChance + b.critChance) },
  };
}

/**
 * One of the player's hits against a target with the given attributes (none: no contest).
 * Strength against theirs scales stagger; Dexterity against theirs shifts crit chance.
 */
export function hitAgainst(s: Session, atk: AttackDefinition, critRoll: number, target?: AttributeLevels): { damage: number; stagger: number; crit: boolean } {
  const st = characterStats(s);
  if (!target) return computeOutgoingHit(st.weapon, atk, st.damageBonus, critRoll);
  const t = s.attributeTotals();
  const weapon = { ...st.weapon, critChance: Math.max(0, Math.min(1, st.weapon.critChance + critContest(t.dexterity, target.dexterity))) };
  const out = computeOutgoingHit(weapon, atk, st.damageBonus, critRoll);
  return { ...out, stagger: out.stagger * staggerContest(t.strength, target.strength) };
}

/** The damage type of the equipped weapon (unarmed: blunt). */
export function weaponDamageType(s: Session): DamageType {
  const w = s.equipped();
  return w ? damageTypeOf(w.family, getBlueprint(w.blueprintId)?.damageType) : 'blunt';
}

/**
 * Damage that lands on an enemy: defense first (mitigate), then its resistance to the
 * weapon's damage type. The same function runs on the server and for guests.
 */
export function damageAgainst(s: Session, rawDamage: number, enemy: { defense: number; resist?: Partial<Record<DamageType, number>> }): { damage: number; type: DamageType; multiplier: number } {
  const type = weaponDamageType(s);
  const multiplier = resistanceMultiplier(enemy.resist, type);
  return { damage: mitigate(rawDamage, enemy.defense) * multiplier, type, multiplier };
}

/** Weapon mastery and attribute XP for a landed hit (none from dummies). */
export function rewardHit(s: Session, enemyType: string, damage: number, attackId?: string, crit = false): SessionEvent[] {
  const def = ENEMIES[enemyType];
  if (!def) return [];
  const atk = attackId ? (ATTACKS as Record<string, (typeof ATTACKS)[AttackId] | undefined>)[attackId] : undefined;
  return captureEvents(s, () => {
    s.gainWeaponXp(weaponXpForHit(def.kind, damage));
    if (def.kind !== 'dummy') s.gainAttributes(ATTRIBUTE_XP.hit(!!atk?.heavy, crit, damage));
  }).events;
}

/** Attribute XP for an enemy attack aimed at the player (raw damage, before dodge or block). */
export function rewardHitTaken(s: Session, rawDamage: number): SessionEvent[] {
  return captureEvents(s, () => s.gainAttributes(ATTRIBUTE_XP.hitTaken(rawDamage))).events;
}
