/**
 * Character actions: the one place that decides what a player may do to their character.
 *
 * The server runs these authoritatively for signed-in players (with its own position,
 * clock and random numbers); the browser runs the same code locally for guests. Clients
 * only ever send the action (an intent), never its result.
 */
import type { ForgeRequest } from '@alloy/crafting';
import { ATTACKS, ENEMIES, computeOutgoingHit, weaponMasteryDamageBonus, weaponXpForHit, type AttackId, type Vec2 } from '@alloy/game-rules';
import { materialName, type ItemInstance } from '@alloy/item-gen';
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
  | { k: 'equip'; item: string }
  | { k: 'discard'; item: string }
  | { k: 'talk'; npc: 'orla' }
  | { k: 'event'; ev: 'open_merchant' };

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
      const qty = nodeYield(def, rt.gathers);
      const t = nodeTraits(def);
      const { value: ok, events } = captureEvents(s, () => s.gather(def.id, def.material, qty, t.quality, t.traits));
      if (!ok) return no('inventory', warnText(events, 'Could not gather.'), events);
      rt.charges--;
      rt.gathers++;
      if (rt.charges <= 0) rt.respawnAt = s.data.playTime + NODE_RESPAWN_SECONDS;
      events.unshift({ type: 'toast', text: `+${qty} ${materialName(def.material)} (quality ${Math.round(t.quality * 100)}%)${t.rich ? ' · rich deposit!' : ''}`, tone: 'good' });
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
      const { value: ok, events } = captureEvents(s, () => s.equip(a.item));
      return ok ? { ok: true, events } : no('equip', warnText(events, 'Could not equip that.'), events);
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
    s.recordKill(enemyType);
  });
  return { coins, flux, events };
}

/**
 * Outgoing damage of one of the player's hits, from the character's own equipped weapon
 * and mastery (before the target's defense). Null if the attack isn't allowed.
 */
export function playerHit(s: Session, attackId: string, rng: () => number): { damage: number; stagger: number; crit: boolean; guardBreak: boolean } | null {
  const atk = (ATTACKS as Record<string, (typeof ATTACKS)[AttackId] | undefined>)[attackId];
  if (!atk) return null;
  const w = s.equipped();
  if (atk.id === 'storm_arc' && !w?.result.imbuements.includes('storm_arc')) return null;
  const stats = w?.result ?? { damage: 8, attackSpeed: 1, stagger: 8, staminaCostMultiplier: 1, critChance: 0 };
  const out = computeOutgoingHit(stats, atk, weaponMasteryDamageBonus(s.weaponLevel), rng());
  return { ...out, guardBreak: !!atk.guardBreak };
}

/** Weapon mastery XP for a landed hit (none from dummies). */
export function rewardHit(s: Session, enemyType: string, damage: number): SessionEvent[] {
  const def = ENEMIES[enemyType];
  if (!def) return [];
  return captureEvents(s, () => s.gainWeaponXp(weaponXpForHit(def.kind, damage))).events;
}
