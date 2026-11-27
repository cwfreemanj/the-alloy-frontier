/**
 * Parameterised weapon meshes (GDD 6.12: modular meshes + material parameters
 * rather than a unique heavyweight mesh per item).
 */
import * as THREE from 'three';
import { gearLook, holdable } from './Gear';
import { getBlueprint, type ItemInstance, type Rarity } from '@alloy/item-gen';

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#b9b4aa',
  uncommon: '#6fd17a',
  rare: '#4fa8ff',
  epic: '#b57bff',
  legendary: '#ffb03a',
  mythic: '#ff5a7a',
};

export interface SwordVisual {
  group: THREE.Group;
  bladeMaterial: THREE.MeshStandardMaterial;
  /** Local-space point at the blade tip (for effects). */
  tip: THREE.Object3D;
  glow?: THREE.MeshStandardMaterial;
}

/** Sword attaches to a hand; the blade extends along local -Y. */
export function buildSword(item: ItemInstance | null): SwordVisual {
  const bp = getBlueprint(item?.blueprintId ?? 'worn_longsword')!;
  // Maces and other workshop-made weapons (forge expansion): their look loads on demand.
  if (bp.look && bp.family !== 'longsword') return buildWorkshopWeapon(bp.id, item?.result.rarity ?? 'common');
  const v = bp.visual;
  const spec = item?.forge.specialization ?? 'balanced';
  const width = spec === 'heavy' ? 0.085 : spec === 'agile' ? 0.05 : spec === 'keen' ? 0.06 : 0.065;
  const len = 0.95 * v.length;
  const g = new THREE.Group();
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: v.blade, metalness: 0.85, roughness: 0.3 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: v.edge, metalness: 0.9, roughness: 0.2 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(width, len, 0.018), bladeMaterial);
  blade.position.y = -0.13 - len / 2;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(width * 0.35, len * 0.98, 0.022), edgeMat);
  edge.position.copy(blade.position);
  const tipMesh = new THREE.Mesh(new THREE.ConeGeometry(width * 0.72, 0.14, 4), bladeMaterial);
  tipMesh.rotation.z = Math.PI;
  tipMesh.rotation.y = Math.PI / 4;
  tipMesh.scale.z = 0.25;
  tipMesh.position.y = -0.13 - len - 0.07;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(spec === 'heavy' ? 0.32 : 0.26, 0.04, 0.06), new THREE.MeshStandardMaterial({ color: v.guard, metalness: 0.6, roughness: 0.4 }));
  guard.position.y = -0.11;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.2, 6), new THREE.MeshStandardMaterial({ color: v.grip, roughness: 0.9 }));
  grip.position.y = 0;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), guard.material);
  pommel.position.y = 0.11;
  g.add(blade, edge, tipMesh, guard, grip, pommel);
  const tip = new THREE.Object3D();
  tip.position.y = -0.13 - len - 0.12;
  g.add(tip);

  let glow: THREE.MeshStandardMaterial | undefined;
  const hasArc = item?.result.imbuements.includes('storm_arc');
  if (v.glow || hasArc) {
    glow = new THREE.MeshStandardMaterial({ color: v.glow ?? '#45e0ff', emissive: v.glow ?? '#45e0ff', emissiveIntensity: hasArc ? 1.8 : 0.7 });
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(width * 0.18, len * 0.8, 0.024), glow);
    fuller.position.y = blade.position.y + 0.04;
    g.add(fuller);
  }
  // Rarity gem on the guard (readable without relying on colour alone: the inventory also names rarity).
  if (item && item.result.rarity !== 'common') {
    const c = RARITY_COLORS[item.result.rarity];
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.025), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 }));
    gem.position.set(0, -0.11, 0.035);
    g.add(gem);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group: g, bladeMaterial, tip, glow };
}

export function buildHatchet(): THREE.Group {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.62, 6), new THREE.MeshStandardMaterial({ color: '#4a3626' }));
  handle.position.y = -0.25;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.03), new THREE.MeshStandardMaterial({ color: '#6c6660', metalness: 0.7, roughness: 0.4 }));
  head.position.set(0.08, -0.5, 0);
  g.add(handle, head);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return g;
}

export function buildConstructArm(color: string, size = 1): THREE.Group {
  const g = new THREE.Group();
  const ram = new THREE.Mesh(new THREE.BoxGeometry(0.24 * size, 0.5 * size, 0.24 * size), new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.35 }));
  ram.position.y = -0.25 * size;
  g.add(ram);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return g;
}

export function buildShield(): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.07), new THREE.MeshStandardMaterial({ color: '#4c545c', metalness: 0.7, roughness: 0.35 }));
  s.position.set(0, -0.1, 0.12);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.09), new THREE.MeshStandardMaterial({ color: '#45e0ff', emissive: '#45e0ff', emissiveIntensity: 0.6 }));
  rim.position.set(0, 0.28, 0.12);
  g.add(s, rim);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return g;
}

/**
 * A weapon with a Model Workshop look (entities/Gear.ts): an empty hand frame at once, filled when
 * the look has been built. The tip starts at a typical one-handed reach and moves to the real one.
 */
function buildWorkshopWeapon(blueprintId: string, rarity: string): SwordVisual {
  const g = new THREE.Group();
  const tip = new THREE.Object3D();
  tip.position.y = -0.7;
  g.add(tip);
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: '#8f969c', metalness: 0.85, roughness: 0.3 });
  void gearLook(blueprintId, rarity).then((look) => {
    if (!look) return;
    const held = holdable(look);
    g.add(held.group);
    tip.position.y = -held.reach;
  });
  return { group: g, bladeMaterial, tip };
}
