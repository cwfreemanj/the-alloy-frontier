// Alloy Frontier Model Workshop — World view: the Emberhold first area built from workshop models
// on the game's own terrain and layout, with procedural scatter, particles and post-processing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';
import { MaterialBank, buildModel, optimizeForGame, modelStats, rng } from '../../../apps/web/src/world/workshop/core.js';
import * as T from './terrain.js';
import { TIMES, sunDirection, createSky, ParticleField, createGrass, createPost } from '../../../apps/web/src/world/workshop/fx.js';

export const SCENE_FORMAT = 'alloy-scene';
const D2R = THREE.MathUtils.degToRad;
const R2D = THREE.MathUtils.radToDeg;
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Particle anchors per model, in the model's own metres (before yaw/scale). */
const EMITTERS = {
  forge_hall: [
    { preset: 'smoke', at: [-2.4, 9.2, -2.2], count: 26 },
    { preset: 'embers', at: [-2.4, 9.0, -2.2], count: 30 },
    { preset: 'embers', at: [-1.4, 0.6, 2.1], count: 18, radius: 0.35 },
  ],
  forge_anvil: [{ preset: 'sparks', at: [0, 0.95, 0], count: 26 }],
  frontier_cottage: [{ preset: 'smoke', at: [2.2, 8.8, -1.4], count: 14 }],
  steam_pumphouse: [{ preset: 'smoke', at: [-1.6, 8.4, -1], count: 22 }],
  brazier: [{ preset: 'embers', at: [0, 1.5, 0], count: 22, radius: 0.25 }],
  foundry_core: [
    { preset: 'embers', at: [0, 3.4, 0], count: 90, radius: 1.3 },
    { preset: 'motes', at: [3.25, 4.6, 3.25], count: 10 },
    { preset: 'motes', at: [-3.25, 4.6, 3.25], count: 10 },
    { preset: 'motes', at: [3.25, 4.6, -3.25], count: 10 },
    { preset: 'motes', at: [-3.25, 4.6, -3.25], count: 10 },
  ],
  ironglass_cluster: [{ preset: 'motes', at: [0, 1.1, 0], count: 12, radius: 0.8 }],
  aether_beacon: [{ preset: 'motes', at: [0, 12.7, 0], count: 24, radius: 1.2 }],
  iron_ore_node: [{ preset: 'sparks', at: [0, 0.9, 0], count: 3, radius: 0.6 }],
};

/** Point lights the scene keeps (few, at the hotspots). */
const HOT_LIGHTS = {
  forge_hall: { at: [-1.4, 1.2, 3.2], color: '#ff7a2e', intensity: 26, distance: 18, flicker: true },
  foundry_core: { at: [0, 3.4, 0], color: '#ff5a1a', intensity: 60, distance: 34, pulse: true },
  aether_beacon: { at: [0, 12.7, 0], color: '#5fd6f5', intensity: 40, distance: 40 },
};

// ---------------------------------------------------------------------------------------------
// Default layout (game coordinates: metres, +Z north from Emberhold to the Foundry)
// ---------------------------------------------------------------------------------------------
let pidN = 0;
function put(model, x, z, yaw = 0, scale = 1, y = 0) {
  return { id: `pl${(++pidN).toString(36)}`, model, x: r2(x), z: r2(z), y, yaw: r2(yaw), scale };
}
const face = (x, z, tx, tz) => R2D(Math.atan2(tx - x, tz - z));
const snap90 = (a) => Math.round(a / 90) * 90;

export function defaultScene() {
  pidN = 0;
  const P = [];
  // Emberhold Village
  // The anvil sits exactly on the game's FORGE_ANVIL interaction point, in front of the hall.
  P.push(put('forge_hall', -16.5, 14.5, face(-16.5, 14.5, 0, 0)));
  P.push(put('forge_anvil', T.FORGE_ANVIL.x, T.FORGE_ANVIL.z, face(-16.5, 14.5, 0, 0)));
  P.push(put('barrels_crates', -19.5, 8.5, 40));
  P.push(put('steam_pipes', -21.5, 13, 100, 0.8));
  P.push(put('brazier', -9.2, 15.6));
  P.push(put('market_stall', 13, 7, face(13, 7, 0, 0)));
  P.push(put('barrels_crates', 15.8, 10.2, -100));
  for (const [x, z] of [[-20, -8], [18, -10], [22, 14], [-25, 4], [26, -2]]) P.push(put('frontier_cottage', x, z, snap90(face(x, z, 0, 0))));
  P.push(put('order_chapterhouse', -7.5, 23.5, 90, 0.85));
  P.push(put('clocktower', 9, 20, 180));
  P.push(put('watchtower', 19, 22, -135));
  P.push(put('brass_well', 0, 10));
  P.push(put('bench', -3.6, 10, 90));
  P.push(put('bench', 3.6, 10, -90));
  P.push(put('gear_sun_monument', -8, -13, 35));
  P.push(put('brazier', -4.5, -16));
  for (const [x, z] of [[-5, -2], [6, 1], [-1.8, 16], [6.5, 27], [-7, 13], [-3, -12], [3, -12], [-4, -27], [4, -27], [-4.5, 33], [4.5, 33]]) P.push(put('aether_lamp', x, z));
  P.push(put('order_gatehouse', 0, 31, 0));
  P.push(put('order_banner', -5.5, -31, 0));
  P.push(put('order_banner', 5.5, -31, 0));
  // Palisade ring (r = 31) with gates north and south.
  const step = (6 / 31) * R2D(1);
  for (const [a0, a1] of [[11 + step / 2, 168 - step / 2], [192 + step / 2, 349 - step / 2]])
    for (let a = a0; a <= a1 + 0.01; a += (a1 - a0) / Math.round((a1 - a0) / step)) P.push(put('palisade', Math.sin(D2R(a)) * 31, Math.cos(D2R(a)) * 31, a));

  // Ironwood Trail
  for (let s = 56; s <= 98; s += 7)
    for (const side of [-1, 1]) {
      const p = T.pathAt(s);
      P.push(put('gilded_birch', p.x + p.tz * 4.4 * side, p.z - p.tx * 4.4 * side, (s * 37) % 360, 0.9 + ((s * 13) % 4) / 10));
    }
  let side = 1;
  for (let s = 100; s <= 236; s += 23) {
    const p = T.pathAt(s);
    P.push(put('aether_lamp', p.x + p.tz * 3.2 * side, p.z - p.tx * 3.2 * side));
    side = -side;
  }
  for (let s = 52; s <= 152; s += 20) {
    const p = T.pathAt(s);
    P.push(put('telegraph_pole', p.x - p.tz * 5.5, p.z + p.tx * 5.5, R2D(Math.atan2(p.tx, p.tz)) + 90));
  }
  for (const [s, off] of [[48, -2.8], [158, 3], [252, -3.2]]) {
    const p = T.pathAt(s);
    P.push(put('signpost', p.x + p.tz * off, p.z - p.tx * off, R2D(Math.atan2(p.tx, p.tz))));
  }
  {
    const p = T.pathAt(118);
    P.push(put('watchtower', p.x + p.tz * 10, p.z - p.tx * 10, face(p.x + p.tz * 10, p.z - p.tx * 10, p.x, p.z)));
  }
  // Ironglass Quarry
  const Q = T.ZONE.quarry.center;
  for (const a of [30, 60, 90, 120, 225, 255, 285, 318]) P.push(put('cliff_wall', Q.x + Math.sin(D2R(a)) * 30, Q.z + Math.cos(D2R(a)) * 30, a, 1, -1.6));
  P.push(put('mine_cart', 46, 151, 25));
  P.push(put('barrels_crates', 49, 147, 15));
  P.push(put('steam_pumphouse', 70, 167, -90));
  P.push(put('steam_pipes', 62, 174, -70));
  P.push(put('aether_beacon', 11, 164, 90));
  P.push(put('watchtower', 59, 188, -140));
  // Dormant Foundry (boss arena)
  const F = T.ZONE.foundry.center;
  P.push(put('arena_floor', F.x, F.z, 0, 1, -0.02));
  P.push(put('foundry_core', F.x, F.z + 20, 180));
  P.push(put('order_gatehouse', 8.5, 221.5, -45)); // straddles the trail into the arena
  for (const a of [50, 90, 130, 230, 270, 310]) P.push(put('brazier', F.x + Math.sin(D2R(a)) * 21, F.z + Math.cos(D2R(a)) * 21));
  P.push(put('order_banner', F.x - 7.5, F.z + 13, 180));
  P.push(put('order_banner', F.x + 7.5, F.z + 13, 180));
  P.push(put('aether_beacon', F.x - 26, F.z + 2, 90, 0.75));
  P.push(put('aether_beacon', F.x + 26, F.z + 2, -90, 0.75));
  P.push(put('steam_pipes', F.x - 14, F.z + 15, 60));
  P.push(put('steam_pipes', F.x + 16, F.z + 15, -60));
  for (const [x, z, yaw] of [[F.x, F.z + 37, 0], [F.x - 24, F.z + 28, 40], [F.x + 26, F.z + 28, -40]]) P.push(put('cliff_wall', x, z, yaw, 1.1, -1.5));
  // Backdrop
  for (const [m, x, z, yaw, s] of [
    ['ridge_chunk', -100, 40, 20, 1.6],
    ['ridge_chunk', -108, 170, -10, 1.8],
    ['ridge_chunk', 140, 70, 0, 1.6],
    ['ridge_chunk', 142, 215, 30, 1.7],
    ['ridge_chunk', 60, 335, 0, 2],
    ['ridge_chunk', -50, 330, 15, 1.8],
    ['ridge_chunk', -85, -70, 0, 1.6],
    ['ridge_chunk', 95, -70, 0, 1.5],
    ['mesa_tile', 112, 135, 0, 1.4],
    ['mesa_tile', -88, 268, 0, 1.3],
  ])
    P.push(put(m, x, z, yaw, s, -5));

  return {
    format: SCENE_FORMAT,
    version: 1,
    id: 'emberhold',
    name: 'Emberhold Frontier: first area',
    placements: P,
    generators: { seed: 1337, trees: 1, rocks: 1, shrubs: 1, logs: 1, ores: 1, crystals: 1, grass: 1, suppress: [] },
    atmosphere: { time: 'golden', overrides: {}, particles: 1, shadows: true },
  };
}

export function normalizeScene(s) {
  const d = defaultScene();
  if (!s || typeof s !== 'object' || !Array.isArray(s.placements)) throw new Error('Not a scene: expected "placements".');
  const n = (v, f) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const g = { ...d.generators, ...(s.generators ?? {}) };
  for (const k of ['seed', 'trees', 'rocks', 'shrubs', 'logs', 'ores', 'crystals', 'grass']) g[k] = n(g[k], d.generators[k]);
  g.suppress = Array.isArray(g.suppress) ? g.suppress.filter((x) => typeof x === 'string').slice(0, 2000) : [];
  const a = { ...d.atmosphere, ...(s.atmosphere ?? {}) };
  if (!TIMES[a.time]) a.time = 'golden';
  a.overrides = a.overrides && typeof a.overrides === 'object' ? a.overrides : {};
  return {
    format: SCENE_FORMAT,
    version: 1,
    id: String(s.id ?? 'emberhold').slice(0, 40),
    name: String(s.name ?? d.name).slice(0, 80),
    placements: s.placements.slice(0, 3000).map((p, i) => ({
      id: String(p.id ?? `pl_${i}`).slice(0, 40),
      model: String(p.model ?? '').slice(0, 60),
      x: n(p.x, 0),
      z: n(p.z, 0),
      y: n(p.y, 0),
      yaw: n(p.yaw, 0),
      scale: Math.max(0.05, Math.min(20, n(p.scale, 1))),
    })),
    generators: g,
    atmosphere: { time: a.time, overrides: a.overrides, particles: n(a.particles, 1), shadows: a.shadows !== false },
  };
}

// ---------------------------------------------------------------------------------------------
// Procedural generation
// ---------------------------------------------------------------------------------------------
class Spacing {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  free(x, z, r) {
    const c = this.cell;
    const n = Math.ceil(r / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) for (const p of this.map.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < Math.max(r, p[2])) return false;
    return true;
  }
  add(x, z, r) {
    const k = this.key(x, z);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push([x, z, r]);
  }
}

/** Everything the generators place: { items: [{model,x,z,y,yaw,scale,gen,key,gameplay?}], grass: [...] } */
export function generate(scene, footprints) {
  const G = scene.generators;
  const R = rng(G.seed * 7919 + 13);
  const rand = (a, b) => a + (b - a) * R();
  const pick = (w) => {
    let t = R() * w.reduce((s, [, x]) => s + x, 0);
    for (const [m, x] of w) if ((t -= x) <= 0) return m;
    return w[0][0];
  };
  const items = [];
  const sp = new Spacing(4);
  for (const f of footprints) sp.add(f.x, f.z, f.r);
  const Q = T.ZONE.quarry;
  const F = T.ZONE.foundry;
  const V = T.ZONE.village;
  const dq = (x, z) => Math.hypot(x - Q.center.x, z - Q.center.z);
  const df = (x, z) => Math.hypot(x - F.center.x, z - F.center.z);
  const dv = (x, z) => Math.hypot(x - V.center.x, z - V.center.z);
  const B = T.WORLD_BOUNDS;
  const slopeAt = (x, z) => Math.hypot(T.terrainHeight(x + 1, z) - T.terrainHeight(x - 1, z), T.terrainHeight(x, z + 1) - T.terrainHeight(x, z - 1)) / 2;
  const suppressed = new Set(G.suppress);
  let gid = 0;
  const add = (gen, model, x, z, scale, o = {}) => {
    const key = `${gen}:${gid++}`;
    if (suppressed.has(key)) return;
    items.push({ model, x, z, y: o.y ?? 0, yaw: o.yaw ?? rand(0, 360), scale, gen, key, gameplay: o.gameplay ?? false, anchor: o.anchor ?? false });
  };

  // Keep NPCs, spawns, the anvil, the training post and enemy patrol routes clear of scatter.
  const keepClear = [T.PLAYER_SPAWN, T.RESPAWN_POINT, T.FORGE_ANVIL, T.TRAINING_POST, ...T.NPCS.map((n) => n.pos)];
  for (const p of keepClear) sp.add(p.x, p.z, 3);
  for (const e of T.ENEMY_SPAWNS) {
    sp.add(e.pos.x, e.pos.z, 3);
    const loop = e.patrol ? [...e.patrol, e.patrol[0]] : [];
    for (let i = 0; i < loop.length - 1; i++) {
      const a = loop[i];
      const b = loop[i + 1];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
      for (let k = 0; k <= n; k++) sp.add(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, 2.5);
    }
  }

  // Gameplay resource nodes at the game's exact positions.
  for (const n of T.RESOURCE_NODES) {
    const model = n.material === 'iron_ore' ? 'iron_ore_node' : n.material === 'ironglass' ? 'ironglass_cluster' : 'ironwood_tree';
    add('nodes', model, n.pos.x, n.pos.z, model === 'ironwood_tree' ? 1.15 : 1, { gameplay: true, y: model === 'iron_ore_node' ? -0.1 : 0 });
    sp.add(n.pos.x, n.pos.z, 3);
  }

  // Ore clusters: seams follow a noise "richness" field along the trail and in the quarry.
  const oreSeed = (G.seed % 997) + 101;
  let clusters = 0;
  const maxOre = Math.round(34 * G.ores);
  for (let i = 0; i < maxOre * 120 && clusters < maxOre; i++) {
    const x = rand(-40, 90);
    const z = rand(30, 200);
    const p = { x, z };
    const dp = T.distToPath(p);
    const inQuarry = dq(x, z) < Q.radius - 3;
    if (!inQuarry && !(dp > 4 && dp < 16 && z < 150)) continue;
    if (T.gfbm(x / 22, z / 22, 3, oreSeed) < (inQuarry ? -0.1 : 0.02)) continue;
    if (!sp.free(x, z, 7)) continue;
    if (slopeAt(x, z) > 0.6) continue;
    const k = 2 + Math.floor(R() * 3);
    const base = rand(0.7, 0.95);
    add('ores', 'iron_ore_node', x, z, base, { y: -0.12 * base, anchor: true });
    for (let j = 1; j < k; j++) {
      const a = R() * Math.PI * 2;
      const rr = rand(1.3, 2.6);
      const s = rand(0.38, 0.6);
      add('ores', 'iron_ore_node', x + Math.cos(a) * rr, z + Math.sin(a) * rr, s, { y: -0.12 * s });
    }
    sp.add(x, z, 4);
    clusters++;
  }
  let crystals = 0;
  const maxCr = Math.round(15 * G.crystals);
  for (let i = 0; i < maxCr * 150 && crystals < maxCr; i++) {
    const a = R() * Math.PI * 2;
    const rr = Math.sqrt(R()) * (Q.radius + 2);
    const x = Q.center.x + Math.cos(a) * rr;
    const z = Q.center.z + Math.sin(a) * rr;
    const wall = rr > Q.radius - 9;
    if (T.distToPath({ x, z }) < 4) continue;
    if (T.gfbm(x / 14, z / 14, 3, oreSeed + 7) < (wall ? -0.35 : 0.18)) continue;
    if (!sp.free(x, z, 6.5)) continue;
    const k = 2 + Math.floor(R() * 3);
    for (let j = 0; j < k; j++) {
      const b = R() * Math.PI * 2;
      const d = j ? rand(1, 2.2) : 0;
      add('crystals', 'ironglass_cluster', x + Math.cos(b) * d, z + Math.sin(b) * d, j ? rand(0.45, 0.7) : rand(0.8, 1.15), { y: -0.1, anchor: !j });
    }
    sp.add(x, z, 5);
    crystals++;
  }

  // Trees: a forest band hugging the playable edge, sparse trees inside.
  const nTrees = Math.round(460 * G.trees);
  let placed = 0;
  for (let i = 0; i < nTrees * 6 && placed < nTrees; i++) {
    const x = rand(B.minX + 10, B.maxX - 10);
    const z = rand(B.minZ + 10, B.maxZ - 10);
    const p = { x, z };
    const sd = T.playableSdf(p);
    const inner = sd < -2;
    if (sd > 24) continue;
    if (inner && (R() > 0.12 || T.distToPath(p) < 7 || dv(x, z) < 36)) continue;
    if (!inner && T.distToPath(p) < 5) continue;
    if (dq(x, z) < Q.radius + 4 || df(x, z) < F.radius + 3 || dv(x, z) < 33) continue;
    const s = rand(0.8, 1.45);
    if (!sp.free(x, z, 2.6 * s)) continue;
    sp.add(x, z, 2.2 * s);
    const model = z < 45 ? pick([['ironwood_tree', 5], ['broadleaf_tree', 4], ['gilded_birch', 1.2]]) : z > 200 ? pick([['ironwood_tree', 8], ['broadleaf_tree', 1]]) : pick([['ironwood_tree', 7], ['broadleaf_tree', 3]]);
    add('trees', model, x, z, s);
    placed++;
  }
  // Fallen logs and shrubs.
  for (let i = 0, n = Math.round(26 * G.logs); i < n * 8 && n > 0; i++) {
    const x = rand(B.minX + 20, B.maxX - 20);
    const z = rand(20, 250);
    const sd = T.playableSdf({ x, z });
    if (sd < -6 || sd > 10 || T.distToPath({ x, z }) < 4 || dq(x, z) < Q.radius + 2 || df(x, z) < F.radius) continue;
    if (!sp.free(x, z, 3)) continue;
    sp.add(x, z, 2.5);
    add('logs', 'fallen_log', x, z, rand(0.8, 1.2), { y: -0.1 });
    if (--n <= 0) break;
  }
  for (let i = 0, n = Math.round(320 * G.shrubs); i < n * 25 && n > 0; i++) {
    const x = rand(B.minX + 10, B.maxX - 10);
    const z = rand(B.minZ + 10, B.maxZ - 30);
    const p = { x, z };
    const sd = T.playableSdf(p);
    const dp = T.distToPath(p);
    if (sd > 12 || dp < 3 || dv(x, z) < 18 || dq(x, z) < Q.radius - 2 || df(x, z) < F.radius - 2) continue;
    if (!(sd > -7 || (dp > 3 && dp < 10))) continue;
    const s = rand(0.7, 1.4);
    if (!sp.free(x, z, 0.9 * s)) continue;
    sp.add(x, z, 0.8 * s);
    add('shrubs', 'shrub', x, z, s, { y: -0.08 });
    n--;
  }
  // Rocks: forest floor, quarry rim and trail edges.
  for (let i = 0, n = Math.round(150 * G.rocks); i < n * 25 && n > 0; i++) {
    const x = rand(B.minX + 10, B.maxX - 10);
    const z = rand(B.minZ + 10, B.maxZ - 10);
    const p = { x, z };
    const sd = T.playableSdf(p);
    const dp = T.distToPath(p);
    const rim = Math.abs(dq(x, z) - Q.radius) < 8;
    const pit = dq(x, z) < Q.radius - 6 && R() < 0.35;
    if (!(rim || pit || (sd > -4 && sd < 26) || (dp > 4 && dp < 10 && z > 34))) continue;
    if (dv(x, z) < 33 || dp < 3.5 || (dq(x, z) < Q.radius - 6 && !rim && !pit) || df(x, z) < F.radius - 4) continue;
    const s = rand(0.5, 1.7);
    if (!sp.free(x, z, 1.8 * s)) continue;
    sp.add(x, z, 1.6 * s);
    add('rocks', 'rock_cluster', x, z, s, { y: -0.25 * s });
    n--;
  }

  // Grass clumps (not on paths, plazas, the quarry pit, the arena or under things).
  const grass = [];
  const nGrass = Math.round(11000 * G.grass);
  const col = new THREE.Color();
  const tip = new THREE.Color('#a9b56a');
  for (let i = 0; i < nGrass * 12 && grass.length < nGrass; i++) {
    const x = rand(-70, 100);
    const z = rand(-45, 280);
    const p = { x, z };
    const sd = T.playableSdf(p);
    if (sd > 10) continue;
    const dp = T.distToPath(p);
    if (dp < 2.4 + R() * 1.2 || dv(x, z) < 16 + R() * 4 || dq(x, z) < Q.radius - 3 || df(x, z) < F.radius - 2) continue;
    if (T.gfbm(x / 11, z / 11, 2, 55) < -0.45 + R() * 0.35) continue;
    if (!sp.free(x, z, 0.4)) continue;
    if (slopeAt(x, z) > 0.55) continue;
    T.groundColor(x, z, 0, col).lerp(tip, 0.25 + R() * 0.25);
    grass.push({ x, y: T.terrainHeight(x, z) - 0.03, z, yaw: R() * Math.PI * 2, s: rand(0.7, 1.35), h: R() * 0.5, color: `#${col.getHexString()}` });
  }
  return { items, grass };
}

// ---------------------------------------------------------------------------------------------
// The World view
// ---------------------------------------------------------------------------------------------
const VIEWS = {
  overview: { label: 'Overview', cam: [95, 210, -80], target: [18, 0, 125] },
  village: { label: 'Village', cam: [17, 13, -21], target: [-2, 2, 9] },
  forge: { label: 'Forge', cam: [-2.5, 6.5, 2], target: [-14, 2.5, 13] },
  trail: { label: 'Trail', cam: [12, 9, 50], target: [20, 2, 92] },
  quarry: { label: 'Quarry', cam: [62, 24, 142], target: [38, -2, 172] },
  foundry: { label: 'Foundry', cam: [22, 18, 222], target: [2, 6, 262] },
};
const LAYERS = [
  ['buildings', 'Buildings & props'],
  ['nature', 'Trees, rocks, shrubs'],
  ['ores', 'Ores & crystals'],
  ['grass', 'Wind grass'],
  ['particles', 'Particles'],
  ['backdrop', 'Backdrop mountains'],
  ['markers', 'Gameplay markers'],
];
const ATMO_FIELDS = [
  ['exposure', 'Exposure', 0.4, 2, 0.05],
  ['bloomStrength', 'Bloom strength', 0, 2.5, 0.05],
  ['bloomRadius', 'Bloom radius', 0, 1, 0.05],
  ['bloomThreshold', 'Bloom threshold', 0.3, 1.2, 0.01],
  ['fog', 'Fog density', 0, 0.02, 0.0005],
  ['vignette', 'Vignette', 0, 0.8, 0.02],
  ['contrast', 'Contrast', 0.8, 1.3, 0.01],
  ['saturation', 'Saturation', 0.6, 1.4, 0.01],
  ['warmth', 'Warmth', -0.15, 0.2, 0.01],
  ['grain', 'Film grain', 0, 0.1, 0.005],
];
const GEN_FIELDS = [
  ['trees', 'Trees'],
  ['rocks', 'Rocks'],
  ['shrubs', 'Shrubs'],
  ['logs', 'Fallen logs'],
  ['ores', 'Ore clusters'],
  ['crystals', 'Crystal clusters'],
  ['grass', 'Grass'],
];
const BACKDROP = new Set(['ridge_chunk', 'mesa_tile', 'hills_tile']);
const NATURE = new Set(['ironwood_tree', 'broadleaf_tree', 'gilded_birch', 'rock_cluster', 'shrub', 'fallen_log', 'cliff_wall']);
const ORES = new Set(['iron_ore_node', 'ironglass_cluster']);

export async function createWorld(ctx) {
  const { renderer, viewport } = ctx;
  const $ = (s) => document.querySelector(s);
  const left = $('#world-left');
  const right = $('#world-right');
  const tools = $('#world-tools');
  const statsEl = $('#world-stats');

  const W = {
    scene: null,
    gen: null,
    layers: { buildings: true, nature: true, ores: true, grass: true, particles: true, backdrop: true, markers: false },
    selected: null,
    tab: 'atmosphere',
    dirty: false,
    undo: [],
    redo: [],
    fly: null,
    tween: null,
    active: false,
  };
  W.scene = normalizeScene(defaultScene());

  // ---- Three setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = D2R(88);
  controls.maxDistance = 650;
  controls.minDistance = 2;
  controls.screenSpacePanning = false;
  controls.enabled = false;
  camera.position.set(...VIEWS.village.cam);
  controls.target.set(...VIEWS.village.target);

  const sky = createSky();
  scene.add(sky);
  const hemi = new THREE.HemisphereLight('#cfe1ff', '#3d3527', 0.9);
  const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 500;
  scene.add(hemi, sun, sun.target);
  scene.fog = new THREE.FogExp2('#b7c4cf', 0.004);

  const terrainBank = new MaterialBank(ctx.theme());
  const detail = terrainBank.get('grass').map ?? null;
  const terrain = T.buildTerrain({ detail });
  scene.add(terrain);

  const groups = { buildings: new THREE.Group(), nature: new THREE.Group(), ores: new THREE.Group(), backdrop: new THREE.Group(), particles: new THREE.Group(), markers: new THREE.Group(), lights: new THREE.Group() };
  for (const g of Object.values(groups)) scene.add(g);
  let grassMesh = null;
  const timeU = { value: 0 };

  const post = createPost(renderer, scene, camera);
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.showY = false;
  gizmo.enabled = false;
  const gizmoHelper = gizmo.getHelper();
  gizmoHelper.visible = false;
  scene.add(gizmoHelper);
  const proxy = new THREE.Object3D();
  scene.add(proxy);
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5fd6f5', transparent: true, opacity: 0.85, depthTest: false }));
  selRing.renderOrder = 5;
  selRing.visible = false;
  scene.add(selRing);

  // ---- Models -> instanced meshes
  let bank = new MaterialBank(ctx.theme());
  const modelCache = new Map(); // id -> { parts:[{geometry, material}], radius, height } | null
  function modelOf(id) {
    if (modelCache.has(id)) return modelCache.get(id);
    const r = ctx.getRecipe(id);
    if (!r || r.kind === 'asset') {
      modelCache.set(id, null);
      return null;
    }
    const opt = optimizeForGame(buildModel(r, bank));
    const box = new THREE.Box3().setFromObject(opt);
    const size = box.getSize(new THREE.Vector3());
    const m = {
      parts: opt.children.map((c) => ({ geometry: c.geometry, material: c.material })),
      radius: Math.hypot(size.x, size.z) / 2,
      height: size.y,
      tris: modelStats(opt).tris,
    };
    for (const p of m.parts) if (p.material.emissive) p.material.userData.baseGlow = p.material.emissiveIntensity;
    modelCache.set(id, m);
    return m;
  }
  function invalidateModels() {
    for (const m of modelCache.values()) m?.parts.forEach((p) => p.geometry.dispose());
    modelCache.clear();
    bank = new MaterialBank(ctx.theme());
  }

  let instRefs = new Map(); // modelId -> { items, meshes }
  const m4 = new THREE.Matrix4();
  const qY = new THREE.Quaternion();
  const vS = new THREE.Vector3();
  const vP = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function itemMatrix(it, out = m4) {
    qY.setFromAxisAngle(UP, D2R(it.yaw));
    vS.setScalar(it.scale);
    vP.set(it.x, T.terrainHeight(it.x, it.z) + (it.y ?? 0), it.z);
    return out.compose(vP, qY, vS);
  }
  function layerOf(model, it) {
    if (BACKDROP.has(model)) return 'backdrop';
    if (ORES.has(model)) return 'ores';
    if (it?.gen && it.gen !== 'nodes') return 'nature';
    if (NATURE.has(model)) return 'nature';
    return 'buildings';
  }
  function footprints() {
    return W.scene.placements
      .map((p) => {
        const m = modelOf(p.model);
        return m && !BACKDROP.has(p.model) ? { x: p.x, z: p.z, r: m.radius * p.scale * 0.85 + 1 } : null;
      })
      .filter(Boolean);
  }
  function rebuildInstances() {
    for (const k of ['buildings', 'nature', 'ores', 'backdrop']) {
      for (const c of [...groups[k].children]) {
        groups[k].remove(c);
        c.dispose?.();
      }
    }
    instRefs = new Map();
    const all = [...W.scene.placements.map((p) => ({ ...p, ref: p, kind: 'placement' })), ...W.gen.items.map((g) => ({ ...g, ref: g, kind: 'gen' }))];
    const byModel = new Map();
    for (const it of all) {
      if (!modelOf(it.model)) continue;
      const k = `${it.model}|${layerOf(it.model, it)}`;
      if (!byModel.has(k)) byModel.set(k, []);
      byModel.get(k).push(it);
    }
    for (const [k, items] of byModel) {
      const [model, layer] = k.split('|');
      const mdl = modelOf(model);
      const meshes = mdl.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, items.length);
        items.forEach((it, i) => im.setMatrixAt(i, itemMatrix(it)));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = layer !== 'backdrop';
        im.receiveShadow = true;
        im.userData = { key: k };
        im.computeBoundingSphere();
        groups[layer].add(im);
        return im;
      });
      items.forEach((it, i) => {
        it.ref.__key = k;
        it.ref.__idx = i;
      });
      instRefs.set(k, { items, meshes });
    }
  }
  function updateInstance(ref) {
    const e = instRefs.get(ref.__key);
    if (!e) return;
    itemMatrix(ref);
    for (const im of e.meshes) {
      im.setMatrixAt(ref.__idx, m4);
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }

  // ---- Particles, lights, markers
  let fields = [];
  let lights = [];
  function rebuildFx() {
    for (const f of fields) {
      groups.particles.remove(f.points);
      f.dispose();
    }
    fields = [];
    for (const l of lights) groups.lights.remove(l.light);
    lights = [];
    const t = TIMES[W.scene.atmosphere.time];
    const dens = W.scene.atmosphere.particles;
    const em = { embers: [], sparks: [], smoke: [], dust: [], wisps: [], motes: [] };
    const all = [...W.scene.placements, ...W.gen.items];
    const v = new THREE.Vector3();
    for (const it of all) {
      const list = EMITTERS[it.model];
      if (!list) continue;
      itemMatrix(it);
      for (const e of list) {
        v.fromArray(e.at).applyMatrix4(m4);
        em[e.preset].push({ x: v.x, y: v.y, z: v.z, count: e.count, radius: (e.radius ?? undefined) && e.radius * it.scale });
      }
    }
    // Hotspot lights (nearest few of each kind).
    for (const it of W.scene.placements) {
      const L = HOT_LIGHTS[it.model];
      if (!L || lights.filter((l) => l.model === it.model).length >= 2) continue;
      itemMatrix(it);
      v.fromArray(L.at).applyMatrix4(m4);
      const light = new THREE.PointLight(L.color, L.intensity, L.distance, 1.7);
      light.position.copy(v);
      groups.lights.add(light);
      lights.push({ light, model: it.model, base: L.intensity, flicker: L.flicker, pulse: L.pulse });
    }
    // Ambient volumes: drifting dust in the village and along the trail; fireflies at dusk.
    em.dust.push({ x: 0, y: 1, z: 6, count: 70, radius: 22, height: 5 });
    for (let s = 40; s < T.PATH_LENGTH; s += 28) {
      const p = T.pathAt(s);
      em.dust.push({ x: p.x, y: T.terrainHeight(p.x, p.z) + 0.6, z: p.z, count: 30, radius: 14, height: 4 });
    }
    if (t.night > 0.15) {
      const R = rng(99);
      for (let i = 0; i < 46; i++) {
        const s = 30 + R() * (T.PATH_LENGTH - 40);
        const p = T.pathAt(s);
        const side = R() > 0.5 ? 1 : -1;
        const x = p.x + p.tz * side * (8 + R() * 8);
        const z = p.z - p.tx * side * (8 + R() * 8);
        em.wisps.push({ x, y: T.terrainHeight(x, z) + 0.8, z, count: Math.round(10 * t.night), radius: 6, height: 2.2 });
      }
    }
    for (const [preset, list] of Object.entries(em)) {
      if (!list.length) continue;
      const f = new ParticleField(preset, list, { density: dens, pixelRatio: renderer.getPixelRatio() });
      groups.particles.add(f.points);
      fields.push(f);
    }
    rebuildMarkers();
  }
  function rebuildMarkers() {
    for (const c of [...groups.markers.children]) groups.markers.remove(c);
    const cap = (color, h, x, z) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.28 * (h / 1.8), h - 0.56 * (h / 1.8), 4, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 }));
      m.position.set(x, T.terrainHeight(x, z) + h / 2, z);
      groups.markers.add(m);
    };
    const ring = (color, r, x, z) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
      m.position.set(x, T.terrainHeight(x, z) + 0.08, z);
      groups.markers.add(m);
    };
    cap('#5fd6f5', 1.8, T.PLAYER_SPAWN.x, T.PLAYER_SPAWN.z);
    ring('#5fd6f5', 1.2, T.PLAYER_SPAWN.x, T.PLAYER_SPAWN.z);
    for (const n of T.NPCS) {
      cap('#e0b84e', n.height, n.pos.x, n.pos.z);
      ring('#e0b84e', 1.4, n.pos.x, n.pos.z);
    }
    for (const e of T.ENEMY_SPAWNS) {
      cap(e.type === 'dummy' ? '#c8b28a' : '#ef6b5b', e.height, e.pos.x, e.pos.z);
      if (e.patrol) {
        const pts = [...e.patrol, e.patrol[0]].map((p) => new THREE.Vector3(p.x, T.terrainHeight(p.x, p.z) + 0.2, p.z));
        groups.markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ef6b5b' })));
      }
    }
    for (const n of T.RESOURCE_NODES) ring(n.material === 'iron_ore' ? '#ff8a3d' : n.material === 'ironglass' ? '#5fd6f5' : '#8fcf6a', 2.2, n.pos.x, n.pos.z);
    const path = T.PATH.map((p) => new THREE.Vector3(p.x, T.terrainHeight(p.x, p.z) + 0.25, p.z));
    groups.markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineDashedMaterial({ color: '#e0b84e', dashSize: 2, gapSize: 1.2 })).computeLineDistances());
  }
  function rebuildGrass() {
    if (grassMesh) {
      scene.remove(grassMesh);
      grassMesh.geometry.dispose();
      grassMesh.material.dispose();
      grassMesh = null;
    }
    if (!W.gen.grass.length) return;
    grassMesh = createGrass(W.gen.grass, timeU);
    grassMesh.visible = W.layers.grass;
    scene.add(grassMesh);
  }
  function regenerate() {
    W.gen = generate(W.scene, footprints());
    rebuildInstances();
    rebuildGrass();
    rebuildFx();
    applyLayers();
    renderLeft();
  }

  // ---- Atmosphere
  function atmo() {
    const a = W.scene.atmosphere;
    const t = TIMES[a.time];
    const o = a.overrides;
    return {
      t,
      exposure: o.exposure ?? t.exposure,
      bloomStrength: o.bloomStrength ?? t.bloom[0],
      bloomRadius: o.bloomRadius ?? t.bloom[1],
      bloomThreshold: o.bloomThreshold ?? t.bloom[2],
      fog: o.fog ?? t.fog[1],
      vignette: o.vignette ?? t.grade.vignette,
      contrast: o.contrast ?? t.grade.contrast,
      saturation: o.saturation ?? t.grade.saturation,
      warmth: o.warmth ?? t.grade.warmth,
      grain: o.grain ?? 0.03,
    };
  }
  function applyAtmosphere() {
    const A = atmo();
    const t = A.t;
    const dir = sunDirection(t);
    sun.color.set(t.sun.color);
    sun.intensity = t.sun.intensity;
    sun.userData.dir = dir;
    hemi.color.set(t.hemi[0]);
    hemi.groundColor.set(t.hemi[1]);
    hemi.intensity = t.hemi[2];
    sky.material.uniforms.uZenith.value.set(t.zenith);
    sky.material.uniforms.uHorizon.value.set(t.horizon);
    sky.material.uniforms.uSunColor.value.set(t.sun.color);
    sky.material.uniforms.uSunDir.value.copy(dir);
    sky.material.uniforms.uNight.value = t.night;
    scene.fog.color.set(t.fog[0]);
    scene.fog.density = A.fog;
    renderer.toneMappingExposure = A.exposure;
    post.bloom.strength = A.bloomStrength;
    post.bloom.radius = A.bloomRadius;
    post.bloom.threshold = A.bloomThreshold;
    const g = post.grade.uniforms;
    g.uVignette.value = A.vignette;
    g.uContrast.value = A.contrast;
    g.uSaturation.value = A.saturation;
    g.uWarmth.value = A.warmth;
    g.uGrain.value = A.grain;
    for (const m of modelCache.values()) m?.parts.forEach((p) => p.material.emissive && (p.material.emissiveIntensity = (p.material.userData.baseGlow ?? 1) * t.glow));
    sun.castShadow = W.scene.atmosphere.shadows;
    for (const l of lights) l.light.visible = true;
  }
  function setTime(k) {
    const prevNight = TIMES[W.scene.atmosphere.time].night > 0.15;
    W.scene.atmosphere.time = k;
    W.scene.atmosphere.overrides = {};
    applyAtmosphere();
    if (prevNight !== TIMES[k].night > 0.15) rebuildFx();
    markDirty();
    renderRight();
  }
  function applyLayers() {
    for (const k of ['buildings', 'nature', 'ores', 'backdrop', 'particles', 'markers']) groups[k].visible = W.layers[k];
    if (grassMesh) grassMesh.visible = W.layers.grass;
  }

  // ---- Camera helpers
  function goView(k) {
    const v = VIEWS[k];
    stopFly();
    W.tween = { t: 0, dur: 1.3, fromC: camera.position.clone(), fromT: controls.target.clone(), toC: new THREE.Vector3(...v.cam), toT: new THREE.Vector3(...v.target) };
    W.tween.toC.y = Math.max(W.tween.toC.y, T.terrainHeight(v.cam[0], v.cam[2]) + 6);
  }
  function focusOn(x, z, r = 8) {
    const y = T.terrainHeight(x, z);
    const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
    if (dir.lengthSq() < 0.1) dir.set(0, 0, -1);
    W.tween = { t: 0, dur: 0.9, fromC: camera.position.clone(), fromT: controls.target.clone(), toT: new THREE.Vector3(x, y + r * 0.25, z), toC: new THREE.Vector3(x + dir.x * r * 2.2, y + r * 1.3, z + dir.z * r * 2.2) };
  }
  function startFly() {
    W.fly = { s: 0, speed: 4.2 };
    W.tween = null;
    controls.enabled = false;
    renderLeft();
  }
  function stopFly() {
    if (!W.fly) return;
    W.fly = null;
    controls.enabled = W.active;
    renderLeft();
  }
  const keys = new Set();

  // ---- Selection & editing
  const ray = new THREE.Raycaster();
  let downAt = null;
  function onPointerDown(e) {
    if (!W.active) return;
    downAt = [e.clientX, e.clientY];
    stopFly();
    W.tween = null;
  }
  function onPointerUp(e) {
    if (!W.active || !downAt || gizmo.dragging) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 5 || gizmo.axis) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const targets = [];
    for (const k of ['buildings', 'nature', 'ores']) if (groups[k].visible) targets.push(...groups[k].children);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return select(null);
    const e2 = instRefs.get(hit.object.userData.key);
    const it = e2?.items[hit.instanceId];
    select(it ? it.ref : null);
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  function select(ref) {
    W.selected = ref;
    if (ref && W.scene.placements.includes(ref)) {
      proxy.position.set(ref.x, T.terrainHeight(ref.x, ref.z) + ref.y, ref.z);
      proxy.rotation.set(0, D2R(ref.yaw), 0);
      gizmo.attach(proxy);
      gizmoHelper.visible = true;
    } else {
      gizmo.detach();
      gizmoHelper.visible = false;
    }
    if (ref) {
      const m = modelOf(ref.model);
      const r = Math.max(0.8, (m?.radius ?? 1) * ref.scale);
      selRing.scale.setScalar(r);
      selRing.position.set(ref.x, T.terrainHeight(ref.x, ref.z) + 0.15, ref.z);
      selRing.visible = true;
    } else selRing.visible = false;
    W.tab = ref ? 'placement' : W.tab === 'placement' ? 'atmosphere' : W.tab;
    renderRight();
    renderLeft();
  }
  let dragSnap = null;
  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value && W.active && !W.fly;
    if (e.value) dragSnap = JSON.stringify(W.scene.placements);
    else if (dragSnap !== null) {
      if (dragSnap !== JSON.stringify(W.scene.placements)) {
        pushUndo(dragSnap);
        rebuildFx();
      }
      dragSnap = null;
      renderRight();
    }
  });
  gizmo.addEventListener('objectChange', () => {
    const ref = W.selected;
    if (!ref) return;
    ref.x = r2(proxy.position.x);
    ref.z = r2(proxy.position.z);
    ref.yaw = r2(R2D(proxy.rotation.y));
    proxy.position.y = T.terrainHeight(ref.x, ref.z) + ref.y;
    proxy.rotation.set(0, D2R(ref.yaw), 0);
    selRing.position.set(ref.x, T.terrainHeight(ref.x, ref.z) + 0.15, ref.z);
    updateInstance(ref);
    liveFields(ref);
  });
  function pushUndo(snap) {
    W.undo.push(snap);
    if (W.undo.length > 60) W.undo.shift();
    W.redo = [];
    markDirty();
  }
  function changePlacements(fn, { regen = false } = {}) {
    const snap = JSON.stringify(W.scene.placements);
    fn(W.scene.placements);
    pushUndo(snap);
    if (regen) regenerate();
    else {
      rebuildInstances();
      rebuildFx();
      applyLayers();
      applyAtmosphere();
    }
    if (W.selected && !W.scene.placements.includes(W.selected)) select(null);
    else select(W.selected);
  }
  function restorePlacements(json) {
    const keep = W.selected?.id;
    W.scene.placements = JSON.parse(json);
    rebuildInstances();
    rebuildFx();
    applyLayers();
    applyAtmosphere();
    select(W.scene.placements.find((p) => p.id === keep) ?? null);
    markDirty();
  }
  function undo() {
    if (!W.undo.length) return;
    W.redo.push(JSON.stringify(W.scene.placements));
    restorePlacements(W.undo.pop());
  }
  function redo() {
    if (!W.redo.length) return;
    W.undo.push(JSON.stringify(W.scene.placements));
    restorePlacements(W.redo.pop());
  }
  function markDirty() {
    W.dirty = true;
    const b = document.getElementById('w-save');
    if (b) b.textContent = 'Save scene for the team •';
  }
  function viewCenterGround() {
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = ray.intersectObject(terrain, false)[0];
    return hit ? hit.point : controls.target.clone();
  }

  // ---- UI: left panel
  function renderLeft() {
    const G = W.scene.generators;
    const counts = {};
    for (const it of W.gen?.items ?? []) counts[it.gen] = (counts[it.gen] ?? 0) + 1;
    const q = (left.dataset.q ?? '').toLowerCase();
    const list = W.scene.placements
      .filter((p) => !q || `${p.model} ${ctx.nameOf(p.model)}`.toLowerCase().includes(q))
      .map((p) => `<button class="part-row" data-pl="${esc(p.id)}" aria-current="${W.selected === p}"><span class="sw" style="background:${BACKDROP.has(p.model) ? '#6a6660' : NATURE.has(p.model) ? '#3d5230' : '#b8913a'}"></span><span>${esc(ctx.nameOf(p.model))}</span><small>${Math.round(p.x)}, ${Math.round(p.z)}</small></button>`)
      .join('');
    left.innerHTML = `
      <div class="section"><h3>Views</h3>
        <div class="chips">${Object.entries(VIEWS).map(([k, v]) => `<button class="chip" data-view="${k}">${v.label}</button>`).join('')}</div>
        <button class="btn ${W.fly ? '' : 'primary'}" id="w-fly">${W.fly ? 'Stop flythrough' : 'Fly the trail'}</button>
        <p class="note">Drag to orbit, right-drag to pan, scroll to zoom. <span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span> glide, <span class="kbd">Q</span>/<span class="kbd">E</span> lower/raise.</p>
      </div>
      <div class="section"><h3>Layers</h3>
        ${LAYERS.map(([k, l]) => `<label class="check"><input type="checkbox" data-layer="${k}" ${W.layers[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      </div>
      <div class="section"><h3>Procedural generation</h3>
        <div class="row"><label class="row-label" for="w-seed">Seed</label><input type="number" id="w-seed" value="${G.seed}" step="1" style="width:100px"><button class="btn icon" id="w-reroll" title="New random seed">Reroll</button></div>
        ${GEN_FIELDS.map(([k, l]) => `<label class="field"><span>${l} <b class="mono">${G[k].toFixed(2)}×</b>${counts[k] !== undefined ? ` · ${counts[k]}` : k === 'grass' ? ` · ${W.gen?.grass.length ?? 0} clumps` : ''}</span><input type="range" data-gen="${k}" min="0" max="2" step="0.05" value="${G[k]}"></label>`).join('')}
        <p class="note">Ore seams follow a noise “richness” field along the trail and in the quarry; each seam is a 2–4 node cluster. The 17 gameplay nodes always sit at the game’s exact positions (turn on Gameplay markers to see them).</p>
      </div>
      <div class="section"><h3>Placements <small class="note">${W.scene.placements.length}</small></h3>
        <input type="search" id="w-q" placeholder="Filter placements" value="${esc(left.dataset.q ?? '')}">
        <div class="parts-list" style="max-height:320px">${list || '<p class="empty">None match.</p>'}</div>
      </div>`;
  }
  left.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) return goView(b.dataset.view);
    if (b.dataset.pl) {
      const p = W.scene.placements.find((x) => x.id === b.dataset.pl);
      if (p) {
        select(p);
        focusOn(p.x, p.z, Math.max(6, (modelOf(p.model)?.radius ?? 3) * p.scale * 1.6));
      }
      return;
    }
    if (b.id === 'w-fly') return W.fly ? stopFly() : startFly();
    if (b.id === 'w-reroll') {
      W.scene.generators.seed = Math.floor(Math.random() * 99999);
      W.scene.generators.suppress = [];
      markDirty();
      regenerate();
    }
  });
  left.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.layer) {
      W.layers[el.dataset.layer] = el.checked;
      return applyLayers();
    }
    if (el.dataset.gen) {
      W.scene.generators[el.dataset.gen] = Number(el.value);
      W.scene.generators.suppress = [];
      markDirty();
      return regenerate();
    }
    if (el.id === 'w-seed') {
      W.scene.generators.seed = Math.max(0, Math.floor(Number(el.value) || 0));
      W.scene.generators.suppress = [];
      markDirty();
      regenerate();
    }
  });
  left.addEventListener('input', (e) => {
    if (e.target.id === 'w-q') {
      left.dataset.q = e.target.value;
      const pos = e.target.selectionStart;
      renderLeft();
      const el = document.getElementById('w-q');
      el.focus();
      el.setSelectionRange(pos, pos);
    }
    if (e.target.dataset.gen) e.target.previousElementSibling.querySelector('b').textContent = `${Number(e.target.value).toFixed(2)}×`;
  });

  // ---- UI: right panel
  function renderRight() {
    const tabs = [
      ['placement', 'Placement'],
      ['atmosphere', 'Atmosphere'],
      ['scene', 'Scene'],
    ];
    let body = '';
    if (W.tab === 'placement') body = placementPanel();
    else if (W.tab === 'atmosphere') body = atmospherePanel();
    else body = scenePanel();
    right.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-wtab="${k}" aria-selected="${W.tab === k}">${l}</button>`).join('')}</div><div class="tab-body">${body}</div>`;
  }
  function modelOptions(sel) {
    return ctx
      .listModels()
      .filter((m) => m.category !== 'imported')
      .map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`)
      .join('');
  }
  function placementPanel() {
    const ref = W.selected;
    const add = `<div class="section"><h3>Add to the world</h3><div class="row"><select id="w-add-model" aria-label="Model to add">${modelOptions('aether_lamp')}</select><button class="btn primary" id="w-add">Add at view centre</button></div><p class="note">Edits in the Models view show up here: reopen World after saving or editing a model.</p></div>`;
    if (!ref) return `<div class="section"><p class="empty">Click a building, prop or tree in the world to select it.</p></div>${add}`;
    const isPl = W.scene.placements.includes(ref);
    const m = modelOf(ref.model);
    if (!isPl)
      return `<div class="section"><h3>${esc(ctx.nameOf(ref.model))}</h3>
        <p class="note">Placed by the <b>${esc(ref.gen)}</b> generator${ref.gameplay ? ' at a gameplay resource-node position from the game' : ''}. Scale ${ref.scale.toFixed(2)}, ${m?.tris ?? 0} triangles each.</p>
        <div class="row"><button class="btn primary" id="w-bake">Make editable</button><button class="btn danger" id="w-remove-gen">Remove</button></div>
        <p class="note">“Make editable” turns it into a hand placement you can move; regenerating with new settings brings generated items back.</p></div>${add}`;
    return `<div class="section"><h3>${esc(ctx.nameOf(ref.model))} <span class="row"><button class="btn icon" id="w-dup">Duplicate</button><button class="btn icon danger" id="w-del">Delete</button></span></h3>
        <label class="field"><span>Model</span><select id="w-model">${modelOptions(ref.model)}</select></label>
        <div class="grid2">
          <label class="field"><span>X (east)</span><input type="number" id="w-x" step="0.5" value="${ref.x}"></label>
          <label class="field"><span>Z (north)</span><input type="number" id="w-z" step="0.5" value="${ref.z}"></label>
          <label class="field"><span>Turn (°)</span><input type="number" id="w-yaw" step="5" value="${ref.yaw}"></label>
          <label class="field"><span>Scale</span><input type="number" id="w-scale" step="0.05" min="0.05" value="${ref.scale}"></label>
          <label class="field"><span>Height offset (m)</span><input type="number" id="w-y" step="0.1" value="${ref.y}"></label>
          <div class="field"><span>Ground</span><span class="mono">${T.terrainHeight(ref.x, ref.z).toFixed(2)} m</span></div>
        </div>
        <div class="row"><button class="btn" data-gmode="translate" aria-pressed="${gizmo.mode === 'translate'}">Move</button><button class="btn" data-gmode="rotate" aria-pressed="${gizmo.mode === 'rotate'}">Turn</button><button class="btn" id="w-focus">Focus</button></div>
        <p class="note">Objects follow the game’s terrain height automatically. ${m ? `${m.tris.toLocaleString()} triangles, ${m.parts.length} draw call${m.parts.length > 1 ? 's' : ''} (shared by every copy).` : ''}</p>
      </div>${add}`;
  }
  function liveFields(ref) {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = v;
    };
    set('w-x', ref.x);
    set('w-z', ref.z);
    set('w-yaw', ref.yaw);
  }
  function atmospherePanel() {
    const A = atmo();
    const a = W.scene.atmosphere;
    return `<div class="section"><h3>Time of day</h3>
        <div class="chips">${Object.entries(TIMES).map(([k, t]) => `<button class="chip" data-time="${k}" aria-pressed="${a.time === k}">${t.label}</button>`).join('')}</div>
      </div>
      <div class="section"><h3>Light & post-processing <button class="btn icon" id="w-atmo-reset" ${Object.keys(a.overrides).length ? '' : 'disabled'}>Reset</button></h3>
        ${ATMO_FIELDS.map(([k, l, min, max, st]) => `<label class="field"><span>${l} <b class="mono">${(+A[k]).toFixed(st < 0.01 ? 4 : 2)}</b></span><input type="range" data-atmo="${k}" min="${min}" max="${max}" step="${st}" value="${A[k]}"></label>`).join('')}
        <label class="field"><span>Particle density <b class="mono">${a.particles.toFixed(2)}×</b></span><input type="range" id="w-particles" min="0" max="2.5" step="0.05" value="${a.particles}"></label>
        <label class="check"><input type="checkbox" id="w-shadows" ${a.shadows ? 'checked' : ''}> Sun shadows</label>
        <p class="note">Pipeline: 4× MSAA HDR render → bloom → ACES tone mapping → grade (contrast, saturation, warm highlights / cool shadows, vignette, grain). Lamps, ember and aether materials glow brighter as the light falls.</p>
      </div>`;
  }
  function scenePanel() {
    return `<div class="section"><h3>Scene</h3>
        <label class="field"><span>Name</span><input type="text" id="w-name" value="${esc(W.scene.name)}" maxlength="80"></label>
        <div class="row"><button class="btn primary" id="w-save" ${ctx.db() ? '' : 'disabled'}>Save scene for the team${W.dirty ? ' •' : ''}</button></div>
        <div class="row"><button class="btn" id="w-export-json">Export scene (.json)</button><button class="btn" id="w-export-pack">Export world pack (.zip)</button></div>
        <div class="row"><button class="btn" id="w-import">Import scene (.json)</button><input type="file" id="w-import-file" accept=".json" hidden><button class="btn danger" id="w-reset">Reset to default layout</button></div>
        <p class="note">The world pack holds the scene layout, every generated object baked to exact positions, the atmosphere settings, a .glb and recipe for each model used, and the terrain and effects source files, ready for porting into the game. Coordinates are the game’s: metres, +Z north from Emberhold.</p>
      </div>`;
  }
  right.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.wtab) {
      W.tab = b.dataset.wtab;
      return renderRight();
    }
    if (b.dataset.time) return setTime(b.dataset.time);
    if (b.dataset.gmode) {
      gizmo.setMode(b.dataset.gmode);
      gizmo.showX = b.dataset.gmode === 'translate';
      gizmo.showZ = b.dataset.gmode === 'translate';
      gizmo.showY = b.dataset.gmode === 'rotate';
      return renderRight();
    }
    const ref = W.selected;
    switch (b.id) {
      case 'w-add': {
        const model = document.getElementById('w-add-model').value;
        const c = viewCenterGround();
        const p = put(model, r2(c.x), r2(c.z), r2(face(c.x, c.z, camera.position.x, camera.position.z)));
        p.id = `pl_${Date.now().toString(36)}`;
        changePlacements((L) => L.push(p));
        return select(p);
      }
      case 'w-dup': {
        const p = { ...clone({ ...ref, __key: undefined, __idx: undefined }), id: `pl_${Date.now().toString(36)}`, x: ref.x + 2, z: ref.z + 2 };
        delete p.__key;
        delete p.__idx;
        changePlacements((L) => L.push(p));
        return select(p);
      }
      case 'w-del':
        return changePlacements((L) => L.splice(L.indexOf(ref), 1));
      case 'w-focus':
        return focusOn(ref.x, ref.z, Math.max(6, (modelOf(ref.model)?.radius ?? 3) * ref.scale * 1.6));
      case 'w-bake': {
        const p = { id: `pl_${Date.now().toString(36)}`, model: ref.model, x: r2(ref.x), z: r2(ref.z), y: ref.y, yaw: r2(ref.yaw), scale: r2(ref.scale) };
        W.scene.generators.suppress.push(ref.key);
        changePlacements((L) => L.push(p));
        W.gen.items = W.gen.items.filter((g) => g !== ref);
        rebuildInstances();
        applyLayers();
        applyAtmosphere();
        return select(p);
      }
      case 'w-remove-gen':
        W.scene.generators.suppress.push(ref.key);
        W.gen.items = W.gen.items.filter((g) => g !== ref);
        markDirty();
        rebuildInstances();
        rebuildFx();
        applyLayers();
        applyAtmosphere();
        return select(null);
      case 'w-atmo-reset':
        W.scene.atmosphere.overrides = {};
        applyAtmosphere();
        markDirty();
        return renderRight();
      case 'w-save':
        return saveScene();
      case 'w-export-json':
        return ctx.offerFile(`${W.scene.id}.scene.json`, JSON.stringify(cleanScene(), null, 1));
      case 'w-export-pack':
        return exportPack();
      case 'w-import':
        return document.getElementById('w-import-file').click();
      case 'w-reset': {
        const ok = await ctx.ask('Reset the world to the default layout?', 'Your placements and generator settings go back to the starting layout. Saved team scenes are unchanged until you save.', 'Reset layout');
        if (!ok) return;
        const snap = JSON.stringify(W.scene.placements);
        W.scene = normalizeScene(defaultScene());
        pushUndo(snap);
        applyAtmosphere();
        regenerate();
        return select(null);
      }
    }
  });
  right.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.atmo) {
      W.scene.atmosphere.overrides[el.dataset.atmo] = Number(el.value);
      el.previousElementSibling.querySelector('b').textContent = Number(el.value).toFixed(Number(el.step) < 0.01 ? 4 : 2);
      applyAtmosphere();
      markDirty();
    }
  });
  right.addEventListener('change', async (e) => {
    const el = e.target;
    const ref = W.selected;
    if (el.id === 'w-particles') {
      W.scene.atmosphere.particles = Number(el.value);
      rebuildFx();
      markDirty();
      return renderRight();
    }
    if (el.id === 'w-shadows') {
      W.scene.atmosphere.shadows = el.checked;
      applyAtmosphere();
      return markDirty();
    }
    if (el.id === 'w-name') {
      W.scene.name = el.value.slice(0, 80) || W.scene.name;
      return markDirty();
    }
    if (el.id === 'w-import-file') {
      const f = el.files?.[0];
      el.value = '';
      if (!f) return;
      try {
        const s = normalizeScene(JSON.parse(await f.text()));
        const snap = JSON.stringify(W.scene.placements);
        W.scene = s;
        pushUndo(snap);
        applyAtmosphere();
        regenerate();
        select(null);
        ctx.toast(`Loaded scene “${s.name}”.`, 'good');
      } catch (err) {
        ctx.toast(`That file isn’t a scene: ${err.message}`, 'bad');
      }
      return;
    }
    if (!ref || !W.scene.placements.includes(ref)) return;
    const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
    const map = { 'w-x': 'x', 'w-z': 'z', 'w-yaw': 'yaw', 'w-scale': 'scale', 'w-y': 'y' };
    if (map[el.id]) {
      const k = map[el.id];
      return changePlacements(() => (ref[k] = k === 'scale' ? Math.max(0.05, num(el.value, ref[k])) : num(el.value, ref[k])));
    }
    if (el.id === 'w-model') return changePlacements(() => (ref.model = el.value));
  });

  function cleanScene() {
    const s = clone(W.scene);
    for (const p of s.placements) {
      delete p.__key;
      delete p.__idx;
    }
    return s;
  }
  async function saveScene() {
    const db = ctx.db();
    if (!db) return;
    try {
      const doc = { scene: cleanScene(), updatedAt: new Date().toISOString() };
      if (JSON.stringify(doc).length > 240 * 1024) return ctx.toast('The scene is too large to save (over 240 KB). Remove some placements or suppressed items.', 'bad');
      await db.doc(`scenes/${W.scene.id}`).set(doc);
      W.dirty = false;
      renderRight();
      ctx.toast('Scene saved for the team.', 'good');
    } catch (e) {
      ctx.toast(e?.code === 'invalid_argument' ? 'You don’t have permission to save here. Ask the owner for Contributor access.' : 'Saving the scene failed.', 'bad');
    }
  }
  let sceneUnsub = null;
  function listenTeamScene() {
    const db = ctx.db();
    if (!db || sceneUnsub) return;
    sceneUnsub = db.doc(`scenes/${W.scene.id}`).onSnapshot(
      (snap) => {
        if (!snap.exists || W.dirty) return;
        try {
          W.scene = normalizeScene(snap.data().scene);
          applyAtmosphere();
          regenerate();
          select(null);
          renderRight();
        } catch {
          /* ignore malformed */
        }
      },
      () => {},
    );
  }

  async function exportPack() {
    ctx.toast('Building the world pack…');
    const files = {};
    const scn = cleanScene();
    files['scene.json'] = strToU8(JSON.stringify(scn, null, 1));
    files['generated.json'] = strToU8(
      JSON.stringify(
        {
          note: 'Every generated object, baked. y is the offset above terrainHeight(x, z).',
          seed: scn.generators.seed,
          items: W.gen.items.map((g) => ({ model: g.model, x: r2(g.x), z: r2(g.z), y: r2(g.y), yaw: r2(g.yaw), scale: r2(g.scale), gen: g.gen, gameplay: g.gameplay || undefined })),
          grass: W.gen.grass.map((g) => [r2(g.x), r2(g.z), r2(g.yaw), r2(g.s), r2(g.h), g.color]),
        },
        null,
        0,
      ),
    );
    const A = atmo();
    files['atmosphere.json'] = strToU8(JSON.stringify({ time: scn.atmosphere.time, preset: A.t, resolved: { ...A, t: undefined }, particles: scn.atmosphere.particles, shadows: scn.atmosphere.shadows }, null, 1));
    const used = new Set([...scn.placements.map((p) => p.model), ...W.gen.items.map((g) => g.model)]);
    const manifest = [];
    for (const id of used) {
      const r = ctx.getRecipe(id);
      if (!r || r.kind === 'asset') continue;
      files[`recipes/${id}.json`] = strToU8(JSON.stringify(r, null, 1));
      const opt = optimizeForGame(buildModel(r, new MaterialBank(ctx.theme())));
      opt.name = id;
      const glb = new Uint8Array(await new GLTFExporter().parseAsync(opt, { binary: true, maxTextureSize: 512 }));
      files[`models/${id}.glb`] = glb;
      manifest.push({ id, name: r.name, file: `models/${id}.glb`, recipe: `recipes/${id}.json`, bytes: glb.byteLength });
      await new Promise((res) => setTimeout(res, 0));
    }
    files['models/manifest.json'] = strToU8(JSON.stringify({ format: 'alloy-model-pack', version: 1, models: manifest }, null, 1));
    for (const src of ['terrain.js', 'fx.js', 'world.js', 'core.js']) {
      try {
        const res = await fetch(`./${src}`);
        if (res.ok) files[`src/${src}`] = new Uint8Array(await res.arrayBuffer());
      } catch {
        /* source copy is optional */
      }
    }
    files['PORTING.md'] = strToU8(`# Emberhold first area: world pack

Made in the Alloy Frontier Model Workshop.

- scene.json         hand placements (model, x, z, yaw°, scale, y offset above terrain) + generator settings + atmosphere
- generated.json     every generated tree/rock/shrub/ore/crystal and grass clump, baked to exact positions
- atmosphere.json    time-of-day preset and the resolved light / fog / bloom / grade values
- models/*.glb       game-ready models (merged per material), recipes/*.json their editable sources
- src/terrain.js     terrain height = exact port of packages/world/src/Terrain.ts (ground colours tweaked)
- src/fx.js          sky, time of day, GPU particles, wind grass, post-processing (three.js only)

Coordinates match the game: metres, +Z north, terrainHeight() from the game's Terrain.ts.
Colliders stay in code on the server (packages/world); visuals can load from this pack on the client.
`);
    await ctx.offerFile(`${scn.id}-world-pack.zip`, zipSync(files, { level: 6 }));
  }

  // ---- Toolbars & stats
  tools.innerHTML = `<div class="toolgroup" role="group" aria-label="World tools"><button class="btn" id="wt-move" aria-pressed="true" title="Move along the ground">Move</button><button class="btn" id="wt-turn" aria-pressed="false" title="Turn around the vertical axis">Turn</button></div>
    <div class="toolgroup"><button class="btn" id="wt-markers" aria-pressed="${W.layers.markers}" title="Spawns, NPCs, enemy patrols and resource nodes from the game">Gameplay markers</button><button class="btn" id="wt-shot" title="Hide the panels for a clean view">Clean view</button></div>`;
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'wt-move' || b.id === 'wt-turn') {
      const mode = b.id === 'wt-move' ? 'translate' : 'rotate';
      gizmo.setMode(mode);
      gizmo.showX = gizmo.showZ = mode === 'translate';
      gizmo.showY = mode === 'rotate';
      document.getElementById('wt-move').setAttribute('aria-pressed', String(mode === 'translate'));
      document.getElementById('wt-turn').setAttribute('aria-pressed', String(mode === 'rotate'));
      if (W.tab === 'placement') renderRight();
    }
    if (b.id === 'wt-markers') {
      W.layers.markers = !W.layers.markers;
      b.setAttribute('aria-pressed', String(W.layers.markers));
      applyLayers();
      renderLeft();
    }
    if (b.id === 'wt-shot') document.querySelector('.app').classList.toggle('clean-view');
  });

  let fpsAcc = 0;
  let fpsN = 0;
  let fpsShown = 0;
  function renderStats(dt) {
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc < 0.5) return;
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0;
    fpsN = 0;
    const info = renderer.info.render;
    const inst = (W.gen?.items.length ?? 0) + W.scene.placements.length;
    statsEl.innerHTML = `<span><b>${fpsShown}</b> fps</span><span>draws <b>${info.calls}</b></span><span>tris <b>${(info.triangles / 1000).toFixed(0)}k</b></span><span>objects <b>${inst.toLocaleString()}</b></span><span>grass <b>${(W.gen?.grass.length ?? 0).toLocaleString()}</b></span>`;
  }

  // ---- Frame
  let time = 0;
  const tmp = new THREE.Vector3();
  function frame(dt) {
    time += dt;
    timeU.value = time;
    sky.material.uniforms.uTime.value = time;
    for (const f of fields) f.update(time);
    for (const l of lights) {
      if (l.flicker) l.light.intensity = l.base * (0.85 + Math.sin(time * 13) * 0.06 + Math.sin(time * 7.3) * 0.08);
      if (l.pulse) l.light.intensity = l.base * (0.8 + Math.sin(time * 1.6) * 0.2);
    }
    // Camera motion
    if (W.fly) {
      W.fly.s += dt * W.fly.speed;
      if (W.fly.s > T.PATH_LENGTH - 8) W.fly.s = 0;
      const p = T.pathAt(W.fly.s);
      const a = T.pathAt(W.fly.s + 16);
      const want = new THREE.Vector3(p.x - p.tz * 2.5, T.terrainHeight(p.x, p.z) + 5.5, p.z + p.tx * 2.5);
      const look = new THREE.Vector3(a.x, T.terrainHeight(a.x, a.z) + 2.2, a.z);
      camera.position.lerp(want, 1 - Math.exp(-dt * 1.8));
      controls.target.lerp(look, 1 - Math.exp(-dt * 2.2));
      camera.lookAt(controls.target);
    } else if (W.tween) {
      const tw = W.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      camera.position.lerpVectors(tw.fromC, tw.toC, k);
      controls.target.lerpVectors(tw.fromT, tw.toT, k);
      if (tw.t >= 1) W.tween = null;
      controls.update();
    } else {
      if (keys.size) {
        const dist = camera.position.distanceTo(controls.target);
        const sp = Math.max(6, dist * 0.9) * dt;
        const fwd = controls.target.clone().sub(camera.position).setY(0).normalize();
        const rightV = new THREE.Vector3().crossVectors(fwd, UP).normalize();
        const mv = new THREE.Vector3();
        if (keys.has('w')) mv.add(fwd);
        if (keys.has('s')) mv.sub(fwd);
        if (keys.has('d')) mv.add(rightV);
        if (keys.has('a')) mv.sub(rightV);
        mv.multiplyScalar(sp);
        if (keys.has('e')) mv.y += sp * 0.6;
        if (keys.has('q')) mv.y -= sp * 0.6;
        camera.position.add(mv);
        controls.target.add(mv);
      }
      controls.update();
    }
    // Keep the camera above ground.
    const gy = T.terrainHeight(camera.position.x, camera.position.z) + 1.2;
    if (camera.position.y < gy) camera.position.y = gy;
    // Sun shadow box follows the view target (snapped to texels to avoid shimmer).
    const dir = sun.userData.dir ?? tmp.set(0.4, 0.8, 0.3);
    const tgt = controls.target;
    const texel = 140 / 2048;
    const sx = Math.round(tgt.x / texel) * texel;
    const sz = Math.round(tgt.z / texel) * texel;
    sun.target.position.set(sx, T.terrainHeight(sx, sz), sz);
    sun.position.copy(sun.target.position).addScaledVector(dir, 220);
    sky.position.copy(camera.position);
    renderer.info.reset();
    post.render(time);
    renderStats(dt);
  }

  function onKey(e, down) {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e'].includes(k)) {
      if (down) {
        keys.add(k);
        stopFly();
        W.tween = null;
      } else keys.delete(k);
      return true;
    }
    if (!down) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') {
      e.shiftKey ? redo() : undo();
      return true;
    }
    if (mod && k === 'y') {
      redo();
      return true;
    }
    if (mod && k === 'd' && W.selected && W.scene.placements.includes(W.selected)) {
      document.getElementById('w-dup')?.click();
      return true;
    }
    if ((k === 'delete' || k === 'backspace') && W.selected && W.scene.placements.includes(W.selected)) {
      changePlacements((L) => L.splice(L.indexOf(W.selected), 1));
      return true;
    }
    if (k === 'f' && W.selected) {
      focusOn(W.selected.x, W.selected.z, Math.max(6, (modelOf(W.selected.model)?.radius ?? 3) * W.selected.scale * 1.6));
      return true;
    }
    if (k === 'escape') {
      stopFly();
      select(null);
      return true;
    }
    return false;
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.setSize(w, h);
  }

  // ---- Build
  regenerate();
  applyAtmosphere();
  renderLeft();
  renderRight();

  return {
    activate() {
      W.active = true;
      renderer.info.autoReset = false;
      controls.enabled = !W.fly;
      gizmo.enabled = true;
      // Pick up model / theme edits from the Models view.
      if (ctx.consumeModelChanges()) {
        invalidateModels();
        const nb = new MaterialBank(ctx.theme());
        terrain.material.map = nb.get('grass').map ?? null;
        terrain.material.needsUpdate = true;
        regenerate();
        applyAtmosphere();
      }
      listenTeamScene();
      const r = viewport.getBoundingClientRect();
      resize(r.width, r.height);
    },
    deactivate() {
      W.active = false;
      renderer.info.autoReset = true;
      controls.enabled = false;
      gizmo.enabled = false;
      keys.clear();
      stopFly();
      document.querySelector('.app').classList.remove('clean-view');
    },
    frame,
    resize,
    onKey,
    get dirty() {
      return W.dirty;
    },
  };
}
