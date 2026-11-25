/**
 * Authored 3D models (Meshy, optimized by tools/asset-pipeline/meshy.mjs) for the forge and the
 * area's scenery. They load in the background after the world is built; until then (or if a file
 * fails to load) the code-built / Model Workshop versions stay in place.
 *
 * Each model's origin is its footprint centre on the ground, and it is about 1 unit across;
 * callers scale it to a size in metres (see fitScale).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface AuthoredPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}
export interface AuthoredModel {
  id: string;
  parts: AuthoredPart[];
  /** Bounding size in model units (x, y, z). */
  size: THREE.Vector3;
}

interface ManifestEntry {
  size: [number, number, number];
  hash: string;
}

/** Foliage: leaf cards are cut out by the texture's alpha and seen from both sides. */
const FOLIAGE = new Set(['pine_tall', 'pine_wide', 'pine_young', 'oak_autumn', 'tree_golden', 'ironwood', 'ironwood_young', 'shrub', 'ferns']);

const cache = new Map<string, Promise<AuthoredModel | null>>();
let manifest: Promise<Record<string, ManifestEntry> | null> | null = null;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const base = () => `${import.meta.env.BASE_URL}models/authored/`;

function loadManifest(): Promise<Record<string, ManifestEntry> | null> {
  manifest ??= fetch(`${base()}manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, ManifestEntry>>) : null))
    .catch(() => null);
  return manifest;
}

/** Load one authored model (cached). Resolves null if it is missing or fails to load. */
export function authoredModel(id: string): Promise<AuthoredModel | null> {
  let p = cache.get(id);
  if (!p) {
    p = loadManifest().then(async (m) => {
      const entry = m?.[id];
      if (!entry) return null;
      try {
        const gltf = await loader.loadAsync(`${base()}${id}.glb?v=${entry.hash}`);
        gltf.scene.updateMatrixWorld(true);
        const parts: AuthoredPart[] = [];
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
          if (FOLIAGE.has(id)) {
            material.alphaTest = 0.5;
            material.transparent = false;
            material.side = THREE.DoubleSide;
          }
          parts.push({ geometry, material });
        });
        const box = new THREE.Box3();
        for (const p of parts) {
          p.geometry.computeBoundingBox();
          box.union(p.geometry.boundingBox!);
        }
        return { id, parts, size: box.getSize(new THREE.Vector3()) };
      } catch {
        return null;
      }
    });
    cache.set(id, p);
  }
  return p;
}

/** Load several; resolves with the ones that loaded. */
export async function authoredModels(ids: string[]): Promise<Map<string, AuthoredModel>> {
  const out = new Map<string, AuthoredModel>();
  await Promise.all(
    ids.map(async (id) => {
      const m = await authoredModel(id);
      if (m) out.set(id, m);
    }),
  );
  return out;
}

/** Uniform scale that makes a model `metres` along an axis ('x' width, 'y' height, 'z' depth). */
export function fitScale(m: AuthoredModel, metres: number, axis: 'x' | 'y' | 'z' = 'y'): number {
  const v = m.size[axis];
  return v > 1e-6 ? metres / v : 1;
}

/** A plain (non-instanced) copy of a model, as a group of meshes. */
export function authoredObject(m: AuthoredModel, opts: { shadows?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = opts.shadows ?? true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/**
 * An emissive mask from a base-colour texture: white where the pixel is orange-hot (strong red,
 * little blue: glowing coals, an ember line), black elsewhere. Null if the image can't be read.
 * `threshold` (0..1) is how "hot" a pixel must be to glow.
 */
export function emberMask(tex: THREE.Texture | null, threshold = 0.3): THREE.CanvasTexture | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return null;
  const w = Math.min(512, img.width);
  const h = Math.min(512, img.height);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const gr = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    // Hot: bright red channel, red well above blue, some yellow (green) in it.
    const heat = Math.max(0, Math.min(1, (r - b - threshold) * 2.4)) * (r > 0.55 ? 1 : 0) * (gr > 0.18 ? 1 : 0.4);
    const v = Math.round(heat * 255);
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.flipY = tex!.flipY; // glTF textures are not flipped
  out.colorSpace = THREE.SRGBColorSpace;
  out.channel = tex!.channel;
  return out;
}

/**
 * Where a model glows: the average position (model units) of the vertices that sit on hot texels
 * of an emissive mask (from emberMask), weighted by how hot. Null if nothing glows.
 */
export function hotSpot(m: AuthoredModel, mask: THREE.CanvasTexture): THREE.Vector3 | null {
  const c = mask.image as HTMLCanvasElement;
  const g = c.getContext('2d');
  if (!g) return null;
  const { width: w, height: h } = c;
  const px = g.getImageData(0, 0, w, h).data;
  const sum = new THREE.Vector3();
  let wsum = 0;
  const p = new THREE.Vector3();
  for (const part of m.parts) {
    const uv = part.geometry.getAttribute('uv');
    const pos = part.geometry.getAttribute('position');
    if (!uv || !pos) continue;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i) - Math.floor(uv.getX(i));
      const v = uv.getY(i) - Math.floor(uv.getY(i));
      // glTF UVs: v grows downward in the image (the mask isn't flipped, like the texture).
      const x = Math.min(w - 1, Math.floor(u * w));
      const y = Math.min(h - 1, Math.floor(v * h));
      const heat = px[(y * w + x) * 4] / 255;
      if (heat < 0.5) continue;
      p.fromBufferAttribute(pos, i);
      sum.addScaledVector(p, heat);
      wsum += heat;
    }
  }
  return wsum > 0 ? sum.divideScalar(wsum) : null;
}
