/** NPCs and gatherable resource nodes. */
import * as THREE from 'three';
import { Rng, materialName, type MaterialId } from '@alloy/item-gen';
import type { NodeDef } from '@alloy/world';
import { terrainHeight } from '@alloy/world';
import { POSE_GUARD, Rig, locomotionPose, type RigStyle } from './Rig';

export class Npc {
  readonly rig: Rig;
  readonly object = new THREE.Group();
  private t = Math.random() * 10;
  constructor(
    readonly id: string,
    readonly name: string,
    pos: { x: number; z: number },
    yaw: number,
    style: RigStyle,
  ) {
    this.rig = new Rig(style);
    this.object.add(this.rig.root);
    this.object.position.set(pos.x, terrainHeight(pos.x, pos.z), pos.z);
    this.object.rotation.y = yaw;
  }
  get pos2() {
    return { x: this.object.position.x, z: this.object.position.z };
  }
  update(dt: number, lookAt: THREE.Vector3 | null): void {
    this.t += dt;
    const p = locomotionPose(0, 0, false);
    const breath = Math.sin(this.t * 1.4) * 0.04;
    this.rig.apply({ ...POSE_GUARD, ...p, rShoulder: [-0.1, 0, -0.1], rElbow: [-0.3, 0, 0], chest: [breath, 0, 0], head: lookAt ? [0, 0, 0] : [0, Math.sin(this.t * 0.4) * 0.4, 0] }, Math.min(1, dt * 4));
    if (lookAt) {
      const ty = Math.atan2(lookAt.x - this.object.position.x, lookAt.z - this.object.position.z);
      let d = ty - this.object.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.object.rotation.y += d * Math.min(1, dt * 3);
    }
  }
}

export interface NodeRuntime {
  charges: number;
  respawnAt: number;
}

export const NODE_MAX_CHARGES = 3;
export const NODE_RESPAWN_SECONDS = 120;

/** Procedural deposit traits from the node seed (GDD 4.10; stretch: one variable ore property). */
export function nodeTraits(def: NodeDef): { quality: number; rich: boolean; label: string; traits: Record<string, number> } {
  const rng = new Rng(`node:${def.id}`);
  const r = rng.next();
  const rich = rng.next() < 0.2;
  const quality = Math.round((rich ? 0.85 + r * 0.15 : 0.32 + r * 0.46) * 1000) / 1000;
  const traitName = def.material === 'iron_ore' ? 'purity' : def.material === 'ironglass' ? 'conductivity' : 'grain';
  const label = `${rich ? 'Rich ' : ''}${materialName(def.material)} · ${traitName} ${Math.round(quality * 100)}%`;
  return { quality, rich, label, traits: { [traitName]: quality } };
}

export function nodeYield(def: NodeDef, gatherIndex: number): number {
  return new Rng(`yield:${def.id}:${gatherIndex}`).int(1, 2);
}

const NODE_COLORS: Record<MaterialId, string> = {
  iron_ore: '#6b5f57',
  ironwood: '#3a2c22',
  ironglass: '#7fdcff',
  binding_flux: '#ccc',
};

export class ResourceNode {
  readonly object = new THREE.Group();
  readonly traits: ReturnType<typeof nodeTraits>;
  private parts: THREE.Mesh[] = [];
  private glowMat?: THREE.MeshStandardMaterial;

  constructor(readonly def: NodeDef) {
    this.traits = nodeTraits(def);
    const rng = new Rng(`nodevis:${def.id}`);
    if (def.material === 'iron_ore') {
      const rock = new THREE.MeshStandardMaterial({ color: NODE_COLORS.iron_ore, roughness: 0.9, flatShading: true });
      const vein = new THREE.MeshStandardMaterial({
        color: this.traits.rich ? '#bfe9ff' : '#b0702e',
        emissive: this.traits.rich ? '#45e0ff' : '#5a2a08',
        emissiveIntensity: this.traits.rich ? 0.9 : 0.25,
        metalness: 0.7,
        roughness: 0.4,
      });
      this.glowMat = vein;
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.45, 0.75), 0), i === 0 ? rock : rng.next() < 0.5 ? vein : rock);
        m.position.set(rng.range(-0.5, 0.5), 0.3, rng.range(-0.5, 0.5));
        m.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
        this.parts.push(m);
      }
      const nugget = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), vein);
      nugget.position.set(0, 0.75, 0.2);
      this.parts.push(nugget);
    } else if (def.material === 'ironwood') {
      const bark = new THREE.MeshStandardMaterial({ color: NODE_COLORS.ironwood, roughness: 0.9 });
      const vein = new THREE.MeshStandardMaterial({ color: '#8a5a2a', emissive: '#ff7a2e', emissiveIntensity: 0.35 });
      this.glowMat = vein;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 2.6, 8), bark);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rng.range(0, 3);
      log.position.y = 0.35;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10), vein);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(1.31, 0, 0);
      log.add(ring);
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.8, 8), bark);
      stump.position.set(0.9, 0.4, 0.8);
      this.parts.push(log, stump);
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: NODE_COLORS.ironglass,
        emissive: '#2ab8e8',
        emissiveIntensity: this.traits.rich ? 1.4 : 0.8,
        roughness: 0.15,
        metalness: 0.3,
        transparent: true,
        opacity: 0.9,
      });
      this.glowMat = mat;
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(rng.range(0.25, 0.5)), mat);
        c.scale.y = rng.range(2, 3.2);
        c.position.set(rng.range(-0.4, 0.4), 0.6, rng.range(-0.4, 0.4));
        c.rotation.set(rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(-0.4, 0.4));
        this.parts.push(c);
      }
    }
    for (const p of this.parts) {
      p.castShadow = true;
      this.object.add(p);
    }
    this.object.position.set(def.pos.x, terrainHeight(def.pos.x, def.pos.z), def.pos.z);
  }

  get pos2() {
    return this.def.pos;
  }

  setState(rt: NodeRuntime, t: number): void {
    const frac = rt.charges / NODE_MAX_CHARGES;
    const depleted = rt.charges <= 0;
    this.object.scale.setScalar(depleted ? 0.55 : 0.75 + 0.25 * frac);
    if (this.glowMat) this.glowMat.emissiveIntensity = depleted ? 0.05 : (this.traits.rich ? 1.2 : 0.5) + Math.sin(t * 2 + this.def.pos.x) * 0.15;
  }
}
