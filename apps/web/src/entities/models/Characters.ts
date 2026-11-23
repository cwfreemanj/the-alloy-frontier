/**
 * Skinned character models (Mixamo-rigged GLBs) and their animation library.
 *
 * Asset pipeline (see docs/ASSETS.md): every character GLB keeps its own bind pose; every clip in
 * anims.glb is stored *relative to the rest pose of the skeleton it was authored on*
 * (rotation deltas, hips offset in hip-heights, horizontal travel removed). At load we rebuild
 * each clip for each character's own rest pose, so one library drives every model.
 *
 * Gameplay never reads animation: rules in @alloy/game-rules decide timing, and this module only
 * maps a rules phase (windup / active / recovery, 0..1) onto the clip, with the clip's strike frame
 * placed inside the active window. That keeps the visible swing in step with the hit window.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type CharacterId = 'maria' | 'exo' | 'eve' | 'demon' | 'heraklios' | 'maw';
export type PlayerCharacterId = 'maria' | 'exo';

export const PLAYER_CHARACTERS: Array<{ id: PlayerCharacterId; name: string; blurb: string }> = [
  { id: 'maria', name: 'Maria', blurb: 'Frontier swordswoman' },
  { id: 'exo', name: 'Exo Gray', blurb: 'Meridian exo-suit wanderer' },
];
export const DEFAULT_PLAYER_CHARACTER: PlayerCharacterId = 'maria';
export function isPlayerCharacter(v: unknown): v is PlayerCharacterId {
  return v === 'maria' || v === 'exo';
}

export interface ClipMeta {
  duration: number;
  /** Strike moment (s) of the clip's effector. */
  peak: number;
  effector: string;
  /** Root travel in hip-heights per second (x = character left, z = forward) before it was removed. */
  travel: [number, number];
}

interface CharacterMeta {
  file: string;
  v: string;
  name: string;
  heightCm: number;
  hipsY: number;
  handLenCm: number;
  hand?: { grip: number[]; dir: number[]; width: number[] };
}

interface Manifest {
  version: number;
  characters: Record<CharacterId, CharacterMeta>;
  anims: { file: string; v: string };
  clips: Record<string, ClipMeta>;
}

type Rest = Record<string, { q: THREE.Quaternion; p: THREE.Vector3 }>;

interface Template {
  meta: CharacterMeta;
  scene: THREE.Object3D;
  rest: Rest;
}

class Library {
  readonly templates = new Map<CharacterId, Template>();
  readonly source = new Map<string, THREE.AnimationClip>();
  private readonly perChar = new Map<CharacterId, Map<string, THREE.AnimationClip>>();
  constructor(readonly manifest: Manifest) {}

  clip(char: CharacterId, id: string): THREE.AnimationClip | null {
    let m = this.perChar.get(char);
    if (!m) this.perChar.set(char, (m = new Map()));
    let c = m.get(id);
    if (!c) {
      const src = this.source.get(id);
      const t = this.templates.get(char);
      if (!src || !t) return null;
      c = retargetClip(src, t.rest);
      m.set(id, c);
    }
    return c;
  }
}

let library: Library | null = null;

export function charactersReady(): boolean {
  return library !== null;
}

export function clipMeta(id: string): ClipMeta | null {
  return library?.manifest.clips[id] ?? null;
}

function captureRest(root: THREE.Object3D): Rest {
  const rest: Rest = {};
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) rest[o.name] = { q: o.quaternion.clone(), p: o.position.clone() };
  });
  return rest;
}

/** Rebuild a rest-relative library clip for one skeleton's rest pose. */
export function retargetClip(clip: THREE.AnimationClip, rest: Rest): THREE.AnimationClip {
  const hipsH = rest.Hips?.p.y ?? 100;
  const tracks: THREE.KeyframeTrack[] = [];
  const d = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);
    const r = rest[bone];
    if (!r) continue;
    if (prop === 'quaternion') {
      const v = new Float32Array(t.values.length);
      for (let i = 0; i < v.length; i += 4) {
        d.fromArray(t.values, i);
        q.copy(r.q).multiply(d).toArray(v, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, Array.from(t.times), Array.from(v)));
    } else if (prop === 'position' && bone === 'Hips') {
      const v = new Float32Array(t.values.length);
      for (let i = 0; i < v.length; i += 3) {
        v[i] = r.p.x + t.values[i] * hipsH;
        v[i + 1] = r.p.y + t.values[i + 1] * hipsH;
        v[i + 2] = r.p.z + t.values[i + 2] * hipsH;
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(v)));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Load the manifest, every character and the animation library. Resolves false (and the game keeps
 * its procedural placeholder rigs) if anything is missing or fails to load.
 */
export async function loadCharacters(onProgress?: (fraction: number) => void): Promise<boolean> {
  if (library) return true;
  const base = `${import.meta.env.BASE_URL}models/`;
  try {
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return false;
    const manifest = (await res.json()) as Manifest;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const files: Array<{ url: string; key: CharacterId | 'anims' }> = [
      ...(Object.keys(manifest.characters) as CharacterId[]).map((id) => ({ url: `${base}${manifest.characters[id].file}?v=${manifest.characters[id].v}`, key: id })),
      { url: `${base}${manifest.anims.file}?v=${manifest.anims.v}`, key: 'anims' as const },
    ];
    let done = 0;
    const lib = new Library(manifest);
    await Promise.all(
      files.map(async (f) => {
        const gltf = await loader.loadAsync(f.url);
        if (f.key === 'anims') {
          for (const a of gltf.animations) lib.source.set(a.name, a);
        } else {
          const scene = gltf.scene;
          scene.traverse((o) => {
            const m = o as THREE.SkinnedMesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.frustumCulled = false; // skinned bounds don't follow the animation
            }
          });
          lib.templates.set(f.key, { meta: manifest.characters[f.key], scene, rest: captureRest(scene) });
        }
        onProgress?.(++done / files.length);
      }),
    );
    library = lib;
    return true;
  } catch (e) {
    console.warn('Character models unavailable, using placeholder rigs.', e);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Animation requests (what an entity asks its body to show this frame)
// ---------------------------------------------------------------------------------------------

/** Clips used for locomotion. Missing directional clips fall back to walk/run. */
export interface LocoSet {
  idle: string;
  walk: string;
  run: string;
  back?: string;
  left?: string;
  right?: string;
}

export type AnimRequest =
  /** Speed in m/s; dir is the movement direction in the character's frame (x = left, z = forward). */
  | { kind: 'loco'; speed: number; dirX?: number; dirZ?: number }
  /** Show a clip at an explicit time (seconds into the clip; clamped). */
  | { kind: 'clip'; clip: string; time: number; fade?: number }
  /** Loop a clip at its natural speed. */
  | { kind: 'loop'; clip: string; rate?: number; fade?: number };

export interface PhaseShape {
  /** Seconds of clip before the strike frame shown during the windup. */
  lead: number;
  /** Seconds of clip around the strike frame shown during the active window. */
  before: number;
  after: number;
  /** Seconds of clip after the active window shown during recovery. */
  tail: number;
}

const DEFAULT_SHAPE: PhaseShape = { lead: 0.45, before: 0.06, after: 0.1, tail: 0.5 };

/**
 * Map a rules phase onto clip time so the strike frame lands just inside the active window:
 * windup plays [peak - lead, peak - before], active plays [peak - before, peak + after],
 * recovery plays [peak + after, peak + after + tail].
 */
export function phaseClipTime(clip: string, phase: 'windup' | 'active' | 'recovery', k: number, shape: Partial<PhaseShape> = {}): number {
  const m = clipMeta(clip);
  if (!m) return 0;
  const s = { ...DEFAULT_SHAPE, ...shape };
  const kk = Math.max(0, Math.min(1, k));
  const a0 = Math.max(0, m.peak - s.before);
  const start = Math.max(0, Math.min(a0, m.peak - s.lead));
  const a1 = Math.min(m.duration, m.peak + s.after);
  const end = Math.min(m.duration, a1 + s.tail);
  if (phase === 'windup') return start + (a0 - start) * kk;
  if (phase === 'active') return a0 + (a1 - a0) * kk;
  return a1 + (end - a1) * kk;
}

// ---------------------------------------------------------------------------------------------
// Body: one animated character instance
// ---------------------------------------------------------------------------------------------

interface Slot {
  action: THREE.AnimationAction;
  weight: number;
  target: number;
  fade: number;
  manual: boolean;
}

export class CharacterBody {
  /** Add this to the scene graph (feet at the origin, facing +Z, height in metres). */
  readonly root = new THREE.Group();
  /** Right-hand attachment in metres: a weapon's grip goes at the origin, blade along local -Y. */
  readonly rHand = new THREE.Group();
  readonly lHand = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly coreMaterial?: THREE.MeshStandardMaterial;
  readonly heightM: number;
  /** Metres per model unit. */
  readonly unit: number;
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly slots = new Map<string, Slot>();

  constructor(
    readonly id: CharacterId,
    heightM: number,
    readonly loco: LocoSet,
  ) {
    const t = library!.templates.get(id)!;
    this.heightM = heightM;
    this.unit = heightM / t.meta.heightCm;
    this.model = cloneSkinned(t.scene);
    this.model.scale.setScalar(this.unit);
    this.root.add(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const clone = (mat: THREE.Material) => {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        this.materials.push(c);
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    this.mixer = new THREE.AnimationMixer(this.model);

    // Hand attachments. The grip frame was measured from Maria's own sword prop and is shared by
    // every Mixamo rig (same hand-bone axes), scaled by hand size.
    const ref = library!.manifest.characters.maria;
    const hand = t.meta.hand ?? ref.hand;
    const rBone = this.model.getObjectByName('RightHand');
    const lBone = this.model.getObjectByName('LeftHand');
    if (rBone && hand) {
      const k = t.meta.handLenCm / ref.handLenCm;
      const y = new THREE.Vector3().fromArray(hand.dir).negate();
      const x = new THREE.Vector3().fromArray(hand.width);
      x.addScaledVector(y, -x.dot(y)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y).normalize();
      this.rHand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      this.rHand.position.fromArray(hand.grip).multiplyScalar(k);
      this.rHand.scale.setScalar(1 / this.unit);
      rBone.add(this.rHand);
    } else this.root.add(this.rHand);
    if (lBone) {
      this.lHand.scale.setScalar(1 / this.unit);
      lBone.add(this.lHand);
    } else this.root.add(this.lHand);
  }

  /** Native ground speed (m/s) of a locomotion clip on this character. */
  nativeSpeed(clip: string): number {
    const m = clipMeta(clip);
    const hipsM = (library!.templates.get(this.id)!.meta.hipsY ?? 100) * this.unit;
    return m ? Math.max(0.3, Math.hypot(m.travel[0], m.travel[1]) * hipsM) : 1;
  }

  private slot(clip: string): Slot | null {
    let s = this.slots.get(clip);
    if (!s) {
      const c = library!.clip(this.id, clip);
      if (!c) return null;
      const action = this.mixer.clipAction(c);
      action.setEffectiveWeight(0);
      action.play();
      s = { action, weight: 0, target: 0, fade: 0.15, manual: false };
      this.slots.set(clip, s);
    }
    return s;
  }

  private want(clip: string, weight: number, fade: number): Slot | null {
    const s = this.slot(clip);
    if (!s) return null;
    s.target = Math.max(s.target, weight);
    s.fade = fade;
    if (s.weight === 0 && weight > 0 && !s.action.isRunning()) s.action.play();
    return s;
  }

  update(dt: number, req: AnimRequest): void {
    for (const s of this.slots.values()) s.target = 0;
    if (req.kind === 'clip') {
      const s = this.want(req.clip, 1, req.fade ?? 0.08);
      if (s) {
        s.manual = true;
        s.action.timeScale = 0;
        s.action.time = Math.max(0, Math.min(s.action.getClip().duration - 1e-3, req.time));
      }
    } else if (req.kind === 'loop') {
      const s = this.want(req.clip, 1, req.fade ?? 0.18);
      if (s) {
        s.manual = false;
        s.action.timeScale = req.rate ?? 1;
      }
    } else {
      this.locomotion(req.speed, req.dirX ?? 0, req.dirZ ?? 1);
    }
    // Incoming clips fade in at their own rate, outgoing ones at the incoming rate; weights are
    // then normalised so the pose never blends toward the bind (T) pose mid-transition.
    const reqFade = req.kind === 'loco' ? 0.18 : (req.fade ?? (req.kind === 'clip' ? 0.08 : 0.18));
    let total = 0;
    for (const s of this.slots.values()) {
      const rate = dt / Math.max(0.01, s.target > 0 ? s.fade : reqFade);
      s.weight = s.target > s.weight ? Math.min(s.target, s.weight + rate) : Math.max(s.target, s.weight - rate);
      total += s.weight;
    }
    for (const s of this.slots.values()) {
      s.action.setEffectiveWeight(total > 0 ? s.weight / total : 0);
      if (s.weight === 0 && s.target === 0 && s.action.isRunning()) s.action.stop();
    }
    this.mixer.update(dt);
  }

  private locomotion(speed: number, dx: number, dz: number): void {
    const L = this.loco;
    const idle = Math.max(0, Math.min(1, 1 - speed / 0.9));
    this.want(L.idle, idle, 0.2)?.action.setEffectiveTimeScale(1);
    if (idle >= 1) return;
    const move = 1 - idle;
    const len = Math.hypot(dx, dz) || 1;
    const x = dx / len;
    const z = dz / len;
    let fw = Math.max(0, z);
    let bw = L.back ? Math.max(0, -z) : 0;
    let lw = L.left ? Math.max(0, x) : 0;
    let rw = L.right ? Math.max(0, -x) : 0;
    if (!L.back) fw += Math.max(0, -z); // no back clip: walk forward
    if (!L.left) fw += Math.max(0, x);
    if (!L.right) fw += Math.max(0, -x);
    const sum = fw + bw + lw + rw || 1;
    fw /= sum;
    bw /= sum;
    lw /= sum;
    rw /= sum;
    const scaled = (clip: string, w: number) => {
      if (w <= 0.001) return;
      const s = this.want(clip, w, 0.18);
      if (s) {
        s.manual = false;
        s.action.timeScale = Math.max(0.5, Math.min(1.8, speed / this.nativeSpeed(clip)));
      }
    };
    // Walk -> run blend for the forward direction.
    const walkTop = this.nativeSpeed(L.walk) * 1.3;
    const runFrom = this.nativeSpeed(L.run) * 0.7;
    const r = Math.max(0, Math.min(1, (speed - walkTop) / Math.max(0.3, runFrom - walkTop)));
    scaled(L.walk, move * fw * (1 - r));
    scaled(L.run, move * fw * r);
    if (L.back) scaled(L.back, move * bw);
    if (L.left) scaled(L.left, move * lw);
    if (L.right) scaled(L.right, move * rw);
  }

  setTint(color: THREE.Color | null, intensity = 0): void {
    for (const m of this.materials) {
      if (color) {
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      } else if (m.userData.baseEmissive !== undefined) {
        m.emissive.set(m.userData.baseEmissive as string);
        m.emissiveIntensity = m.userData.baseIntensity as number;
      }
    }
  }

  snapshotEmissive(): void {
    for (const m of this.materials) {
      m.userData.baseEmissive = '#' + m.emissive.getHexString();
      m.userData.baseIntensity = m.emissiveIntensity;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
  }
}

export function createBody(id: CharacterId, heightM: number, loco: LocoSet): CharacterBody | null {
  if (!library?.templates.has(id)) return null;
  const b = new CharacterBody(id, heightM, loco);
  b.snapshotEmissive();
  return b;
}
