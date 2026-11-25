/**
 * Chests and trail caches (searchable containers, @alloy/world CONTAINERS). Barrels are the
 * scene's own barrels_crates models, so only chests and caches get a model here. A container
 * this character has searched shows its lid open (code-built chest) or turns dark (the authored
 * chest, which loads in the background) until it refills.
 */
import * as THREE from 'three';
import { CONTAINERS, terrainHeight, type ContainerDef } from '@alloy/world';
import { authoredModel, authoredObject, fitScale } from './AuthoredModels';

interface Prop {
  def: ContainerDef;
  lid: THREE.Object3D;
  glint: THREE.Mesh | null;
  open: number;
  group: THREE.Group;
  /** The code-built chest's meshes (hidden once the authored chest loads). */
  pieces: THREE.Object3D[];
  /** The authored chest's own materials (darkened while searched). */
  mats: THREE.MeshStandardMaterial[];
  width: number;
}

function buildChest(kind: 'chest' | 'cache'): { group: THREE.Group; lid: THREE.Group; glint: THREE.Mesh | null; pieces: THREE.Object3D[]; width: number } {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: kind === 'cache' ? '#5a3e26' : '#6b4526', roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: '#3d3f44', metalness: 0.7, roughness: 0.45 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c08c3c', metalness: 0.85, roughness: 0.3, emissive: new THREE.Color('#4a2a08'), emissiveIntensity: 0.4 });
  const w = kind === 'cache' ? 0.7 : 0.85;
  const d = kind === 'cache' ? 0.45 : 0.5;
  const h = 0.4;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
  body.position.y = h / 2;
  g.add(body);
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, h + 0.01, d + 0.02), iron);
    band.position.set(x, h / 2, 0);
    g.add(band);
  }
  // Lid: hinged at the back edge.
  const lid = new THREE.Group();
  lid.position.set(0, h, -d / 2);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 12, 1, false, 0, Math.PI), wood);
  top.rotation.z = Math.PI / 2;
  top.rotation.y = Math.PI / 2;
  top.position.set(0, 0, d / 2);
  top.scale.set(1, 1, 0.55);
  lid.add(top);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.04), brass);
  lock.position.set(0, -0.02, d + 0.01);
  lid.add(lock);
  g.add(lid);
  const pieces = [...g.children];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  let glint: THREE.Mesh | null = null;
  if (kind === 'cache') {
    // Half-hidden: stones and a fallen branch around it, and a faint glint on the lock.
    const rock = new THREE.MeshStandardMaterial({ color: '#6d665c', roughness: 1 });
    for (const [x, z, r] of [[-0.55, 0.15, 0.22], [0.5, -0.2, 0.26], [0.15, 0.42, 0.16], [-0.3, -0.38, 0.18]] as const) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r), rock);
      m.position.set(x, r * 0.5, z);
      m.castShadow = true;
      g.add(m);
    }
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 1 }));
    branch.rotation.set(0, 0.6, Math.PI / 2 - 0.15);
    branch.position.set(0.05, 0.47, 0.05);
    g.add(branch);
    glint = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    glint.position.set(0, 0.42, d / 2 + 0.05);
    g.add(glint);
  }
  return { group: g, lid, glint, pieces, width: w };
}

export class ContainerProps {
  readonly group = new THREE.Group();
  private props: Prop[] = [];

  constructor() {
    for (const def of CONTAINERS) {
      if (def.kind === 'barrel') continue;
      const { group, lid, glint, pieces, width } = buildChest(def.kind);
      group.position.set(def.pos.x, terrainHeight(def.pos.x, def.pos.z) + def.floor, def.pos.z);
      group.rotation.y = (def.yaw * Math.PI) / 180;
      if (def.kind === 'cache') group.scale.setScalar(1.25);
      this.group.add(group);
      this.props.push({ def, lid, glint, open: 0, group, pieces, width, mats: [] });
    }
    void this.upgrade();
  }

  /** Swap the code-built chests for the authored chest model once it loads. */
  private async upgrade(): Promise<void> {
    const m = await authoredModel('chest');
    if (!m) return;
    for (const p of this.props) {
      const o = authoredObject(m);
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = mat;
        p.mats.push(mat);
      });
      o.scale.setScalar(fitScale(m, p.width * 1.1, 'x'));
      p.group.add(o);
      for (const piece of p.pieces) piece.visible = false;
    }
  }

  /** `searched(id)`: whether this character's copy is emptied (lid open, no glint). */
  update(dt: number, time: number, searched: (id: string) => boolean): void {
    for (const p of this.props) {
      const target = searched(p.def.id) ? 1 : 0;
      p.open += (target - p.open) * Math.min(1, dt * 6);
      p.lid.rotation.x = -p.open * 1.9;
      for (const m of p.mats) m.color.setScalar(1 - 0.45 * p.open);
      if (p.glint) {
        p.glint.visible = target === 0;
        const k = Math.max(0, Math.sin(time * 2.2 + p.def.pos.x));
        p.glint.scale.setScalar(0.4 + k * k * 1.4);
      }
    }
  }
}
