/** Simple 2D colliders with heights for movement and camera collision. */
import type { Vec2 } from '@alloy/game-rules';

export type Collider =
  | { type: 'circle'; x: number; z: number; r: number; top: number }
  | { type: 'box'; minX: number; maxX: number; minZ: number; maxZ: number; top: number };

const CELL = 10;

export class ColliderWorld {
  private all: Collider[] = [];
  private grid = new Map<string, Collider[]>();

  add(c: Collider): void {
    this.all.push(c);
    const [minX, maxX, minZ, maxZ] =
      c.type === 'circle' ? [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r] : [c.minX, c.maxX, c.minZ, c.maxZ];
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
        } else {
          const cx = Math.max(c.minX, Math.min(x, c.maxX));
          const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
          const dx = x - cx;
          const dz = z - cz;
          const d = Math.hypot(dx, dz);
          if (d < r) {
            if (d > 1e-6) {
              x = cx + (dx / d) * r;
              z = cz + (dz / d) * r;
            } else {
              // Inside the box: push out along the shallowest axis.
              const pen = [x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z];
              const m = Math.min(...pen);
              if (m === pen[0]) x = c.minX - r;
              else if (m === pen[1]) x = c.maxX + r;
              else if (m === pen[2]) z = c.minZ - r;
              else z = c.maxZ + r;
            }
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
      } else if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  }
}
