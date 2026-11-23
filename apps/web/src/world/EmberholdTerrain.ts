/** The painted Emberhold ground (Model Workshop terrain.js): game heights, ground colours, tiling detail. */
import * as THREE from 'three';
import { ZONES, distToPath, fbm, playableSdf, smoothstep, terrainHeight } from '@alloy/world';

const village = ZONES[0];
const quarry = ZONES[2];
const foundry = ZONES[3];

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
export function groundColor(x: number, z: number, slope = 0, out = new THREE.Color()): THREE.Color {
  const p = { x, z };
  const n = fbm(x / 6, z / 6, 2, 41) * 0.5 + 0.5;
  const n2 = fbm(x / 30, z / 30, 2, 77) * 0.5 + 0.5;
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

/** The ground mesh. seg is the grid spacing in metres (coarser on low quality). */
export function buildEmberholdTerrain(detail: THREE.Texture | null, seg = 2.2): THREE.Mesh {
  const width = 420;
  const depth = 520;
  const cx = 10;
  const cz = 120;
  const geo = new THREE.PlaneGeometry(width, depth, Math.round(width / seg), Math.round(depth / seg));
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
    groundColor(pos.getX(i), pos.getZ(i), 1 - nrm.getY(i) * nrm.getY(i), c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: detail });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
