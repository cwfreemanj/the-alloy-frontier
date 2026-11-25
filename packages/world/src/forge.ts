/**
 * The Emberhold forge's floor plan, shared by the building's visuals (apps/web ForgeBuilding),
 * its colliders (the browser and the world server) and the things inside it.
 *
 * Local frame of the building: ground at y = 0, the open front faces +Z, the walls enclose
 * x in [-4, 4], z in [-3.5, 3.4]. The building stands at FORGE_HALL, turned by its yaw.
 */
import type { Vec2 } from '@alloy/game-rules';

/** Where the hall stands in the world (matches its entry in the baked scene). */
export const FORGE_HALL = { x: -16.5, z: 14.5, yaw: 131.3 } as const;

const A = (FORGE_HALL.yaw * Math.PI) / 180;
const COS = Math.cos(A);
const SIN = Math.sin(A);

/** A point in the forge's own frame, in world coordinates (same rotation as three.js: Ry(yaw)). */
export function forgeToWorld(lx: number, lz: number): Vec2 {
  return { x: FORGE_HALL.x + COS * lx + SIN * lz, z: FORGE_HALL.z - SIN * lx + COS * lz };
}

/** A world point in the forge's own frame. */
export function worldToForge(x: number, z: number): Vec2 {
  const ox = x - FORGE_HALL.x;
  const oz = z - FORGE_HALL.z;
  return { x: COS * ox - SIN * oz, z: SIN * ox + COS * oz };
}

/** Is a world point under the forge's roof? */
export function insideForge(x: number, z: number): boolean {
  const l = worldToForge(x, z);
  return Math.abs(l.x) < 4.05 && l.z > -3.6 && l.z < 3.5;
}

/** The layout inside (local metres). */
export const FORGE_PLAN = {
  /** Height of the walls' top plate. */
  wallHeight: 3.6,
  ridgeHeight: 6.5,
  /** Hearth against the back wall, chimney behind it. */
  hearth: { x: -1.6, z: -2.0, hw: 1.0, hd: 1.12, h: 1.1 },
  chimney: { x: -1.6, z: -3.55, half: 0.8, h: 9.2 },
  bellows: { x: -3.12, z: -2.3 },
  /** Quench trough along the left wall. */
  trough: { x: -3.25, z: -0.6 },
  /** The anvil (world item origin) faces the hearth. */
  anvil: { x: -1.2, z: 0.9 },
  /** A storage loft over the back right, reached by stairs along the right wall. */
  loft: { minX: 0.9, maxX: 3.67, minZ: -3.12, maxZ: -0.4, y: 2.5, thick: 0.2 },
  stairs: { minX: 2.68, maxX: 3.62, zBottom: 2.5, zTop: -0.4, steps: 10 },
  /** Orla's masterwork, on the left wall near the door. */
  masterwork: { x: -3.62, z: 1.7, y: 1.95 },
  /** The watch's sword rack, under the loft against the back wall. */
  rack: { x: 1.85, z: -2.5 },
  /** A workbench against the right wall under the loft. */
  workbench: { x: 3.18, z: -1.4 },
  /** A chest up in the loft. */
  loftChest: { x: 2.7, z: -2.55 },
} as const;

/** The forge's anvil: Orla's working anvil in front of the hearth. */
export const FORGE_ANVIL_LOCAL = FORGE_PLAN.anvil;

type Opts = { bottom?: number; walk?: boolean };
/** Collision shapes in the building's frame: circles [x, z, r, height] and rectangles [x, z, halfW, halfD, height]. */
export type ForgeShape = ['c', number, number, number, number, Opts?] | ['r', number, number, number, number, number, Opts?];

function shapes(): ForgeShape[] {
  const P = FORGE_PLAN;
  const out: ForgeShape[] = [
    // Walls (the front is open between the two posts)
    ['r', 0, -3.3, 4.0, 0.2, 6.4],
    ['r', -3.85, -0.05, 0.2, 3.45, 6.4],
    ['r', 3.85, -0.05, 0.2, 3.45, 6.4],
    ['c', -3.85, 3.2, 0.26, 4.2],
    ['c', 3.85, 3.2, 0.26, 4.2],
    // Fire
    ['r', P.chimney.x, P.chimney.z, P.chimney.half, P.chimney.half, P.chimney.h],
    ['r', P.hearth.x, P.hearth.z, P.hearth.hw, P.hearth.hd, P.hearth.h],
    ['r', P.bellows.x, P.bellows.z, 0.5, 0.3, 1.0],
    ['r', P.trough.x, P.trough.z, 0.35, 0.7, 0.9],
    ['r', P.rack.x, P.rack.z, 0.85, 0.62, 2.1],
    ['r', P.workbench.x, P.workbench.z, 0.49, 0.7, 1.1],
  ];
  // Loft: a floor overhead (walk under it, stand on it), its post and railings.
  const L = P.loft;
  out.push(['r', (L.minX + L.maxX) / 2, (L.minZ + L.maxZ) / 2, (L.maxX - L.minX) / 2, (L.maxZ - L.minZ) / 2, L.y, { bottom: L.y - L.thick, walk: true }]);
  out.push(['c', L.minX + 0.06, L.maxZ - 0.06, 0.12, L.y - L.thick]);
  out.push(['r', (L.minX + P.stairs.minX) / 2, L.maxZ, (P.stairs.minX - L.minX) / 2, 0.06, L.y + 1.0, { bottom: L.y }]);
  out.push(['r', L.minX, (L.minZ + L.maxZ) / 2, 0.06, (L.maxZ - L.minZ) / 2, L.y + 1.0, { bottom: L.y }]);
  // Stairs: solid steps, each one a floor.
  const S = P.stairs;
  const tread = (S.zBottom - S.zTop) / S.steps;
  const rise = L.y / S.steps;
  for (let i = 0; i < S.steps; i++) {
    const z = S.zBottom - (i + 0.5) * tread;
    out.push(['r', (S.minX + S.maxX) / 2, z, (S.maxX - S.minX) / 2, tread / 2, rise * (i + 1), { walk: true }]);
  }
  return out;
}

export const FORGE_SHAPES: ForgeShape[] = shapes();
