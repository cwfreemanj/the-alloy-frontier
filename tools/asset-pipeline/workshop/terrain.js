// Emberhold Frontier terrain and layout: an exact port of packages/world/src/{noise,Layout,Terrain}.ts
// from the game, so anything placed here sits on the same ground in game.
import * as THREE from 'three';

// ---- noise.ts ----
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);
export function valueNoise(x, z, seed = 1) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}
export function gfbm(x, z, octaves = 4, seed = 1) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- Layout.ts ----
export const ZONES = [
  { id: 'village', name: 'Emberhold Village', center: { x: 0, z: 0 }, radius: 34 },
  { id: 'trail', name: 'Ironwood Trail', center: { x: 14, z: 82 }, radius: 46 },
  { id: 'quarry', name: 'Ironglass Quarry', center: { x: 40, z: 168 }, radius: 32 },
  { id: 'foundry', name: 'Dormant Foundry', center: { x: 2, z: 248 }, radius: 30 },
];
export const ZONE = Object.fromEntries(ZONES.map((z) => [z.id, z]));
export const PATH = [
  { x: 0, z: -14 },
  { x: 0, z: 30 },
  { x: 8, z: 58 },
  { x: 20, z: 92 },
  { x: 30, z: 124 },
  { x: 40, z: 148 },
  { x: 42, z: 168 },
  { x: 34, z: 192 },
  { x: 18, z: 212 },
  { x: 4, z: 226 },
  { x: 2, z: 248 },
];
export const PLAYER_SPAWN = { x: 0, z: -4, yaw: 0 };
export const RESPAWN_POINT = { x: -2, z: 2 };
export const NPCS = [
  { id: 'orla', name: 'Master Smith Orla', pos: { x: -9, z: 7 }, yaw: 0.9, height: 1.7 },
  { id: 'bram', name: 'Bram the Trader', pos: { x: 11, z: 5 }, yaw: -1.2, height: 2.15 },
];
export const FORGE_ANVIL = { x: -12.5, z: 10.5 };
export const TRAINING_POST = { x: 5, z: -10 };
export const RESOURCE_NODES = [
  { id: 'ore-t1', material: 'iron_ore', pos: { x: -6, z: 40 } },
  { id: 'ore-t2', material: 'iron_ore', pos: { x: 16, z: 52 } },
  { id: 'ore-t3', material: 'iron_ore', pos: { x: 3, z: 72 } },
  { id: 'ore-t4', material: 'iron_ore', pos: { x: 30, z: 88 } },
  { id: 'ore-t5', material: 'iron_ore', pos: { x: 14, z: 108 } },
  { id: 'ore-t6', material: 'iron_ore', pos: { x: 38, z: 116 } },
  { id: 'wood-t1', material: 'ironwood', pos: { x: 10, z: 36 } },
  { id: 'wood-t2', material: 'ironwood', pos: { x: -4, z: 60 } },
  { id: 'wood-t3', material: 'ironwood', pos: { x: 28, z: 70 } },
  { id: 'wood-t4', material: 'ironwood', pos: { x: 8, z: 96 } },
  { id: 'glass-q1', material: 'ironglass', pos: { x: 30, z: 160 } },
  { id: 'glass-q2', material: 'ironglass', pos: { x: 50, z: 158 } },
  { id: 'glass-q3', material: 'ironglass', pos: { x: 46, z: 178 } },
  { id: 'glass-q4', material: 'ironglass', pos: { x: 32, z: 178 } },
  { id: 'glass-q5', material: 'ironglass', pos: { x: 54, z: 170 } },
  { id: 'ore-q1', material: 'iron_ore', pos: { x: 26, z: 170 } },
  { id: 'ore-q2', material: 'iron_ore', pos: { x: 44, z: 150 } },
];
export const ENEMY_SPAWNS = [
  { id: 'dummy-1', type: 'dummy', pos: TRAINING_POST, height: 1.6 },
  { id: 'scav-1', type: 'scavenger', pos: { x: 4, z: 46 }, height: 1.9, patrol: [{ x: 4, z: 46 }, { x: 12, z: 54 }, { x: -2, z: 52 }] },
  { id: 'scav-2', type: 'scavenger', pos: { x: 18, z: 78 }, height: 1.9, patrol: [{ x: 18, z: 78 }, { x: 26, z: 82 }, { x: 14, z: 86 }] },
  { id: 'scav-3', type: 'scavenger', pos: { x: 24, z: 104 }, height: 1.9, patrol: [{ x: 24, z: 104 }, { x: 32, z: 110 }, { x: 18, z: 112 }] },
  { id: 'scav-4', type: 'scavenger', pos: { x: 34, z: 132 }, height: 1.9, patrol: [{ x: 34, z: 132 }, { x: 40, z: 138 }, { x: 28, z: 136 }] },
  { id: 'sent-1', type: 'sentinel', pos: { x: 38, z: 162 }, height: 2.2 },
  { id: 'sent-2', type: 'sentinel', pos: { x: 42, z: 178 }, height: 2.2 },
  { id: 'warden', type: 'warden', pos: { x: 2, z: 252 }, height: 3.3 },
];
export const WORLD_BOUNDS = { minX: -110, maxX: 130, minZ: -60, maxZ: 300 };

export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
export function distToPath(p) {
  let d = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) d = Math.min(d, distToSegment(p, PATH[i], PATH[i + 1]));
  return d;
}
/** Point and tangent along the path at distance s (metres from the start). */
export function pathAt(s) {
  let acc = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= s || i === PATH.length - 2) {
      const t = Math.max(0, Math.min(1, (s - acc) / L));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L };
    }
    acc += L;
  }
  return { x: 0, z: 0, tx: 0, tz: 1 };
}
export const PATH_LENGTH = PATH.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - PATH[i].x, p.z - PATH[i].z), 0);
export function playableSdf(p) {
  let d = distToPath(p) - 13;
  for (const z of ZONES) d = Math.min(d, Math.hypot(p.x - z.center.x, p.z - z.center.z) - z.radius);
  return d;
}

// ---- Terrain.ts ----
const village = ZONES[0];
const quarry = ZONES[2];
const foundry = ZONES[3];
export function terrainHeight(x, z) {
  const p = { x, z };
  let h = gfbm(x / 55, z / 55, 3, 3) * 2.2 + gfbm(x / 14, z / 14, 2, 9) * 0.45;
  const dp = distToPath(p);
  h *= 0.55 + 0.45 * smoothstep(1, 7, dp);
  h += smoothstep(120, 230, z) * 3.5;
  const dv = Math.hypot(x - village.center.x, z - village.center.z);
  h *= smoothstep(village.radius - 6, village.radius + 4, dv);
  const dq = Math.hypot(x - quarry.center.x, z - quarry.center.z);
  h -= 4.5 * (1 - smoothstep(6, quarry.radius - 4, dq));
  h += 2.2 * (smoothstep(quarry.radius - 6, quarry.radius, dq) - smoothstep(quarry.radius, quarry.radius + 8, dq));
  const df = Math.hypot(x - foundry.center.x, z - foundry.center.z);
  const plateau = 1 - smoothstep(foundry.radius - 10, foundry.radius - 2, df);
  h = h * (1 - plateau) + 4.2 * plateau;
  const sd = playableSdf(p);
  if (sd > 0) {
    const s = Math.min(sd, 45);
    h += Math.pow(s, 1.35) * 0.55 + gfbm(x / 9, z / 9, 2, 21) * Math.min(1, s / 6) * 2.2;
  }
  return h;
}

// Ground palette: the game's, lifted a touch, plus slope rock and a cobbled plaza.
const C = {
  grass: new THREE.Color('#4a5733'),
  grassDry: new THREE.Color('#6b6a3c'),
  grassDark: new THREE.Color('#2f3b23'),
  dirt: new THREE.Color('#6a553c'),
  rock: new THREE.Color('#5c5a56'),
  quarry: new THREE.Color('#7a8086'),
  basalt: new THREE.Color('#2e2c30'),
  plaza: new THREE.Color('#77695a'),
  scorch: new THREE.Color('#3a2a22'),
};
/** Ground colour at a point; slope (0 flat .. 1 cliff) pushes toward rock. */
export function groundColor(x, z, slope = 0, out = new THREE.Color()) {
  const p = { x, z };
  const n = gfbm(x / 6, z / 6, 2, 41) * 0.5 + 0.5;
  const n2 = gfbm(x / 30, z / 30, 2, 77) * 0.5 + 0.5;
  out.copy(C.grass).lerp(C.grassDark, n).lerp(C.grassDry, Math.max(0, n2 - 0.55) * 1.4);
  const sd = playableSdf(p);
  if (sd > 0) out.lerp(C.rock, smoothstep(2, 16, sd) * 0.8);
  out.lerp(C.rock, smoothstep(0.35, 0.7, slope) * 0.85);
  const dp = distToPath(p);
  out.lerp(C.dirt, (1 - smoothstep(1.4, 3.6, dp + n * 0.8)) * 0.92);
  const dv = Math.hypot(x - village.center.x, z - village.center.z);
  out.lerp(C.plaza, (1 - smoothstep(12, 22, dv + n * 3)) * 0.75);
  const dq = Math.hypot(x - quarry.center.x, z - quarry.center.z);
  out.lerp(C.quarry, (1 - smoothstep(quarry.radius - 8, quarry.radius + 2, dq)) * (0.65 + n * 0.25));
  const df = Math.hypot(x - foundry.center.x, z - foundry.center.z);
  out.lerp(C.basalt, (1 - smoothstep(foundry.radius - 6, foundry.radius + 3, df)) * 0.9);
  out.lerp(C.scorch, (1 - smoothstep(4, 14, Math.hypot(x - 2, z - 266))) * 0.6);
  return out;
}

/** The ground mesh: game heights, painted ground, tiling detail map in world UVs. */
export function buildTerrain({ width = 420, depth = 520, cx = 10, cz = 120, seg = 2.2, detail = null } = {}) {
  const sx = Math.round(width / seg);
  const sz = Math.round(depth / seg);
  const geo = new THREE.PlaneGeometry(width, depth, sx, sz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setXYZ(i, x, terrainHeight(x, z), z);
    uv.setXY(i, x / 4, z / 4);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    groundColor(pos.getX(i), pos.getZ(i), 1 - nrm.getY(i) * nrm.getY(i) * 1.0, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detail ?? null });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
