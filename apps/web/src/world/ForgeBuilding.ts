/**
 * The Emberhold forge: a stone-and-timber smithy built in code (replaces the plain Model
 * Workshop "forge_hall" shed at the same spot, footprint and collider).
 *
 * Local frame: ground at y = 0, the open front faces +Z (toward the anvil), the footprint is
 * x in [-4, 4], z in [-3.5, 3.4] (the collider box). The roof overhang and awning reach
 * further forward but don't collide.
 *
 * Textures are drawn on canvases at start-up (no image files).
 */
import * as THREE from 'three';
import { buildSword } from '../entities/Weapons';

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
    g.font = 'bold 54px Georgia, "Palatino Linotype", serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd28a';
    g.shadowColor = '#ff7a2a';
    g.shadowBlur = 12;
    g.fillText('EMBERHOLD', 140, 62);
    g.font = 'bold 34px Georgia, "Palatino Linotype", serif';
    g.fillText('· FORGE ·', 230, 114);
  });

// ---------------- Building ----------------
export class ForgeBuilding {
  readonly group = new THREE.Group();
  private coals: THREE.MeshStandardMaterial;
  private lanterns: THREE.MeshStandardMaterial;

  constructor() {
    seed = 1234;
    const tex = { stone: stoneTex(), wood: woodTex(), plaster: plasterTex(), shingle: shingleTex(), sign: signTex() };
    const mat = (t: THREE.Texture, rx: number, ry: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
      const m = t.clone();
      m.needsUpdate = true;
      m.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map: m, roughness: 0.9, ...opts });
    };
    const stone = (rx = 2, ry = 1) => mat(tex.stone, rx, ry);
    const wood = mat(tex.wood, 1, 1, { roughness: 0.85 });
    const darkWood = new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: '#3b3d42', metalness: 0.75, roughness: 0.45 });
    this.coals = new THREE.MeshStandardMaterial({ color: '#2a0e05', emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 2.4, roughness: 1 });
    this.lanterns = new THREE.MeshStandardMaterial({ color: '#ffcf87', emissive: new THREE.Color('#ffae4a'), emissiveIntensity: 2.2 });

    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rot?: [number, number, number]) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // Foundation and floor
    add(box(8.4, 0.45, 7.2), stone(4, 0.5), 0, 0.22, -0.05);
    add(box(7.6, 0.06, 6.4), mat(tex.stone, 5, 4, { color: '#8a7a66' }), 0, 0.47, -0.05);

    // Walls: stone up to 1.3 m, plaster above, timber framing (back and sides; the front is open)
    const H = 3.6;
    add(box(8, 1.3, 0.35), stone(4, 0.7), 0, 1.1, -3.3);
    add(box(0.35, 1.3, 6.6), stone(3.3, 0.7), -3.85, 1.1, -0.05);
    add(box(0.35, 1.3, 6.6), stone(3.3, 0.7), 3.85, 1.1, -0.05);
    const plaster = mat(tex.plaster, 2, 1);
    add(box(8, H - 1.75, 0.3), plaster, 0, 1.75 + (H - 1.75) / 2, -3.3);
    add(box(0.3, H - 1.75, 6.6), plaster, -3.85, 1.75 + (H - 1.75) / 2, -0.05);
    add(box(0.3, H - 1.75, 6.6), plaster, 3.85, 1.75 + (H - 1.75) / 2, -0.05);
    // Timber frame on the walls' outer faces
    for (const y of [1.78, H]) {
      add(box(8.2, 0.18, 0.12), darkWood, 0, y, -3.5);
      add(box(0.12, 0.18, 6.8), darkWood, -4.05, y, -0.05);
      add(box(0.12, 0.18, 6.8), darkWood, 4.05, y, -0.05);
    }
    for (const x of [-3.9, -1.3, 1.3, 3.9]) add(box(0.18, H - 1.75, 0.12), darkWood, x, 1.75 + (H - 1.75) / 2, -3.5);
    for (const z of [-3.3, -1, 1.2]) for (const sx of [-4.05, 4.05]) add(box(0.12, H - 1.75, 0.18), darkWood, sx, 1.75 + (H - 1.75) / 2, z);
    for (const [x, d] of [[-2.6, 1], [0, -1], [2.6, 1]] as const) add(box(0.14, 2.3, 0.1), darkWood, x, 2.7, -3.5, [0, 0, d * 0.78]);

    // Open front: two heavy posts and a lintel
    for (const x of [-3.85, 3.85]) add(box(0.42, H, 0.42), wood, x, H / 2 + 0.45, 3.2);
    add(box(8.3, 0.45, 0.45), wood, 0, H + 0.2, 3.2);
    // Knee braces
    for (const s of [-1, 1]) add(box(0.16, 1.3, 0.16), darkWood, s * 3.4, H - 0.35, 3.2, [0, 0, s * 0.78]);

    // Gables (side triangles) and roof: ridge along x
    const ridgeY = 6.5;
    const gable = new THREE.Shape();
    gable.moveTo(-3.5, 0);
    gable.lineTo(3.45, 0);
    gable.lineTo(-0.05, ridgeY - H);
    gable.closePath();
    const gableGeo = new THREE.ShapeGeometry(gable);
    for (const s of [-1, 1]) {
      const m = add(gableGeo, plaster, s * 3.85, H + 0.2, 0, [0, s * Math.PI / 2, 0]);
      (m.material as THREE.Material).side = THREE.DoubleSide;
    }
    const roofMat = mat(tex.shingle, 5, 3);
    const back = { dz: 3.9, dy: ridgeY - (H + 0.1) };
    const lenBack = Math.hypot(back.dz, back.dy) + 0.5;
    const angle = Math.atan2(back.dy, back.dz);
    add(box(9.2, 0.18, lenBack), roofMat, 0, ridgeY - back.dy / 2 - 0.05, -0.05 - back.dz / 2, [angle, 0, 0]);
    add(box(9.2, 0.18, lenBack), roofMat, 0, ridgeY - back.dy / 2 - 0.05, -0.05 + back.dz / 2, [-angle, 0, 0]);
    add(box(9.4, 0.3, 0.3), darkWood, 0, ridgeY + 0.05, -0.05);

    // Awning over the anvil: a lean-to on two posts
    const awnLen = 2.3;
    add(box(7, 0.14, awnLen), mat(tex.shingle, 4, 1.2), 0, H - 0.15, 3.3 + awnLen / 2 - 0.1, [-0.28, 0, 0]);
    for (const x of [-2.9, 2.9]) {
      add(box(0.22, H - 0.75, 0.22), wood, x, (H - 0.75) / 2 + 0.45, 5.3);
      add(box(0.12, 1.0, 0.12), darkWood, x, H - 0.85, 4.95, [0.75, 0, 0]);
    }

    // Chimney and hearth (back left), hood, coals
    add(box(1.6, 9.2, 1.6), stone(1, 4), -2.4, 4.6, -2.5);
    add(box(1.9, 0.3, 1.9), mat(tex.stone, 1, 0.3, { color: '#6a5d50' }), -2.4, 9.25, -2.5);
    add(box(2.4, 1.0, 1.5), stone(1.2, 0.5), -2.4, 0.95, -1.3);
    const bed = add(box(2.0, 0.12, 1.1), this.coals, -2.4, 1.5, -1.3);
    bed.castShadow = false;
    for (let i = 0; i < 14; i++) {
      const c = add(new THREE.DodecahedronGeometry(0.09 + rnd() * 0.07), this.coals, -3.2 + rnd() * 1.6, 1.58, -1.75 + rnd() * 0.9);
      c.castShadow = false;
    }
    const hood = add(new THREE.CylinderGeometry(0.7, 1.45, 1.4, 4, 1, true), iron, -2.4, 2.75, -1.6, [0, Math.PI / 4, 0]);
    (hood.material as THREE.Material).side = THREE.DoubleSide;

    // Bellows beside the hearth
    const leather = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.8 });
    add(box(0.9, 0.35, 1.2), leather, -0.7, 1.2, -1.4, [0, 0, 0.25]);
    add(box(1.0, 0.06, 1.3), wood, -0.7, 1.42, -1.4, [0, 0, 0.25]);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.9), iron, -1.3, 1.1, -1.4, [0, 0, Math.PI / 2]);

    // Quench trough with water
    add(box(1.7, 0.6, 0.8), wood, 1.7, 0.78, -2.6);
    const water = add(box(1.5, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: '#1d3b48', metalness: 0.3, roughness: 0.15, emissive: new THREE.Color('#0b2a36'), emissiveIntensity: 0.5 }), 1.7, 1.06, -2.6);
    water.castShadow = false;

    // Weapon rack on the right wall, with swords
    add(box(0.12, 1.6, 2.0), darkWood, 3.55, 1.6, -0.5);
    add(box(0.25, 0.1, 2.0), darkWood, 3.48, 0.95, -0.5);
    for (const [i, z] of [-1.15, -0.5, 0.15].entries()) {
      const s = buildSword(null).group;
      s.position.set(3.42, 2.25, z);
      s.rotation.set(Math.PI, 0, 0.05 * (i - 1)); // blade down, resting in the rack
      s.scale.setScalar(1.05);
      this.group.add(s);
    }

    // Coal pile, tools and a grindstone outside under the awning
    const coalHeap = new THREE.MeshStandardMaterial({ color: '#16120f', roughness: 1 });
    for (let i = 0; i < 18; i++) add(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.12), coalHeap, -3.2 + rnd() * 0.8, 0.6 + rnd() * 0.35, 0.3 + rnd() * 0.9);
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 20), new THREE.MeshStandardMaterial({ color: '#8d8275', roughness: 0.95 }), 3.25, 1.0, 4.3, [0, 0, Math.PI / 2]);
    add(box(0.9, 0.7, 0.18), wood, 3.25, 0.7, 4.0);
    add(box(0.9, 0.7, 0.18), wood, 3.25, 0.7, 4.6);
    // Tongs and hammer hanging inside the front post
    add(box(0.05, 0.7, 0.05), iron, -3.55, 2.4, 2.9, [0, 0, 0.15]);
    add(box(0.05, 0.7, 0.05), iron, -3.45, 2.4, 2.9, [0, 0, -0.15]);
    add(box(0.08, 0.55, 0.08), darkWood, -3.55, 2.3, 2.55);
    add(box(0.28, 0.12, 0.14), iron, -3.55, 2.6, 2.55);

    // Lanterns on the awning posts
    for (const x of [-2.9, 2.9]) {
      add(box(0.32, 0.42, 0.32), iron, x, 2.45, 5.55).castShadow = false;
      add(box(0.24, 0.3, 0.24), this.lanterns, x, 2.45, 5.55).castShadow = false;
    }

    // Hanging sign under the awning
    const signMat = new THREE.MeshStandardMaterial({ map: tex.sign, roughness: 0.8 });
    const sign = add(box(2.6, 0.8, 0.08), [darkWood, darkWood, darkWood, darkWood, signMat, signMat] as unknown as THREE.Material, 0, 2.55, 5.55);
    sign.castShadow = false;
    for (const x of [-1.1, 1.1]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.55), iron, x, 3.2, 5.5);
  }

  /** Coals breathe; lantern glass flickers a little. */
  update(time: number): void {
    this.coals.emissiveIntensity = 2.1 + Math.sin(time * 2.1) * 0.35 + Math.sin(time * 7.7) * 0.15;
    this.lanterns.emissiveIntensity = 2.0 + Math.sin(time * 9.1) * 0.12;
  }
}
