/** Resource node rules (traits, yield, charges, regrowth). Shared by the browser and the server. */
import { Rng, materialName } from '@alloy/item-gen';
import type { NodeState, SessionData } from '@alloy/save';
import { ALL_RESOURCE_NODES, type NodeDef } from '@alloy/world';

export const NODE_MAX_CHARGES = 3;
export const NODE_RESPAWN_SECONDS = 120;
/** How long the gather channel lasts in the browser. The server allows a little less between gathers. */
export const GATHER_SECONDS = 1.0;

export type NodeRuntime = NodeState;

const BY_ID = new Map(ALL_RESOURCE_NODES.map((n) => [n.id, n]));
export function nodeDef(id: string): NodeDef | undefined {
  return BY_ID.get(id);
}

/** Procedural deposit traits from the node seed (GDD 4.10; stretch: one variable ore property). */
export function nodeTraits(def: NodeDef): { quality: number; rich: boolean; label: string; traits: Record<string, number> } {
  const rng = new Rng(`node:${def.id}`);
  const r = rng.next();
  const rich = rng.next() < 0.2;
  const quality = Math.round((rich ? 0.85 + r * 0.15 : 0.32 + r * 0.46) * 1000) / 1000;
  const traitName = def.material === 'iron_ore' ? 'purity' : def.material === 'ironglass' ? 'conductivity' : 'grain';
  const label = `${rich ? 'Rich ' : ''}${materialName(def.material)} · ${traitName} ${Math.round(quality * 100)}%`;
  return { quality, rich, label, traits: { [traitName]: quality } };
}

export function nodeYield(def: NodeDef, gatherIndex: number): number {
  return new Rng(`yield:${def.id}:${gatherIndex}`).int(1, 2);
}

const FULL: Readonly<NodeState> = Object.freeze({ charges: NODE_MAX_CHARGES, respawnAt: 0, gathers: 0 });

/** A node's state in this character; untouched nodes are full and have no stored entry. */
export function nodeState(data: SessionData, id: string): Readonly<NodeState> {
  return data.world.nodes[id] ?? FULL;
}

/** The stored state of a node, created when it is first gathered. */
export function nodeStateForGather(data: SessionData, id: string): NodeState {
  return (data.world.nodes[id] ??= { charges: NODE_MAX_CHARGES, respawnAt: 0, gathers: 0 });
}

/**
 * Tidy a character's node states: drop entries for nodes that no longer exist and full ones
 * (they are the default). Keeps saves and server updates small now that the world has
 * hundreds of nodes. (Older saves stored every node.)
 */
export function ensureNodes(data: SessionData): void {
  for (const [id, rt] of Object.entries(data.world.nodes)) {
    if (!BY_ID.has(id) || (rt.charges >= NODE_MAX_CHARGES && rt.respawnAt === 0)) delete data.world.nodes[id];
  }
}

/** Refill depleted nodes whose regrow time (in play-time seconds) has passed. */
export function regrowNodes(data: SessionData): void {
  const now = data.playTime;
  for (const rt of Object.values(data.world.nodes)) {
    if (rt.charges < NODE_MAX_CHARGES && rt.respawnAt > 0 && now >= rt.respawnAt) {
      rt.charges = NODE_MAX_CHARGES;
      rt.respawnAt = 0;
    }
  }
}
