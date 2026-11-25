/** NPCs and gatherable resource nodes. */
import * as THREE from 'three';
import { Rng, type MaterialId } from '@alloy/item-gen';
import type { NodeDef } from '@alloy/world';
import { terrainHeight } from '@alloy/world';
import { POSE_GUARD, Rig, locomotionPose, type RigStyle } from './Rig';
import { CharacterBody, createBody } from './models/Characters';
import { NPC_ANIMS } from './models/animSets';
import { gameModel, modelGlow } from '../world/WorkshopModels';

export class Npc {
  readonly body: Rig | CharacterBody;
  private readonly idleClip: string | null = null;
  readonly object = new THREE.Group();
  private t = Math.random() * 10;
  constructor(
    readonly id: string,
    readonly name: string,
    pos: { x: number; z: number },
    yaw: number,
    style: RigStyle,
  ) {
    const look = NPC_ANIMS[id];
    const model = look ? createBody(look.model, look.heightM, { idle: look.idle, walk: look.idle, run: look.idle }) : null;
    if (model && look) {
      this.body = model;
      this.idleClip = look.idle;
    } else this.body = new Rig(style);
    this.object.add(this.body.root);
    this.object.position.set(pos.x, terrainHeight(pos.x, pos.z), pos.z);
    this.object.rotation.y = yaw;
  }
  get pos2() {
    return { x: this.object.position.x, z: this.object.position.z };
  }
  /** Name label height above the feet (m). */
  get labelHeight(): number {
    return this.body instanceof CharacterBody ? this.body.heightM + 0.35 : 2.25;
  }
  update(dt: number, lookAt: THREE.Vector3 | null): void {
    this.t += dt;
    if (this.body instanceof CharacterBody) this.body.update(dt, { kind: 'loop', clip: this.idleClip! });
    else {
      const p = locomotionPose(0, 0, false);
      const breath = Math.sin(this.t * 1.4) * 0.04;
      this.body.apply({ ...POSE_GUARD, ...p, rShoulder: [-0.1, 0, -0.1], rElbow: [-0.3, 0, 0], chest: [breath, 0, 0], head: lookAt ? [0, 0, 0] : [0, Math.sin(this.t * 0.4) * 0.4, 0] }, Math.min(1, dt * 4));
    }
    if (lookAt) {
      const ty = Math.atan2(lookAt.x - this.object.position.x, lookAt.z - this.object.position.z);
      let d = ty - this.object.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.object.rotation.y += d * Math.min(1, dt * 3);
    }
  }
}

export { NODE_MAX_CHARGES, NODE_RESPAWN_SECONDS, nodeTraits, nodeYield, type NodeRuntime } from '@alloy/session';
import { NODE_MAX_CHARGES, nodeTraits, type NodeRuntime } from '@alloy/session';

/** Workshop model, size and ground offset per node material (matches the World view). */
const NODE_MODELS: Partial<Record<MaterialId, { model: string; scale: number; y: number }>> = {
  iron_ore: { model: 'iron_ore_node', scale: 1, y: -0.1 },
  ironwood: { model: 'ironwood_tree', scale: 1.15, y: 0 },
  ironglass: { model: 'ironglass_cluster', scale: 1, y: -0.1 },
  binding_flux: { model: 'iron_ore_node', scale: 1, y: -0.1 },
  emberleaf: { model: 'shrub', scale: 0.75, y: 0 },
};

/** One instance of an instanced scenery model (the grove trees are drawn with the scenery). */
export interface InstanceHandle {
  /** `local`: the model's own fit (an authored model scaled to the replaced one's size). */
  parts: Array<{ mesh: THREE.InstancedMesh; index: number; local?: THREE.Matrix4 }>;
  /** Bumped when the parts change (the scenery was swapped): poses are re-applied. */
  version?: number;
}

const TMP_M2 = new THREE.Matrix4();
const FALL_SECONDS = 1.1;
const SINK_SECONDS = 0.9;
const REGROW_SECONDS = 1.6;
const WOBBLE_SECONDS = 0.45;
const ORE_SCALE = (charges: number) => (charges <= 0 ? 0.45 : 0.55 + 0.45 * (charges / NODE_MAX_CHARGES));
let stumpGeo: THREE.CylinderGeometry | null = null;
let stumpMat: THREE.MeshStandardMaterial | null = null;

/**
 * A gatherable node and how it shows depletion:
 * - trees shake when chopped, fall over on the last chop, sink away leaving a stump, and grow
 *   back when they respawn;
 * - ore and crystal deposits shrink a step with every gather and go dark when depleted.
 * Grove trees have no meshes of their own: they move their instance in the scenery.
 */
export class ResourceNode {
  readonly object = new THREE.Group();
  readonly traits: ReturnType<typeof nodeTraits>;
  /** Per-node copies of the model's glowing materials (veins, crystals) so each node pulses alone. */
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private readonly baseScale: number;
  private readonly baseY: number;
  private readonly yawQ: THREE.Quaternion;
  private readonly fallAxis: THREE.Vector3;
  private readonly isTree: boolean;
  // Animation state
  private lastT = -1;
  private lastCharges = -1;
  private fall = 0; // 0..1 tipping over
  private sink = 0; // 0..1 sinking away after the fall
  private grow = 1; // 0..1 regrowing
  private wobble = 0; // seconds left of a chop shake
  private oreScale = 1;
  private stump: THREE.Mesh | null = null;
  private applied = '';

  constructor(
    readonly def: NodeDef,
    private readonly instance: InstanceHandle | null = null,
  ) {
    this.traits = nodeTraits(def);
    this.isTree = def.material === 'ironwood';
    const spec = NODE_MODELS[def.material] ?? NODE_MODELS.iron_ore!;
    if (!instance) {
      const model = gameModel(spec.model);
      for (const p of model?.parts ?? []) {
        let material = p.material;
        if (def.material === 'emberleaf') {
          // Emberleaf: a shrub whose leaves glow a warm ember orange.
          const m = (material as THREE.MeshStandardMaterial).clone();
          m.color.lerp(new THREE.Color('#d9822b'), 0.55);
          m.emissive = new THREE.Color('#ff7a2a');
          m.userData = { ...p.material.userData, baseGlow: 0.35 };
          material = m;
          this.glowMats.push(m);
        } else if (material.userData.baseGlow !== undefined) {
          material = material.clone();
          material.userData = { ...p.material.userData };
          if (this.traits.rich && def.material === 'iron_ore') {
            // Rich deposits show cold, bright Meridian veins instead of ember-orange ones.
            material.color.set('#bfe9ff');
            material.emissive.set('#45e0ff');
            material.userData.baseGlow = 1.2;
          } else if (this.traits.rich) material.userData.baseGlow *= 1.5;
          this.glowMats.push(material);
        }
        const mesh = new THREE.Mesh(p.geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.object.add(mesh);
      }
    }
    this.baseScale = spec.scale * (def.scale ?? 1);
    this.baseY = terrainHeight(def.pos.x, def.pos.z) + spec.y * (def.scale ?? 1);
    const rng = new Rng(`nodevis:${def.id}`);
    const yawDeg = def.yaw ?? rng.range(0, 360);
    this.yawQ = new THREE.Quaternion().setFromAxisAngle(UP, THREE.MathUtils.degToRad(yawDeg));
    const dir = rng.range(0, Math.PI * 2);
    this.fallAxis = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir));
    this.object.position.set(def.pos.x, this.baseY, def.pos.z);
    this.object.quaternion.copy(this.yawQ);
    this.object.scale.setScalar(this.baseScale);
  }

  get pos2() {
    return this.def.pos;
  }

  setState(rt: NodeRuntime, t: number): void {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const depleted = rt.charges <= 0;
    const first = this.lastCharges < 0;
    const chopped = !first && rt.charges < this.lastCharges;
    const regrown = !first && this.lastCharges <= 0 && rt.charges > 0;
    this.lastCharges = rt.charges;

    if (this.isTree) {
      if (first && depleted) {
        this.fall = 1;
        this.sink = 1; // loaded already felled: no animation
      }
      if (chopped && !depleted) this.wobble = WOBBLE_SECONDS;
      if (regrown) {
        this.fall = 0;
        this.sink = 0;
        this.grow = 0;
      }
      if (depleted) {
        if (this.fall < 1) this.fall = Math.min(1, this.fall + dt / FALL_SECONDS);
        else if (this.sink < 1) this.sink = Math.min(1, this.sink + dt / SINK_SECONDS);
      } else if (this.grow < 1) this.grow = Math.min(1, this.grow + dt / REGROW_SECONDS);
      this.wobble = Math.max(0, this.wobble - dt);
      this.showStump(depleted && this.fall >= 1);
      this.applyTree();
    } else {
      // Deposits shrink a step per gather (smoothly), with a little squash on each hit.
      if (chopped) this.wobble = WOBBLE_SECONDS * 0.6;
      this.wobble = Math.max(0, this.wobble - dt);
      const target = ORE_SCALE(rt.charges);
      this.oreScale = first ? target : this.oreScale + (target - this.oreScale) * Math.min(1, dt * 6);
      const squash = this.wobble > 0 ? 1 - 0.08 * Math.sin((this.wobble / (WOBBLE_SECONDS * 0.6)) * Math.PI) : 1;
      this.object.scale.set(this.baseScale * this.oreScale, this.baseScale * this.oreScale * squash, this.baseScale * this.oreScale);
      const pulse = 1 + Math.sin(t * 2 + this.def.pos.x) * 0.2;
      for (const m of this.glowMats) m.emissiveIntensity = depleted ? 0.05 : (m.userData.baseGlow as number) * modelGlow() * pulse;
    }
  }

  private applyTree(): void {
    // Tip over around the base: ease in, like a real fall.
    const fallAngle = (Math.PI / 2) * 0.95 * this.fall * this.fall;
    const shake = this.wobble > 0 ? Math.sin(this.wobble * 40) * 0.035 * (this.wobble / WOBBLE_SECONDS) : 0;
    const scale = this.baseScale * (this.sink >= 1 ? 0 : (1 - 0.6 * this.sink) * (0.15 + 0.85 * this.grow));
    const y = this.baseY - this.sink * 0.8;
    const key = `${fallAngle.toFixed(4)}|${shake.toFixed(4)}|${scale.toFixed(4)}|${y.toFixed(3)}|${this.instance?.version ?? 0}`;
    if (key === this.applied) return; // nothing changed: don't touch the GPU buffers
    this.applied = key;
    TMP_Q.setFromAxisAngle(this.fallAxis, fallAngle + shake).multiply(this.yawQ);
    if (this.instance) {
      TMP_M.compose(TMP_P.set(this.def.pos.x, y, this.def.pos.z), TMP_Q, TMP_S.setScalar(scale));
      for (const p of this.instance.parts) {
        p.mesh.setMatrixAt(p.index, p.local ? TMP_M2.multiplyMatrices(TMP_M, p.local) : TMP_M);
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    } else {
      this.object.position.y = y;
      this.object.quaternion.copy(TMP_Q);
      this.object.scale.setScalar(Math.max(1e-4, scale));
      this.object.visible = scale > 0;
    }
  }

  /** A stump marks a felled tree (its trunk still blocks movement until it grows back). */
  private showStump(on: boolean): void {
    if (on && !this.stump) {
      stumpGeo ??= new THREE.CylinderGeometry(0.32, 0.4, 0.45, 9);
      stumpMat ??= new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.95 });
      this.stump = new THREE.Mesh(stumpGeo, stumpMat);
      this.stump.position.set(this.def.pos.x, this.baseY + 0.2, this.def.pos.z);
      this.stump.scale.setScalar((this.def.scale ?? 1) * 1.1);
      this.stump.castShadow = true;
      this.stump.receiveShadow = true;
      (this.object.parent ?? this.object).add(this.stump);
    } else if (!on && this.stump) {
      this.stump.removeFromParent();
      this.stump = null;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP_Q = new THREE.Quaternion();
const TMP_M = new THREE.Matrix4();
const TMP_P = new THREE.Vector3();
const TMP_S = new THREE.Vector3();
