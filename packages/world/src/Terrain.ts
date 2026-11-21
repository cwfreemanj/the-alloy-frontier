import * as THREE from 'three';
import { fbm, smoothstep } from './noise';
import { ZONES, distToPath, playableSdf } from './Layout';

const village = ZONES[0];
const quarry = ZONES[2];
const foundry = ZONES[3];

/** Analytic terrain height. Used by rendering, movement, camera and AI alike. */
export function terrainHeight(x: number, z: number): number {
  const p = { x, z };
  let h = fbm(x / 55, z / 55, 3, 3) * 2.2 + fbm(x / 14, z / 14, 2, 9) * 0.45;
  // Path is smoother.
  const dp = distToPath(p);
  h *= 0.55 + 0.45 * smoothstep(1, 7, dp);
  // Gentle overall rise towards the foundry plateau.
  h += smoothstep(120, 230, z) * 3.5;
  // Village is flat.
  const dv = Math.hypot(x - village.center.x, z - village.center.z);
  h *= smoothstep(village.radius - 6, village.radius + 4, dv);
  // Quarry pit.
  const dq = Math.hypot(x - quarry.center.x, z - quarry.center.z);
  h -= 4.5 * (1 - smoothstep(6, quarry.radius - 4, dq));
  h += 2.2 * (smoothstep(quarry.radius - 6, quarry.radius, dq) - smoothstep(quarry.radius, quarry.radius + 8, dq));
  // Foundry plateau (flat arena floor).
  const df = Math.hypot(x - foundry.center.x, z - foundry.center.z);
  const plateau = 1 - smoothstep(foundry.radius - 10, foundry.radius - 2, df);
  h = h * (1 - plateau) + 4.2 * plateau;
  // Hills rise outside the playable area (natural boundary).
  const sd = playableSdf(p);
  if (sd > 0) {
    const s = Math.min(sd, 45);
    h += Math.pow(s, 1.35) * 0.55 + fbm(x / 9, z / 9, 2, 21) * Math.min(1, s / 6) * 2.2;
  }
  return h;
}

export interface TerrainColors {
  grass: THREE.Color;
  grassDark: THREE.Color;
  dirt: THREE.Color;
  rock: THREE.Color;
  quarry: THREE.Color;
  basalt: THREE.Color;
  village: THREE.Color;
}

const C: TerrainColors = {
  grass: new THREE.Color('#3f4a2c'),
  grassDark: new THREE.Color('#2b3420'),
  dirt: new THREE.Color('#5b4935'),
  rock: new THREE.Color('#4b4a48'),
  quarry: new THREE.Color('#6d7378'),
  basalt: new THREE.Color('#2c2b2e'),
  village: new THREE.Color('#5a4c3c'),
};

export function buildTerrainMesh(): THREE.Mesh {
  const width = 240;
  const depth = 360;
  const cx = 10;
  const cz = 120;
  const geo = new THREE.PlaneGeometry(width, depth, 150, 225);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const y = terrainHeight(x, z);
    pos.setXYZ(i, x, y, z);
    const p = { x, z };
    const n = fbm(x / 6, z / 6, 2, 41) * 0.5 + 0.5;
    tmp.copy(C.grass).lerp(C.grassDark, n);
    const sd = playableSdf(p);
    if (sd > 0) tmp.lerp(C.rock, smoothstep(0, 14, sd) * 0.85);
    const dp = distToPath(p);
    tmp.lerp(C.dirt, (1 - smoothstep(1.6, 3.4, dp)) * 0.9);
    const dv = Math.hypot(x - village.center.x, z - village.center.z);
    tmp.lerp(C.village, (1 - smoothstep(14, 26, dv)) * 0.7);
    const dq = Math.hypot(x - quarry.center.x, z - quarry.center.z);
    tmp.lerp(C.quarry, (1 - smoothstep(quarry.radius - 8, quarry.radius + 2, dq)) * (0.65 + n * 0.25));
    const df = Math.hypot(x - foundry.center.x, z - foundry.center.z);
    tmp.lerp(C.basalt, (1 - smoothstep(foundry.radius - 6, foundry.radius + 3, df)) * 0.9);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
