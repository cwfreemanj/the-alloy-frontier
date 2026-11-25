/**
 * Authored scenery for the Emberhold area: which Model Workshop models are replaced by which
 * authored (Meshy) models, which scenery is no longer drawn (clutter on the steep hill walls
 * outside the playable area), and where cliff faces line the valley edges.
 *
 * Pure placement maths (deterministic), used by EmberholdWorld.
 */
import { playableSdf, terrainHeight, type WorldItem } from '@alloy/world';

export interface Swap {
  /** Authored variants, picked per instance by position. */
  variants: string[];
  /** Variants for instances outside the playable area (the hills around the valley). */
  outside?: string[];
  /** Match the replaced model's height ('y') or width ('x'). */
  fit: 'x' | 'y';
}

export const SWAPS: Record<string, Swap> = {
  // Gatherable groves keep ironwood; the hillside forest of the same model becomes pines.
  ironwood_tree: { variants: ['ironwood', 'ironwood_young'], outside: ['pine_tall', 'pine_wide', 'pine_young', 'pine_tall'], fit: 'y' },
  broadleaf_tree: { variants: ['oak_autumn', 'tree_golden'], outside: ['pine_wide', 'oak_autumn', 'pine_tall'], fit: 'y' },
  gilded_birch: { variants: ['tree_golden', 'pine_young'], fit: 'y' },
  shrub: { variants: ['shrub', 'ferns', 'shrub'], fit: 'y' },
  rock_cluster: { variants: ['boulder', 'stones', 'slab'], fit: 'x' },
  cliff_wall: { variants: ['cliff', 'rockwall'], fit: 'x' },
  ridge_chunk: { variants: ['ridge'], fit: 'x' },
  forge_anvil: { variants: ['forge_anvil'], fit: 'y' },
};

export const AUTHORED_SCENERY_IDS = [...new Set(Object.values(SWAPS).flatMap((s) => [...s.variants, ...(s.outside ?? [])]).concat(['cliff', 'rockwall']))];

const slopeAt = (x: number, z: number) => Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;

/** Loose scenery that is no longer drawn: on the steep hill walls outside the playable area. */
const CLUTTER = new Set(['ironwood_tree', 'broadleaf_tree', 'gilded_birch', 'shrub', 'rock_cluster']);
export function hiddenScenery(model: string, x: number, z: number): boolean {
  return CLUTTER.has(model) && playableSdf({ x, z }) > 0 && slopeAt(x, z) > 0.6;
}

/** A stable pseudo-random number in [0, 1) for a position. */
export function hash01(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function variantFor(swap: Swap, it: WorldItem): string {
  const list = swap.outside && playableSdf({ x: it.x, z: it.z }) > 0 ? swap.outside : swap.variants;
  return list[Math.floor(hash01(it.x, it.z) * list.length) % list.length];
}

export interface CliffSpot {
  x: number;
  z: number;
  /** Facing (radians, three.js yaw): the cliff's front looks into the valley. */
  yaw: number;
  /** Width in metres. */
  width: number;
  /** Base height: the lowest ground under the piece, sunk a little so no edge floats. */
  y: number;
  model: 'cliff' | 'rockwall';
}

/**
 * Cliff faces along the valley edge: just outside the playable area where the hills rise
 * steeply, about 17 m apart, each turned to face into the valley.
 */
export function cliffSpots(): CliffSpot[] {
  const cand: Array<{ x: number; z: number; s: number }> = [];
  for (let x = -120; x <= 160; x += 4)
    for (let z = -90; z <= 330; z += 4) {
      const d = playableSdf({ x, z });
      if (d < 2 || d > 7) continue;
      const s = slopeAt(x, z);
      if (s > 0.42) cand.push({ x, z, s });
    }
  // Steepest first, then keep those far enough from the ones already taken.
  cand.sort((a, b) => b.s - a.s);
  const out: CliffSpot[] = [];
  for (const c of cand) {
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 17)) continue;
    const e = 1.5;
    const gx = playableSdf({ x: c.x + e, z: c.z }) - playableSdf({ x: c.x - e, z: c.z });
    const gz = playableSdf({ x: c.x, z: c.z + e }) - playableSdf({ x: c.x, z: c.z - e });
    // The model's front is +Z; face down the gradient (back toward the playable area).
    const yaw = Math.atan2(-gx, -gz);
    const width = 15 + hash01(c.x, c.z, 3) * 7;
    // Lowest ground across its width and depth (the hill falls away under one end).
    const ax = Math.cos(yaw), az = -Math.sin(yaw); // local +x in the world
    const fx = Math.sin(yaw), fz = Math.cos(yaw); // local +z (front)
    let low = Infinity;
    for (let u = -0.5; u <= 0.5; u += 0.125)
      for (const v of [-3, 0, 3]) low = Math.min(low, terrainHeight(c.x + ax * u * width + fx * v, c.z + az * u * width + fz * v));
    out.push({ x: c.x, z: c.z, yaw, width, y: low - 1.5, model: hash01(c.x, c.z, 5) < 0.55 ? 'cliff' : 'rockwall' });
  }
  return out;
}
