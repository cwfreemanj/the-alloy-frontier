/**
 * Procedural environment for Emberhold Frontier. All geometry is generated in code
 * (no external assets; see assets/ASSET_PROVENANCE.md).
 */
import * as THREE from 'three';
import { Rng } from '@alloy/item-gen';
import { ColliderWorld } from './Colliders';
import { FORGE_ANVIL, PATH, RESOURCE_NODES, ZONES, distToPath, playableSdf } from './Layout';
import { terrainHeight } from './Terrain';

export const PALETTE = {
  stone: '#3a3936',
  stoneDark: '#2a2927',
  timber: '#4a3626',
  timberDark: '#33251a',
  roof: '#4b2f24',
  steel: '#7d848b',
  agedSteel: '#585e64',
  cyan: '#45e0ff',
  ember: '#ff7a2e',
  canopy: '#2f3d24',
  canopyDark: '#243019',
  bark: '#3b2e24',
};

const mat = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });

export interface WorldVisuals {
  group: THREE.Group;
  colliders: ColliderWorld;
  update: (t: number) => void;
  forgeLight: THREE.PointLight;
}

function place(obj: THREE.Object3D, x: number, z: number, yOffset = 0): THREE.Object3D {
  obj.position.set(x, terrainHeight(x, z) + yOffset, z);
  return obj;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function house(w: number, d: number, h: number, wallColor: string): THREE.Group {
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wallColor));
  walls.position.y = h / 2;
  g.add(walls);
  // Timber framing
  const beamMat = mat(PALETTE.timberDark);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, h + 0.1, 0.25), beamMat);
      b.position.set((sx * w) / 2, h / 2, (sz * d) / 2);
      g.add(b);
    }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.8, 4, 1), mat(PALETTE.roof, { roughness: 0.9 }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  roof.position.y = h + h * 0.4;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.1), mat(PALETTE.timber));
  door.position.set(0, 0.9, d / 2 + 0.05);
  g.add(door);
  return shadowed(g);
}

function techLamp(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), mat(PALETTE.agedSteel, { metalness: 0.6, roughness: 0.5 }));
  post.position.y = 1.2;
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16),
    new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 1.6, roughness: 0.3 }),
  );
  crystal.position.y = 2.5;
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 4, 10), mat(PALETTE.agedSteel, { metalness: 0.7 }));
  cage.position.y = 2.5;
  cage.rotation.x = Math.PI / 2;
  g.add(post, crystal, cage);
  return g;
}

export function buildWorld(scene: THREE.Scene): WorldVisuals {
  const group = new THREE.Group();
  group.name = 'world';
  const colliders = new ColliderWorld();
  const flickers: Array<(t: number) => void> = [];
  const rng = new Rng('emberhold-world');

  // ---------- Emberhold Village ----------
  const houses: Array<[number, number, number, number, number, string]> = [
    [-20, -8, 7, 6, 3.4, '#4a4440'],
    [18, -10, 6, 7, 3.2, '#47423c'],
    [22, 14, 7, 5, 3.0, '#4c4640'],
    [-22, 18, 6, 6, 3.6, '#46413b'],
    [-4, 24, 8, 5, 3.2, '#4a453f'],
  ];
  for (const [x, z, w, d, h, c] of houses) {
    const hs = house(w, d, h, c);
    place(hs, x, z);
    hs.lookAt(0, hs.position.y, 0);
    hs.rotation.y = Math.round(hs.rotation.y / (Math.PI / 2)) * (Math.PI / 2);
    group.add(hs);
    const half = Math.max(w, d) / 2 + 0.2;
    colliders.add({ type: 'box', minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, top: terrainHeight(x, z) + h * 1.6 });
  }

  // Forge: open-sided shed with furnace and anvil.
  const forge = new THREE.Group();
  const fx = -13;
  const fz = 13;
  const floorY = terrainHeight(fx, fz);
  forge.position.set(fx, floorY, fz);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 7), mat(PALETTE.roof));
  roof.position.y = 3.6;
  roof.rotation.z = 0.08;
  forge.add(roof);
  for (const [px, pz] of [
    [-4.2, -3.2],
    [4.2, -3.2],
    [-4.2, 3.2],
    [4.2, 3.2],
  ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.35), mat(PALETTE.timberDark));
    p.position.set(px, 1.8, pz);
    forge.add(p);
    colliders.add({ type: 'circle', x: fx + px, z: fz + pz, r: 0.3, top: floorY + 3.6 });
  }
  const furnace = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 2.6, 8), mat(PALETTE.stoneDark));
  furnace.position.set(-2.2, 1.3, 2.2);
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.7, 0.2),
    new THREE.MeshStandardMaterial({ color: PALETTE.ember, emissive: PALETTE.ember, emissiveIntensity: 2.2 }),
  );
  mouth.position.set(-1.6, 0.9, 1.05);
  mouth.rotation.y = -0.6;
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 6), mat(PALETTE.stone));
  chimney.position.set(-2.2, 4, 2.2);
  forge.add(furnace, mouth, chimney);
  colliders.add({ type: 'circle', x: fx - 2.2, z: fz + 2.2, r: 1.6, top: floorY + 6 });
  // Anvil (interaction point)
  const anvil = new THREE.Group();
  const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.4), mat(PALETTE.stoneDark));
  anvilBase.position.y = 0.3;
  const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.42), mat(PALETTE.agedSteel, { metalness: 0.8, roughness: 0.35 }));
  anvilTop.position.y = 0.72;
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.45, 8), anvilTop.material);
  horn.rotation.z = Math.PI / 2;
  horn.position.set(0.75, 0.74, 0);
  // Fantasy-tech: a cyan alignment lens mounted over the anvil.
  const lens = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.03, 6, 20),
    new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 1.2 }),
  );
  lens.position.set(0, 1.5, 0);
  lens.rotation.x = Math.PI / 2;
  anvil.add(anvilBase, anvilTop, horn, lens);
  anvil.position.set(FORGE_ANVIL.x - fx, 0, FORGE_ANVIL.z - fz);
  forge.add(anvil);
  colliders.add({ type: 'circle', x: FORGE_ANVIL.x, z: FORGE_ANVIL.z, r: 0.55, top: floorY + 0.9 });
  // Weapon rack
  const rack = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 0.2), mat(PALETTE.timber));
  rack.position.set(3, 0.8, -3);
  forge.add(rack);
  shadowed(forge);
  group.add(forge);
  const forgeLight = new THREE.PointLight(PALETTE.ember, 18, 16, 1.6);
  forgeLight.position.set(fx - 1.5, floorY + 1.4, fz + 1.2);
  group.add(forgeLight);
  flickers.push((t) => {
    forgeLight.intensity = 16 + Math.sin(t * 13) * 1.5 + Math.sin(t * 7.3) * 2;
    lens.rotation.z = t * 0.6;
  });

  // Merchant stall
  const stall = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 1.2), mat(PALETTE.timber));
  table.position.y = 0.45;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 2.2), mat('#6b3a2a'));
  canopy.position.set(0, 2.6, 0.2);
  canopy.rotation.x = -0.18;
  for (const sx of [-1.7, 1.7]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), mat(PALETTE.timberDark));
    p.position.set(sx, 1.3, -0.6);
    stall.add(p);
  }
  for (let i = 0; i < 4; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), mat('#5a4430'));
    crate.position.set(-1 + i * 0.65, 1.1, 0);
    stall.add(crate);
  }
  stall.add(table, canopy);
  place(stall, 13, 7);
  stall.rotation.y = -Math.PI / 2 + 0.3;
  shadowed(stall);
  group.add(stall);
  colliders.add({ type: 'circle', x: 13, z: 7, r: 1.7, top: terrainHeight(13, 7) + 1 });

  // Well + lamps
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 12, 1, true), mat(PALETTE.stone));
  place(well, 0, 10, 0.45);
  group.add(shadowed(well));
  colliders.add({ type: 'circle', x: 0, z: 10, r: 1.25, top: terrainHeight(0, 10) + 0.9 });
  for (const [lx, lz] of [
    [-5, -2],
    [6, 1],
    [-3, 20],
    [3, 30],
    [-7, 13],
  ]) {
    const l = techLamp();
    place(l, lx, lz);
    group.add(l);
    colliders.add({ type: 'circle', x: lx, z: lz, r: 0.15, top: 99 });
  }
  // Palisade around the village (gaps for the north gate and south).
  const palMat = mat(PALETTE.timberDark);
  const stakeGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.2, 5);
  const stakes: THREE.Vector3[] = [];
  for (let a = 0; a < Math.PI * 2; a += 0.045) {
    const deg = (a * 180) / Math.PI;
    if (deg < 12 || deg > 348 || (deg > 168 && deg < 192)) continue; // gates north/south
    const r = 31;
    stakes.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
  }
  const stakeMesh = new THREE.InstancedMesh(stakeGeo, palMat, stakes.length);
  const m4 = new THREE.Matrix4();
  stakes.forEach((s, i) => {
    m4.makeTranslation(s.x, terrainHeight(s.x, s.z) + 1.4, s.z);
    stakeMesh.setMatrixAt(i, m4);
    colliders.add({ type: 'circle', x: s.x, z: s.z, r: 0.45, top: terrainHeight(s.x, s.z) + 3 });
  });
  stakeMesh.castShadow = true;
  group.add(stakeMesh);

  // ---------- Trees & rocks (instanced) ----------
  const treePositions: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < 1400 && treePositions.length < 420; i++) {
    const x = rng.range(-70, 100);
    const z = rng.range(20, 240);
    const p = { x, z };
    const sd = playableSdf(p);
    if (sd < -2 || sd > 22) continue;
    if (distToPath(p) < 5) continue;
    if (Math.hypot(x - ZONES[2].center.x, z - ZONES[2].center.z) < ZONES[2].radius + 4) continue;
    if (Math.hypot(x - ZONES[3].center.x, z - ZONES[3].center.z) < ZONES[3].radius + 3) continue;
    if (RESOURCE_NODES.some((n) => Math.hypot(n.pos.x - x, n.pos.z - z) < 3)) continue;
    treePositions.push({ x, z, s: rng.range(0.8, 1.4) });
  }
  // Trees inside the trail (playable interior) are sparser.
  for (let i = 0; i < 400 && treePositions.length < 520; i++) {
    const x = rng.range(-30, 60);
    const z = rng.range(36, 140);
    const p = { x, z };
    if (playableSdf(p) > -2 || distToPath(p) < 6) continue;
    if (RESOURCE_NODES.some((n) => Math.hypot(n.pos.x - x, n.pos.z - z) < 4)) continue;
    treePositions.push({ x, z, s: rng.range(0.8, 1.3) });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 4, 6);
  trunkGeo.translate(0, 2, 0);
  const canopyGeo = new THREE.ConeGeometry(1.8, 5.5, 7);
  canopyGeo.translate(0, 5.6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(PALETTE.bark), treePositions.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, mat(PALETTE.canopy, { roughness: 1 }), treePositions.length);
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const tp = new THREE.Vector3();
  const col = new THREE.Color();
  treePositions.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
    sc.set(t.s, t.s * rng.range(0.9, 1.2), t.s);
    tp.set(t.x, y - 0.1, t.z);
    m4.compose(tp, q, sc);
    trunks.setMatrixAt(i, m4);
    canopies.setMatrixAt(i, m4);
    canopies.setColorAt(i, col.set(PALETTE.canopy).lerp(new THREE.Color(PALETTE.canopyDark), rng.next()));
    colliders.add({ type: 'circle', x: t.x, z: t.z, r: 0.35 * t.s, top: y + 8 });
  });
  trunks.castShadow = canopies.castShadow = true;
  trunks.receiveShadow = canopies.receiveShadow = true;
  group.add(trunks, canopies);

  const rocks: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < 1200 && rocks.length < 260; i++) {
    const x = rng.range(-80, 110);
    const z = rng.range(-50, 290);
    const p = { x, z };
    const sd = playableSdf(p);
    const inQuarry = Math.hypot(x - ZONES[2].center.x, z - ZONES[2].center.z) < ZONES[2].radius + 6;
    if (!(sd > 0 && sd < 25) && !(inQuarry && rng.next() < 0.6)) continue;
    if (distToPath(p) < 4) continue;
    if (RESOURCE_NODES.some((n) => Math.hypot(n.pos.x - x, n.pos.z - z) < 3)) continue;
    if (Math.hypot(x, z) < 33) continue;
    rocks.push({ x, z, s: inQuarry ? rng.range(0.6, 2.2) : rng.range(0.8, 3.5) });
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeo, mat('#55534f', { roughness: 0.95, flatShading: true }), rocks.length);
  rocks.forEach((r, i) => {
    const y = terrainHeight(r.x, r.z);
    q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
    sc.set(r.s, r.s * rng.range(0.5, 0.9), r.s * rng.range(0.7, 1.1));
    tp.set(r.x, y + r.s * 0.2, r.z);
    m4.compose(tp, q, sc);
    rockMesh.setMatrixAt(i, m4);
    rockMesh.setColorAt(i, col.set('#57544f').lerp(new THREE.Color('#6b7075'), rng.next() * 0.6));
    colliders.add({ type: 'circle', x: r.x, z: r.z, r: r.s * 0.85, top: y + r.s * 0.9 });
  });
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // Path marker stones with cyan relic shards every so often (wayfinding).
  for (let i = 1; i < PATH.length - 1; i++) {
    const p = PATH[i];
    const nx = p.x + 3.5;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), mat(PALETTE.stone));
    place(marker, nx, p.z, 0.7);
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12),
      new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 1.3 }),
    );
    shard.position.y = 0.85;
    marker.add(shard);
    group.add(shadowed(marker));
    colliders.add({ type: 'circle', x: nx, z: p.z, r: 0.3, top: terrainHeight(nx, p.z) + 1.4 });
  }

  // ---------- Ironglass Quarry ----------
  const qz = ZONES[2];
  const crystalMat = new THREE.MeshStandardMaterial({ color: '#7fdcff', emissive: '#1a8fb3', emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(qz.radius - 6, qz.radius + 2);
    const x = qz.center.x + Math.sin(a) * r;
    const z = qz.center.z + Math.cos(a) * r;
    if (distToPath({ x, z }) < 4) continue;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(rng.range(0.4, 1.1)), crystalMat);
    c.scale.y = rng.range(1.6, 2.8);
    c.rotation.set(rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(-0.4, 0.4));
    place(c, x, z, 0.6);
    group.add(c);
  }
  // Scaffold + cart
  const scaffold = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 0.2), mat(PALETTE.timber));
    p.position.set((i % 2) * 3, 2.5, Math.floor(i / 2) * 3);
    scaffold.add(p);
  }
  const plank = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 3.4), mat(PALETTE.timber));
  plank.position.set(1.5, 3.5, 1.5);
  scaffold.add(plank);
  place(scaffold, qz.center.x + 18, qz.center.z - 6);
  group.add(shadowed(scaffold));
  colliders.add({ type: 'box', minX: qz.center.x + 17.8, maxX: qz.center.x + 21.2, minZ: qz.center.z - 6.2, maxZ: qz.center.z - 2.8, top: terrainHeight(qz.center.x + 19, qz.center.z - 5) + 5 });
  const quarryLight = new THREE.PointLight('#5fd8ff', 10, 40, 1.5);
  quarryLight.position.set(qz.center.x, terrainHeight(qz.center.x, qz.center.z) + 6, qz.center.z);
  group.add(quarryLight);

  // ---------- Dormant Foundry ----------
  const fd = ZONES[3];
  const fy = terrainHeight(fd.center.x, fd.center.z);
  const ruinMat = mat('#34343a', { roughness: 0.8, metalness: 0.2 });
  const conduitMat = new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 1.4 });
  const wallR = 21;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    const deg = (a * 180) / Math.PI;
    if (deg > 165 && deg < 195) continue; // south gate opening (facing the trail)
    if (rng.next() < 0.18) continue; // collapsed sections
    const x = fd.center.x + Math.sin(a) * wallR;
    const z = fd.center.z + Math.cos(a) * wallR;
    const h = rng.range(2.5, 6.5);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(5.2, h, 1.4), ruinMat);
    seg.position.set(x, fy + h / 2 - 0.2, z);
    seg.rotation.y = a;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.05), conduitMat);
    strip.position.set(0, h * 0.25, -0.73);
    seg.add(strip);
    group.add(shadowed(seg));
    colliders.add({ type: 'circle', x, z, r: 2.6, top: fy + h });
  }
  // Gate arch
  const gateZ = fd.center.z - wallR;
  for (const sx of [-4, 4]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, 1.4), ruinMat);
    pillar.position.set(fd.center.x + sx, fy + 4, gateZ);
    group.add(shadowed(pillar));
    colliders.add({ type: 'circle', x: fd.center.x + sx, z: gateZ, r: 0.9, top: fy + 8 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(9.5, 1.2, 1.6), ruinMat);
  lintel.position.set(fd.center.x, fy + 8.4, gateZ);
  const sigil = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.08, 6, 24), conduitMat);
  sigil.position.set(fd.center.x, fy + 8.4, gateZ - 0.85);
  group.add(shadowed(lintel), sigil);
  // Arena floor rings + central dormant core at the north end.
  const floorRing = new THREE.Mesh(new THREE.RingGeometry(9, 9.35, 48), new THREE.MeshBasicMaterial({ color: '#2a8fa8', transparent: true, opacity: 0.5 }));
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.set(fd.center.x, fy + 0.04, fd.center.z);
  group.add(floorRing);
  const core = new THREE.Group();
  const coreBase = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 2, 10), ruinMat);
  coreBase.position.y = 1;
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 8, 28), mat(PALETTE.agedSteel, { metalness: 0.8, roughness: 0.4 }));
  coreRing.position.y = 4.5;
  const coreHeart = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.1, 0),
    new THREE.MeshStandardMaterial({ color: PALETTE.ember, emissive: '#ff5a1a', emissiveIntensity: 1.6, flatShading: true }),
  );
  coreHeart.position.y = 4.5;
  core.add(coreBase, coreRing, coreHeart);
  core.position.set(fd.center.x, fy, fd.center.z + 15);
  group.add(shadowed(core));
  colliders.add({ type: 'circle', x: fd.center.x, z: fd.center.z + 15, r: 3.6, top: fy + 6 });
  const coreLight = new THREE.PointLight('#ff6a2a', 14, 30, 1.6);
  coreLight.position.set(fd.center.x, fy + 5, fd.center.z + 13);
  group.add(coreLight);
  flickers.push((t) => {
    coreRing.rotation.x = Math.sin(t * 0.4) * 0.4 + Math.PI / 2;
    coreRing.rotation.y = t * 0.3;
    coreHeart.rotation.y = t * 0.5;
    coreLight.intensity = 12 + Math.sin(t * 2.1) * 3;
    sigil.rotation.z = t * 0.5;
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = fd.center.x + Math.sin(a) * 13;
    const z = fd.center.z + Math.cos(a) * 13;
    if (Math.abs(a - Math.PI) < 0.5) continue;
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, rng.range(3, 6), 6), ruinMat);
    pil.position.set(x, fy + 1.5, z);
    group.add(shadowed(pil));
    colliders.add({ type: 'circle', x, z, r: 0.85, top: fy + 5 });
  }

  scene.add(group);
  return { group, colliders, forgeLight, update: (t) => flickers.forEach((f) => f(t)) };
}
