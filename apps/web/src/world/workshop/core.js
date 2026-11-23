// Alloy Frontier Model Workshop — core: theme materials, procedural textures, shapes,
// recipe format, model building and game-ready export. Runs in the browser (via import map)
// and in Node (for tests). No DOM use outside the texture factory.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const RECIPE_FORMAT = 'alloy-recipe';
export const RECIPE_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Seeded randomness and noise
// ---------------------------------------------------------------------------------------------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, s = 0, oct = 4) {
  let f = 0;
  let amp = 0.5;
  let fr = 1;
  for (let i = 0; i < oct; i++) {
    f += amp * noise2(x * fr, y * fr, s + i * 17);
    fr *= 2;
    amp *= 0.5;
  }
  return f / (1 - Math.pow(0.5, oct));
}

// ---------------------------------------------------------------------------------------------
// Theme: materials of the Alloy Frontier / Aurealium Order look.
// Textures are neutral detail maps tinted by the material colour, except decals (full colour).
// tile = metres per texture repeat.
// ---------------------------------------------------------------------------------------------
export const DEFAULT_MATERIALS = {
  chapter_stone: { label: 'Chapter stone', group: 'Stone', color: '#b9b2a2', rough: 0.85, metal: 0, tex: 'ashlar', tile: 1.6 },
  dark_stone: { label: 'Dark stone', group: 'Stone', color: '#4a4844', rough: 0.9, metal: 0, tex: 'ashlar', tile: 1.6 },
  brick: { label: 'Kiln brick', group: 'Stone', color: '#8a5440', rough: 0.9, metal: 0, tex: 'brick', tile: 1.2 },
  cobble: { label: 'Cobble', group: 'Stone', color: '#6a655d', rough: 0.95, metal: 0, tex: 'cobble', tile: 1.5 },
  plaster: { label: 'Ivory plaster', group: 'Stone', color: '#d6ccb4', rough: 0.95, metal: 0, tex: 'plaster', tile: 2 },
  timber: { label: 'Timber', group: 'Wood', color: '#6a4b32', rough: 0.85, metal: 0, tex: 'planks', tile: 1.2 },
  timber_dark: { label: 'Dark timber', group: 'Wood', color: '#3e2c1f', rough: 0.85, metal: 0, tex: 'planks', tile: 1.2 },
  bark: { label: 'Ironwood bark', group: 'Wood', color: '#3b2e24', rough: 0.95, metal: 0, tex: 'bark', tile: 1.4 },
  roof_slate: { label: 'Slate roof', group: 'Roof', color: '#3e4b55', rough: 0.8, metal: 0.05, tex: 'shingles', tile: 1.4 },
  roof_clay: { label: 'Clay roof', group: 'Roof', color: '#7a3e2c', rough: 0.85, metal: 0, tex: 'shingles', tile: 1.4 },
  brass: { label: 'Brass', group: 'Metal', color: '#b8913a', rough: 0.38, metal: 0.85, tex: 'hammered', tile: 0.8 },
  gilt: { label: 'Order gilt', group: 'Metal', color: '#e0b84e', rough: 0.25, metal: 0.95, tex: 'hammered', tile: 0.8 },
  copper: { label: 'Verdigris copper', group: 'Metal', color: '#4f8f80', rough: 0.6, metal: 0.5, tex: 'hammered', tile: 0.8 },
  iron: { label: 'Riveted iron', group: 'Metal', color: '#5e646a', rough: 0.55, metal: 0.7, tex: 'plate', tile: 1.2 },
  steel: { label: 'Steel', group: 'Metal', color: '#8d949b', rough: 0.4, metal: 0.8, tex: null, tile: 1 },
  aether_glass: { label: 'Aether glass', group: 'Glow', color: '#7fdcff', rough: 0.15, metal: 0.1, emissive: '#2ab8e8', glow: 1.2, tex: null, tile: 1 },
  ember: { label: 'Ember glow', group: 'Glow', color: '#ff8a3d', rough: 0.5, metal: 0, emissive: '#ff5a1a', glow: 1.6, tex: null, tile: 1 },
  lamp_warm: { label: 'Lamp glass', group: 'Glow', color: '#ffd59a', rough: 0.2, metal: 0, emissive: '#ffb24a', glow: 1.3, tex: null, tile: 1 },
  banner: { label: 'Order banner', group: 'Cloth', color: '#ffffff', rough: 0.9, metal: 0, tex: 'sigil', decal: true, double: true, tile: 1 },
  awning: { label: 'Striped awning', group: 'Cloth', color: '#ffffff', rough: 0.9, metal: 0, tex: 'stripes', tile: 1.6, double: true },
  clockface: { label: 'Clock face', group: 'Decal', color: '#ffffff', rough: 0.5, metal: 0.2, tex: 'clock', decal: true, tile: 1 },
  foliage: { label: 'Canopy', group: 'Nature', color: '#3d5230', rough: 0.9, metal: 0, tex: 'leaf', tile: 1.5, flat: true },
  foliage_gold: { label: 'Gilded leaves', group: 'Nature', color: '#c99a3a', rough: 0.8, metal: 0.1, tex: 'leaf', tile: 1.5, flat: true },
  grass: { label: 'Frontier grass', group: 'Ground', color: '#56653a', rough: 1, metal: 0, tex: 'grass', tile: 3 },
  dirt: { label: 'Trail dirt', group: 'Ground', color: '#6b553d', rough: 1, metal: 0, tex: 'dirt', tile: 3 },
  rock: { label: 'Rock face', group: 'Ground', color: '#6a6660', rough: 0.95, metal: 0, tex: 'rock', tile: 2.5, flat: true },
  iron_ore: { label: 'Iron ore', group: 'Ground', color: '#6b5f57', rough: 0.9, metal: 0.2, tex: 'rock', tile: 1.5, flat: true },
  water: { label: 'Water', group: 'Ground', color: '#2f6878', rough: 0.1, metal: 0.2, opacity: 0.78, tex: null, tile: 1 },
};

// ---------------------------------------------------------------------------------------------
// Procedural textures (256px, neutral detail; decals in colour). Browser only.
// ---------------------------------------------------------------------------------------------
export const TEXTURES = ['ashlar', 'brick', 'cobble', 'plaster', 'planks', 'bark', 'shingles', 'hammered', 'plate', 'leaf', 'grass', 'dirt', 'rock', 'stripes', 'sigil', 'clock'];
const TEX_SIZE = 256;

function px(ctx, r) {
  // Grain overlay
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 18;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}
function grey(v) {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
}
function noiseFill(ctx, s, scale, lo, hi, oct = 4) {
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  for (let y = 0; y < TEX_SIZE; y++)
    for (let x = 0; x < TEX_SIZE; x++) {
      // Tileable: blend noise at wrapped coordinates.
      const u = x / TEX_SIZE;
      const v = y / TEX_SIZE;
      const n =
        fbm(u * scale, v * scale, s, oct) * (1 - u) * (1 - v) +
        fbm((u - 1) * scale, v * scale, s, oct) * u * (1 - v) +
        fbm(u * scale, (v - 1) * scale, s, oct) * (1 - u) * v +
        fbm((u - 1) * scale, (v - 1) * scale, s, oct) * u * v;
      const g = lo + (hi - lo) * n;
      const i = (y * TEX_SIZE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

export function drawTexture(ctx, key, seed = 7) {
  const S = TEX_SIZE;
  const r = rng(seed * 31 + key.length * 7);
  ctx.save();
  ctx.clearRect(0, 0, S, S);
  switch (key) {
    case 'ashlar': {
      noiseFill(ctx, seed, 6, 205, 245);
      const rows = 4;
      const h = S / rows;
      for (let j = 0; j < rows; j++) {
        let x = j % 2 ? -S / 6 : 0;
        while (x < S) {
          const w = S / 3 + (r() - 0.5) * 30;
          ctx.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.08})`;
          ctx.fillRect(x + 2, j * h + 2, w - 4, h - 4);
          ctx.strokeStyle = 'rgba(40,36,30,0.55)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 1.5, j * h + 1.5, w - 3, h - 3);
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 4, j * h + 4);
          ctx.lineTo(x + w - 4, j * h + 4);
          ctx.stroke();
          x += w;
        }
      }
      break;
    }
    case 'brick': {
      ctx.fillStyle = grey(150);
      ctx.fillRect(0, 0, S, S);
      const rows = 8;
      const h = S / rows;
      for (let j = 0; j < rows; j++)
        for (let i = -1; i < 5; i++) {
          const x = i * (S / 4) + (j % 2 ? S / 8 : 0);
          ctx.fillStyle = grey(200 + (r() - 0.5) * 50);
          ctx.fillRect(x + 2, j * h + 2, S / 4 - 4, h - 4);
        }
      break;
    }
    case 'cobble': {
      ctx.fillStyle = grey(120);
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 70; i++) {
        const x = r() * S;
        const y = r() * S;
        const rad = 12 + r() * 14;
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          ctx.fillStyle = grey(185 + (r() - 0.5) * 60);
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'plaster':
      noiseFill(ctx, seed, 5, 215, 250, 5);
      break;
    case 'planks': {
      noiseFill(ctx, seed + 3, 3, 170, 230);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = (i * S) / n;
        ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
        ctx.fillRect(x, 0, S / n, S);
        ctx.fillStyle = 'rgba(25,15,8,0.6)';
        ctx.fillRect(x, 0, 2, S);
        for (let k = 0; k < 7; k++) {
          ctx.strokeStyle = `rgba(30,18,10,${0.08 + r() * 0.1})`;
          ctx.beginPath();
          const xx = x + 4 + r() * (S / n - 8);
          ctx.moveTo(xx, 0);
          ctx.bezierCurveTo(xx + 4, S * 0.3, xx - 4, S * 0.6, xx + 2, S);
          ctx.stroke();
        }
        if (r() > 0.5) {
          ctx.fillStyle = 'rgba(40,30,20,0.7)';
          ctx.beginPath();
          ctx.arc(x + S / n / 2, r() * S, 2, 0, 7);
          ctx.arc(x + S / n / 2, (r() * S + S / 2) % S, 2, 0, 7);
          ctx.fill();
        }
      }
      break;
    }
    case 'bark': {
      noiseFill(ctx, seed, 4, 150, 220);
      for (let i = 0; i < 40; i++) {
        const x = r() * S;
        ctx.strokeStyle = `rgba(20,12,6,${0.25 + r() * 0.3})`;
        ctx.lineWidth = 2 + r() * 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= S; y += 32) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 6, y);
        ctx.stroke();
      }
      break;
    }
    case 'shingles': {
      ctx.fillStyle = grey(120);
      ctx.fillRect(0, 0, S, S);
      const rows = 8;
      const h = S / rows;
      for (let j = 0; j < rows; j++)
        for (let i = -1; i < 9; i++) {
          const x = i * (S / 8) + (j % 2 ? S / 16 : 0);
          const g = ctx.createLinearGradient(0, j * h, 0, j * h + h);
          const b = 190 + (r() - 0.5) * 50;
          g.addColorStop(0, grey(b + 25));
          g.addColorStop(1, grey(b - 35));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x + 1, j * h);
          ctx.lineTo(x + S / 8 - 1, j * h);
          ctx.lineTo(x + S / 8 - 1, j * h + h - 6);
          ctx.quadraticCurveTo(x + S / 16, j * h + h + 2, x + 1, j * h + h - 6);
          ctx.fill();
        }
      break;
    }
    case 'hammered': {
      noiseFill(ctx, seed, 10, 200, 245, 3);
      for (let i = 0; i < 160; i++) {
        const x = r() * S;
        const y = r() * S;
        const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 9);
        g.addColorStop(0, 'rgba(255,255,255,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 10, y - 10, 20, 20);
      }
      break;
    }
    case 'plate': {
      noiseFill(ctx, seed, 6, 185, 225, 3);
      ctx.strokeStyle = 'rgba(20,20,22,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, S / 2 - 3, S - 3);
      ctx.strokeRect(S / 2 + 1.5, 1.5, S / 2 - 3, S / 2 - 3);
      ctx.strokeRect(S / 2 + 1.5, S / 2 + 1.5, S / 2 - 3, S / 2 - 3);
      for (const [x0, y0, w, h] of [[0, 0, S / 2, S], [S / 2, 0, S / 2, S / 2], [S / 2, S / 2, S / 2, S / 2]])
        for (let t = 0; t <= 1; t += 0.25)
          for (const [x, y] of [[x0 + 9, y0 + 9 + t * (h - 18)], [x0 + w - 9, y0 + 9 + t * (h - 18)], [x0 + 9 + t * (w - 18), y0 + 9], [x0 + 9 + t * (w - 18), y0 + h - 9]]) {
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.beginPath();
            ctx.arc(x - 1, y - 1, 3, 0, 7);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath();
            ctx.arc(x + 1, y + 1, 3, 0, 7);
            ctx.fill();
          }
      break;
    }
    case 'leaf': {
      noiseFill(ctx, seed, 8, 140, 235, 4);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0,0.08)`;
        ctx.beginPath();
        ctx.ellipse(r() * S, r() * S, 6, 3, r() * 3, 0, 7);
        ctx.fill();
      }
      break;
    }
    case 'grass': {
      noiseFill(ctx, seed, 5, 165, 230, 5);
      for (let i = 0; i < 900; i++) {
        const x = r() * S;
        const y = r() * S;
        ctx.strokeStyle = `rgba(255,255,220,${0.05 + r() * 0.12})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 4, y - 5 - r() * 5);
        ctx.stroke();
      }
      break;
    }
    case 'dirt': {
      noiseFill(ctx, seed, 7, 160, 230, 5);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`;
        ctx.beginPath();
        ctx.arc(r() * S, r() * S, 1 + r() * 3, 0, 7);
        ctx.fill();
      }
      break;
    }
    case 'rock': {
      // Weathered stone: soft mottling, faint sediment strata and mineral speckle (no crack lines).
      noiseFill(ctx, seed, 3, 165, 232, 5);
      const img = ctx.getImageData(0, 0, S, S);
      const d = img.data;
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const u = x / S;
          const v = y / S;
          const warp = fbm(u * 3, v * 3, seed + 5, 3) * 1.4;
          const band = Math.sin((v * 5 + warp) * Math.PI * 2) * 0.5 + 0.5;
          const blotch = fbm(u * 9, v * 9, seed + 11, 3);
          const k = 1 - band * 0.07 - Math.max(0, blotch - 0.6) * 0.35;
          const i = (y * S + x) * 4;
          d[i] *= k;
          d[i + 1] *= k;
          d[i + 2] *= k * 0.985;
        }
      ctx.putImageData(img, 0, 0);
      for (let i = 0; i < 520; i++) {
        const light = r() > 0.45;
        ctx.fillStyle = light ? `rgba(255,250,240,${0.08 + r() * 0.12})` : `rgba(0,0,0,${0.08 + r() * 0.14})`;
        ctx.beginPath();
        ctx.arc(r() * S, r() * S, 0.6 + r() * 1.4, 0, 7);
        ctx.fill();
      }
      break;
    }
    case 'stripes': {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#e8dcc0' : '#2c4f8a';
        ctx.fillRect((i * S) / 8, 0, S / 8, S);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < S; y += 4) ctx.fillRect(0, y, S, 1);
      break;
    }
    case 'sigil': {
      // Aurealium Order banner: azure field, gilt gear-sun, cog border.
      ctx.fillStyle = '#23407a';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < S; y += 3) ctx.fillRect(0, y, S, 1);
      ctx.strokeStyle = '#e0b84e';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, S - 20, S - 20);
      const cx = S / 2;
      const cy = S * 0.46;
      ctx.fillStyle = '#e0b84e';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(-6, -60);
        ctx.lineTo(0, i % 2 ? -92 : -80);
        ctx.lineTo(6, -60);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = i % 2 ? 58 : 50;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#23407a';
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#7fdcff';
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#e0b84e';
      ctx.fillRect(cx - 44, S * 0.8, 88, 6);
      ctx.fillRect(cx - 28, S * 0.86, 56, 4);
      break;
    }
    case 'clock': {
      ctx.fillStyle = '#efe4c8';
      ctx.fillRect(0, 0, S, S);
      const c = S / 2;
      ctx.strokeStyle = '#b8913a';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(c, c, S / 2 - 10, 0, 7);
      ctx.stroke();
      ctx.fillStyle = '#2a2622';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(a);
        ctx.fillRect(-3, -S / 2 + 24, 6, i % 3 ? 14 : 24);
        ctx.restore();
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + 40, c - 30);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c - 10, c - 80);
      ctx.stroke();
      ctx.fillStyle = '#b8913a';
      ctx.beginPath();
      ctx.arc(c, c, 9, 0, 7);
      ctx.fill();
      break;
    }
    default:
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, S, S);
  }
  if (!['sigil', 'clock', 'stripes'].includes(key)) px(ctx, r);
  ctx.restore();
}

let textureFactory = null;
/** Browser: provide (key) => THREE.Texture. Node tests leave it unset (untextured). */
export function setTextureFactory(f) {
  textureFactory = f;
}
export function makeCanvasTextureFactory(doc, seedOf = () => 7) {
  const cache = new Map();
  const f = (key) => {
    const seed = seedOf(key);
    const id = `${key}:${seed}`;
    if (cache.has(id)) return cache.get(id);
    const c = doc.createElement('canvas');
    c.width = c.height = TEX_SIZE;
    drawTexture(c.getContext('2d', { willReadFrequently: true }), key, seed);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.name = key;
    t.userData.canvas = c;
    cache.set(id, t);
    return t;
  };
  f.clear = () => cache.clear();
  return f;
}

/** Three materials from a theme, cached per key (rebuild after theme edits). */
export class MaterialBank {
  constructor(theme) {
    this.theme = theme;
    this.cache = new Map();
  }
  setTheme(theme) {
    this.theme = theme;
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
  def(key) {
    return this.theme[key] ?? this.theme.chapter_stone ?? Object.values(this.theme)[0];
  }
  get(key, tint = null) {
    const id = `${key}|${tint ?? ''}`;
    let m = this.cache.get(id);
    if (m) return m;
    const d = this.def(key);
    m = new THREE.MeshStandardMaterial({
      name: tint ? `${key}_${tint.replace('#', '')}` : key,
      color: tint ?? d.color,
      roughness: d.rough ?? 0.8,
      metalness: d.metal ?? 0,
      flatShading: !!d.flat,
      side: d.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (d.emissive) {
      m.emissive = new THREE.Color(d.emissive);
      m.emissiveIntensity = d.glow ?? 1;
    }
    if (d.opacity !== undefined && d.opacity < 1) {
      m.transparent = true;
      m.opacity = d.opacity;
    }
    if (d.tex && textureFactory) m.map = textureFactory(d.tex);
    if (d.image && textureFactory?.fromImage) m.map = textureFactory.fromImage(key, d.image);
    this.cache.set(id, m);
    return m;
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes. Most stand on their base (y = 0 at the bottom); sphere/torus/gear/rock are centred.
// Every shape: params with defaults, and a geometry builder.
// ---------------------------------------------------------------------------------------------
export const SHAPES = {
  box: { label: 'Box', base: true, p: { w: 1, h: 1, d: 1 } },
  cylinder: { label: 'Cylinder', base: true, p: { rt: 0.5, rb: 0.5, h: 1, seg: 16 } },
  cone: { label: 'Cone', base: true, p: { r: 0.5, h: 1, seg: 16 } },
  sphere: { label: 'Sphere / dome', base: false, p: { r: 0.5, seg: 16, hemi: false } },
  torus: { label: 'Ring / torus', base: false, p: { r: 0.5, tube: 0.08, arc: 360, seg: 24 } },
  prism: { label: 'Gable roof', base: true, p: { w: 2, h: 1, d: 2, overhang: 0 } },
  pyramid: { label: 'Pyramid roof', base: true, p: { w: 2, h: 1, d: 2 } },
  arch: { label: 'Arch wall', base: true, p: { w: 3, h: 3.4, d: 0.6, ow: 1.6, oh: 1.8 } },
  gear: { label: 'Gear', base: false, p: { r: 0.6, teeth: 12, tooth: 0.12, depth: 0.12, hole: 0.2 } },
  tube: { label: 'Tube / collar', base: true, p: { ro: 0.5, ri: 0.4, h: 0.3, seg: 20 } },
  lathe: { label: 'Turned profile', base: true, p: { pts: [[0, 0], [0.4, 0], [0.3, 0.4], [0.35, 0.8], [0, 1]], seg: 16 } },
  stairs: { label: 'Stairs', base: true, p: { w: 1.6, h: 1, d: 2, steps: 5 } },
  rock: { label: 'Rock', base: false, p: { r: 0.8, seed: 1, detail: 1, rough: 0.35 } },
  terrain: { label: 'Terrain patch', base: true, p: { size: 20, seg: 48, height: 3, seed: 1, style: 'hills', flat: 0, edge: true } },
  banner: { label: 'Banner cloth', base: true, p: { w: 1, h: 2, wave: 0.08 } },
  plane: { label: 'Flat plane', base: true, p: { w: 4, d: 4 } },
};
export const TERRAIN_STYLES = ['hills', 'mesa', 'ridge', 'crater', 'flat'];

function onBase(g) {
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  return g;
}

export function terrainHeight(p, x, z) {
  const s = p.seed | 0;
  const half = p.size / 2;
  const nx = x / p.size;
  const nz = z / p.size;
  let h;
  switch (p.style) {
    case 'mesa': {
      const n = fbm(nx * 2.2 + 3, nz * 2.2 + 7, s, 4);
      const t = Math.max(0, Math.min(1, (n - 0.48) * 9));
      h = t * t * (3 - 2 * t) + fbm(nx * 8, nz * 8, s + 9, 3) * 0.12;
      break;
    }
    case 'ridge': {
      const n = 1 - Math.abs(fbm(nx * 2.5, nz * 2.5, s, 5) * 2 - 1);
      h = Math.pow(n, 2.2);
      break;
    }
    case 'crater': {
      const d = Math.hypot(nx, nz) * 2;
      h = Math.max(0, 1 - Math.abs(d - 0.55) * 4) * 0.9 - Math.max(0, 0.45 - d) * 0.6 + fbm(nx * 6, nz * 6, s, 3) * 0.15 + 0.3;
      break;
    }
    case 'flat':
      h = fbm(nx * 6, nz * 6, s, 3) * 0.15;
      break;
    default:
      h = fbm(nx * 2.4 + 11, nz * 2.4 - 4, s, 5);
  }
  let hh = h * p.height;
  if (p.flat > 0) {
    const d = Math.hypot(x, z);
    const t = Math.max(0, Math.min(1, (d - p.flat) / Math.max(0.01, p.flat * 0.6)));
    hh *= t;
  }
  if (p.edge) {
    const e = Math.max(Math.abs(x), Math.abs(z)) / half;
    const t = Math.max(0, Math.min(1, (1 - e) / 0.18));
    hh *= t * t * (3 - 2 * t);
  }
  return hh;
}

export function shapeGeometry(shape, p) {
  switch (shape) {
    case 'box':
      return onBase(new THREE.BoxGeometry(p.w, p.h, p.d));
    case 'cylinder':
      return onBase(new THREE.CylinderGeometry(p.rt, p.rb, p.h, Math.max(3, p.seg | 0)));
    case 'cone':
      return onBase(new THREE.ConeGeometry(p.r, p.h, Math.max(3, p.seg | 0)));
    case 'sphere':
      return new THREE.SphereGeometry(p.r, Math.max(4, p.seg | 0), Math.max(3, (p.seg / 2) | 0), 0, Math.PI * 2, 0, p.hemi ? Math.PI / 2 : Math.PI);
    case 'torus':
      return new THREE.TorusGeometry(p.r, p.tube, 8, Math.max(6, p.seg | 0), THREE.MathUtils.degToRad(Math.max(1, Math.min(360, p.arc))));
    case 'prism': {
      const w = p.w / 2 + (p.overhang ?? 0);
      const s = new THREE.Shape([new THREE.Vector2(-w, 0), new THREE.Vector2(w, 0), new THREE.Vector2(0, p.h)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: p.d, bevelEnabled: false });
      g.translate(0, 0, -p.d / 2);
      return g;
    }
    case 'pyramid': {
      const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(p.w, p.h, p.d);
      return onBase(g);
    }
    case 'arch': {
      const s = new THREE.Shape();
      s.moveTo(-p.w / 2, 0);
      s.lineTo(p.w / 2, 0);
      s.lineTo(p.w / 2, p.h);
      s.lineTo(-p.w / 2, p.h);
      s.closePath();
      const r = Math.min(p.ow / 2, p.w / 2 - 0.05);
      const top = Math.min(p.oh, p.h - r - 0.05);
      const hole = new THREE.Path();
      hole.moveTo(-r, 0);
      hole.lineTo(-r, top);
      hole.absarc(0, top, r, Math.PI, 0, true);
      hole.lineTo(r, 0);
      hole.closePath();
      s.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(s, { depth: p.d, bevelEnabled: false, curveSegments: 10 });
      g.translate(0, 0, -p.d / 2);
      return g;
    }
    case 'gear': {
      const n = Math.max(4, p.teeth | 0);
      const s = new THREE.Shape();
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 0.25) / n) * Math.PI * 2;
        const a2 = ((i + 0.5) / n) * Math.PI * 2;
        const a3 = ((i + 0.75) / n) * Math.PI * 2;
        const ro = p.r + p.tooth;
        const pts = [[p.r, a0], [ro, a1], [ro, a2], [p.r, a3]];
        for (const [rr, a] of pts) (i === 0 && rr === p.r && a === a0 ? s.moveTo : s.lineTo).call(s, Math.cos(a) * rr, Math.sin(a) * rr);
      }
      s.closePath();
      if (p.hole > 0) {
        const h = new THREE.Path();
        h.absarc(0, 0, p.hole, 0, Math.PI * 2, true);
        s.holes.push(h);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: p.depth, bevelEnabled: false, curveSegments: 12 });
      g.translate(0, 0, -p.depth / 2);
      return g;
    }
    case 'tube': {
      const pts = [new THREE.Vector2(p.ri, 0), new THREE.Vector2(p.ro, 0), new THREE.Vector2(p.ro, p.h), new THREE.Vector2(p.ri, p.h), new THREE.Vector2(p.ri, 0)];
      return new THREE.LatheGeometry(pts, Math.max(6, p.seg | 0));
    }
    case 'lathe': {
      const pts = (p.pts ?? []).map(([x, y]) => new THREE.Vector2(Math.max(0, x), y));
      if (pts.length < 2) pts.push(new THREE.Vector2(0.3, 0), new THREE.Vector2(0, 1));
      return onBase(new THREE.LatheGeometry(pts, Math.max(4, p.seg | 0)));
    }
    case 'stairs': {
      const n = Math.max(1, p.steps | 0);
      const parts = [];
      for (let i = 0; i < n; i++) {
        const sh = (p.h / n) * (i + 1);
        const g = new THREE.BoxGeometry(p.w, sh, p.d / n);
        g.translate(0, sh / 2, -p.d / 2 + (p.d / n) * (i + 0.5));
        parts.push(g);
      }
      return mergeGeometries(parts);
    }
    case 'rock': {
      const g = new THREE.IcosahedronGeometry(p.r, Math.max(0, Math.min(3, p.detail | 0)));
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      // Displace by position so shared corners move together (closed mesh, flat shaded).
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const k = 1 + (fbm(v.x * 1.7 + 5, v.z * 1.7 + v.y * 1.3, p.seed | 0, 3) - 0.5) * 2 * p.rough;
        v.multiplyScalar(k);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    }
    case 'terrain': {
      const seg = Math.max(4, Math.min(160, p.seg | 0));
      const g = new THREE.PlaneGeometry(p.size, p.size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(p, pos.getX(i), pos.getZ(i)));
      g.computeVertexNormals();
      return g;
    }
    case 'banner': {
      const g = new THREE.PlaneGeometry(p.w, p.h, 6, 8);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, Math.sin((x / p.w) * Math.PI * 2 + y * 1.3) * p.wave * (0.4 + (p.h / 2 - y) / p.h));
      }
      g.computeVertexNormals();
      return onBase(g);
    }
    case 'plane': {
      const g = new THREE.PlaneGeometry(p.w, p.d);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    default:
      return onBase(new THREE.BoxGeometry(1, 1, 1));
  }
}

/** World-scale box-projected UVs so textures tile at the same density on every part. */
function projectUV(g, scale, tile) {
  const pos = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * scale[0];
    const y = pos.getY(i) * scale[1];
    const z = pos.getZ(i) * scale[2];
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    } else if (ax >= az) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------------------------
let uidN = 0;
export function uid(prefix = 'p') {
  uidN = (uidN + 1) % 1e6;
  return `${prefix}${Date.now().toString(36).slice(-4)}${uidN.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Make a part with defaults filled in. */
export function part(shape, o = {}) {
  const def = SHAPES[shape] ?? SHAPES.box;
  return {
    id: o.id ?? uid(),
    name: o.name ?? def.label,
    shape: SHAPES[shape] ? shape : 'box',
    pos: o.pos ?? [0, 0, 0],
    rot: o.rot ?? [0, 0, 0],
    scale: o.scale ?? [1, 1, 1],
    mat: o.mat ?? 'chapter_stone',
    tint: o.tint ?? null,
    params: { ...structuredClone(def.p), ...(o.p ?? {}) },
  };
}

export function recipe(id, name, category, parts, extra = {}) {
  return { format: RECIPE_FORMAT, version: RECIPE_VERSION, id, name, category, notes: extra.notes ?? '', tags: extra.tags ?? [], parts };
}

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec = (v, d) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => num(x, d[i])) : d.slice());

/** Validate + normalise untrusted recipe JSON (imports, shared library). Throws on garbage. */
export function normalizeRecipe(r) {
  if (!r || typeof r !== 'object') throw new Error('Not a recipe: expected a JSON object.');
  if (r.format && r.format !== RECIPE_FORMAT) throw new Error(`Unknown format "${r.format}".`);
  if (!Array.isArray(r.parts)) throw new Error('Recipe has no "parts" list.');
  if (r.parts.length > 2000) throw new Error('Recipe has too many parts (max 2000).');
  const clean = (s, n = 80) => String(s ?? '').slice(0, n);
  return {
    format: RECIPE_FORMAT,
    version: RECIPE_VERSION,
    id: clean(r.id || uid('m'), 60).replace(/[^\w-]/g, '_') || uid('m'),
    name: clean(r.name || 'Untitled model'),
    category: ['buildings', 'environment', 'terrain', 'props', 'aesthetic', 'imported'].includes(r.category) ? r.category : 'props',
    notes: clean(r.notes, 2000),
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 12).map((t) => clean(t, 24)) : [],
    parts: r.parts.map((p) => {
      const shape = SHAPES[p?.shape] ? p.shape : 'box';
      const params = { ...structuredClone(SHAPES[shape].p) };
      for (const [k, dv] of Object.entries(params)) {
        const v = p?.params?.[k];
        if (k === 'pts') params.pts = Array.isArray(v) ? v.slice(0, 64).map((q) => [num(q?.[0]), num(q?.[1])]) : dv;
        else if (k === 'style') params.style = TERRAIN_STYLES.includes(v) ? v : dv;
        else if (typeof dv === 'boolean') params[k] = typeof v === 'boolean' ? v : dv;
        else params[k] = num(v, dv);
      }
      return {
        id: clean(p?.id || uid(), 40),
        name: clean(p?.name || SHAPES[shape].label, 60),
        shape,
        pos: vec(p?.pos, [0, 0, 0]),
        rot: vec(p?.rot, [0, 0, 0]),
        scale: vec(p?.scale, [1, 1, 1]),
        mat: clean(p?.mat || 'chapter_stone', 40),
        tint: typeof p?.tint === 'string' && /^#[0-9a-f]{6}$/i.test(p.tint) ? p.tint : null,
        params,
      };
    }),
  };
}

/** Build a recipe into a THREE.Group (one mesh per part, userData.partId set). */
export function buildModel(r, bank) {
  const group = new THREE.Group();
  group.name = r.name;
  for (const p of r.parts) {
    const d = bank.def(p.mat);
    let g;
    try {
      g = shapeGeometry(p.shape, p.params);
    } catch {
      g = onBase(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    }
    if (!d.decal) projectUV(g, p.scale, d.tile ?? 1);
    const mesh = new THREE.Mesh(g, bank.get(p.mat, p.tint));
    mesh.name = p.name;
    mesh.position.fromArray(p.pos);
    mesh.rotation.set(...p.rot.map((x) => THREE.MathUtils.degToRad(x)));
    mesh.scale.fromArray(p.scale);
    mesh.castShadow = !(d.opacity < 1) && p.shape !== 'terrain' && p.shape !== 'plane';
    mesh.receiveShadow = true;
    mesh.userData.partId = p.id;
    group.add(mesh);
  }
  return group;
}

export function modelStats(group) {
  let tris = 0;
  const mats = new Set();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    mats.add(o.material.name);
  });
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  return { tris: Math.round(tris), meshes: group.children.length, drawCalls: mats.size, size: [size.x, size.y, size.z] };
}

/** Game-ready copy: geometry baked and merged per material (one draw call per material). */
export function optimizeForGame(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const k = o.material.uuid;
    if (!byMat.has(k)) byMat.set(k, { mat: o.material, geos: [] });
    byMat.get(k).geos.push(g);
  });
  const out = new THREE.Group();
  out.name = group.name;
  for (const { mat, geos } of byMat.values()) {
    const merged = mergeVertices(mergeGeometries(geos), 1e-4);
    const m = new THREE.Mesh(merged, mat);
    m.name = mat.name;
    m.castShadow = true;
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Starter library: Aurealium Order styling over the frontier's forge palette.
// ---------------------------------------------------------------------------------------------
const P = part;
const ring = (n, f) => Array.from({ length: n }, (_, i) => f(i, (i / n) * Math.PI * 2));
const D2Rc = THREE.MathUtils.degToRad;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/** Euler degrees that turn a part's +Y axis to point along (x, y, z). */
export function aimY(x, y, z) {
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z).normalize());
  _e.setFromQuaternion(_q, 'XYZ');
  return [_e.x, _e.y, _e.z].map((v) => Math.round(THREE.MathUtils.radToDeg(v) * 10) / 10);
}
/** Shards that start inside a rock and jut out of its surface. */
function shards(cx, cy, cz, rx, ry, rz, n, seed, mat, o = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const el = (o.minEl ?? 0.15) + r() * ((o.maxEl ?? 1.0) - (o.minEl ?? 0.15));
    const dir = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    // Distance from centre to the ellipsoid surface along dir.
    const surf = 1 / Math.hypot(dir[0] / rx, dir[1] / ry, dir[2] / rz);
    const base = surf * (o.inset ?? 0.55);
    const len = surf * (1 - (o.inset ?? 0.55)) + (o.jut ?? 0.35) + r() * (o.jutVar ?? 0.25);
    out.push(
      P('cone', {
        name: o.name ?? 'Shard',
        pos: [cx + dir[0] * base, cy + dir[1] * base, cz + dir[2] * base].map((v) => Math.round(v * 1000) / 1000),
        rot: aimY(...dir),
        mat,
        p: { r: (o.r ?? 0.1) * (0.75 + r() * 0.5), h: Math.round(len * 1000) / 1000, seg: o.seg ?? 5 },
      }),
    );
  }
  return out;
}

function lancetWindow(x, y, z, ry = 0, w = 0.7, h = 1.6) {
  return [
    P('box', { name: 'Window glass', pos: [x, y, z], rot: [0, ry, 0], mat: 'aether_glass', p: { w, h: h - w / 2, d: 0.08 } }),
    P('cylinder', { name: 'Window arch', pos: [x, y + h - w / 2, z], rot: [90, 0, -ry], mat: 'aether_glass', p: { rt: w / 2, rb: w / 2, h: 0.08, seg: 12 } }),
    P('box', { name: 'Window sill', pos: [x, y - 0.08, z], rot: [0, ry, 0], mat: 'gilt', p: { w: w + 0.2, h: 0.08, d: 0.2 } }),
  ];
}

function gearSun(x, y, z, r, ry = 0) {
  return [
    P('gear', { name: 'Sigil gear', pos: [x, y, z], rot: [0, ry, 0], mat: 'gilt', p: { r, teeth: 14, tooth: r * 0.2, depth: 0.12, hole: r * 0.45 } }),
    P('cylinder', { name: 'Sigil core', pos: [x, y, z], rot: [90, 0, -ry], mat: 'aether_glass', p: { rt: r * 0.4, rb: r * 0.4, h: 0.1, seg: 16 } }),
  ];
}

function lampPost(x, z, h = 3.2) {
  return [
    P('cylinder', { name: 'Lamp base', pos: [x, 0, z], mat: 'dark_stone', p: { rt: 0.28, rb: 0.36, h: 0.4, seg: 8 } }),
    P('cylinder', { name: 'Lamp pole', pos: [x, 0.4, z], mat: 'iron', p: { rt: 0.06, rb: 0.09, h: h - 0.9, seg: 8 } }),
    P('tube', { name: 'Pole collar', pos: [x, h * 0.45, z], mat: 'brass', p: { ro: 0.12, ri: 0.05, h: 0.1 } }),
    P('cylinder', { name: 'Lamp cage', pos: [x, h - 0.5, z], mat: 'brass', p: { rt: 0.18, rb: 0.14, h: 0.08, seg: 8 } }),
    P('sphere', { name: 'Aether lamp', pos: [x, h - 0.25, z], mat: 'aether_glass', p: { r: 0.2, seg: 12 } }),
    P('cone', { name: 'Lamp hood', pos: [x, h - 0.05, z], mat: 'brass', p: { r: 0.26, h: 0.3, seg: 8 } }),
  ];
}

function crate(x, y, z, s = 0.6, ry = 0) {
  return [
    P('box', { name: 'Crate', pos: [x, y, z], rot: [0, ry, 0], mat: 'timber', p: { w: s, h: s, d: s } }),
    P('box', { name: 'Crate band', pos: [x, y + s * 0.45, z], rot: [0, ry, 0], mat: 'iron', p: { w: s + 0.02, h: 0.05, d: s + 0.02 } }),
  ];
}
function barrel(x, y, z) {
  return [
    P('lathe', { name: 'Barrel', pos: [x, y, z], mat: 'timber', p: { pts: [[0, 0], [0.3, 0], [0.36, 0.45], [0.3, 0.9], [0, 0.9]], seg: 12 } }),
    P('tube', { name: 'Barrel hoop', pos: [x, y + 0.18, z], mat: 'brass', p: { ro: 0.345, ri: 0.32, h: 0.05, seg: 12 } }),
    P('tube', { name: 'Barrel hoop', pos: [x, y + 0.68, z], mat: 'brass', p: { ro: 0.345, ri: 0.32, h: 0.05, seg: 12 } }),
  ];
}

export function starterLibrary() {
  const L = [];

  // ===== Buildings =====
  {
    const parts = [
      P('box', { name: 'Plinth', mat: 'dark_stone', p: { w: 9.4, h: 0.5, d: 13.4 } }),
      P('stairs', { name: 'Front steps', pos: [0, 0, 7.2], rot: [0, 180, 0], mat: 'dark_stone', p: { w: 3.2, h: 0.5, d: 1.2, steps: 3 } }),
      P('box', { name: 'Hall walls', pos: [0, 0.5, 0], mat: 'chapter_stone', p: { w: 8.6, h: 5.2, d: 12.6 } }),
      P('box', { name: 'Cornice', pos: [0, 5.7, 0], mat: 'gilt', p: { w: 8.9, h: 0.22, d: 12.9 } }),
      P('prism', { name: 'Slate roof', pos: [0, 5.9, 0], mat: 'roof_slate', p: { w: 8.6, h: 3.4, d: 13.2, overhang: 0.4 } }),
      P('box', { name: 'Ridge cap', pos: [0, 9.25, 0], mat: 'gilt', p: { w: 0.25, h: 0.18, d: 13.3 } }),
      P('arch', { name: 'Portal', pos: [0, 0.5, 6.35], mat: 'chapter_stone', p: { w: 3.6, h: 4.4, d: 0.5, ow: 2, oh: 2.2 } }),
      P('box', { name: 'Door', pos: [0, 0.5, 6.25], mat: 'timber_dark', p: { w: 1.9, h: 3.1, d: 0.12 } }),
      P('torus', { name: 'Portal trim', pos: [0, 3.2, 6.62], mat: 'gilt', p: { r: 1.05, tube: 0.07, arc: 180, seg: 20 } }),
      P('box', { name: 'Bell gable', pos: [0, 5.9, 6.1], mat: 'chapter_stone', p: { w: 2.4, h: 4.6, d: 0.7 } }),
      P('pyramid', { name: 'Gable cap', pos: [0, 10.5, 6.1], mat: 'gilt', p: { w: 2.6, h: 1.2, d: 0.9 } }),
      ...gearSun(0, 8.6, 6.5, 0.7),
      P('banner', { name: 'Order banner L', pos: [-2.6, 1.6, 6.42], mat: 'banner', p: { w: 1, h: 2.6, wave: 0.06 } }),
      P('banner', { name: 'Order banner R', pos: [2.6, 1.6, 6.42], mat: 'banner', p: { w: 1, h: 2.6, wave: 0.06 } }),
    ];
    for (const z of [-4.2, -1.4, 1.4, 4.2]) {
      parts.push(...lancetWindow(4.34, 2.2, z, 90), ...lancetWindow(-4.34, 2.2, z, 90));
      parts.push(P('box', { name: 'Buttress', pos: [4.6, 0.5, z + 1.4], mat: 'chapter_stone', p: { w: 0.6, h: 4.6, d: 0.5 } }));
      parts.push(P('box', { name: 'Buttress', pos: [-4.6, 0.5, z + 1.4], mat: 'chapter_stone', p: { w: 0.6, h: 4.6, d: 0.5 } }));
    }
    L.push(recipe('order_chapterhouse', 'Order Chapterhouse', 'buildings', parts, { notes: 'Ivory chapter stone hall of the Aurealium Order: slate roof, gilt cornice, aether lancet windows, bell gable with the gear-sun sigil.', tags: ['order', 'landmark'] }));
  }
  {
    const parts = [
      P('box', { name: 'Stone base', mat: 'dark_stone', p: { w: 8, h: 1.2, d: 7 } }),
      P('box', { name: 'Timber upper', pos: [0, 1.2, 0], mat: 'plaster', p: { w: 7.6, h: 2.8, d: 6.6 } }),
      P('prism', { name: 'Clay roof', pos: [0, 4, 0], mat: 'roof_clay', p: { w: 7.6, h: 2.4, d: 7.2, overhang: 0.5 } }),
      P('box', { name: 'Open front', pos: [0, 0.01, 3.31], mat: 'timber_dark', p: { w: 4.2, h: 3.4, d: 0.04 } }),
      P('box', { name: 'Chimney', pos: [-2.4, 0, -2.2], mat: 'brick', p: { w: 1.6, h: 8.2, d: 1.6 } }),
      P('tube', { name: 'Chimney band', pos: [-2.4, 6.2, -2.2], mat: 'brass', scale: [1, 1, 1], p: { ro: 1.2, ri: 1.1, h: 0.18, seg: 4 }, rot: [0, 45, 0] }),
      P('cylinder', { name: 'Chimney pot', pos: [-2.4, 8.2, -2.2], mat: 'iron', p: { rt: 0.45, rb: 0.55, h: 0.8, seg: 10 } }),
      P('box', { name: 'Furnace', pos: [-1.4, 0, 1.2], mat: 'brick', p: { w: 2, h: 1.8, d: 1.6 } }),
      P('arch', { name: 'Furnace mouth', pos: [-1.4, 0.1, 2.02], mat: 'iron', p: { w: 1.4, h: 1.3, d: 0.1, ow: 0.8, oh: 0.4 } }),
      P('box', { name: 'Fire', pos: [-1.4, 0.15, 1.95], mat: 'ember', p: { w: 0.8, h: 0.7, d: 0.05 } }),
      P('lathe', { name: 'Bellows', pos: [0.4, 0.3, 1.6], rot: [0, 0, 90], mat: 'timber_dark', p: { pts: [[0, 0], [0.4, 0.1], [0.45, 0.6], [0.1, 1.1], [0, 1.1]], seg: 8 } }),
      P('box', { name: 'Gilt fascia', pos: [0, 3.95, 3.42], mat: 'gilt', p: { w: 7.8, h: 0.12, d: 0.08 } }),
      ...gearSun(0, 4.7, 3.65, 0.45),
      ...crate(2.6, 0, 2.6),
      ...barrel(3.3, 0, 1.8),
    ];
    L.push(recipe('forge_hall', 'Forge Hall', 'buildings', parts, { notes: 'Stone-and-plaster smithy with a banded brick chimney, open furnace mouth glowing ember, bellows and stock.', tags: ['crafting'] }));
  }
  {
    const parts = [
      P('box', { name: 'Tower base', mat: 'dark_stone', p: { w: 4.4, h: 1, d: 4.4 } }),
      P('box', { name: 'Tower shaft', pos: [0, 1, 0], mat: 'chapter_stone', p: { w: 3.8, h: 11, d: 3.8 } }),
      P('box', { name: 'Clock storey', pos: [0, 12, 0], mat: 'chapter_stone', p: { w: 4.3, h: 3.4, d: 4.3 } }),
      P('box', { name: 'Gilt band', pos: [0, 15.4, 0], mat: 'gilt', p: { w: 4.5, h: 0.25, d: 4.5 } }),
      P('pyramid', { name: 'Spire roof', pos: [0, 15.65, 0], mat: 'copper', p: { w: 4.6, h: 4.2, d: 4.6 } }),
      P('cylinder', { name: 'Finial', pos: [0, 19.8, 0], mat: 'gilt', p: { rt: 0.04, rb: 0.1, h: 1.6, seg: 8 } }),
      P('sphere', { name: 'Finial orb', pos: [0, 21.5, 0], mat: 'aether_glass', p: { r: 0.22, seg: 12 } }),
      P('arch', { name: 'Door arch', pos: [0, 1, 1.92], mat: 'chapter_stone', p: { w: 2.2, h: 3, d: 0.2, ow: 1.2, oh: 1.6 } }),
      P('box', { name: 'Door', pos: [0, 1, 1.86], mat: 'timber_dark', p: { w: 1.15, h: 2.2, d: 0.1 } }),
    ];
    ring(4, (i) => {
      const a = i * 90;
      const r = 2.18;
      const s = Math.sin(THREE.MathUtils.degToRad(a));
      const c = Math.cos(THREE.MathUtils.degToRad(a));
      parts.push(P('cylinder', { name: 'Clock face', pos: [s * r, 13.7, c * r], rot: [90, 0, -a], mat: 'clockface', p: { rt: 1.25, rb: 1.25, h: 0.06, seg: 24 } }));
      parts.push(P('torus', { name: 'Clock rim', pos: [s * (r + 0.03), 13.7, c * (r + 0.03)], rot: [0, a, 0], mat: 'brass', p: { r: 1.28, tube: 0.07, seg: 24 } }));
      parts.push(...lancetWindow(s * 1.92, 6, c * 1.92, a, 0.5, 1.4));
    });
    L.push(recipe('clocktower', 'Order Clocktower', 'buildings', parts, { notes: 'Square chapter-stone tower with four brass-rimmed clock faces, verdigris spire and an aether finial.', tags: ['order', 'landmark'] }));
  }
  {
    const parts = [
      P('cylinder', { name: 'Footing', mat: 'dark_stone', p: { rt: 2.4, rb: 2.8, h: 1, seg: 12 } }),
      P('cylinder', { name: 'Tower', pos: [0, 1, 0], mat: 'chapter_stone', p: { rt: 1.4, rb: 2.1, h: 10, seg: 12 } }),
      P('tube', { name: 'Gilt band', pos: [0, 4, 0], mat: 'gilt', p: { ro: 1.95, ri: 1.7, h: 0.25, seg: 12 } }),
      P('tube', { name: 'Gilt band', pos: [0, 8, 0], mat: 'gilt', p: { ro: 1.62, ri: 1.4, h: 0.25, seg: 12 } }),
      P('cylinder', { name: 'Gallery deck', pos: [0, 11, 0], mat: 'iron', p: { rt: 2.1, rb: 1.6, h: 0.4, seg: 12 } }),
      P('tube', { name: 'Railing', pos: [0, 11.4, 0], mat: 'brass', p: { ro: 2.1, ri: 2.02, h: 0.8, seg: 24 } }),
      P('cylinder', { name: 'Lens cage', pos: [0, 11.4, 0], mat: 'brass', p: { rt: 1, rb: 1, h: 0.15, seg: 8 } }),
      P('sphere', { name: 'Aether lens', pos: [0, 12.7, 0], mat: 'aether_glass', p: { r: 1.05, seg: 16 } }),
      P('cone', { name: 'Cap', pos: [0, 13.6, 0], mat: 'copper', p: { r: 1.4, h: 1.6, seg: 12 } }),
      P('arch', { name: 'Door', pos: [0, 1, 2.0], mat: 'timber_dark', p: { w: 1.4, h: 2.3, d: 0.15, ow: 0.01, oh: 0.01 } }),
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 360;
      const s = Math.sin(THREE.MathUtils.degToRad(a));
      const c = Math.cos(THREE.MathUtils.degToRad(a));
      parts.push(P('box', { name: 'Cage strut', pos: [s * 1.02, 11.55, c * 1.02], rot: [0, a, 0], mat: 'brass', p: { w: 0.06, h: 2.2, d: 0.06 } }));
    }
    L.push(recipe('aether_beacon', 'Aether Beacon Tower', 'buildings', parts, { notes: 'Lighthouse-style signal tower: tapered stone shaft, brass gallery and caged aether lens. Good as a wayfinding landmark.', tags: ['landmark', 'tech'] }));
  }
  {
    const parts = [
      P('box', { name: 'Foundation', mat: 'dark_stone', p: { w: 6.2, h: 0.5, d: 5.2 } }),
      P('box', { name: 'Ground floor', pos: [0, 0.5, 0], mat: 'plaster', p: { w: 6, h: 2.8, d: 5 } }),
      P('box', { name: 'Upper floor', pos: [0, 3.3, 0], mat: 'plaster', p: { w: 6.4, h: 2.4, d: 5.4 } }),
      P('prism', { name: 'Roof', pos: [0, 5.7, 0], mat: 'roof_clay', p: { w: 6.4, h: 2.6, d: 6, overhang: 0.45 } }),
      P('box', { name: 'Chimney', pos: [2.2, 5, -1.4], mat: 'brick', p: { w: 0.8, h: 3.6, d: 0.8 } }),
      P('box', { name: 'Door', pos: [-1.2, 0.5, 2.52], mat: 'timber_dark', p: { w: 1.1, h: 2.1, d: 0.08 } }),
      P('box', { name: 'Window', pos: [1.3, 1.4, 2.52], mat: 'lamp_warm', p: { w: 1.1, h: 1, d: 0.06 } }),
      P('box', { name: 'Window', pos: [-1.4, 4, 2.72], mat: 'lamp_warm', p: { w: 0.9, h: 0.9, d: 0.06 } }),
      P('box', { name: 'Window', pos: [1.4, 4, 2.72], mat: 'lamp_warm', p: { w: 0.9, h: 0.9, d: 0.06 } }),
      P('box', { name: 'Brass gutter', pos: [0, 5.66, 2.95], mat: 'brass', p: { w: 7.2, h: 0.1, d: 0.12 } }),
    ];
    // Timber framing on the upper floor.
    for (const x of [-3.15, -1.05, 1.05, 3.15]) parts.push(P('box', { name: 'Frame post', pos: [x, 3.3, 2.73], mat: 'timber_dark', p: { w: 0.18, h: 2.4, d: 0.06 } }));
    parts.push(P('box', { name: 'Frame beam', pos: [0, 3.3, 2.73], mat: 'timber_dark', p: { w: 6.4, h: 0.18, d: 0.07 } }));
    parts.push(P('box', { name: 'Frame beam', pos: [0, 5.52, 2.73], mat: 'timber_dark', p: { w: 6.4, h: 0.18, d: 0.07 } }));
    parts.push(P('box', { name: 'Brace', pos: [-2.1, 3.4, 2.74], rot: [0, 0, 40], mat: 'timber_dark', p: { w: 0.14, h: 2.6, d: 0.05 } }));
    parts.push(P('box', { name: 'Brace', pos: [2.1, 3.4, 2.74], rot: [0, 0, -40], mat: 'timber_dark', p: { w: 0.14, h: 2.6, d: 0.05 } }));
    L.push(recipe('frontier_cottage', 'Frontier Cottage', 'buildings', parts, { notes: 'Two-storey jettied cottage: ivory plaster, dark timber framing, clay roof, warm lit windows.', tags: ['village'] }));
  }
  {
    const parts = [];
    for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) parts.push(P('cylinder', { name: 'Leg', pos: [x, 0, z], mat: 'timber', p: { rt: 0.14, rb: 0.18, h: 6.5, seg: 8 } }));
    // X-braces leg to leg on every face (each box stands on its base at one leg and leans to the other).
    const lean = THREE.MathUtils.radToDeg(Math.atan2(2.8, 3.6));
    const len = Math.hypot(2.8, 3.6);
    for (const [y0] of [[0.4], [2.7]]) {
      parts.push(P('box', { name: 'Brace S', pos: [-1.4, y0, 1.45], rot: [0, 0, -lean], mat: 'timber_dark', p: { w: 0.12, h: len, d: 0.1 } }));
      parts.push(P('box', { name: 'Brace N', pos: [1.4, y0, -1.45], rot: [0, 0, lean], mat: 'timber_dark', p: { w: 0.12, h: len, d: 0.1 } }));
      parts.push(P('box', { name: 'Brace E', pos: [1.45, y0, 1.4], rot: [-lean, 0, 0], mat: 'timber_dark', p: { w: 0.1, h: len, d: 0.12 } }));
      parts.push(P('box', { name: 'Brace W', pos: [-1.45, y0, -1.4], rot: [lean, 0, 0], mat: 'timber_dark', p: { w: 0.1, h: len, d: 0.12 } }));
    }
    parts.push(
      P('box', { name: 'Platform', pos: [0, 6.4, 0], mat: 'timber_dark', p: { w: 3.8, h: 0.2, d: 3.8 } }),
      P('box', { name: 'Rail N', pos: [0, 6.6, -1.85], mat: 'timber', p: { w: 3.8, h: 0.9, d: 0.08 } }),
      P('box', { name: 'Rail S (gap for ladder)', pos: [-1.15, 6.6, 1.85], mat: 'timber', p: { w: 1.5, h: 0.9, d: 0.08 } }),
      P('box', { name: 'Rail S', pos: [1.15, 6.6, 1.85], mat: 'timber', p: { w: 1.5, h: 0.9, d: 0.08 } }),
      P('box', { name: 'Rail E', pos: [1.85, 6.6, 0], mat: 'timber', p: { w: 0.08, h: 0.9, d: 3.8 } }),
      P('box', { name: 'Rail W', pos: [-1.85, 6.6, 0], mat: 'timber', p: { w: 0.08, h: 0.9, d: 3.8 } }),
      P('pyramid', { name: 'Roof', pos: [0, 8.9, 0], mat: 'roof_slate', p: { w: 4.6, h: 1.8, d: 4.6 } }),
      P('cylinder', { name: 'Finial', pos: [0, 10.6, 0], mat: 'brass', p: { rt: 0.03, rb: 0.06, h: 0.35, seg: 6 } }),
      P('sphere', { name: 'Signal lamp', pos: [0, 11.1, 0], mat: 'aether_glass', p: { r: 0.22, seg: 12 } }),
    );
    for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) parts.push(P('cylinder', { name: 'Roof post', pos: [x, 6.5, z], mat: 'timber', p: { rt: 0.07, rb: 0.07, h: 2.4, seg: 6 } }));
    // Ladder: two rails and rungs, foot 0.8 m out from the platform edge, top at the rail gap.
    const tilt = THREE.MathUtils.radToDeg(Math.atan2(0.8, 6.5));
    const ladLen = Math.hypot(0.8, 6.5);
    for (const x of [-0.28, 0.28]) parts.push(P('box', { name: 'Ladder rail', pos: [x, 0, 2.7], rot: [-tilt, 0, 0], mat: 'timber', p: { w: 0.07, h: ladLen, d: 0.07 } }));
    for (let i = 1; i <= 15; i++) {
      const y = i * 0.42;
      parts.push(P('box', { name: 'Rung', pos: [0, y, 2.7 - (y / 6.5) * 0.8], mat: 'timber_dark', p: { w: 0.56, h: 0.04, d: 0.05 } }));
    }
    L.push(recipe('watchtower', 'Timber Watchtower', 'buildings', parts, { notes: 'Frontier lookout on braced timber legs with a slate cap and aether signal lamp.', tags: ['village', 'defense'] }));
  }
  {
    const parts = [
      P('box', { name: 'Pumphouse', mat: 'brick', p: { w: 5, h: 3.6, d: 4 } }),
      P('prism', { name: 'Roof', pos: [0, 3.6, 0], mat: 'roof_slate', p: { w: 5, h: 1.6, d: 4.6, overhang: 0.3 } }),
      P('cylinder', { name: 'Tank', pos: [3.8, 4.2, 0], mat: 'copper', p: { rt: 1.5, rb: 1.5, h: 2.6, seg: 16 } }),
      P('cone', { name: 'Tank cap', pos: [3.8, 6.8, 0], mat: 'copper', p: { r: 1.6, h: 0.8, seg: 16 } }),
      P('tube', { name: 'Tank hoop', pos: [3.8, 4.8, 0], mat: 'brass', p: { ro: 1.56, ri: 1.48, h: 0.1, seg: 16 } }),
      P('tube', { name: 'Tank hoop', pos: [3.8, 6.0, 0], mat: 'brass', p: { ro: 1.56, ri: 1.48, h: 0.1, seg: 16 } }),
      P('cylinder', { name: 'Smokestack', pos: [-1.6, 3, -1], mat: 'iron', p: { rt: 0.35, rb: 0.45, h: 5, seg: 10 } }),
      P('tube', { name: 'Stack lip', pos: [-1.6, 8, -1], mat: 'brass', p: { ro: 0.5, ri: 0.3, h: 0.2, seg: 10 } }),
      P('cylinder', { name: 'Pipe up', pos: [2.5, 0.6, 1.4], mat: 'brass', p: { rt: 0.14, rb: 0.14, h: 3.4, seg: 8 } }),
      P('torus', { name: 'Pipe elbow', pos: [2.85, 4, 1.4], rot: [0, 0, 90], mat: 'brass', p: { r: 0.35, tube: 0.14, arc: 90, seg: 8 } }),
      P('cylinder', { name: 'Pipe in', pos: [2.85, 4.35, 1.4], rot: [0, 0, -90], mat: 'brass', p: { rt: 0.14, rb: 0.14, h: 0.6, seg: 8 } }),
      P('cylinder', { name: 'Gauge', pos: [0.8, 2.2, 2.03], rot: [90, 0, 0], mat: 'clockface', p: { rt: 0.35, rb: 0.35, h: 0.06, seg: 16 } }),
      P('torus', { name: 'Gauge rim', pos: [0.8, 2.2, 2.06], mat: 'brass', p: { r: 0.36, tube: 0.04, seg: 16 } }),
      P('torus', { name: 'Valve wheel', pos: [-0.8, 1.4, 2.1], mat: 'iron', p: { r: 0.3, tube: 0.04, seg: 16 } }),
      P('box', { name: 'Door', pos: [-0.9, 0, 2.02], mat: 'iron', p: { w: 1.2, h: 2.2, d: 0.06 } }),
    ];
    for (const [x, z] of [[2.7, -1.1], [4.9, -1.1], [2.7, 1.1], [4.9, 1.1]]) parts.push(P('box', { name: 'Tank leg', pos: [x, 0, z], mat: 'iron', p: { w: 0.18, h: 4.2, d: 0.18 } }));
    L.push(recipe('steam_pumphouse', 'Steam Pumphouse', 'buildings', parts, { notes: 'Kiln-brick pump station with a verdigris water tank on iron legs, smokestack, brass pipework, gauge and valve.', tags: ['tech'] }));
  }
  {
    const parts = [
      P('arch', { name: 'Gate arch', mat: 'chapter_stone', p: { w: 7, h: 6, d: 1.6, ow: 3.4, oh: 2.8 } }),
      P('box', { name: 'Tower L', pos: [-4.2, 0, 0], mat: 'chapter_stone', p: { w: 2, h: 7.6, d: 2.2 } }),
      P('box', { name: 'Tower R', pos: [4.2, 0, 0], mat: 'chapter_stone', p: { w: 2, h: 7.6, d: 2.2 } }),
      P('pyramid', { name: 'Tower cap L', pos: [-4.2, 7.6, 0], mat: 'roof_slate', p: { w: 2.4, h: 2.2, d: 2.6 } }),
      P('pyramid', { name: 'Tower cap R', pos: [4.2, 7.6, 0], mat: 'roof_slate', p: { w: 2.4, h: 2.2, d: 2.6 } }),
      P('box', { name: 'Parapet', pos: [0, 6, 0], mat: 'chapter_stone', p: { w: 7, h: 0.8, d: 1.8 } }),
      P('box', { name: 'Gilt band', pos: [0, 5.85, 0.82], mat: 'gilt', p: { w: 7.4, h: 0.16, d: 0.1 } }),
      ...gearSun(0, 4.9, 0.85, 0.55),
      P('banner', { name: 'Banner L', pos: [-4.2, 3, 1.13], mat: 'banner', p: { w: 1.2, h: 3, wave: 0.05 } }),
      P('banner', { name: 'Banner R', pos: [4.2, 3, 1.13], mat: 'banner', p: { w: 1.2, h: 3, wave: 0.05 } }),
      P('box', { name: 'Portcullis', pos: [0, 2.4, 0], mat: 'iron', p: { w: 3.3, h: 2.2, d: 0.08 } }),
    ];
    for (let i = 0; i < 4; i++) parts.push(P('box', { name: 'Merlon', pos: [-2.6 + i * 1.75, 6.8, 0], mat: 'chapter_stone', p: { w: 0.8, h: 0.6, d: 1.8 } }));
    L.push(recipe('order_gatehouse', 'Order Gatehouse', 'buildings', parts, { notes: 'Twin-tower stone gate with gilt band, gear-sun crest, Order banners and a raised portcullis. Fits the palisade gaps.', tags: ['order', 'defense'] }));
  }
  {
    const parts = [
      P('cylinder', { name: 'Mill tower', mat: 'chapter_stone', p: { rt: 1.5, rb: 2.2, h: 8, seg: 10 } }),
      P('sphere', { name: 'Cap', pos: [0, 8, 0], mat: 'copper', p: { r: 1.6, seg: 12, hemi: true } }),
      P('cylinder', { name: 'Hub', pos: [0, 8.2, 1.8], rot: [90, 0, 0], mat: 'brass', p: { rt: 0.35, rb: 0.45, h: 0.8, seg: 12 } }),
      ...gearSun(0, 8.2, 2.25, 0.4),
      P('box', { name: 'Door', pos: [0, 0, 2.1], rot: [-8, 0, 0], mat: 'timber_dark', p: { w: 1.1, h: 2.1, d: 0.1 } }),
      P('tube', { name: 'Gilt band', pos: [0, 5, 0], mat: 'gilt', p: { ro: 1.82, ri: 1.65, h: 0.2, seg: 10 } }),
    ];
    for (let i = 0; i < 4; i++) {
      // Arms stand on their base at the hub and point outward along (sin a, cos a).
      const a = i * 90 + 20;
      const s = Math.sin(THREE.MathUtils.degToRad(a));
      const c = Math.cos(THREE.MathUtils.degToRad(a));
      parts.push(P('box', { name: 'Sail arm', pos: [0, 8.2, 2.3], rot: [0, 0, -a], mat: 'brass', p: { w: 0.14, h: 5.2, d: 0.1 } }));
      parts.push(P('box', { name: 'Sail', pos: [s * 1.3 + c * 0.5, 8.2 + c * 1.3 - s * 0.5, 2.25], rot: [0, 0, -a], mat: 'awning', p: { w: 0.9, h: 3.6, d: 0.03 } }));
    }
    L.push(recipe('aether_windmill', 'Brass-Sailed Windmill', 'buildings', parts, { notes: 'Stone mill with a verdigris cap and brass-armed striped sails turning on a gear-sun hub.', tags: ['village', 'tech'] }));
  }
  {
    const parts = [
      P('cylinder', { name: 'Drum', mat: 'chapter_stone', p: { rt: 3.6, rb: 3.8, h: 4.2, seg: 20 } }),
      P('tube', { name: 'Gilt ring', pos: [0, 4.2, 0], mat: 'gilt', p: { ro: 3.8, ri: 3.4, h: 0.22, seg: 24 } }),
      P('sphere', { name: 'Dome', pos: [0, 4.3, 0], mat: 'copper', p: { r: 3.5, seg: 24, hemi: true } }),
      P('box', { name: 'Dome slit', pos: [0, 4.4, 0], rot: [0, 0, 0], mat: 'dark_stone', p: { w: 0.8, h: 3.4, d: 7.02 } }),
      P('cylinder', { name: 'Telescope', pos: [0, 6.4, 1.4], rot: [-50, 0, 0], mat: 'brass', p: { rt: 0.3, rb: 0.42, h: 4, seg: 12 } }),
      P('torus', { name: 'Scope ring', pos: [0, 7.4, 2.25], rot: [40, 0, 0], mat: 'gilt', p: { r: 0.4, tube: 0.06, seg: 16 } }),
      P('arch', { name: 'Door', pos: [0, 0, 3.55], mat: 'timber_dark', p: { w: 1.5, h: 2.5, d: 0.2, ow: 0.01, oh: 0.01 } }),
    ];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 360 + 30;
      const s = Math.sin(THREE.MathUtils.degToRad(a));
      const c = Math.cos(THREE.MathUtils.degToRad(a));
      parts.push(...lancetWindow(s * 3.68, 1.2, c * 3.68, a, 0.5, 1.4));
    }
    L.push(recipe('observatory', 'Order Observatory', 'buildings', parts, { notes: 'Round chapter-stone drum with a verdigris dome, observation slit and a brass telescope.', tags: ['order', 'tech'] }));
  }
  {
    const parts = [
      P('box', { name: 'Counter', mat: 'timber', p: { w: 3.4, h: 1, d: 1 } }),
      P('box', { name: 'Counter top', pos: [0, 1, 0], mat: 'timber_dark', p: { w: 3.6, h: 0.08, d: 1.15 } }),
      // Awning slopes from 2.42 m at the back posts to 1.99 m at the front posts.
      P('cylinder', { name: 'Back post', pos: [-1.7, 0, -0.6], mat: 'timber_dark', p: { rt: 0.07, rb: 0.07, h: 2.42, seg: 6 } }),
      P('cylinder', { name: 'Back post', pos: [1.7, 0, -0.6], mat: 'timber_dark', p: { rt: 0.07, rb: 0.07, h: 2.42, seg: 6 } }),
      P('cylinder', { name: 'Front post', pos: [-1.7, 0, 0.9], mat: 'timber_dark', p: { rt: 0.07, rb: 0.07, h: 1.99, seg: 6 } }),
      P('cylinder', { name: 'Front post', pos: [1.7, 0, 0.9], mat: 'timber_dark', p: { rt: 0.07, rb: 0.07, h: 1.99, seg: 6 } }),
      P('box', { name: 'Awning', pos: [0, 2.2, 0.15], rot: [16, 0, 0], mat: 'awning', p: { w: 3.8, h: 0.04, d: 1.95 } }),
      P('box', { name: 'Back beam', pos: [0, 2.3, -0.6], mat: 'timber_dark', p: { w: 3.5, h: 0.1, d: 0.1 } }),
      P('box', { name: 'Brass sign', pos: [0, 1.75, -0.66], mat: 'brass', p: { w: 1.2, h: 0.4, d: 0.05 } }),
      P('box', { name: 'Sign chain', pos: [-0.45, 2.15, -0.66], mat: 'iron', p: { w: 0.02, h: 0.16, d: 0.02 } }),
      P('box', { name: 'Sign chain', pos: [0.45, 2.15, -0.66], mat: 'iron', p: { w: 0.02, h: 0.16, d: 0.02 } }),
      ...crate(-1.1, 1.08, 0, 0.45),
      ...barrel(1.9, 0, 1.4),
      P('cylinder', { name: 'Ingot stack', pos: [0.85, 1.12, 0.1], rot: [0, 0, 90], mat: 'brass', p: { rt: 0.08, rb: 0.08, h: 0.5, seg: 6 } }),
      P('box', { name: 'Lantern hook', pos: [-1.57, 1.88, 0.9], mat: 'iron', p: { w: 0.28, h: 0.04, d: 0.04 } }),
      P('lathe', { name: 'Lantern', pos: [-1.45, 1.56, 0.9], mat: 'lamp_warm', p: { pts: [[0, 0], [0.11, 0.02], [0.13, 0.18], [0.05, 0.3], [0, 0.32]], seg: 8 } }),
    ];
    L.push(recipe('market_stall', 'Market Stall', 'buildings', parts, { notes: "Trader's stall with an azure-and-ivory striped awning, brass sign, crates and ingots. Bram's style.", tags: ['village', 'trade'] }));
  }

  // ===== Environment =====
  {
    const parts = [
      P('cylinder', { name: 'Trunk', mat: 'bark', p: { rt: 0.28, rb: 0.45, h: 3.6, seg: 8 } }),
      P('cone', { name: 'Canopy low', pos: [0, 2.4, 0], mat: 'foliage', p: { r: 2.4, h: 2.8, seg: 8 } }),
      P('cone', { name: 'Canopy mid', pos: [0, 3.9, 0], mat: 'foliage', p: { r: 1.9, h: 2.4, seg: 8 } }),
      P('cone', { name: 'Canopy top', pos: [0, 5.2, 0], mat: 'foliage', p: { r: 1.3, h: 2, seg: 8 } }),
      P('tube', { name: 'Brass ward ring', pos: [0, 1.2, 0], mat: 'brass', p: { ro: 0.42, ri: 0.38, h: 0.12, seg: 10 } }),
    ];
    L.push(recipe('ironwood_tree', 'Ironwood Tree', 'environment', parts, { notes: 'Tiered ironwood conifer matching the trail trees; a brass ward ring marks Order-claimed timber.', tags: ['tree'] }));
  }
  {
    const parts = [
      P('cylinder', { name: 'Trunk', mat: 'bark', tint: '#d9d2c2', p: { rt: 0.16, rb: 0.24, h: 4.2, seg: 7 } }),
      P('rock', { name: 'Crown', pos: [0, 4.6, 0], scale: [1.2, 1, 1.2], mat: 'foliage_gold', p: { r: 1.5, seed: 4, detail: 1, rough: 0.3 } }),
      P('rock', { name: 'Crown side', pos: [0.9, 3.9, 0.3], mat: 'foliage_gold', p: { r: 1, seed: 9, detail: 1, rough: 0.3 } }),
      P('rock', { name: 'Crown side', pos: [-0.8, 4, -0.4], mat: 'foliage_gold', p: { r: 0.9, seed: 13, detail: 1, rough: 0.3 } }),
    ];
    L.push(recipe('gilded_birch', 'Gilded Birch', 'environment', parts, { notes: 'Pale-trunked birch with gold foliage: the Order plants these along processional roads.', tags: ['tree', 'aesthetic'] }));
  }
  {
    const parts = [
      P('cylinder', { name: 'Trunk', mat: 'bark', p: { rt: 0.2, rb: 0.3, h: 2.6, seg: 7 } }),
      P('rock', { name: 'Canopy', pos: [0, 3.4, 0], scale: [1.3, 0.9, 1.3], mat: 'foliage', p: { r: 1.7, seed: 21, detail: 1, rough: 0.35 } }),
      P('rock', { name: 'Canopy', pos: [1, 2.8, 0.6], mat: 'foliage', tint: '#344a2a', p: { r: 1.1, seed: 22, detail: 1, rough: 0.35 } }),
    ];
    L.push(recipe('broadleaf_tree', 'Broadleaf Oak', 'environment', parts, { notes: 'Rounded low-poly oak for village greens.', tags: ['tree'] }));
  }
  {
    const parts = [
      P('rock', { name: 'Boulder', pos: [0, 0.5, 0], scale: [1.3, 0.8, 1], mat: 'rock', p: { r: 1, seed: 3, detail: 1, rough: 0.35 } }),
      P('rock', { name: 'Stone', pos: [1.25, 0.22, 0.55], mat: 'rock', p: { r: 0.5, seed: 5, detail: 1, rough: 0.35 } }),
      P('rock', { name: 'Stone', pos: [-1.05, 0.12, 0.65], mat: 'rock', tint: '#5b5853', p: { r: 0.35, seed: 8, detail: 1, rough: 0.35 } }),
    ];
    L.push(recipe('rock_cluster', 'Rock Cluster', 'environment', parts, { notes: 'Flat-shaded boulder group; change seeds for variety.', tags: ['rock'] }));
  }
  {
    const parts = [P('rock', { name: 'Ore body', pos: [0, 0.5, 0], scale: [1.1, 0.75, 1], mat: 'iron_ore', p: { r: 0.9, seed: 31, detail: 1, rough: 0.25 } })];
    parts.push(...shards(0, 0.5, 0, 0.99, 0.675, 0.9, 7, 31, 'ember', { name: 'Ember vein', r: 0.11, inset: 0.5, jut: 0.32, jutVar: 0.22, minEl: 0.1, maxEl: 1.1 }));
    parts.push(P('rock', { name: 'Ore chunk', pos: [0.95, 0.15, 0.55], mat: 'iron_ore', p: { r: 0.32, seed: 33, detail: 1, rough: 0.25 } }));
    parts.push(...shards(0.95, 0.15, 0.55, 0.32, 0.32, 0.32, 2, 34, 'ember', { name: 'Ember vein', r: 0.06, inset: 0.4, jut: 0.18, jutVar: 0.1, minEl: 0.5, maxEl: 1.2 }));
    L.push(recipe('iron_ore_node', 'Iron Ore Node', 'environment', parts, { notes: 'Gatherable iron seam with glowing ember veins, sized like the in-game nodes.', tags: ['resource'] }));
  }
  {
    const parts = [P('rock', { name: 'Bed rock', pos: [0, 0.3, 0], scale: [1.4, 0.5, 1.2], mat: 'rock', p: { r: 0.9, seed: 41, detail: 1, rough: 0.3 } })];
    parts.push(P('cone', { name: 'Crystal', pos: [0, 0.25, 0], mat: 'aether_glass', p: { r: 0.24, h: 1.9, seg: 6 } }));
    parts.push(...shards(0, 0.3, 0, 1.26, 0.45, 1.08, 6, 41, 'aether_glass', { name: 'Crystal', r: 0.17, inset: 0.3, jut: 0.7, jutVar: 0.6, minEl: 0.7, maxEl: 1.35, seg: 6 }));
    L.push(recipe('ironglass_cluster', 'Ironglass Crystal Cluster', 'environment', parts, { notes: 'Cyan ironglass crystals breaking out of bedrock, as found in the quarry.', tags: ['resource', 'glow'] }));
  }
  {
    const parts = [
      P('rock', { name: 'Shrub', pos: [0, 0.45, 0], scale: [1.2, 0.8, 1], mat: 'foliage', p: { r: 0.6, seed: 51, detail: 1, rough: 0.3 } }),
      P('rock', { name: 'Shrub', pos: [0.55, 0.32, 0.2], mat: 'foliage', tint: '#46603a', p: { r: 0.42, seed: 52, detail: 1, rough: 0.3 } }),
    ];
    L.push(recipe('shrub', 'Shrub', 'environment', parts, { tags: ['plant'] }));
  }
  {
    const parts = [
      P('cylinder', { name: 'Log', pos: [2.1, 0.32, 0], rot: [0, 0, 90], mat: 'bark', p: { rt: 0.32, rb: 0.38, h: 4.2, seg: 8 } }),
      P('cylinder', { name: 'Stub branch', pos: [0.6, 0.55, 0.2], rot: [40, 0, 20], mat: 'bark', p: { rt: 0.06, rb: 0.1, h: 0.8, seg: 6 } }),
      P('rock', { name: 'Moss', pos: [-0.8, 0.62, 0], scale: [1.6, 0.4, 0.9], mat: 'foliage', p: { r: 0.3, seed: 61, detail: 0, rough: 0.3 } }),
    ];
    L.push(recipe('fallen_log', 'Fallen Ironwood Log', 'environment', parts, { tags: ['tree'] }));
  }

  // ===== Terrain =====
  L.push(recipe('hills_tile', 'Rolling Hills Tile', 'terrain', [P('terrain', { name: 'Hills', mat: 'grass', p: { size: 24, seg: 48, height: 3.2, seed: 3, style: 'hills', edge: true } })], { notes: '24 m tile whose edges ease to zero, so tiles butt together.', tags: ['tile'] }));
  L.push(recipe('mesa_tile', 'Mesa Plateau', 'terrain', [P('terrain', { name: 'Mesa', mat: 'rock', p: { size: 30, seg: 64, height: 7, seed: 12, style: 'mesa', edge: true } })], { notes: 'Stepped plateau landform for the frontier badlands.', tags: ['tile'] }));
  L.push(recipe('ridge_chunk', 'Mountain Ridge', 'terrain', [P('terrain', { name: 'Ridge', mat: 'rock', p: { size: 40, seg: 80, height: 14, seed: 7, style: 'ridge', edge: true } })], { notes: 'Sharp ridge for the backdrop mountains around the trail.', tags: ['backdrop'] }));
  L.push(
    recipe(
      'foundry_crater',
      'Foundry Crater',
      'terrain',
      [
        P('terrain', { name: 'Crater', mat: 'dirt', p: { size: 30, seg: 64, height: 4, seed: 5, style: 'crater', edge: true } }),
        P('cylinder', { name: 'Dormant core', pos: [0, 0.5, 0], mat: 'iron', p: { rt: 1.2, rb: 1.6, h: 1.2, seg: 10 } }),
        P('sphere', { name: 'Core heart', pos: [0, 2.2, 0], mat: 'ember', p: { r: 0.8, seg: 14 } }),
        P('torus', { name: 'Core ring', pos: [0, 2.2, 0], rot: [90, 0, 0], mat: 'brass', p: { r: 1.2, tube: 0.08, seg: 24 } }),
      ],
      { notes: 'Impact basin with the dormant foundry core at its heart.', tags: ['landmark'] },
    ),
  );
  {
    const parts = [P('terrain', { name: 'Ground', mat: 'grass', p: { size: 16, seg: 32, height: 0.6, seed: 2, style: 'flat', edge: true } }), P('box', { name: 'Cobble road', pos: [0, 0.02, 0], mat: 'cobble', p: { w: 3.2, h: 0.12, d: 16 } })];
    for (const z of [-7, -3.5, 0, 3.5, 7]) {
      parts.push(P('box', { name: 'Curb', pos: [1.7, 0, z], mat: 'dark_stone', p: { w: 0.25, h: 0.22, d: 3.4 } }));
      parts.push(P('box', { name: 'Curb', pos: [-1.7, 0, z], mat: 'dark_stone', p: { w: 0.25, h: 0.22, d: 3.4 } }));
    }
    L.push(recipe('cobble_road', 'Cobbled Road Segment', 'terrain', parts, { notes: '16 m straight segment with stone curbs; chain along Z.', tags: ['tile', 'path'] }));
  }
  {
    const parts = [
      P('arch', { name: 'Bridge span', pos: [0, 0, 0], rot: [0, 90, 0], mat: 'chapter_stone', p: { w: 10, h: 3.2, d: 3.4, ow: 6, oh: 0.6 } }),
      P('box', { name: 'Deck', pos: [0, 3.2, 0], mat: 'cobble', p: { w: 3.4, h: 0.15, d: 10 } }),
      P('box', { name: 'Parapet L', pos: [1.6, 3.35, 0], mat: 'chapter_stone', p: { w: 0.25, h: 0.7, d: 10 } }),
      P('box', { name: 'Parapet R', pos: [-1.6, 3.35, 0], mat: 'chapter_stone', p: { w: 0.25, h: 0.7, d: 10 } }),
      P('box', { name: 'Gilt coping', pos: [1.6, 4.05, 0], mat: 'gilt', p: { w: 0.3, h: 0.06, d: 10 } }),
      P('box', { name: 'Gilt coping', pos: [-1.6, 4.05, 0], mat: 'gilt', p: { w: 0.3, h: 0.06, d: 10 } }),
      ...lampPost(1.6, 4.6, 3).map((p) => ({ ...p, pos: [p.pos[0], p.pos[1] + 4.05, p.pos[2]] })),
      ...lampPost(-1.6, -4.6, 3).map((p) => ({ ...p, pos: [p.pos[0], p.pos[1] + 4.05, p.pos[2]] })),
    ];
    L.push(recipe('stone_bridge', 'Stone Arch Bridge', 'terrain', parts, { notes: 'Single-span chapter stone bridge with gilt coping and aether lamps.', tags: ['path', 'water'] }));
  }
  {
    const parts = [P('terrain', { name: 'Banks', mat: 'grass', p: { size: 20, seg: 40, height: 1.6, seed: 9, style: 'crater', edge: true } }), P('plane', { name: 'Water', pos: [0, 0.55, 0], mat: 'water', p: { w: 10, d: 10 } })];
    L.push(recipe('pond_tile', 'Pond Tile', 'terrain', parts, { notes: 'Bowl of grassy banks with a still water plane.', tags: ['water'] }));
  }
  {
    const parts = [];
    for (let i = 0; i < 6; i++) parts.push(P('rock', { name: 'Cliff block', pos: [-6 + i * 2.4, 2 + (i % 2) * 0.6, (i % 3) * 0.4], scale: [1.4, 2.6, 1], mat: 'rock', p: { r: 1.2, seed: 70 + i, detail: 1, rough: 0.3 } }));
    L.push(recipe('cliff_wall', 'Cliff Wall Segment', 'terrain', parts, { notes: '14 m run of stacked cliff faces; rotate and repeat to wall off areas.', tags: ['backdrop'] }));
  }

  // ===== Props =====
  L.push(recipe('aether_lamp', 'Aether Lamp Post', 'props', lampPost(0, 0, 3.4), { notes: 'Brass-hooded street lamp with a cyan aether globe.', tags: ['light'] }));
  L.push(recipe('barrels_crates', 'Barrels & Crates', 'props', [...crate(0, 0, 0), ...crate(0.1, 0.6, 0.05, 0.5, 20), ...crate(0.8, 0, -0.1, 0.55, -12), ...barrel(-0.8, 0, 0.2), ...barrel(-0.6, 0, -0.7)], { tags: ['clutter'] }));
  L.push(
    recipe(
      'forge_anvil',
      'Anvil & Workbench',
      'props',
      [
        P('box', { name: 'Stump', mat: 'bark', p: { w: 0.6, h: 0.55, d: 0.6 } }),
        P('box', { name: 'Anvil waist', pos: [0, 0.55, 0], mat: 'iron', p: { w: 0.3, h: 0.2, d: 0.25 } }),
        P('box', { name: 'Anvil face', pos: [0, 0.75, 0], mat: 'steel', p: { w: 0.75, h: 0.18, d: 0.3 } }),
        P('cone', { name: 'Horn', pos: [0.55, 0.84, 0], rot: [0, 0, -90], mat: 'steel', p: { r: 0.09, h: 0.35, seg: 8 } }),
        P('box', { name: 'Bench', pos: [0, 0, -1.2], mat: 'timber', p: { w: 2, h: 0.9, d: 0.8 } }),
        P('box', { name: 'Bench top', pos: [0, 0.9, -1.2], mat: 'timber_dark', p: { w: 2.1, h: 0.08, d: 0.85 } }),
        P('box', { name: 'Hammer', pos: [-0.4, 0.98, -1.1], rot: [0, 30, 0], mat: 'timber', p: { w: 0.05, h: 0.05, d: 0.45 } }),
        P('gear', { name: 'Gear blank', pos: [0.5, 1.0, -1.2], rot: [90, 0, 0], mat: 'brass', p: { r: 0.16, teeth: 10, tooth: 0.04, depth: 0.03, hole: 0.05 } }),
        P('sphere', { name: 'Alignment lens', pos: [0, 1.6, 0], mat: 'aether_glass', p: { r: 0.12, seg: 12 } }),
        P('torus', { name: 'Lens ring', pos: [0, 1.6, 0], mat: 'brass', p: { r: 0.18, tube: 0.02, seg: 16 } }),
      ],
      { notes: 'Smithing station with an aether alignment lens hovering over the anvil (as in the Forge).', tags: ['crafting'] },
    ),
  );
  L.push(
    recipe(
      'signpost',
      'Wayfinder Signpost',
      'props',
      [
        P('cylinder', { name: 'Post', mat: 'timber', p: { rt: 0.07, rb: 0.09, h: 2.6, seg: 6 } }),
        P('box', { name: 'Sign: Emberhold', pos: [0.5, 2.0, 0], mat: 'timber_dark', p: { w: 0.9, h: 0.25, d: 0.05 } }),
        P('box', { name: 'Sign: Quarry', pos: [-0.25, 1.62, -0.433], rot: [0, 120, 0], mat: 'timber_dark', p: { w: 0.9, h: 0.25, d: 0.05 } }),
        P('box', { name: 'Sign: Foundry', pos: [-0.25, 1.24, 0.433], rot: [0, -120, 0], mat: 'timber_dark', p: { w: 0.9, h: 0.25, d: 0.05 } }),
        P('cone', { name: 'Brass cap', pos: [0, 2.6, 0], mat: 'brass', p: { r: 0.12, h: 0.16, seg: 6 } }),
        P('sphere', { name: 'Relic shard', pos: [0, 2.85, 0], mat: 'aether_glass', p: { r: 0.08, seg: 8 } }),
      ],
      { tags: ['path'] },
    ),
  );
  L.push(
    recipe(
      'brass_well',
      'Brass-Crank Well',
      'props',
      [
        P('tube', { name: 'Well wall', mat: 'chapter_stone', p: { ro: 1, ri: 0.75, h: 0.9, seg: 12 } }),
        P('cylinder', { name: 'Water', pos: [0, 0.5, 0], mat: 'water', p: { rt: 0.76, rb: 0.76, h: 0.02, seg: 12 } }),
        P('box', { name: 'Upright', pos: [-0.9, 0.9, 0], mat: 'timber', p: { w: 0.14, h: 1.4, d: 0.14 } }),
        P('box', { name: 'Upright', pos: [0.9, 0.9, 0], mat: 'timber', p: { w: 0.14, h: 1.4, d: 0.14 } }),
        P('prism', { name: 'Hood', pos: [0, 2.3, 0], rot: [0, 90, 0], mat: 'roof_slate', p: { w: 1.4, h: 0.6, d: 2.2, overhang: 0.1 } }),
        P('cylinder', { name: 'Axle', pos: [0, 2.05, 0], rot: [0, 0, 90], mat: 'brass', p: { rt: 0.06, rb: 0.06, h: 1.9, seg: 8 } }),
        P('gear', { name: 'Crank gear', pos: [1.0, 2.05, 0], rot: [0, 90, 0], mat: 'brass', p: { r: 0.22, teeth: 10, tooth: 0.05, depth: 0.05, hole: 0.04 } }),
      ],
      { tags: ['village'] },
    ),
  );
  {
    const parts = [];
    for (let i = 0; i < 6; i++) parts.push(P('cylinder', { name: 'Stake', pos: [-2.5 + i, 0, 0], mat: 'timber', p: { rt: 0.13, rb: 0.16, h: 2.2 + (i % 2) * 0.25, seg: 6 } }), P('cone', { name: 'Point', pos: [-2.5 + i, 2.2 + (i % 2) * 0.25, 0], mat: 'timber', p: { r: 0.13, h: 0.35, seg: 6 } }));
    parts.push(P('box', { name: 'Iron strap', pos: [0, 0.6, 0.1], mat: 'iron', p: { w: 6, h: 0.1, d: 0.06 } }), P('box', { name: 'Iron strap', pos: [0, 1.6, 0.1], mat: 'iron', p: { w: 6, h: 0.1, d: 0.06 } }));
    L.push(recipe('palisade', 'Palisade Segment', 'props', parts, { notes: '6 m stake wall with iron straps, like the village palisade.', tags: ['defense'] }));
  }
  L.push(
    recipe(
      'steam_pipes',
      'Steam Pipe Run',
      'props',
      [
        P('cylinder', { name: 'Pipe', pos: [2, 0.6, 0], rot: [0, 0, 90], mat: 'brass', p: { rt: 0.16, rb: 0.16, h: 4, seg: 10 } }),
        P('torus', { name: 'Elbow', pos: [2, 1.0, 0], rot: [0, 0, -90], mat: 'brass', p: { r: 0.4, tube: 0.16, arc: 90, seg: 8 } }),
        P('cylinder', { name: 'Riser', pos: [2.4, 1.0, 0], mat: 'brass', p: { rt: 0.16, rb: 0.16, h: 1.6, seg: 10 } }),
        P('box', { name: 'Support', pos: [-1, 0, 0], mat: 'iron', p: { w: 0.15, h: 0.6, d: 0.5 } }),
        P('box', { name: 'Support', pos: [1, 0, 0], mat: 'iron', p: { w: 0.15, h: 0.6, d: 0.5 } }),
        P('tube', { name: 'Flange', pos: [0, 0.6, 0], rot: [0, 0, 90], mat: 'iron', p: { ro: 0.24, ri: 0.15, h: 0.08, seg: 10 } }),
        P('torus', { name: 'Valve wheel', pos: [0, 1.05, 0], rot: [90, 0, 0], mat: 'iron', p: { r: 0.2, tube: 0.03, seg: 12 } }),
        P('cylinder', { name: 'Gauge', pos: [2.4, 2.4, 0.18], rot: [90, 0, 0], mat: 'clockface', p: { rt: 0.18, rb: 0.18, h: 0.04, seg: 14 } }),
      ],
      { notes: 'Snap-together brass pipe with flange, valve and pressure gauge.', tags: ['tech', 'clutter'] },
    ),
  );
  L.push(
    recipe(
      'mine_cart',
      'Mine Cart on Rails',
      'props',
      [
        P('box', { name: 'Rail', pos: [0.5, 0, 0], mat: 'steel', p: { w: 0.08, h: 0.1, d: 4 } }),
        P('box', { name: 'Rail', pos: [-0.5, 0, 0], mat: 'steel', p: { w: 0.08, h: 0.1, d: 4 } }),
        ...[-1.6, -0.8, 0, 0.8, 1.6].map((z) => P('box', { name: 'Sleeper', pos: [0, -0.06, z], mat: 'timber_dark', p: { w: 1.4, h: 0.08, d: 0.2 } })),
        P('box', { name: 'Tub', pos: [0, 0.35, 0], mat: 'iron', p: { w: 1.1, h: 0.7, d: 1.5 } }),
        P('box', { name: 'Brass rim', pos: [0, 1.03, 0], mat: 'brass', p: { w: 1.16, h: 0.06, d: 1.56 } }),
        ...[[0.5, -0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, z]) => P('cylinder', { name: 'Wheel', pos: [x, 0.22, z], rot: [0, 0, 90], mat: 'iron', p: { rt: 0.18, rb: 0.18, h: 0.08, seg: 12 } })),
        P('rock', { name: 'Ore load', pos: [0, 1.0, 0], scale: [1, 0.4, 1.3], mat: 'iron_ore', p: { r: 0.5, seed: 81, detail: 1, rough: 0.4 } }),
      ],
      { tags: ['quarry'] },
    ),
  );
  L.push(
    recipe(
      'telegraph_pole',
      'Telegraph Pylon',
      'props',
      [
        P('cylinder', { name: 'Pole', mat: 'timber', p: { rt: 0.1, rb: 0.14, h: 6, seg: 7 } }),
        P('box', { name: 'Crossarm', pos: [0, 5.4, 0], mat: 'timber_dark', p: { w: 1.8, h: 0.12, d: 0.12 } }),
        ...[-0.75, -0.25, 0.25, 0.75].map((x) => P('lathe', { name: 'Insulator', pos: [x, 5.52, 0], mat: 'aether_glass', p: { pts: [[0, 0], [0.06, 0], [0.04, 0.08], [0.06, 0.14], [0, 0.18]], seg: 8 } })),
        P('box', { name: 'Junction box', pos: [0, 2.2, 0.12], mat: 'brass', p: { w: 0.3, h: 0.4, d: 0.12 } }),
      ],
      { notes: 'Old-timey wire pylon with aether-glass insulators.', tags: ['tech'] },
    ),
  );
  L.push(
    recipe(
      'bench',
      'Promenade Bench',
      'props',
      [
        P('box', { name: 'Seat', pos: [0, 0.45, 0], mat: 'timber', p: { w: 1.7, h: 0.06, d: 0.45 } }),
        P('box', { name: 'Back', pos: [0, 0.5, -0.2], rot: [-12, 0, 0], mat: 'timber', p: { w: 1.7, h: 0.45, d: 0.05 } }),
        P('box', { name: 'Frame', pos: [-0.82, 0, 0], mat: 'iron', p: { w: 0.06, h: 0.45, d: 0.45 } }),
        P('box', { name: 'Frame', pos: [0.82, 0, 0], mat: 'iron', p: { w: 0.06, h: 0.45, d: 0.45 } }),
        P('box', { name: 'Back strut', pos: [-0.82, 0.45, -0.2], rot: [-12, 0, 0], mat: 'iron', p: { w: 0.06, h: 0.5, d: 0.05 } }),
        P('box', { name: 'Back strut', pos: [0.82, 0.45, -0.2], rot: [-12, 0, 0], mat: 'iron', p: { w: 0.06, h: 0.5, d: 0.05 } }),
        P('box', { name: 'Arm post', pos: [-0.82, 0.45, 0.17], mat: 'iron', p: { w: 0.06, h: 0.22, d: 0.06 } }),
        P('box', { name: 'Arm post', pos: [0.82, 0.45, 0.17], mat: 'iron', p: { w: 0.06, h: 0.22, d: 0.06 } }),
        P('box', { name: 'Armrest', pos: [-0.82, 0.67, -0.02], mat: 'timber_dark', p: { w: 0.08, h: 0.05, d: 0.46 } }),
        P('box', { name: 'Armrest', pos: [0.82, 0.67, -0.02], mat: 'timber_dark', p: { w: 0.08, h: 0.05, d: 0.46 } }),
        P('gear', { name: 'Gear boss', pos: [0.865, 0.56, 0.17], rot: [0, 90, 0], mat: 'brass', p: { r: 0.075, teeth: 8, tooth: 0.022, depth: 0.025, hole: 0.02 } }),
        P('gear', { name: 'Gear boss', pos: [-0.865, 0.56, 0.17], rot: [0, 90, 0], mat: 'brass', p: { r: 0.075, teeth: 8, tooth: 0.022, depth: 0.025, hole: 0.02 } }),
      ],
      { tags: ['village'] },
    ),
  );

  // ===== Aesthetic =====
  {
    const parts = [
      P('cylinder', { name: 'Dais', mat: 'dark_stone', p: { rt: 6.2, rb: 6.6, h: 0.5, seg: 24 } }),
      P('tube', { name: 'Gilt inlay', pos: [0, 0.5, 0], mat: 'gilt', p: { ro: 5.2, ri: 4.95, h: 0.04, seg: 32 } }),
      P('stairs', { name: 'Steps', pos: [0, 0, 6.9], rot: [0, 180, 0], mat: 'dark_stone', p: { w: 3, h: 0.5, d: 0.9, steps: 2 } }),
      P('cylinder', { name: 'Core housing', pos: [0, 0.5, 0], mat: 'iron', p: { rt: 1.6, rb: 2.2, h: 1.6, seg: 12 } }),
      P('tube', { name: 'Brass collar', pos: [0, 2.0, 0], mat: 'brass', p: { ro: 1.75, ri: 1.4, h: 0.25, seg: 16 } }),
      P('sphere', { name: 'Ember heart', pos: [0, 3.4, 0], mat: 'ember', p: { r: 1.15, seg: 18 } }),
      P('torus', { name: 'Containment ring', pos: [0, 3.4, 0], rot: [90, 0, 0], mat: 'brass', p: { r: 1.8, tube: 0.12, seg: 32 } }),
      P('torus', { name: 'Containment ring', pos: [0, 3.4, 0], rot: [20, 0, 60], mat: 'gilt', p: { r: 2.2, tube: 0.08, seg: 32 } }),
      P('gear', { name: 'Drive gear', pos: [0, 0.8, 0], rot: [90, 0, 0], mat: 'iron', p: { r: 3, teeth: 24, tooth: 0.35, depth: 0.3, hole: 2.3 } }),
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 4.6;
      const z = Math.sin(a) * 4.6;
      parts.push(P('box', { name: 'Pylon', pos: [x, 0.5, z], rot: [0, (-a * 180) / Math.PI, 0], mat: 'chapter_stone', p: { w: 0.8, h: 5.2, d: 0.8 } }));
      parts.push(P('pyramid', { name: 'Pylon cap', pos: [x, 5.7, z], rot: [0, (-a * 180) / Math.PI, 0], mat: 'gilt', p: { w: 1, h: 0.8, d: 1 } }));
      parts.push(P('sphere', { name: 'Pylon lens', pos: [x, 4.6, z], mat: 'aether_glass', p: { r: 0.32, seg: 12 } }));
      parts.push(P('cylinder', { name: 'Conduit', pos: [x * 0.88, 4.45, z * 0.88], rot: aimY(-x, -0.25, -z), mat: 'copper', p: { rt: 0.08, rb: 0.08, h: 2.8, seg: 6 } }));
    }
    L.push(recipe('foundry_core', 'Dormant Foundry Core', 'aesthetic', parts, { notes: 'Boss-arena centrepiece: iron housing with a caged ember heart, a great drive gear and four aether pylons feeding it.', tags: ['landmark', 'boss'] }));
  }  {
    const parts = [
      P('cylinder', { name: 'Arena floor', mat: 'dark_stone', p: { rt: 19, rb: 19.4, h: 0.12, seg: 48 } }),
      P('tube', { name: 'Outer gilt ring', pos: [0, 0.12, 0], mat: 'gilt', p: { ro: 18.2, ri: 17.7, h: 0.03, seg: 64 } }),
      P('tube', { name: 'Inner gilt ring', pos: [0, 0.12, 0], mat: 'gilt', p: { ro: 9.4, ri: 9.0, h: 0.03, seg: 48 } }),
      P('tube', { name: 'Core ring', pos: [0, 0.12, 0], mat: 'aether_glass', p: { ro: 3.1, ri: 2.8, h: 0.03, seg: 32 } }),
      P('cylinder', { name: 'Centre plate', pos: [0, 0.12, 0], mat: 'iron', p: { rt: 2.6, rb: 2.6, h: 0.04, seg: 24 } }),
    ];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 360;
      const s = Math.sin(D2Rc(a));
      const c = Math.cos(D2Rc(a));
      parts.push(P('box', { name: 'Spoke', pos: [s * 13.4, 0.12, c * 13.4], rot: [0, a, 0], mat: i % 3 === 0 ? 'gilt' : 'brass', p: { w: 0.22, h: 0.03, d: 8.2 } }));
      if (i % 3 === 0) parts.push(P('box', { name: 'Floor rune', pos: [s * 6, 0.12, c * 6], rot: [0, a + 45, 0], mat: 'ember', p: { w: 0.7, h: 0.02, d: 0.7 } }));
    }
    L.push(recipe('arena_floor', 'Foundry Arena Floor', 'terrain', parts, { notes: 'Inlaid boss-arena floor: dark stone disc, gilt rings and brass gear spokes radiating from an iron centre plate, ember runes at the quarters.', tags: ['boss', 'landmark'] }));
  }

  L.push(
    recipe(
      'gear_sun_monument',
      'Gear-Sun Monument',
      'aesthetic',
      [
        P('stairs', { name: 'Step', mat: 'dark_stone', p: { w: 4, h: 0.3, d: 4, steps: 1 } }),
        P('box', { name: 'Plinth', pos: [0, 0.3, 0], mat: 'chapter_stone', p: { w: 2.2, h: 1.6, d: 2.2 } }),
        P('box', { name: 'Gilt band', pos: [0, 1.75, 0], mat: 'gilt', p: { w: 2.3, h: 0.15, d: 2.3 } }),
        P('cylinder', { name: 'Column', pos: [0, 1.9, 0], mat: 'chapter_stone', p: { rt: 0.35, rb: 0.45, h: 2, seg: 12 } }),
        ...gearSun(0, 5.2, 0, 1.3),
        P('torus', { name: 'Halo', pos: [0, 5.2, 0], mat: 'gilt', p: { r: 1.85, tube: 0.06, seg: 32 } }),
      ],
      { notes: 'Processional monument bearing the Aurealium gear-sun. Use as a plaza centrepiece.', tags: ['order', 'landmark'] },
    ),
  );
  L.push(
    recipe(
      'order_banner',
      'Order Banner Pole',
      'aesthetic',
      [
        P('cylinder', { name: 'Pole', mat: 'brass', p: { rt: 0.04, rb: 0.06, h: 4.4, seg: 8 } }),
        P('cylinder', { name: 'Crossbar', pos: [0, 4.1, 0.02], rot: [0, 0, 90], mat: 'brass', p: { rt: 0.03, rb: 0.03, h: 1.3, seg: 6 } }),
        P('banner', { name: 'Banner', pos: [0, 1.6, 0.06], mat: 'banner', p: { w: 1.2, h: 2.5, wave: 0.1 } }),
        P('sphere', { name: 'Finial', pos: [0, 4.5, 0], mat: 'gilt', p: { r: 0.1, seg: 10 } }),
        P('cylinder', { name: 'Foot', mat: 'dark_stone', p: { rt: 0.25, rb: 0.3, h: 0.2, seg: 8 } }),
      ],
      { tags: ['order'] },
    ),
  );
  L.push(
    recipe(
      'brazier',
      'Order Brazier',
      'aesthetic',
      [
        P('lathe', { name: 'Bowl stand', mat: 'iron', p: { pts: [[0, 0], [0.35, 0], [0.12, 0.2], [0.08, 0.9], [0.45, 1.15], [0.5, 1.2], [0, 1.2]], seg: 12 } }),
        P('tube', { name: 'Gilt lip', pos: [0, 1.15, 0], mat: 'gilt', p: { ro: 0.52, ri: 0.46, h: 0.08, seg: 16 } }),
        P('cone', { name: 'Flame', pos: [0, 1.15, 0], mat: 'ember', p: { r: 0.32, h: 0.6, seg: 8 } }),
      ],
      { tags: ['light'] },
    ),
  );
  L.push(
    recipe(
      'orrery',
      'Brass Orrery',
      'aesthetic',
      [
        P('cylinder', { name: 'Pedestal', mat: 'dark_stone', p: { rt: 0.5, rb: 0.6, h: 0.8, seg: 10 } }),
        P('cylinder', { name: 'Spindle', pos: [0, 0.8, 0], mat: 'brass', p: { rt: 0.03, rb: 0.03, h: 1.2, seg: 6 } }),
        P('sphere', { name: 'Sun', pos: [0, 1.6, 0], mat: 'ember', p: { r: 0.18, seg: 12 } }),
        P('torus', { name: 'Orbit', pos: [0, 1.6, 0], rot: [90, 0, 0], mat: 'brass', p: { r: 0.5, tube: 0.012, seg: 32 } }),
        P('torus', { name: 'Orbit', pos: [0, 1.6, 0], rot: [80, 20, 0], mat: 'gilt', p: { r: 0.8, tube: 0.012, seg: 32 } }),
        P('sphere', { name: 'World', pos: [0.5, 1.6, 0], mat: 'aether_glass', p: { r: 0.07, seg: 10 } }),
        P('sphere', { name: 'Moon', pos: [-0.78, 1.72, 0.12], mat: 'steel', p: { r: 0.05, seg: 8 } }),
        P('gear', { name: 'Drive gear', pos: [0, 0.85, 0], rot: [90, 0, 0], mat: 'brass', p: { r: 0.3, teeth: 16, tooth: 0.05, depth: 0.04, hole: 0.05 } }),
      ],
      { notes: 'Tabletop brass orrery: a scholarly Order curio.', tags: ['order', 'tech'] },
    ),
  );
  return L;
}
