/**
 * The Emberhold first area as authored in the Model Workshop: baked placements (emberholdData.ts)
 * plus per-model collision footprints. Pure data + maths (no rendering), so the world server builds
 * exactly the same colliders as the browser.
 */
import { ColliderWorld } from './Colliders';
import { PATH, RESOURCE_NODES, type NodeDef } from './Layout';
import { terrainHeight } from './Terrain';
import { EMBERHOLD_MODELS, EMBERHOLD_SEAMS, EMBERHOLD_STATIC, type EmberholdModel } from './emberholdData';

export { EMBERHOLD_MODELS, EMBERHOLD_TIME, type EmberholdModel } from './emberholdData';

/** One baked world item. y is the offset above the terrain at (x, z); yaw is in degrees. */
export interface WorldItem {
  model: EmberholdModel;
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
}

let items: WorldItem[] | null = null;
/** Every static item of the area (buildings, props, scatter), in bake order. */
export function emberholdItems(): WorldItem[] {
  if (!items) {
    items = [];
    for (let i = 0; i < EMBERHOLD_STATIC.length; i += 6) {
      const s = EMBERHOLD_STATIC;
      items.push({ model: EMBERHOLD_MODELS[s[i]], x: s[i + 1], z: s[i + 2], y: s[i + 3], yaw: s[i + 4], scale: s[i + 5] });
    }
  }
  return items;
}

/** Minable nodes at the heart of each generated ore / crystal seam (in addition to RESOURCE_NODES). */
export const SEAM_NODES: NodeDef[] = EMBERHOLD_SEAMS.map((n) => ({ id: n.id, material: n.material, pos: { x: n.x, z: n.z }, scale: n.scale, yaw: n.yaw }));

/**
 * Every ironwood tree of the generated scenery is a node too (players expect any ironwood tree to
 * be choppable). Ids follow the bake order; `instanced` marks nodes drawn with the scenery.
 * The scale is relative to the node model's own 1.15.
 */
export const GROVE_NODES: NodeDef[] = emberholdItems()
  .filter((it) => it.model === 'ironwood_tree')
  .map((it, i) => ({ id: `wood-g${i}`, material: 'ironwood', pos: { x: it.x, z: it.z }, scale: it.scale / 1.15, yaw: it.yaw, instanced: true }));


/** Collision shapes in a model's own metres: circles [x, z, r, height] and rectangles [x, z, halfW, halfD, height]. */
type Shape = ['c', number, number, number, number] | ['r', number, number, number, number, number];
const TRUNK: Shape[] = [['c', 0, 0, 0.35, 8]];
const SHAPES: Partial<Record<EmberholdModel, Shape[]>> = {
  forge_hall: [['r', 0, -0.05, 4.0, 3.45, 6.4]],
  forge_anvil: [['r', 0, -0.65, 0.95, 0.95, 1.0]],
  barrels_crates: [['r', -0.05, -0.25, 1.15, 0.85, 1.1]],
  steam_pipes: [['r', 0.3, 0, 2.3, 0.3, 2.6]],
  brazier: [['c', 0, 0, 0.45, 1.8]],
  market_stall: [
    ['r', 0, -0.05, 1.85, 0.7, 2.4],
    ['c', 1.9, 1.4, 0.45, 0.9],
    ['c', -1.7, 0.9, 0.12, 2],
    ['c', 1.7, 0.9, 0.12, 2],
  ],
  frontier_cottage: [['r', 0, 0, 3.5, 2.8, 7]],
  order_chapterhouse: [['r', 0, 0.3, 4.6, 6.8, 10]],
  clocktower: [['r', 0, 0, 2.0, 2.0, 20]],
  watchtower: [
    ['c', -1.4, -1.4, 0.25, 6.5],
    ['c', 1.4, -1.4, 0.25, 6.5],
    ['c', -1.4, 1.4, 0.25, 6.5],
    ['c', 1.4, 1.4, 0.25, 6.5],
  ],
  brass_well: [['c', -0.2, 0, 1.2, 2.9]],
  bench: [['r', 0, 0, 0.9, 0.3, 0.6]],
  gear_sun_monument: [['c', 0, 0, 1.7, 7]],
  aether_lamp: [['c', 0, 0, 0.2, 3.7]],
  order_gatehouse: [
    ['r', -4.2, 0, 1.0, 1.1, 7.6],
    ['r', 4.2, 0, 1.0, 1.1, 7.6],
    ['r', -2.5, 0, 0.9, 0.8, 6.8],
    ['r', 2.5, 0, 0.9, 0.8, 6.8],
  ],
  order_banner: [['c', 0, 0, 0.2, 4.6]],
  palisade: [['r', 0, 0, 3.05, 0.25, 2.8]],
  gilded_birch: TRUNK,
  ironwood_tree: TRUNK,
  broadleaf_tree: TRUNK,
  telegraph_pole: [['c', 0, 0, 0.2, 6]],
  signpost: [['c', 0, 0, 0.15, 2.9]],
  cliff_wall: [['r', 0, 0.4, 7.4, 1.3, 7.5]],
  mine_cart: [['r', 0, 0, 0.7, 1.9, 1.2]],
  steam_pumphouse: [
    ['r', 0, 0, 2.5, 2.0, 5.2],
    ['c', 2.7, -1.1, 0.15, 4.2],
    ['c', 4.8, -0.8, 0.15, 4.2],
    ['c', 2.7, 1.1, 0.15, 4.2],
    ['c', 4.8, 1.0, 0.15, 4.2],
  ],
  aether_beacon: [['c', 0, 0, 1.8, 15]],
  foundry_core: [
    ['c', 0, 0, 6.6, 0.5],
    ['c', 0, 0, 3.3, 6.5],
    ['c', 3.25, 3.25, 0.6, 6.5],
    ['c', -3.25, 3.25, 0.6, 6.5],
    ['c', 3.25, -3.25, 0.6, 6.5],
    ['c', -3.25, -3.25, 0.6, 6.5],
  ],
  iron_ore_node: [['c', 0, 0, 0.85, 1.5]],
  ironglass_cluster: [['c', 0, 0, 0.85, 2]],
  fallen_log: [['r', 0, 0.2, 2.0, 0.45, 1.0]],
  rock_cluster: [['c', 0.05, 0, 1.15, 1.3]],
};

/** Add one item's colliders (rotation matches three.js: world = Ry(yaw) * local). */
function addItem(world: ColliderWorld, it: WorldItem): void {
  const shapes = SHAPES[it.model];
  if (!shapes) return;
  const a = (it.yaw * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const s = it.scale;
  const base = terrainHeight(it.x, it.z) + it.y;
  const axisAligned = Math.abs(((it.yaw % 90) + 90) % 90) < 0.5 || Math.abs(((it.yaw % 90) + 90) % 90) > 89.5;
  for (const sh of shapes) {
    const x = it.x + (cos * sh[1] + sin * sh[2]) * s;
    const z = it.z + (-sin * sh[1] + cos * sh[2]) * s;
    if (sh[0] === 'c') {
      world.add({ type: 'circle', x, z, r: sh[3] * s, top: base + sh[4] * s });
      continue;
    }
    const hw = sh[3] * s;
    const hd = sh[4] * s;
    const top = base + sh[5] * s;
    if (axisAligned) {
      const swap = Math.abs(sin) > 0.5;
      const ex = swap ? hd : hw;
      const ez = swap ? hw : hd;
      world.add({ type: 'box', minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, top });
    } else world.add({ type: 'obb', x, z, hw, hd, cos, sin, top });
  }
}

/** Colliders for the whole area. Deterministic: the server and every browser build the same set. */
export function buildWorldColliders(): ColliderWorld {
  const world = new ColliderWorld();
  for (const it of emberholdItems()) addItem(world, it);
  // Ironwood nodes are standing trees: their trunks block like any other tree.
  // Hand-placed quest trees (the grove's trees are already in the scenery above).
  for (const n of RESOURCE_NODES) if (n.material === 'ironwood') addItem(world, { model: 'ironwood_tree', x: n.pos.x, z: n.pos.z, y: 0, yaw: 0, scale: 1.15 });
  return world;
}

/**
 * Emberleaf patches (herbs, no tool needed): along both sides of the trail from the village to
 * the quarry, every ~11 m, 4-8 m off the path, skipping spots inside buildings, rocks or trees.
 * Deterministic: the server and every browser place the same patches.
 */
export const HERB_NODES: NodeDef[] = (() => {
  const world = buildWorldColliders();
  let seed = 7331;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: NodeDef[] = [];
  for (let i = 0; i < PATH.length - 1 && PATH[i].z < 150; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    for (let d = 5; d < len; d += 8) {
      const side = rnd() < 0.5 ? -1 : 1;
      const off = side * (4 + rnd() * 4);
      const x = a.x + ((b.x - a.x) * d) / len + nx * off;
      const z = a.z + ((b.z - a.z) * d) / len + nz * off;
      if (world.blocksPoint(x, 0.3, z, 1.2)) continue;
      out.push({ id: `herb-${out.length}`, material: 'emberleaf', pos: { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }, scale: 0.8 + rnd() * 0.4, yaw: rnd() * 360 });
    }
  }
  return out;
})();

/** Every node the player can gather from: the hand-placed quest nodes, the generated seams, the grove and the herbs. */
export const ALL_RESOURCE_NODES: NodeDef[] = [...RESOURCE_NODES, ...SEAM_NODES, ...GROVE_NODES, ...HERB_NODES];
