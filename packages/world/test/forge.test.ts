import { describe, expect, it } from 'vitest';
import { heightOk } from '@alloy/game-rules';
import { CONTAINERS, FORGE_ANVIL, FORGE_PLAN, buildWorldColliders, containerDef, emberholdItems, forgeToWorld, insideForge, playableSdf, terrainHeight, worldToForge } from '../src';

const world = buildWorldColliders();
const P = FORGE_PLAN;
/** Walk a straight line in the forge's frame the way the browser does: resolve, then find the floor. */
function walk(from: [number, number], to: [number, number], startY?: number, steps = 120): { x: number; z: number; y: number } {
  let p = forgeToWorld(from[0], from[1]);
  let y = startY ?? terrainHeight(p.x, p.z);
  const goal = forgeToWorld(to[0], to[1]);
  for (let i = 0; i < steps; i++) {
    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const k = Math.min(1, 0.12 / d);
    p = world.resolve({ x: p.x + dx * k, z: p.z + dz * k }, 0.4, y);
    y = world.groundAt(p.x, p.z, y, terrainHeight(p.x, p.z));
  }
  return { ...p, y };
}

describe('walk-in forge', () => {
  it('places the anvil where the plan says, inside the building', () => {
    const a = forgeToWorld(P.anvil.x, P.anvil.z);
    expect(FORGE_ANVIL.x).toBeCloseTo(a.x, 1);
    expect(FORGE_ANVIL.z).toBeCloseTo(a.z, 1);
    const item = emberholdItems().find((it) => it.model === 'forge_anvil')!;
    expect([item.x, item.z]).toEqual([FORGE_ANVIL.x, FORGE_ANVIL.z]);
    expect(insideForge(FORGE_ANVIL.x, FORGE_ANVIL.z)).toBe(true);
    const l = worldToForge(a.x, a.z);
    expect(l.x).toBeCloseTo(P.anvil.x, 6);
  });

  it('lets a player walk in through the open front, but not through the walls', () => {
    const inside = walk([0, 7], [0.2, 1.8]);
    expect(insideForge(inside.x, inside.z)).toBe(true);
    const l = worldToForge(inside.x, inside.z);
    expect(l.z).toBeLessThan(2.2);
    // From behind, the back wall stops you.
    const back = walk([0, -7], [0, 0]);
    expect(worldToForge(back.x, back.z).z).toBeLessThan(-3.4);
  });

  it('climbs the stairs to the loft, and the loft is overhead for someone below', () => {
    const top = walk([3.15, 3.0], [3.15, -1.0]);
    expect(top.y).toBeCloseTo(P.loft.y, 5);
    const loft = walk([3.15, -1.0], [2.2, -2.2], top.y);
    expect(loft.y).toBeCloseTo(P.loft.y, 5);
    // Under the loft on the ground floor: still at ground level, free to walk.
    const under = walk([0.2, 0.5], [2.2, -1.8]);
    expect(under.y).toBeCloseTo(terrainHeight(under.x, under.z), 5);
    expect(worldToForge(under.x, under.z).x).toBeGreaterThan(1.5);
  });

  it('the server height check accepts the loft and a drop from it, but not flying elsewhere', () => {
    const loft = forgeToWorld(2.2, -2.0);
    const g = terrainHeight(loft.x, loft.z);
    expect(heightOk(P.loft.y, g, world.highestFloorNear(loft.x, loft.z, 4, g))).toBe(true);
    const below = forgeToWorld(0, 0.5); // next to the loft, mid-drop
    const gb = terrainHeight(below.x, below.z);
    expect(heightOk(gb + 2.0, gb, world.highestFloorNear(below.x, below.z, 4, gb))).toBe(true);
    expect(heightOk(gb + 2.0, gb)).toBe(false);
    const far = { x: 0, z: 0 };
    const gf = terrainHeight(far.x, far.z);
    expect(heightOk(gf + 2.5, gf, world.highestFloorNear(far.x, far.z, 4, gf))).toBe(false);
  });
});

describe('containers', () => {
  it('are deterministic, unique and reachable', () => {
    const ids = CONTAINERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONTAINERS.filter((c) => c.kind === 'cache').length).toBeGreaterThanOrEqual(4);
    expect(CONTAINERS.filter((c) => c.kind === 'barrel').length).toBeGreaterThanOrEqual(2);
    for (const c of CONTAINERS.filter((x) => x.kind === 'cache')) {
      expect(playableSdf(c.pos)).toBeLessThan(0);
      expect(world.blocksPoint(c.pos.x, terrainHeight(c.pos.x, c.pos.z) + 0.3, c.pos.z, 0.5)).toBe(false);
    }
    const chest = containerDef('forge-loft-chest')!;
    expect(chest.floor).toBe(P.loft.y);
    expect(insideForge(chest.pos.x, chest.pos.z)).toBe(true);
  });
});
