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
const NODE_MODELS: Record<MaterialId, { model: string; scale: number; y: number }> = {
  iron_ore: { model: 'iron_ore_node', scale: 1, y: -0.1 },
  ironwood: { model: 'ironwood_tree', scale: 1.15, y: 0 },
  ironglass: { model: 'ironglass_cluster', scale: 1, y: -0.1 },
  binding_flux: { model: 'iron_ore_node', scale: 1, y: -0.1 },
};

export class ResourceNode {
  readonly object = new THREE.Group();
  readonly traits: ReturnType<typeof nodeTraits>;
  /** Per-node copies of the model's glowing materials (veins, crystals) so each node pulses alone. */
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private readonly baseScale: number;

  constructor(readonly def: NodeDef) {
    this.traits = nodeTraits(def);
    const spec = NODE_MODELS[def.material];
    const model = gameModel(spec.model);
    for (const p of model?.parts ?? []) {
      let material = p.material;
      if (material.userData.baseGlow !== undefined) {
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
    this.baseScale = spec.scale * (def.scale ?? 1);
    const y = spec.y * (def.scale ?? 1);
    this.object.position.set(def.pos.x, terrainHeight(def.pos.x, def.pos.z) + y, def.pos.z);
    this.object.rotation.y = THREE.MathUtils.degToRad(def.yaw ?? new Rng(`nodevis:${def.id}`).range(0, 360));
    this.object.scale.setScalar(this.baseScale);
  }

  get pos2() {
    return this.def.pos;
  }

  setState(rt: NodeRuntime, t: number): void {
    const frac = rt.charges / NODE_MAX_CHARGES;
    const depleted = rt.charges <= 0;
    this.object.scale.setScalar(this.baseScale * (depleted ? 0.55 : 0.75 + 0.25 * frac));
    const pulse = 1 + Math.sin(t * 2 + this.def.pos.x) * 0.2;
    for (const m of this.glowMats) m.emissiveIntensity = depleted ? 0.05 : (m.userData.baseGlow as number) * modelGlow() * pulse;
  }
}
