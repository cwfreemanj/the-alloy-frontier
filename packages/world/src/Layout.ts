/**
 * Emberhold Frontier region layout (GDD 5.2). One continuous map; zones are
 * labels on a single terrain, not separately loaded levels.
 * Coordinates are metres. +Z is north (village -> foundry).
 */
import type { MaterialId } from '@alloy/item-gen';
import type { Vec2 } from '@alloy/game-rules';

export interface Zone {
  id: 'village' | 'trail' | 'quarry' | 'foundry';
  name: string;
  center: Vec2;
  radius: number;
  subtitle: string;
}

export const ZONES: Zone[] = [
  { id: 'village', name: 'Emberhold Village', center: { x: 0, z: 0 }, radius: 34, subtitle: 'Forge, merchant and the Compact\'s last frontier outpost' },
  { id: 'trail', name: 'Ironwood Trail', center: { x: 14, z: 82 }, radius: 46, subtitle: 'Scavengers prowl the iron-veined woods' },
  { id: 'quarry', name: 'Ironglass Quarry', center: { x: 40, z: 168 }, radius: 32, subtitle: 'Conductive crystal and the constructs that guard it' },
  { id: 'foundry', name: 'Dormant Foundry', center: { x: 2, z: 248 }, radius: 30, subtitle: 'An automated forge of the Meridian Network, not quite asleep' },
];

/** The trail polyline linking all four areas. */
export const PATH: Vec2[] = [
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

export const PLAYER_SPAWN: Vec2 & { yaw: number } = { x: 0, z: -4, yaw: 0 };
export const RESPAWN_POINT: Vec2 = { x: -2, z: 2 };

export const NPCS = {
  orla: { id: 'orla', name: 'Master Smith Orla', role: 'Blacksmith · Quest giver', pos: { x: -9, z: 7 }, yaw: 0.9 },
  bram: { id: 'bram', name: 'Bram the Trader', role: 'Merchant', pos: { x: 11, z: 5 }, yaw: -1.2 },
} as const;
export type NpcId = keyof typeof NPCS;

/** Orla's anvil, inside the forge in front of the hearth (FORGE_PLAN.anvil; the baked scene places the model here). */
export const FORGE_ANVIL: Vec2 = { x: -15.03, z: 14.81 };
export const TRAINING_POST: Vec2 = { x: 5, z: -10 };

export interface NodeDef {
  id: string;
  material: MaterialId;
  pos: Vec2;
  /** Visual size (1 = standard node) and facing in degrees; generated seams vary these. */
  scale?: number;
  yaw?: number;
  /** Drawn as part of the instanced scenery (grove trees), not as its own object. */
  instanced?: boolean;
}

export const RESOURCE_NODES: NodeDef[] = [
  // Ironwood Trail: iron ore + ironwood
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
  // Ironglass Quarry
  { id: 'glass-q1', material: 'ironglass', pos: { x: 30, z: 160 } },
  { id: 'glass-q2', material: 'ironglass', pos: { x: 50, z: 158 } },
  { id: 'glass-q3', material: 'ironglass', pos: { x: 46, z: 178 } },
  { id: 'glass-q4', material: 'ironglass', pos: { x: 32, z: 178 } },
  { id: 'glass-q5', material: 'ironglass', pos: { x: 54, z: 170 } },
  { id: 'ore-q1', material: 'iron_ore', pos: { x: 26, z: 170 } },
  { id: 'ore-q2', material: 'iron_ore', pos: { x: 44, z: 150 } },
];

export interface EnemySpawn {
  id: string;
  type: 'scavenger' | 'sentinel' | 'warden' | 'dummy';
  pos: Vec2;
  yaw: number;
  patrol?: Vec2[];
}

export const ENEMY_SPAWNS: EnemySpawn[] = [
  { id: 'dummy-1', type: 'dummy', pos: TRAINING_POST, yaw: Math.PI },
  { id: 'scav-1', type: 'scavenger', pos: { x: 4, z: 46 }, yaw: Math.PI, patrol: [{ x: 4, z: 46 }, { x: 12, z: 54 }, { x: -2, z: 52 }] },
  { id: 'scav-2', type: 'scavenger', pos: { x: 18, z: 78 }, yaw: Math.PI, patrol: [{ x: 18, z: 78 }, { x: 26, z: 82 }, { x: 14, z: 86 }] },
  { id: 'scav-3', type: 'scavenger', pos: { x: 24, z: 104 }, yaw: Math.PI, patrol: [{ x: 24, z: 104 }, { x: 32, z: 110 }, { x: 18, z: 112 }] },
  { id: 'scav-4', type: 'scavenger', pos: { x: 34, z: 132 }, yaw: Math.PI, patrol: [{ x: 34, z: 132 }, { x: 40, z: 138 }, { x: 28, z: 136 }] },
  { id: 'sent-1', type: 'sentinel', pos: { x: 38, z: 162 }, yaw: Math.PI },
  { id: 'sent-2', type: 'sentinel', pos: { x: 42, z: 178 }, yaw: Math.PI },
  { id: 'warden', type: 'warden', pos: { x: 2, z: 252 }, yaw: Math.PI },
];

export const WORLD_BOUNDS = { minX: -110, maxX: 130, minZ: -60, maxZ: 300 };

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

export function distToPath(p: Vec2): number {
  let d = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) d = Math.min(d, distToSegment(p, PATH[i], PATH[i + 1]));
  return d;
}

/** Signed distance from the playable area (negative inside). */
export function playableSdf(p: Vec2): number {
  let d = distToPath(p) - 13;
  for (const z of ZONES) d = Math.min(d, Math.hypot(p.x - z.center.x, p.z - z.center.z) - z.radius);
  return d;
}

export function zoneAt(p: Vec2): Zone {
  let best = ZONES[0];
  let bestD = Infinity;
  for (const z of ZONES) {
    const d = Math.hypot(p.x - z.center.x, p.z - z.center.z) / z.radius;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}
