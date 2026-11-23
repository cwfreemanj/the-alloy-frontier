/** Simple 2D colliders with heights for movement and camera collision. */
import type { Vec2 } from '@alloy/game-rules';

export type Collider =
  | { type: 'circle'; x: number; z: number; r: number; top: number }
  | { type: 'box'; minX: number; maxX: number; minZ: number; maxZ: number; top: number }
  /** Oriented box: centre, half extents along its local x / z axes, and the axes' rotation (cos, sin of yaw). */
  | { type: 'obb'; x: number; z: number; hw: number; hd: number; cos: number; sin: number; top: number };

/** World-space axis-aligned bounds of a collider. */
function bounds(c: Collider): [number, number, number, number] {
  if (c.type === 'circle') return [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r];
  if (c.type === 'box') return [c.minX, c.maxX, c.minZ, c.maxZ];
  const ex = Math.abs(c.cos) * c.hw + Math.abs(c.sin) * c.hd;
  const ez = Math.abs(c.sin) * c.hw + Math.abs(c.cos) * c.hd;
  return [c.x - ex, c.x + ex, c.z - ez, c.z + ez];
}

/** Push a circle (x, z, r) out of an axis-aligned rectangle; null when not touching. */
function pushOutOfRect(x: number, z: number, r: number, minX: number, maxX: number, minZ: number, maxZ: number): [number, number] | null {
  const cx = Math.max(minX, Math.min(x, maxX));
  const cz = Math.max(minZ, Math.min(z, maxZ));
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= r) return null;
  if (d > 1e-6) return [cx + (dx / d) * r, cz + (dz / d) * r];
  // Inside the box: push out along the shallowest axis.
  const pen = [x - minX, maxX - x, z - minZ, maxZ - z];
  const m = Math.min(...pen);
  if (m === pen[0]) return [minX - r, z];
  if (m === pen[1]) return [maxX + r, z];
  if (m === pen[2]) return [x, minZ - r];
  return [x, maxZ + r];
}

const CELL = 10;

export class ColliderWorld {
  private all: Collider[] = [];
  private grid = new Map<string, Collider[]>();

  add(c: Collider): void {
    this.all.push(c);
    const [minX, maxX, minZ, maxZ] = bounds(c);
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
        const k = `${gx},${gz}`;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
  }

  get count(): number {
    return this.all.length;
  }

  near(x: number, z: number, radius: number): Collider[] {
    const out = new Set<Collider>();
    for (let gx = Math.floor((x - radius) / CELL); gx <= Math.floor((x + radius) / CELL); gx++)
      for (let gz = Math.floor((z - radius) / CELL); gz <= Math.floor((z + radius) / CELL); gz++) {
        const list = this.grid.get(`${gx},${gz}`);
        if (list) for (const c of list) out.add(c);
      }
    return [...out];
  }

  /** Push a circle of radius r at p out of all colliders whose top is above `feetY`. */
  resolve(p: Vec2, r: number, feetY: number): Vec2 {
    let { x, z } = p;
    for (let iter = 0; iter < 3; iter++) {
      for (const c of this.near(x, z, r + 2)) {
        if (c.top < feetY + 0.35) continue; // can step onto / jump over low obstacles
        if (c.type === 'circle') {
          const dx = x - c.x;
          const dz = z - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + r;
          if (d < min && d > 1e-6) {
            x = c.x + (dx / d) * min;
            z = c.z + (dz / d) * min;
          } else if (d <= 1e-6) {
            x += min;
          }
        } else if (c.type === 'box') {
          const q = pushOutOfRect(x, z, r, c.minX, c.maxX, c.minZ, c.maxZ);
          if (q) [x, z] = q;
        } else {
          // Into the box's frame (local = R(-yaw) * world offset), resolve, and back out.
          const ox = x - c.x;
          const oz = z - c.z;
          const lx = c.cos * ox - c.sin * oz;
          const lz = c.sin * ox + c.cos * oz;
          const q = pushOutOfRect(lx, lz, r, -c.hw, c.hw, -c.hd, c.hd);
          if (q) {
            x = c.x + c.cos * q[0] + c.sin * q[1];
            z = c.z - c.sin * q[0] + c.cos * q[1];
          }
        }
      }
    }
    return { x, z };
  }

  /** Is the point inside a collider volume (for camera occlusion tests)? */
  blocksPoint(x: number, y: number, z: number, pad = 0.2): boolean {
    for (const c of this.near(x, z, 1)) {
      if (y > c.top) continue;
      if (c.type === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
      } else if (c.type === 'box') {
        if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
      } else {
        const ox = x - c.x;
        const oz = z - c.z;
        if (Math.abs(c.cos * ox - c.sin * oz) < c.hw + pad && Math.abs(c.sin * ox + c.cos * oz) < c.hd + pad) return true;
      }
    }
    return false;
  }
}
