/**
 * Things in the world the player can walk up to and examine (E): lore, no game state.
 * Positions are in the world; `y` is the height of the thing above the floor it stands on.
 */
import { FORGE_PLAN, forgeToWorld } from '@alloy/world';
import type { Vec2 } from '@alloy/game-rules';

export interface Inspectable {
  id: string;
  pos: Vec2;
  /** Floor height the player stands on to examine it (0 = the ground). */
  floor: number;
  /** Interaction prompt. */
  label: string;
  title: string;
  subtitle: string;
  lines: string[];
}

/** Stand-in-front point: `out` metres from a wall-mounted thing toward the room. */
const front = (lx: number, lz: number, dx: number, dz: number): Vec2 => forgeToWorld(lx + dx, lz + dz);

export const INSPECTABLES: Inspectable[] = [
  {
    id: 'emberwake',
    pos: front(FORGE_PLAN.masterwork.x, FORGE_PLAN.masterwork.z, 0.6, 0),
    floor: 0,
    label: 'Examine Emberwake',
    title: 'Emberwake',
    subtitle: 'Masterwork longsword · forged by Master Smith Orla',
    lines: [
      'A long, slender blade of folded ironglass steel, its edge clean enough to catch the hearth-light like water. A thread of ember runs down the fuller, and it has never once gone cold.',
      'Orla forged it in a single winter, the year the Dormant Foundry fell silent, and has turned away every buyer since. The brass plate beneath it reads: "Steel remembers the hand that shaped it."',
      'Orla, without looking up from the anvil: "Masterwork isn\'t luck. Keep at the hammer, and one day your steel will sing like that."',
    ],
  },
  {
    id: 'watch_rack',
    pos: front(FORGE_PLAN.rack.x, FORGE_PLAN.rack.z, 0, 0.75),
    floor: 0,
    label: 'Examine the sword rack',
    title: "The Watch's Blades",
    subtitle: 'Iron longswords · forged for the village watch',
    lines: [
      "Plain, honest iron longswords, edge-ground and oiled, each stamped with Orla's mark below the guard. A dented watch shield hangs above them.",
      'These belong to the watch. Your own blade comes from the anvil.',
    ],
  },
];
