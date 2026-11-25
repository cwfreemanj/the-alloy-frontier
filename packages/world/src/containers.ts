/**
 * Things a player can search: the village's barrels and crates, a chest in the forge loft, and
 * caches hidden off the trail. Each character finds its own loot (the rules are in
 * @alloy/session containers.ts); a searched container fills again after `refill` seconds of
 * that character's play time.
 *
 * Deterministic: the server and every browser place the same containers.
 */
import type { Vec2 } from '@alloy/game-rules';
import { emberholdItems, buildWorldColliders } from './Emberhold';
import { FORGE_HALL, FORGE_PLAN, forgeToWorld } from './forge';
import { PATH, playableSdf } from './Layout';
import { terrainHeight } from './Terrain';

export type ContainerKind = 'barrel' | 'chest' | 'cache';

export interface ContainerDef {
  id: string;
  kind: ContainerKind;
  pos: Vec2;
  /** Height above the terrain of the floor it sits on (the loft chest is up a flight of stairs). */
  floor: number;
  yaw: number;
  /** Seconds of play time until it can be searched again. */
  refill: number;
}

/** How close (metres, horizontally) a player must be to search. */
export const SEARCH_RANGE = 2.2;
/** How far above or below the container's floor the player's feet may be. */
export const SEARCH_HEIGHT = 1.2;

export const REFILL: Record<ContainerKind, number> = { barrel: 600, chest: 1800, cache: 1200 };

function build(): ContainerDef[] {
  const out: ContainerDef[] = [];
  // Every stack of barrels and crates in the scene (the collider is 2.3 x 1.7 m, so the search point is its middle).
  emberholdItems()
    .filter((it) => it.model === 'barrels_crates')
    .forEach((it, i) => out.push({ id: `barrel-${i}`, kind: 'barrel', pos: { x: it.x, z: it.z }, floor: 0, yaw: it.yaw, refill: REFILL.barrel }));
  // The chest in the forge loft.
  const c = forgeToWorld(FORGE_PLAN.loftChest.x, FORGE_PLAN.loftChest.z);
  out.push({ id: 'forge-loft-chest', kind: 'chest', pos: c, floor: FORGE_PLAN.loft.y, yaw: FORGE_HALL.yaw + 180, refill: REFILL.chest });
  // Caches: tucked 9-15 m off the trail between the village and the quarry, one every ~30 m.
  const world = buildWorldColliders();
  let seed = 90210;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let n = 0;
  for (let i = 0; i < PATH.length - 1 && PATH[i].z < 170; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    for (let d = 14; d < len; d += 30) {
      const along = a.z + ((b.z - a.z) * d) / len;
      if (along < 30) continue; // not inside the village
      for (let tries = 0; tries < 6; tries++) {
        const off = (rnd() < 0.5 ? -1 : 1) * (9 + rnd() * 6);
        const x = a.x + ((b.x - a.x) * d) / len + nx * off;
        const z = a.z + ((b.z - a.z) * d) / len + nz * off;
        if (playableSdf({ x, z }) > -2 || world.blocksPoint(x, terrainHeight(x, z) + 0.3, z, 1.0)) continue;
        out.push({ id: `cache-${n++}`, kind: 'cache', pos: { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }, floor: 0, yaw: Math.round(rnd() * 360), refill: REFILL.cache });
        break;
      }
    }
  }
  return out;
}

export const CONTAINERS: ContainerDef[] = build();

export const containerDef = (id: string): ContainerDef | undefined => CONTAINERS.find((c) => c.id === id);
