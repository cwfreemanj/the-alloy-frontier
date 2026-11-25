/**
 * The Emberhold first area, rendered from the Model Workshop scene: painted terrain, instanced
 * buildings / nature / ore seams, sky dome, golden-hour lighting, hotspot lights, GPU particles,
 * wind grass and post-processing (bloom + colour grade). Gameplay (NPCs, enemies, nodes, quests)
 * is untouched: positions come from @alloy/world's Layout, colliders from the same baked scene.
 */
import { ContainerProps } from './ContainerProps';
import { authoredModels } from './AuthoredModels';
import { AUTHORED_SCENERY_IDS, SWAPS, cliffSpots, hiddenScenery, variantFor } from './AuthoredScenery';
import type { InstanceHandle } from '../entities/WorldObjects';
import { ForgeBuilding } from './ForgeBuilding';
import * as THREE from 'three';
import {
  EMBERHOLD_TIME,
  PATH,
  ZONES,
  buildWorldColliders,
  distToPath,
  emberholdItems,
  fbm,
  playableSdf,
  CONTAINERS,
  insideForge,
  terrainHeight,
  type ColliderWorld,
  type WorldItem,
} from '@alloy/world';
import { TIMES, ParticleField, createGrass, createPost, createSky, sunDirection, type Emitter, type GrassSpot, type ParticlePreset, type Post, type TimeKey, type TimeOfDay } from './workshop/fx.js';
import { rng } from './workshop/core.js';
import { gameModel, setModelGlow, themeMaterial } from './WorkshopModels';
import { buildEmberholdTerrain, groundColor } from './EmberholdTerrain';

export type Quality = 'low' | 'medium' | 'high';

/** Particle anchors per model, in the model's own metres (before yaw/scale). */
const EMITTERS: Record<string, { preset: ParticlePreset; at: [number, number, number]; count: number; radius?: number }[]> = {
  // The forge building (ForgeBuilding.ts): chimney top and hearth.
  forge_hall: [
    { preset: 'smoke', at: [-1.6, 9.6, -3.55], count: 26 },
    { preset: 'embers', at: [-1.6, 9.5, -3.55], count: 30 },
    { preset: 'embers', at: [-1.6, 1.35, -2.45], count: 18, radius: 0.5 },
  ],
  forge_anvil: [{ preset: 'sparks', at: [0, 0.95, 0], count: 26 }],
  frontier_cottage: [{ preset: 'smoke', at: [2.2, 8.8, -1.4], count: 14 }],
  steam_pumphouse: [{ preset: 'smoke', at: [-1.6, 8.4, -1], count: 22 }],
  brazier: [{ preset: 'embers', at: [0, 1.5, 0], count: 22, radius: 0.25 }],
  foundry_core: [
    { preset: 'embers', at: [0, 3.4, 0], count: 90, radius: 1.3 },
    { preset: 'motes', at: [3.25, 4.6, 3.25], count: 10 },
    { preset: 'motes', at: [-3.25, 4.6, 3.25], count: 10 },
    { preset: 'motes', at: [3.25, 4.6, -3.25], count: 10 },
    { preset: 'motes', at: [-3.25, 4.6, -3.25], count: 10 },
  ],
  ironglass_cluster: [{ preset: 'motes', at: [0, 1.1, 0], count: 12, radius: 0.8 }],
  aether_beacon: [{ preset: 'motes', at: [0, 12.7, 0], count: 24, radius: 1.2 }],
  iron_ore_node: [{ preset: 'sparks', at: [0, 0.9, 0], count: 3, radius: 0.6 }],
};

/** The few point lights the area keeps, at its hotspots. */
const HOT_LIGHTS: Record<string, { at: [number, number, number]; color: string; intensity: number; distance: number; flicker?: boolean; pulse?: boolean; max: number }> = {
  forge_hall: { at: [-1.4, 2.0, -1.2], color: '#ff7a2e', intensity: 30, distance: 20, flicker: true, max: 1 },
  foundry_core: { at: [0, 3.4, 0], color: '#ff5a1a', intensity: 60, distance: 34, pulse: true, max: 1 },
  aether_beacon: { at: [0, 12.7, 0], color: '#5fd6f5', intensity: 40, distance: 40, max: 2 },
};

const BACKDROP = new Set(['ridge_chunk', 'mesa_tile', 'hills_tile']);
const NO_SHADOW = new Set(['shrub', 'arena_floor', ...BACKDROP]);
const CHUNK = 96;

/** Scatter footprints for keeping grass off things (generator radii, metres at scale 1). */
const CLEAR: Record<string, number> = { ironwood_tree: 2.2, broadleaf_tree: 2.2, gilded_birch: 2.2, rock_cluster: 1.6, shrub: 0.8, fallen_log: 2.5, iron_ore_node: 1.6, ironglass_cluster: 1.6 };

function pathAt(s: number): { x: number; z: number; tx: number; tz: number } {
  let acc = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= s || i === PATH.length - 2) {
      const t = Math.max(0, Math.min(1, (s - acc) / L));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L };
    }
    acc += L;
  }
  return { x: 0, z: 0, tx: 0, tz: 1 };
}
const PATH_LENGTH = PATH.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - PATH[i].x, p.z - PATH[i].z), 0);

const UP = new THREE.Vector3(0, 1, 0);
/** Scenery models that gatherable nodes animate (falling trees). */
const ANIMATED = new Set(['ironwood_tree']);

/** A workshop model's bounding size (metres at scale 1). */
const sizeCache = new Map<string, THREE.Vector3 | null>();
function workshopSize(id: string): THREE.Vector3 | null {
  if (sizeCache.has(id)) return sizeCache.get(id)!;
  const m = gameModel(id);
  let out: THREE.Vector3 | null = null;
  if (m) {
    const box = new THREE.Box3();
    for (const p of m.parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    out = box.getSize(new THREE.Vector3());
  }
  sizeCache.set(id, out);
  return out;
}

function itemMatrix(it: WorldItem, out: THREE.Matrix4): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, THREE.MathUtils.degToRad(it.yaw));
  return out.compose(new THREE.Vector3(it.x, terrainHeight(it.x, it.z) + it.y, it.z), q, new THREE.Vector3().setScalar(it.scale));
}

interface HotLight {
  light: THREE.PointLight;
  base: number;
  flicker?: boolean;
  pulse?: boolean;
}

export class EmberholdWorld {
  readonly group = new THREE.Group();
  readonly colliders: ColliderWorld;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  readonly time: TimeKey;
  private sky: ReturnType<typeof createSky>;
  private fields: ParticleField[] = [];
  private lights: HotLight[] = [];
  private grass: THREE.InstancedMesh | null = null;
  private handles = new Map<string, InstanceHandle>();
  /** Instanced scenery per model and chunk (swapped for authored models once they load). */
  private instGroups: Array<{ id: string; items: WorldItem[]; meshes: THREE.InstancedMesh[] }> = [];
  private forge: ForgeBuilding | null = null;
  /** Chests and trail caches (searchable). */
  readonly containers = new ContainerProps();

  /** The instance of a scenery model at a position (grove trees), for nodes that animate it. */
  instanceAt(model: string, x: number, z: number): InstanceHandle | null {
    return this.handles.get(`${model}|${x},${z}`) ?? null;
  }
  private grassTime = { value: 0 };
  private post: Post | null = null;
  private quality: Quality;
  private sunDir: THREE.Vector3;
  private width = 1;
  private height = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    this.quality = quality;
    this.time = (EMBERHOLD_TIME in TIMES ? EMBERHOLD_TIME : 'golden') as TimeKey;
    const t = this.light();
    this.colliders = buildWorldColliders();
    // The cliff faces on the valley edge block like rock (browser-side: the server doesn't check walls).
    for (const c of cliffSpots()) {
      const depth = c.width * (c.model === 'cliff' ? 0.5 : 0.4);
      this.colliders.add({ type: 'obb', x: c.x, z: c.z, hw: c.width / 2, hd: depth / 2, cos: Math.cos(c.yaw), sin: Math.sin(c.yaw), top: c.y + c.width * 1.1 });
    }
    this.group.name = 'emberhold';

    // Sky, light, fog.
    this.sky = createSky();
    this.sunDir = sunDirection(t);
    const u = this.sky.material.uniforms;
    u.uZenith.value.set(t.zenith);
    u.uHorizon.value.set(t.horizon);
    u.uSunColor.value.set(t.sun.color);
    u.uSunDir.value.copy(this.sunDir);
    u.uNight.value = t.night;
    this.hemi = new THREE.HemisphereLight(t.hemi[0], t.hemi[1], t.hemi[2]);
    this.sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -48;
    sc.right = sc.top = 48;
    sc.near = 1;
    sc.far = 320;
    this.fog = new THREE.FogExp2(t.fog[0], t.fog[1]);
    scene.background = new THREE.Color(t.horizon);
    scene.fog = this.fog;
    renderer.toneMappingExposure = t.exposure;
    this.group.add(this.sky, this.hemi, this.sun, this.sun.target);

    // Ground + models.
    const detail = themeMaterial('grass').map ?? null;
    this.group.add(buildEmberholdTerrain(detail, quality === 'low' ? 3.2 : 2.2));
    this.buildInstances();
    setModelGlow(t.glow);
    this.buildFx();
    this.applyQuality();
    scene.add(this.group);
    // Authored models replace the workshop scenery as they arrive (the game doesn't wait).
    void this.upgradeScenery();
  }

  /**
   * Swap Model Workshop scenery for the authored (Meshy) models, matched to the original
   * model's height or width, and line the steep valley edges with cliff faces.
   */
  private async upgradeScenery(): Promise<void> {
    const models = await authoredModels(AUTHORED_SCENERY_IDS);
    if (models.size === 0) return;
    const m4 = new THREE.Matrix4();
    const base = new THREE.Matrix4();
    const shadowsOn = this.quality !== 'low';
    for (const g of this.instGroups) {
      const swap = SWAPS[g.id];
      const orig = workshopSize(g.id);
      if (!swap || !orig) continue;
      const byVariant = new Map<string, WorldItem[]>();
      for (const it of g.items) {
        const v = variantFor(swap, it);
        let list = byVariant.get(v);
        if (!list) byVariant.set(v, (list = []));
        list.push(it);
      }
      if ([...byVariant.keys()].some((v) => !models.has(v))) continue; // keep the original if any variant failed
      for (const m of g.meshes) this.group.remove(m);
      g.meshes = [];
      const animated = ANIMATED.has(g.id);
      if (animated)
        for (const it of g.items) {
          const h = this.handles.get(`${g.id}|${it.x},${it.z}`);
          if (h) h.parts.length = 0;
        }
      for (const [v, items] of byVariant) {
        const am = models.get(v)!;
        const s = orig[swap.fit] / Math.max(1e-6, am.size[swap.fit]);
        const local = new THREE.Matrix4().makeScale(s, s, s);
        for (const p of am.parts) {
          const im = new THREE.InstancedMesh(p.geometry, p.material, items.length);
          items.forEach((it, i) => {
            im.setMatrixAt(i, m4.multiplyMatrices(itemMatrix(it, base), local));
            if (animated) {
              const h = this.handles.get(`${g.id}|${it.x},${it.z}`);
              if (h) {
                h.parts.push({ mesh: im, index: i, local });
                h.version = (h.version ?? 0) + 1;
              }
            }
          });
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = shadowsOn && !NO_SHADOW.has(g.id);
          im.receiveShadow = true;
          im.computeBoundingSphere();
          im.name = `${g.id}:${v}`;
          this.group.add(im);
          g.meshes.push(im);
        }
      }
    }
    // Cliff faces on the steep valley edges.
    const spots = cliffSpots();
    for (const id of ['cliff', 'rockwall'] as const) {
      const am = models.get(id);
      const list = spots.filter((c) => c.model === id);
      if (!am || list.length === 0) continue;
      for (const p of am.parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
        list.forEach((c, i) => {
          const s = c.width / Math.max(1e-6, am.size.x);
          im.setMatrixAt(i, m4.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion().setFromAxisAngle(UP, c.yaw), new THREE.Vector3(s, s * 1.15, s)));
        });
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = shadowsOn;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.name = `edge:${id}`;
        this.group.add(im);
      }
    }
    this.warmUp(models.values());
  }

  /**
   * Upload the new models' textures and compile their shaders now, so the first time one comes
   * into view (walking into a new area) doesn't stall a frame.
   */
  private warmUp(models: Iterable<{ parts: Array<{ material: THREE.MeshStandardMaterial }> }>): void {
    for (const m of models)
      for (const p of m.parts)
        for (const t of [p.material.map, p.material.normalMap, p.material.roughnessMap, p.material.metalnessMap, p.material.emissiveMap]) if (t) this.renderer.initTexture(t);
    void this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  }

  /**
   * The scene's time-of-day preset, tuned for play: the workshop's golden hour keeps its colour,
   * sky and fog, but the sun sits higher and the fill is stronger so the third-person view (which
   * looks across the long low-sun shadows rather than down on them) stays readable.
   */
  private light(): TimeOfDay {
    const t = TIMES[this.time];
    return {
      ...t,
      sun: { ...t.sun, el: Math.max(t.sun.el, 30), intensity: t.sun.intensity * 1.15 },
      hemi: [t.hemi[0], t.hemi[1], Math.max(t.hemi[2], 0.6) * 1.9],
      exposure: t.exposure * 1.12,
    };
  }

  /** Instanced meshes per model and 96 m chunk, so frustum culling skips what is off screen. */
  private buildInstances(): void {
    const byKey = new Map<string, WorldItem[]>();
    for (const it of emberholdItems()) {
      if (it.model === 'forge_hall') {
        // Drawn as the detailed forge building instead of the workshop shed.
        this.forge = new ForgeBuilding();
        itemMatrix(it, this.forge.group.matrix);
        this.forge.group.matrixAutoUpdate = false;
        this.group.add(this.forge.group);
        this.group.add(this.containers.group);
        continue;
      }
      // Clutter on the steep hill walls outside the playable area isn't drawn (cliffs line the edge instead).
      if (hiddenScenery(it.model, it.x, it.z)) continue;
      const k = BACKDROP.has(it.model) ? `${it.model}|bd` : `${it.model}|${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
      let list = byKey.get(k);
      if (!list) byKey.set(k, (list = []));
      list.push(it);
    }
    const m4 = new THREE.Matrix4();
    for (const [k, items] of byKey) {
      const id = k.split('|')[0];
      const model = gameModel(id);
      if (!model) continue;
      const group = { id, items, meshes: [] as THREE.InstancedMesh[] };
      this.instGroups.push(group);
      for (const p of model.parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, items.length);
        items.forEach((it, i) => {
          im.setMatrixAt(i, itemMatrix(it, m4));
          // Remember where gatherable scenery lives, so a node can animate its own instance.
          if (ANIMATED.has(id)) {
            const key = `${id}|${it.x},${it.z}`;
            const h = this.handles.get(key) ?? { parts: [] };
            h.parts.push({ mesh: im, index: i });
            this.handles.set(key, h);
          }
        });
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = !NO_SHADOW.has(id);
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.name = id;
        this.group.add(im);
        group.meshes.push(im);
      }
    }
  }

  private buildFx(): void {
    const em: Record<ParticlePreset, Emitter[]> = { embers: [], sparks: [], smoke: [], dust: [], wisps: [], motes: [] };
    const m4 = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const seen = new Map<string, number>();
    for (const it of emberholdItems()) {
      const list = EMITTERS[it.model];
      const L = HOT_LIGHTS[it.model];
      if (!list && !L) continue;
      itemMatrix(it, m4);
      for (const e of list ?? []) {
        v.fromArray(e.at).applyMatrix4(m4);
        em[e.preset].push({ x: v.x, y: v.y, z: v.z, count: e.count, radius: e.radius !== undefined ? e.radius * it.scale : undefined });
      }
      if (L && (seen.get(it.model) ?? 0) < L.max) {
        seen.set(it.model, (seen.get(it.model) ?? 0) + 1);
        v.fromArray(L.at).applyMatrix4(m4);
        const light = new THREE.PointLight(L.color, L.intensity, L.distance, 1.7);
        light.position.copy(v);
        this.group.add(light);
        this.lights.push({ light, base: L.intensity, flicker: L.flicker, pulse: L.pulse });
      }
    }
    // Drifting dust in the village and along the trail; fireflies once the light goes golden.
    em.dust.push({ x: 0, y: 1, z: 6, count: 70, radius: 22, height: 5 });
    for (let s = 40; s < PATH_LENGTH; s += 28) {
      const p = pathAt(s);
      em.dust.push({ x: p.x, y: terrainHeight(p.x, p.z) + 0.6, z: p.z, count: 30, radius: 14, height: 4 });
    }
    const t = TIMES[this.time];
    if (t.night > 0.15) {
      const R = rng(99);
      for (let i = 0; i < 46; i++) {
        const p = pathAt(30 + R() * (PATH_LENGTH - 40));
        const side = R() > 0.5 ? 1 : -1;
        const x = p.x + p.tz * side * (8 + R() * 8);
        const z = p.z - p.tx * side * (8 + R() * 8);
        em.wisps.push({ x, y: terrainHeight(x, z) + 0.8, z, count: Math.round(10 * t.night), radius: 6, height: 2.2 });
      }
    }
    const density = this.quality === 'low' ? 0.35 : this.quality === 'medium' ? 0.7 : 1;
    for (const [preset, list] of Object.entries(em) as [ParticlePreset, Emitter[]][]) {
      if (!list.length) continue;
      const f = new ParticleField(preset, list, { density, pixelRatio: this.renderer.getPixelRatio() });
      this.group.add(f.points);
      this.fields.push(f);
    }
  }

  /** Grass clumps, kept off the trail, plazas, the quarry pit, the arena and anything placed. */
  private buildGrass(count: number): void {
    if (this.grass) {
      this.group.remove(this.grass);
      this.grass.geometry.dispose();
      (this.grass.material as THREE.Material).dispose();
      this.grass = null;
    }
    if (count <= 0) return;
    const cell = 4;
    const grid = new Map<string, [number, number, number][]>();
    const add = (x: number, z: number, r: number) => {
      const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push([x, z, r]);
    };
    const free = (x: number, z: number) => {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) for (const p of grid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < Math.max(0.4, p[2])) return false;
      return true;
    };
    for (const it of emberholdItems()) {
      if (BACKDROP.has(it.model)) continue;
      const r = CLEAR[it.model] !== undefined ? CLEAR[it.model] * it.scale : (gameModel(it.model)?.radius ?? 1) * it.scale * 0.85 + 1;
      add(it.x, it.z, Math.min(r, 8));
    }
    // A small clearing around each trail cache: half hidden among rocks, not buried in grass.
    for (const c of CONTAINERS) if (c.kind === 'cache') add(c.pos.x, c.pos.z, 1.6);
    const [V, , Q, F] = ZONES;
    const R = rng(1337 * 31 + 7);
    const rand = (a: number, b: number) => a + (b - a) * R();
    const tip = new THREE.Color('#a9b56a');
    const col = new THREE.Color();
    const slopeAt = (x: number, z: number) => Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
    const spots: GrassSpot[] = [];
    for (let i = 0; i < count * 12 && spots.length < count; i++) {
      const x = rand(-70, 100);
      const z = rand(-45, 280);
      const p = { x, z };
      if (playableSdf(p) > 10) continue;
      if (distToPath(p) < 2.4 + R() * 1.2) continue;
      if (Math.hypot(x - V.center.x, z - V.center.z) < 16 + R() * 4) continue;
      if (Math.hypot(x - Q.center.x, z - Q.center.z) < Q.radius - 3 || Math.hypot(x - F.center.x, z - F.center.z) < F.radius - 2) continue;
      if (fbm(x / 11, z / 11, 2, 55) < -0.45 + R() * 0.35) continue;
      if (!free(x, z) || slopeAt(x, z) > 0.55) continue;
      groundColor(x, z, 0, col).lerp(tip, 0.15 + R() * 0.2);
      spots.push({ x, y: terrainHeight(x, z) - 0.03, z, yaw: R() * Math.PI * 2, s: rand(0.5, 0.95), h: R() * 0.5, color: `#${col.getHexString()}` });
    }
    this.grass = createGrass(spots, this.grassTime);
    // Light both sides of every blade like the ground it grows from (no dark back faces when
    // the third-person camera looks across the grass instead of down on it).
    const mat = this.grass.material as THREE.MeshStandardMaterial;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );');
    };
    mat.customProgramCacheKey = () => 'emberhold-grass';
    this.group.add(this.grass);
  }

  /** Re-tune for a quality level: grass density, post-processing, hotspot lights. */
  setQuality(q: Quality): void {
    if (q === this.quality && (this.grass || q === 'low')) return;
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = this.quality;
    this.buildGrass(q === 'high' ? 11000 : q === 'medium' ? 5000 : 0);
    // Low keeps the forge + foundry glow only (fewer per-pixel lights).
    this.lights.forEach((l, i) => (l.light.visible = q !== 'low' || i < 2));
    this.post?.dispose();
    this.post = null;
    if (q !== 'low') {
      const t = this.light();
      this.post = createPost(this.renderer, this.scene, this.camera, { samples: q === 'high' ? 4 : 0 });
      this.post.bloom.strength = t.bloom[0];
      this.post.bloom.radius = t.bloom[1];
      this.post.bloom.threshold = t.bloom[2];
      const g = this.post.grade.uniforms;
      g.uVignette.value = t.grade.vignette;
      g.uContrast.value = t.grade.contrast;
      g.uSaturation.value = t.grade.saturation;
      g.uWarmth.value = t.grade.warmth;
      g.uGrain.value = q === 'high' ? 0.03 : 0.02;
      this.post.setSize(this.width, this.height);
    }
    // Low quality: a shorter view with denser fog hides the reduced draw distance.
    this.fog.density = TIMES[this.time].fog[1] * (q === 'low' ? 1.8 : 1);
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.post?.setSize(w, h);
  }

  /** Per frame: animate fx and keep the sun's shadow box centred on `focus` (the player). */
  update(time: number, focus: THREE.Vector3): void {
    this.grassTime.value = time;
    this.sky.material.uniforms.uTime.value = time;
    this.sky.position.copy(this.camera.position);
    for (const f of this.fields) f.update(time);
    this.forge?.update(time);
    this.forge?.setInside(insideForge(focus.x, focus.z));
    for (const l of this.lights) {
      if (l.flicker) l.light.intensity = l.base * (0.85 + Math.sin(time * 13) * 0.06 + Math.sin(time * 7.3) * 0.08);
      if (l.pulse) l.light.intensity = l.base * (0.8 + Math.sin(time * 1.6) * 0.2);
    }
    // Snap to shadow texels so the shadows do not shimmer as the player moves.
    const texel = 96 / this.sun.shadow.mapSize.x;
    const sx = Math.round(focus.x / texel) * texel;
    const sz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(sx, terrainHeight(sx, sz), sz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 160);
  }

  render(time: number): void {
    // Count every pass of the frame in renderer.info (the perf overlay reads it after rendering).
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.post) this.post.render(time);
    else this.renderer.render(this.scene, this.camera);
  }
}
