/**
 * The Emberhold forge: a walk-in stone-and-timber smithy built in code (replaces the Model
 * Workshop "forge_hall" shed at the same spot). The floor plan (hearth, anvil, loft, stairs,
 * Orla's masterwork) lives in @alloy/world FORGE_PLAN, shared with the colliders and the server.
 *
 * Local frame: ground at y = 0, the open front faces +Z. Textures are drawn on canvases at
 * start-up (no image files).
 */
import * as THREE from 'three';
import { FORGE_PLAN } from '@alloy/world';
import { buildShield, buildSword } from '../entities/Weapons';

// ---------------- Procedural textures ----------------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
let seed = 1234;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** A colour near `base`: one shared brightness shift, plus a little per-channel tint. */
const jitter = (base: [number, number, number], amt: number) => {
  const k = (rnd() - 0.5) * amt;
  return `rgb(${base.map((v) => Math.round(Math.max(0, Math.min(255, v + k + (rnd() - 0.5) * amt * 0.15)))).join(',')})`;
};

const stoneTex = () =>
  canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3a342e';
    g.fillRect(0, 0, w, h);
    const rows = 8;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rh * 0.6 : 0;
      while (x < w) {
        const bw = rh * (1.2 + rnd() * 0.9);
        g.fillStyle = jitter([122, 110, 96], 34);
        g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x + 2, r * rh + 2, bw - 4, 3);
        x += bw;
      }
    }
  });
const woodTex = () =>
  canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#4a2f1d';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(${20 + rnd() * 30},${10 + rnd() * 15},5,${0.25 + rnd() * 0.3})`;
      g.lineWidth = 1 + rnd() * 2;
      const x = rnd() * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rnd() - 0.5) * 12, h * 0.3, x + (rnd() - 0.5) * 12, h * 0.7, x + (rnd() - 0.5) * 8, h);
      g.stroke();
    }
  });
const plasterTex = () =>
  canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#cdbb9a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${90 + rnd() * 60},${70 + rnd() * 50},${40 + rnd() * 30},${rnd() * 0.12})`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 4, 2 + rnd() * 4);
    }
  });
const shingleTex = () =>
  canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2a1712';
    g.fillRect(0, 0, w, h);
    const rows = 10;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 0.5 : 0;
      for (let i = -1; i < 9; i++) {
        const x = (i + off) * (w / 8);
        g.fillStyle = jitter([96, 50, 40], 26);
        g.beginPath();
        g.moveTo(x + 2, r * rh);
        g.lineTo(x + w / 8 - 2, r * rh);
        g.lineTo(x + w / 8 - 2, r * rh + rh * 0.8);
        g.quadraticCurveTo(x + w / 16, r * rh + rh * 1.05, x + 2, r * rh + rh * 0.8);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + 2, r * rh + rh * 0.72, w / 8 - 4, rh * 0.1);
      }
    }
  });
const signTex = () =>
  canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#3a2416';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(15,8,3,${0.2 + rnd() * 0.3})`;
      g.beginPath();
      const y = rnd() * h;
      g.moveTo(0, y);
      g.lineTo(w, y + (rnd() - 0.5) * 10);
      g.stroke();
    }
    g.strokeStyle = '#c9974f';
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    // Hammer over anvil
    g.fillStyle = '#e8b45a';
    g.fillRect(40, 92, 70, 14);
    g.fillRect(56, 106, 38, 10);
    g.fillRect(48, 116, 54, 10);
    g.save();
    g.translate(80, 66);
    g.rotate(-0.6);
    g.fillRect(-4, -30, 8, 46);
    g.fillRect(-16, -38, 32, 14);
    g.restore();
    g.font = 'bold 44px Georgia, "Palatino Linotype", serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd28a';
    g.shadowColor = '#ff7a2a';
    g.shadowBlur = 12;
    g.fillText('EMBERHOLD', 138, 62);
    g.font = 'bold 34px Georgia, "Palatino Linotype", serif';
    g.fillText('· FORGE ·', 230, 114);
  });


// ---------------- Building ----------------
/**
 * Orla's masterwork, "Emberwake": a long, slender ironglass-steel blade with a living ember
 * fuller. Built lying along -Z (point first), the flat of the blade facing +X.
 */
function buildEmberwake(): { group: THREE.Group; ember: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#e4eaf1', metalness: 0.95, roughness: 0.16 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d8a542', metalness: 0.9, roughness: 0.28 });
  const leather = new THREE.MeshStandardMaterial({ color: '#3a1a12', roughness: 0.7 });
  const ember = new THREE.MeshStandardMaterial({ color: '#ff8a2a', emissive: new THREE.Color('#ff6a14'), emissiveIntensity: 2.2 });
  // Blade: a tapered profile (length along +x of the shape, width along y), extruded thin.
  const len = 1.22;
  const s = new THREE.Shape();
  s.moveTo(0, 0.042);
  s.lineTo(len * 0.78, 0.034);
  s.quadraticCurveTo(len * 0.95, 0.026, len, 0);
  s.quadraticCurveTo(len * 0.95, -0.026, len * 0.78, -0.034);
  s.lineTo(0, -0.042);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  bladeGeo.translate(0, 0, -0.006);
  const blade = new THREE.Mesh(bladeGeo, steel);
  // Ember fuller, both faces.
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(len * 0.7, 0.012, 0.004), ember);
    f.position.set(len * 0.38, 0, side * 0.0135);
    g.add(f);
  }
  // Swept guard with an ember stone, gold-ringed grip, faceted pommel.
  const guardCore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.05), gold);
  guardCore.position.x = -0.03;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), ember);
  gem.position.set(-0.03, 0, 0.03);
  const gem2 = gem.clone();
  gem2.position.z = -0.03;
  g.add(blade, guardCore, gem, gem2);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.15, 0.032), gold);
    arm.position.set(-0.01, side * 0.12, 0);
    arm.rotation.z = side * -0.35; // swept toward the blade
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), gold);
    tip.position.set(0.025, side * 0.19, 0);
    g.add(arm, tip);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.24, 10), leather);
  grip.rotation.z = Math.PI / 2;
  grip.position.x = -0.18;
  g.add(grip);
  for (const x of [-0.08, -0.18, -0.28]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 10), gold);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = x;
    g.add(ring);
  }
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.04), gold);
  pommel.position.x = -0.33;
  pommel.scale.set(1.2, 1, 0.8);
  g.add(pommel);
  // Lay it along -Z with the flat facing +X.
  g.rotation.y = Math.PI / 2;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const holder = new THREE.Group();
  holder.add(g);
  return { group: holder, ember };
}

export class ForgeBuilding {
  readonly group = new THREE.Group();
  /** Roof, gables, ridge, awning and sign: hidden from the camera while the player is inside (still cast shadows). */
  private roofMats: THREE.Material[] = [];
  private inside = false;
  private coals: THREE.MeshStandardMaterial;
  private lanterns: THREE.MeshStandardMaterial;
  private ember: THREE.MeshStandardMaterial;
  private flames: THREE.Mesh[] = [];

  constructor() {
    seed = 1234;
    const P = FORGE_PLAN;
    const tex = { stone: stoneTex(), wood: woodTex(), plaster: plasterTex(), shingle: shingleTex(), sign: signTex() };
    const mat = (t: THREE.Texture, rx: number, ry: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
      const m = t.clone();
      m.needsUpdate = true;
      m.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map: m, roughness: 0.9, ...opts });
    };
    const stone = (rx = 2, ry = 1) => mat(tex.stone, rx, ry);
    const wood = mat(tex.wood, 1, 1, { roughness: 0.85 });
    const planks = mat(tex.wood, 3, 1, { roughness: 0.85, color: '#c79a72' });
    const darkWood = new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: '#3b3d42', metalness: 0.75, roughness: 0.45 });
    const brass = new THREE.MeshStandardMaterial({ color: '#b8873a', metalness: 0.85, roughness: 0.35 });
    this.coals = new THREE.MeshStandardMaterial({ color: '#2a0e05', emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 2.4, roughness: 1 });
    this.lanterns = new THREE.MeshStandardMaterial({ color: '#ffcf87', emissive: new THREE.Color('#ffae4a'), emissiveIntensity: 2.2 });

    const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x: number, y: number, z: number, rot?: [number, number, number], parent: THREE.Object3D = this.group) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // ---- Floor: a low stone curb outside the walls, flagstones inside (flush with the ground) ----
    add(box(8.4, 0.25, 7.2), stone(4, 0.3), 0, 0.12, -0.05).receiveShadow = true;
    add(box(7.5, 0.05, 6.5), mat(tex.stone, 5, 4, { color: '#8a7a66' }), 0, 0.03, 0.0);
    // The curb is open at the doorway so the floor is level with the ground there.
    add(box(7.3, 0.04, 0.6), mat(tex.stone, 4, 0.4, { color: '#8a7a66' }), 0, 0.02, 3.35);

    // ---- Walls: stone up to 1.3 m, plaster above, timber framing (back and sides; the front is open) ----
    const H = P.wallHeight;
    add(box(8, 1.3, 0.35), stone(4, 0.7), 0, 0.65, -3.3);
    add(box(0.35, 1.3, 6.6), stone(3.3, 0.7), -3.85, 0.65, -0.05);
    add(box(0.35, 1.3, 6.6), stone(3.3, 0.7), 3.85, 0.65, -0.05);
    const plaster = mat(tex.plaster, 2, 1);
    const upH = H - 1.3;
    add(box(8, upH, 0.3), plaster, 0, 1.3 + upH / 2, -3.3);
    add(box(0.3, upH, 6.6), plaster, -3.85, 1.3 + upH / 2, -0.05);
    add(box(0.3, upH, 6.6), plaster, 3.85, 1.3 + upH / 2, -0.05);
    // Timber frame on the walls' outer faces (and the inner top plate)
    for (const y of [1.33, H]) {
      add(box(8.2, 0.18, 0.12), darkWood, 0, y, -3.5);
      add(box(0.12, 0.18, 6.8), darkWood, -4.05, y, -0.05);
      add(box(0.12, 0.18, 6.8), darkWood, 4.05, y, -0.05);
    }
    add(box(7.4, 0.22, 0.16), darkWood, 0, H - 0.1, -3.05);
    for (const x of [-3.9, -1.3, 1.3, 3.9]) add(box(0.18, upH, 0.12), darkWood, x, 1.3 + upH / 2, -3.5);
    for (const z of [-3.3, -1, 1.2]) for (const sx of [-4.05, 4.05]) add(box(0.12, upH, 0.18), darkWood, sx, 1.3 + upH / 2, z);
    for (const [x, d] of [[-2.6, 1], [0, -1], [2.6, 1]] as const) add(box(0.14, 2.3, 0.1), darkWood, x, 2.45, -3.5, [0, 0, d * 0.78]);
    // Windows on the side walls: warm light at night
    const glass = new THREE.MeshStandardMaterial({ color: '#ffcf87', emissive: new THREE.Color('#ff9a3a'), emissiveIntensity: 0.9, roughness: 0.4 });
    for (const sx of [-1, 1])
      for (const z of [-2.2, 0.1]) {
        add(box(0.08, 0.9, 0.9), glass, sx * 4.02, 2.35, z).castShadow = false;
        add(box(0.1, 0.12, 1.1), darkWood, sx * 4.06, 1.86, z);
        add(box(0.1, 0.12, 1.1), darkWood, sx * 4.06, 2.84, z);
        add(box(0.1, 1.0, 0.08), darkWood, sx * 4.07, 2.35, z);
      }

    // ---- Open front: two heavy posts, a lintel and knee braces ----
    for (const x of [-3.85, 3.85]) add(box(0.42, H + 0.2, 0.42), wood, x, (H + 0.2) / 2, 3.2);
    add(box(8.3, 0.45, 0.45), wood, 0, H + 0.2, 3.2);
    for (const s of [-1, 1]) add(box(0.16, 1.3, 0.16), darkWood, s * 3.4, H - 0.35, 3.2, [0, 0, s * 0.78]);

    // ---- Roof: ridge along x at ridgeHeight, slopes down to the front and back eaves ----
    const roof = new THREE.Group();
    this.group.add(roof);
    const ridgeY = P.ridgeHeight;
    const eaveY = H + 0.1;
    const run = 3.9; // ridge (z = -0.05) to each eave
    const rise = ridgeY - eaveY;
    const slope = Math.atan2(rise, run);
    const panel = Math.hypot(run, rise) + 0.45;
    const roofMat = mat(tex.shingle, 5, 3);
    const gablePlaster = mat(tex.plaster, 2, 1);
    gablePlaster.side = THREE.DoubleSide;
    const ridgeWood = darkWood.clone();
    this.roofMats.push(roofMat, gablePlaster, ridgeWood);
    // Back slope: its +z end (at the ridge) is high, so it tips back (negative x rotation).
    add(box(9.2, 0.2, panel), roofMat, 0, ridgeY - rise / 2 + 0.05, -0.05 - run / 2, [-slope, 0, 0], roof);
    add(box(9.2, 0.2, panel), roofMat, 0, ridgeY - rise / 2 + 0.05, -0.05 + run / 2, [slope, 0, 0], roof);
    add(box(9.4, 0.3, 0.32), ridgeWood, 0, ridgeY + 0.12, -0.05, undefined, roof);
    // Gables: triangles closing the sides from the wall top up to the ridge.
    for (const sx of [-3.85, 3.85]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([sx, H + 0.05, -3.45, sx, H + 0.05, 3.35, sx, ridgeY, -0.05], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2.2, 0, 1.1, 0.9], 2));
      geo.computeVertexNormals();
      add(geo, gablePlaster, 0, 0, 0, undefined, roof);
    }

    // ---- Awning over the doorway ----
    const awnLen = 2.3;
    const awnMat = mat(tex.shingle, 4, 1.2);
    this.roofMats.push(awnMat); // the camera sits under it while the player is inside
    add(box(7, 0.14, awnLen), awnMat, 0, H - 0.15, 3.3 + awnLen / 2 - 0.1, [0.28, 0, 0]);
    for (const x of [-2.9, 2.9]) {
      add(box(0.22, H - 0.55, 0.22), wood, x, (H - 0.55) / 2, 5.3);
      add(box(0.12, 1.0, 0.12), darkWood, x, H - 0.85, 4.95, [-0.75, 0, 0]);
    }

    // ---- Chimney (built into the back wall), hearth in front of it, iron hood ----
    const C = P.chimney;
    add(box(C.half * 2, C.h, C.half * 2), stone(1, 4), C.x, C.h / 2, C.z);
    add(box(C.half * 2 + 0.3, 0.3, C.half * 2 + 0.3), mat(tex.stone, 1, 0.3, { color: '#6a5d50' }), C.x, C.h + 0.05, C.z);
    // Flashing where the chimney passes through the back roof slope.
    const roofYAt = (z: number) => ridgeY - (Math.abs(z + 0.05) / run) * rise;
    add(box(C.half * 2 + 0.24, 0.12, C.half * 2 + 0.3), new THREE.MeshStandardMaterial({ color: '#4a4440', metalness: 0.4, roughness: 0.6 }), C.x, roofYAt(C.z) + 0.2, C.z, [-slope, 0, 0]);
    const Hh = P.hearth;
    add(box(Hh.hw * 2, Hh.h, Hh.hd * 2), stone(1.2, 0.5), Hh.x, Hh.h / 2, Hh.z);
    add(box(Hh.hw * 2 + 0.1, 0.12, Hh.hd * 2 + 0.1), mat(tex.stone, 1, 0.2, { color: '#5c5046' }), Hh.x, Hh.h + 0.02, Hh.z);
    const bed = add(box(Hh.hw * 2 - 0.4, 0.1, Hh.hd * 2 - 0.3), this.coals, Hh.x, Hh.h + 0.1, Hh.z);
    bed.castShadow = false;
    for (let i = 0; i < 16; i++) {
      const c = add(new THREE.DodecahedronGeometry(0.08 + rnd() * 0.07), this.coals, Hh.x - 0.8 + rnd() * 1.6, Hh.h + 0.17, Hh.z - 0.35 + rnd() * 0.7);
      c.castShadow = false;
    }
    // Flames: soft additive cones that flicker in update().
    const flameMat = new THREE.MeshBasicMaterial({ color: '#ffa03a', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const f = add(new THREE.ConeGeometry(0.1 + rnd() * 0.08, 0.45 + rnd() * 0.3, 6, 1, true), flameMat, Hh.x - 0.6 + i * 0.2, Hh.h + 0.4, Hh.z - 0.1 + (rnd() - 0.5) * 0.3);
      f.castShadow = false;
      f.receiveShadow = false;
      this.flames.push(f);
    }
    const hood = add(new THREE.CylinderGeometry(0.62, 1.45, 1.3, 4, 1, true), iron, Hh.x, Hh.h + 1.75, Hh.z - 0.15, [0, Math.PI / 4, 0]);
    (hood.material as THREE.Material).side = THREE.DoubleSide;
    add(box(1.0, 1.4, 0.9), stone(0.6, 0.8), Hh.x, Hh.h + 3.05, Hh.z - 0.45); // flue into the chimney breast

    // Bellows beside the hearth, pointing at the fire
    const leather = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.8 });
    const B = P.bellows;
    add(box(0.8, 0.32, 1.1), leather, B.x, 0.95, B.z, [0, 0, 0.2]);
    add(box(0.9, 0.06, 1.2), wood, B.x, 1.15, B.z, [0, 0, 0.2]);
    add(box(0.12, 0.7, 0.12), darkWood, B.x - 0.25, 0.35, B.z - 0.4);
    add(box(0.12, 0.7, 0.12), darkWood, B.x - 0.25, 0.35, B.z + 0.4);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.8), iron, B.x + 0.6, 1.0, B.z, [0, 0, Math.PI / 2]);

    // Quench trough along the left wall
    const T = P.trough;
    add(box(0.7, 0.75, 1.4), wood, T.x, 0.38, T.z);
    const water = add(box(0.55, 0.04, 1.25), new THREE.MeshStandardMaterial({ color: '#1d3b48', metalness: 0.3, roughness: 0.15, emissive: new THREE.Color('#0b2a36'), emissiveIntensity: 0.5 }), T.x, 0.74, T.z);
    water.castShadow = false;

    // ---- Loft over the back right, on a corner post, with railings ----
    const L = P.loft;
    const lw = L.maxX - L.minX;
    const ld = L.maxZ - L.minZ;
    add(box(lw, L.thick, ld), planks, (L.minX + L.maxX) / 2, L.y - L.thick / 2, (L.minZ + L.maxZ) / 2);
    add(box(lw, 0.22, 0.16), darkWood, (L.minX + L.maxX) / 2, L.y - L.thick - 0.1, L.maxZ - 0.08);
    add(box(0.16, 0.22, ld), darkWood, L.minX + 0.08, L.y - L.thick - 0.1, (L.minZ + L.maxZ) / 2);
    add(box(0.2, L.y - L.thick, 0.2), wood, L.minX + 0.06, (L.y - L.thick) / 2, L.maxZ - 0.06);
    const railTop = L.y + 0.95;
    const S = P.stairs;
    add(box(S.minX - L.minX, 0.08, 0.08), wood, (L.minX + S.minX) / 2, railTop, L.maxZ);
    add(box(0.08, 0.08, ld), wood, L.minX, railTop, (L.minZ + L.maxZ) / 2);
    for (let x = L.minX; x <= S.minX + 0.01; x += (S.minX - L.minX) / 3) add(box(0.07, 0.95, 0.07), wood, x, L.y + 0.47, L.maxZ);
    for (let z = L.minZ + 0.1; z <= L.maxZ; z += ld / 3) add(box(0.07, 0.95, 0.07), wood, L.minX, L.y + 0.47, z);
    // Loft storage: sacks and crates (the chest itself is a searchable container).
    const sack = new THREE.MeshStandardMaterial({ color: '#a08a62', roughness: 1 });
    add(new THREE.SphereGeometry(0.28, 8, 6), sack, 3.25, L.y + 0.22, -2.85).scale.set(1, 0.8, 1);
    add(new THREE.SphereGeometry(0.25, 8, 6), sack, 3.3, L.y + 0.2, -2.3).scale.set(1, 0.85, 1);
    add(box(0.55, 0.5, 0.55), wood, 1.5, L.y + 0.25, -2.75);
    add(box(0.45, 0.4, 0.45), wood, 1.55, L.y + 0.7, -2.7, [0, 0.4, 0]);

    // ---- Stairs along the right wall: solid steps and a handrail ----
    const tread = (S.zBottom - S.zTop) / S.steps;
    const stepRise = L.y / S.steps;
    for (let i = 0; i < S.steps; i++) {
      const top = stepRise * (i + 1);
      add(box(S.maxX - S.minX, top, tread), i % 2 ? planks : wood, (S.minX + S.maxX) / 2, top / 2, S.zBottom - (i + 0.5) * tread);
    }
    const railLen = Math.hypot(S.zBottom - S.zTop, L.y);
    add(box(0.07, 0.07, railLen), wood, S.minX - 0.02, L.y / 2 + 0.95, (S.zBottom + S.zTop) / 2, [Math.atan2(L.y, S.zBottom - S.zTop), 0, 0]);
    add(box(0.09, 1.0, 0.09), wood, S.minX - 0.02, 0.5 + stepRise, S.zBottom - tread / 2);

    // ---- The watch's sword rack under the loft: three iron longswords and a shield ----
    const R = P.rack;
    add(box(1.8, 0.1, 0.3), darkWood, R.x, 0.35, R.z);
    add(box(1.8, 0.1, 0.12), darkWood, R.x, 1.25, R.z - 0.08);
    for (const x of [-0.85, 0.85]) add(box(0.1, 1.4, 0.3), darkWood, R.x + x, 0.7, R.z);
    for (const [i, dx] of [-0.5, 0, 0.5].entries()) {
      const s = buildSword(null).group;
      s.position.set(R.x + dx, 1.45, R.z + 0.04);
      s.rotation.set(Math.PI, 0, 0.04 * (i - 1)); // point down, resting in the rack
      this.group.add(s);
    }
    const shield = buildShield();
    shield.position.set(R.x + 0.05, 1.75, R.z - 0.25);
    this.group.add(shield);

    // ---- Orla's masterwork, mounted on the left wall near the door ----
    const M = P.masterwork;
    const plaque = new THREE.Group();
    plaque.position.set(M.x, M.y, M.z);
    this.group.add(plaque);
    add(box(0.06, 0.62, 1.75), darkWood, 0.03, 0, 0, undefined, plaque);
    for (const [y, h] of [[0.31, 0.03], [-0.31, 0.03]] as const) add(box(0.07, h, 1.8), brass, 0.04, y, 0, undefined, plaque);
    for (const z of [-0.88, 0.88]) add(box(0.07, 0.65, 0.03), brass, 0.04, 0, z, undefined, plaque);
    for (const z of [-0.45, 0.32]) add(new THREE.CylinderGeometry(0.018, 0.018, 0.12), brass, 0.1, -0.09, z, [0, 0, Math.PI / 2], plaque);
    add(box(0.02, 0.07, 0.36), brass, 0.07, -0.24, 0.0, undefined, plaque); // name plate
    const ew = buildEmberwake();
    ew.group.position.set(0.12, -0.04, 0.5);
    plaque.add(ew.group);
    this.ember = ew.ember;
    // Two candles on a little shelf beneath it.
    add(box(0.22, 0.05, 0.6), darkWood, 0.11, -0.52, 0, undefined, plaque);
    for (const z of [-0.18, 0.18]) {
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.8 }), 0.12, -0.42, z, undefined, plaque);
      add(new THREE.SphereGeometry(0.022, 6, 5), this.lanterns, 0.12, -0.33, z, undefined, plaque).castShadow = false;
    }

    // ---- Inside lantern on the back wall, between the hearth and the loft ----
    add(box(0.28, 0.38, 0.28), iron, 0.35, 2.3, -2.98).castShadow = false;
    add(box(0.2, 0.28, 0.2), this.lanterns, 0.35, 2.3, -2.93).castShadow = false;

    // ---- Outside, under the awning: coal heap, grindstone, tongs and hammer, lanterns, sign ----
    const coalHeap = new THREE.MeshStandardMaterial({ color: '#16120f', roughness: 1 });
    for (let i = 0; i < 18; i++) add(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.12), coalHeap, -3.0 + rnd() * 0.8, 0.15 + rnd() * 0.35, 4.0 + rnd() * 0.9);
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 20), new THREE.MeshStandardMaterial({ color: '#8d8275', roughness: 0.95 }), 2.0, 0.75, 4.3, [0, 0, Math.PI / 2]);
    add(box(0.9, 0.5, 0.18), wood, 2.0, 0.25, 4.0);
    add(box(0.9, 0.5, 0.18), wood, 2.0, 0.25, 4.6);
    add(box(0.05, 0.7, 0.05), iron, -3.55, 2.4, 2.9, [0, 0, 0.15]);
    add(box(0.05, 0.7, 0.05), iron, -3.45, 2.4, 2.9, [0, 0, -0.15]);
    add(box(0.08, 0.55, 0.08), darkWood, -3.55, 2.3, 2.55);
    add(box(0.28, 0.12, 0.14), iron, -3.55, 2.6, 2.55);
    for (const x of [-2.9, 2.9]) {
      add(box(0.32, 0.42, 0.32), iron, x, 2.45, 5.55).castShadow = false;
      add(box(0.24, 0.3, 0.24), this.lanterns, x, 2.45, 5.55).castShadow = false;
    }
    const signMat = new THREE.MeshStandardMaterial({ map: tex.sign, roughness: 0.8 });
    const signEdge = darkWood.clone();
    this.roofMats.push(signMat, signEdge);
    const sign = add(box(2.6, 0.8, 0.08), [signEdge, signEdge, signEdge, signEdge, signMat, signMat], 0, 2.55, 5.55);
    sign.castShadow = false;
    for (const x of [-1.1, 1.1]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.55), iron, x, 3.2, 5.5);
  }

  /**
   * While the player is inside, the roof is not drawn for the camera (so the view from above
   * shows the room) but still casts its shadow, keeping the interior lit by the hearth.
   */
  setInside(inside: boolean): void {
    if (inside === this.inside) return;
    this.inside = inside;
    for (const m of this.roofMats) {
      m.colorWrite = !inside;
      m.depthWrite = !inside;
    }
  }

  /** Coals breathe, flames flicker, lantern glass and the masterwork's ember fuller pulse. */
  update(time: number): void {
    this.coals.emissiveIntensity = 2.1 + Math.sin(time * 2.1) * 0.35 + Math.sin(time * 7.7) * 0.15;
    this.lanterns.emissiveIntensity = 2.0 + Math.sin(time * 9.1) * 0.12;
    this.ember.emissiveIntensity = 1.9 + Math.sin(time * 1.3) * 0.5;
    this.flames.forEach((f, i) => {
      const k = 0.75 + 0.3 * Math.sin(time * (8 + i * 1.7) + i) + 0.12 * Math.sin(time * 23 + i * 3);
      f.scale.set(1, k, 1);
    });
  }
}
