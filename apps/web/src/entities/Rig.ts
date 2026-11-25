/**
 * Procedural humanoid/construct rig with pose blending. Stands in for a skinned
 * glTF character until art is produced (asset pipeline: GDD 6.13).
 * The model faces +Z; the character's right side is -X.
 */
import * as THREE from 'three';

export type Joint =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'lShoulder'
  | 'lElbow'
  | 'rShoulder'
  | 'rElbow'
  | 'rWrist'
  | 'lHip'
  | 'lKnee'
  | 'rHip'
  | 'rKnee';

export type Euler3 = [number, number, number];
export type Pose = Partial<Record<Joint, Euler3>> & { hipsY?: number };

export interface RigStyle {
  kind: 'organic' | 'construct';
  skin: string;
  body: string;
  armor: string;
  legs: string;
  boots: string;
  accent: string;
  /** Emissive core colour for constructs. */
  core?: string;
  scale: number;
  bulk?: number;
}

const JOINTS: Joint[] = ['hips', 'spine', 'chest', 'head', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'rWrist', 'lHip', 'lKnee', 'rHip', 'rKnee'];

export class Rig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<Joint, THREE.Group>;
  readonly rHand: THREE.Group;
  readonly lHand: THREE.Group;
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly coreMaterial?: THREE.MeshStandardMaterial;
  private current: Record<Joint, Euler3>;
  private currentHipsY = 0;
  readonly baseHipsY: number;

  constructor(style: RigStyle) {
    const m = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const mm = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...opts });
      this.materials.push(mm);
      return mm;
    };
    const construct = style.kind === 'construct';
    const bulk = style.bulk ?? 1;
    const skin = m(style.skin, construct ? { metalness: 0.6, roughness: 0.45 } : {});
    const body = m(style.body, construct ? { metalness: 0.55, roughness: 0.5 } : {});
    const armor = m(style.armor, { metalness: 0.6, roughness: 0.4 });
    const legs = m(style.legs, construct ? { metalness: 0.5 } : {});
    const boots = m(style.boots);
    const accent = m(style.accent, { emissive: construct ? style.accent : '#000000', emissiveIntensity: construct ? 0.8 : 0 });
    if (style.core) {
      this.coreMaterial = m(style.core, { emissive: style.core, emissiveIntensity: 1.4 });
    }

    const limb = (len: number, r: number, mat: THREE.Material) => {
      const g = construct ? new THREE.BoxGeometry(r * 2.1, len, r * 2.1) : new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 8);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.y = -len / 2;
      mesh.castShadow = true;
      return mesh;
    };
    const mk = (name: Joint, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      this.joints[name] = g;
      return g;
    };

    this.baseHipsY = 0.95;
    const hips = mk('hips', this.root, 0, this.baseHipsY, 0);
    const pelvis = new THREE.Mesh(construct ? new THREE.BoxGeometry(0.42 * bulk, 0.2, 0.26 * bulk) : new THREE.CapsuleGeometry(0.15 * bulk, 0.12, 4, 8), legs);
    if (!construct) pelvis.rotation.z = Math.PI / 2;
    pelvis.castShadow = true;
    hips.add(pelvis);

    const spine = mk('spine', hips, 0, 0.06, 0);
    const torso = new THREE.Mesh(
      construct ? new THREE.BoxGeometry(0.5 * bulk, 0.42, 0.32 * bulk) : new THREE.CapsuleGeometry(0.17 * bulk, 0.22, 4, 10),
      body,
    );
    torso.position.y = 0.2;
    torso.castShadow = true;
    spine.add(torso);
    const chest = mk('chest', spine, 0, 0.3, 0);
    const chestMesh = new THREE.Mesh(construct ? new THREE.BoxGeometry(0.62 * bulk, 0.34, 0.4 * bulk) : new THREE.CapsuleGeometry(0.2 * bulk, 0.12, 4, 10), armor);
    chestMesh.position.y = 0.08;
    if (!construct) chestMesh.rotation.z = Math.PI / 2;
    chestMesh.castShadow = true;
    chest.add(chestMesh);
    if (this.coreMaterial) {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 * bulk, 0), this.coreMaterial);
      core.position.set(0, 0.06, 0.2 * bulk);
      chest.add(core);
    } else {
      // Fantasy-tech accent: a small cyan clasp.
      const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), accent);
      clasp.position.set(0, 0.12, 0.21 * bulk);
      chest.add(clasp);
    }
    const head = mk('head', chest, 0, 0.32, 0);
    const headMesh = new THREE.Mesh(construct ? new THREE.BoxGeometry(0.26, 0.24, 0.26) : new THREE.SphereGeometry(0.115, 12, 10), construct ? armor : skin);
    headMesh.position.y = 0.06;
    headMesh.castShadow = true;
    head.add(headMesh);
    if (construct) {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.02), accent);
      visor.position.set(0, 0.08, 0.135);
      head.add(visor);
    } else {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(style.legs));
      hair.position.y = 0.075;
      head.add(hair);
    }

    const shoulderX = (construct ? 0.36 : 0.23) * bulk;
    const armR = (construct ? 0.085 : 0.055) * bulk;
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? shoulderX : -shoulderX;
      const sh = mk(`${side}Shoulder` as Joint, chest, sx, 0.15, 0);
      const pad = new THREE.Mesh(construct ? new THREE.BoxGeometry(0.24 * bulk, 0.16, 0.24 * bulk) : new THREE.SphereGeometry(0.075 * bulk, 8, 6), armor);
      pad.castShadow = true;
      sh.add(pad);
      sh.add(limb(0.3, armR, body));
      const el = mk(`${side}Elbow` as Joint, sh, 0, -0.3, 0);
      el.add(limb(0.27, armR * 0.9, construct ? body : skin));
      const hand = new THREE.Group();
      hand.position.y = -0.28;
      if (side === 'r') {
        const wrist = mk('rWrist', el, 0, -0.28, 0);
        hand.position.y = 0;
        wrist.add(hand);
      } else {
        el.add(hand);
      }
      const fist = new THREE.Mesh(construct ? new THREE.BoxGeometry(0.14, 0.14, 0.14) : new THREE.SphereGeometry(0.05, 8, 6), construct ? armor : skin);
      hand.add(fist);
      if (side === 'r') this.rHand = hand;
      else this.lHand = hand;
    }

    const hipX = 0.1 * bulk;
    const legR = (construct ? 0.1 : 0.068) * bulk;
    for (const side of ['l', 'r'] as const) {
      const hx = side === 'l' ? hipX : -hipX;
      const hp = mk(`${side}Hip` as Joint, hips, hx, -0.05, 0);
      hp.add(limb(0.44, legR, legs));
      const kn = mk(`${side}Knee` as Joint, hp, 0, -0.44, 0);
      kn.add(limb(0.42, legR * 0.9, legs));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12 * bulk, 0.08, 0.24 * bulk), boots);
      foot.position.set(0, -0.44, 0.05);
      foot.castShadow = true;
      kn.add(foot);
    }

    this.rHand ??= new THREE.Group();
    this.lHand ??= new THREE.Group();
    this.root.scale.setScalar(style.scale);
    this.current = Object.fromEntries(JOINTS.map((j) => [j, [0, 0, 0] as Euler3])) as Record<Joint, Euler3>;
  }

  /** Blend toward a target pose; `k` is the per-frame blend factor (0..1). */
  apply(target: Pose, k: number): void {
    for (const j of JOINTS) {
      const t = target[j] ?? [0, 0, 0];
      const c = this.current[j];
      c[0] += (t[0] - c[0]) * k;
      c[1] += (t[1] - c[1]) * k;
      c[2] += (t[2] - c[2]) * k;
      this.joints[j].rotation.set(c[0], c[1], c[2]);
    }
    this.currentHipsY += ((target.hipsY ?? 0) - this.currentHipsY) * k;
    this.joints.hips.position.y = this.baseHipsY + this.currentHipsY;
  }

  setTint(color: THREE.Color | null, intensity = 0): void {
    for (const m of this.materials) {
      if (m === this.coreMaterial) continue;
      if (color) {
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      } else if (m.userData.baseEmissive !== undefined) {
        m.emissive.set(m.userData.baseEmissive);
        m.emissiveIntensity = m.userData.baseIntensity;
      }
    }
  }

  /** Remember base emissive so flashes can be undone. */
  snapshotEmissive(): void {
    for (const m of this.materials) {
      m.userData.baseEmissive = '#' + m.emissive.getHexString();
      m.userData.baseIntensity = m.emissiveIntensity;
    }
  }
}

// ---------- Pose library ----------
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  for (const j of JOINTS) {
    const pa = a[j] ?? [0, 0, 0];
    const pb = b[j] ?? [0, 0, 0];
    out[j] = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t), lerp(pa[2], pb[2], t)];
  }
  out.hipsY = lerp(a.hipsY ?? 0, b.hipsY ?? 0, t);
  return out;
}

export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeIn = (t: number) => t * t;

/** Sword-ready stance: forearm forward, blade angled up. */
export const POSE_GUARD: Pose = {
  rShoulder: [-0.35, 0, -0.15],
  rElbow: [-1.15, 0, 0],
  rWrist: [0.45, 0, 0],
  lShoulder: [-0.2, 0, 0.15],
  lElbow: [-0.5, 0, 0],
  spine: [0.04, 0, 0],
};

export const POSE_BLOCK: Pose = {
  rShoulder: [-1.25, 0.4, -0.2],
  rElbow: [-1.1, 0, 0],
  rWrist: [0.2, 0, 1.2],
  lShoulder: [-1.1, 0, 0.4],
  lElbow: [-1.3, 0, 0],
  spine: [0.12, 0, 0],
  chest: [0, -0.15, 0],
  lHip: [-0.25, 0, 0],
  lKnee: [0.35, 0, 0],
  rHip: [0.15, 0, 0],
  rKnee: [0.2, 0, 0],
  hipsY: -0.06,
};

/** Locomotion overlay (legs + arm counter-swing). */
export function locomotionPose(phase: number, amount: number, running: boolean): Pose {
  const A = (running ? 0.85 : 0.55) * amount;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    lHip: [-s * A, 0, 0],
    rHip: [s * A, 0, 0],
    lKnee: [Math.max(0, s) * A * 1.4 + 0.05, 0, 0],
    rKnee: [Math.max(0, -s) * A * 1.4 + 0.05, 0, 0],
    lShoulder: [s * A * 0.6 - 0.15, 0, 0.12],
    lElbow: [-0.35 - (running ? 0.6 : 0.2) * amount, 0, 0],
    spine: [running ? 0.18 * amount : 0.05, 0, 0],
    hipsY: -Math.abs(c) * 0.05 * amount - (running ? 0.03 : 0),
  };
}

/** Player attack keyframes: [windup pose, strike-end pose]. */
export const ATTACK_POSES: Record<string, [Pose, Pose]> = {
  light1: [
    { chest: [0, -0.8, 0], rShoulder: [-1.3, 0, -1.2], rElbow: [-0.6, 0, 0], rWrist: [0.2, 0, 0], lShoulder: [-0.4, 0, 0.3], spine: [0.08, 0, 0] },
    { chest: [0, 0.75, 0], rShoulder: [-1.45, 0, 0.6], rElbow: [-0.15, 0, 0], rWrist: [0.1, 0, 0], lShoulder: [0.2, 0, 0.5], spine: [0.15, 0, 0], lHip: [-0.4, 0, 0], lKnee: [0.4, 0, 0] },
  ],
  light2: [
    { chest: [0, 0.75, 0], rShoulder: [-1.5, 0, 0.7], rElbow: [-0.5, 0, 0], rWrist: [0.1, 0, 0], spine: [0.08, 0, 0] },
    { chest: [0, -0.8, 0], rShoulder: [-1.4, 0, -1.25], rElbow: [-0.1, 0, 0], rWrist: [0.15, 0, 0], spine: [0.15, 0, 0], rHip: [-0.4, 0, 0], rKnee: [0.4, 0, 0] },
  ],
  light3: [
    { chest: [-0.15, -0.3, 0], rShoulder: [-2.7, 0, -0.3], rElbow: [-0.7, 0, 0], rWrist: [0.4, 0, 0], lShoulder: [-1.2, 0, 0.3], spine: [-0.15, 0, 0] },
    { chest: [0.25, 0.25, 0], rShoulder: [-0.75, 0, 0.05], rElbow: [-0.1, 0, 0], rWrist: [0.2, 0, 0], lShoulder: [-0.3, 0, 0.3], spine: [0.35, 0, 0], lHip: [-0.6, 0, 0], lKnee: [0.6, 0, 0], hipsY: -0.12 },
  ],
  heavy: [
    { chest: [-0.2, -0.9, 0], rShoulder: [-2.9, 0, -0.6], rElbow: [-0.9, 0, 0], rWrist: [0.6, 0, 0], lShoulder: [-2.6, 0, -0.4], lElbow: [-0.9, 0, 0], spine: [-0.2, 0, 0], rHip: [-0.3, 0, 0], rKnee: [0.4, 0, 0], hipsY: -0.08 },
    { chest: [0.3, 0.5, 0], rShoulder: [-0.6, 0, 0.3], rElbow: [-0.1, 0, 0], rWrist: [0.2, 0, 0], lShoulder: [-0.7, 0, 0.6], spine: [0.45, 0, 0], lHip: [-0.7, 0, 0], lKnee: [0.8, 0, 0], hipsY: -0.18 },
  ],
  guardbreaker: [
    { chest: [0, -1.2, 0], rShoulder: [-0.4, 0, -0.6], rElbow: [-1.6, 0, 0], rWrist: [0.2, 0, 0], lShoulder: [-1.3, 0, 0.3], lElbow: [-0.8, 0, 0], spine: [0.1, 0, 0], rHip: [0.3, 0, 0], hipsY: -0.1 },
    { chest: [0.1, 0.25, 0], rShoulder: [-1.55, 0, 0.1], rElbow: [0, 0, 0], rWrist: [0.05, 0, 0], lShoulder: [0.4, 0, 0.4], spine: [0.3, 0, 0], lHip: [-0.9, 0, 0], lKnee: [0.6, 0, 0], rHip: [0.5, 0, 0], hipsY: -0.15 },
  ],
  storm_arc: [
    { chest: [0, -0.4, 0], rShoulder: [-2.9, 0, -0.2], rElbow: [-0.2, 0, 0], rWrist: [0, 0, 0], lShoulder: [-2.6, 0, 0.3], spine: [-0.15, 0, 0], hipsY: 0.04 },
    { chest: [0.3, 0, 0], rShoulder: [-0.4, 0, -0.2], rElbow: [-0.2, 0, 0], rWrist: [1.4, 0, 0], lShoulder: [-0.3, 0, 0.6], spine: [0.5, 0, 0], lHip: [-0.5, 0, 0], lKnee: [1.0, 0, 0], rHip: [0.4, 0, 0], rKnee: [0.8, 0, 0], hipsY: -0.3 },
  ],
};

// Skills borrow the closest existing poses (procedural rig fallback).
ATTACK_POSES.lunging_thrust = ATTACK_POSES.light3;
ATTACK_POSES.final_slash = ATTACK_POSES.heavy;

export const POSE_DODGE: Pose = {
  spine: [0.6, 0, 0],
  chest: [0.3, 0, 0],
  head: [0.2, 0, 0],
  lHip: [-1.2, 0, 0],
  lKnee: [1.6, 0, 0],
  rHip: [-0.6, 0, 0],
  rKnee: [1.8, 0, 0],
  rShoulder: [-0.6, 0, -0.2],
  rElbow: [-1.2, 0, 0],
  lShoulder: [-0.8, 0, 0.3],
  lElbow: [-1.2, 0, 0],
  hipsY: -0.42,
};

export const POSE_STAGGER: Pose = {
  spine: [-0.35, 0, 0.1],
  chest: [-0.2, 0.2, 0],
  head: [-0.3, 0, 0],
  rShoulder: [-0.2, 0, -0.7],
  lShoulder: [-0.2, 0, 0.7],
  lHip: [0.3, 0, 0],
  rHip: [-0.2, 0, 0],
  rKnee: [0.4, 0, 0],
  hipsY: -0.05,
};

export const POSE_DEAD: Pose = {
  spine: [-1.2, 0, 0],
  head: [-0.3, 0, 0],
  rShoulder: [-2.6, 0, -0.4],
  lShoulder: [-2.6, 0, 0.4],
  lHip: [-1.4, 0, 0.1],
  rHip: [-1.4, 0, -0.1],
  lKnee: [0.2, 0, 0],
  rKnee: [0.2, 0, 0],
  hipsY: -0.75,
};

export const POSE_GATHER: Pose = {
  spine: [0.7, 0, 0],
  chest: [0.2, 0, 0],
  rShoulder: [-1.6, 0, -0.2],
  rElbow: [-0.6, 0, 0],
  lShoulder: [-1.2, 0, 0.3],
  lElbow: [-0.5, 0, 0],
  lHip: [-1.1, 0, 0],
  lKnee: [1.6, 0, 0],
  rHip: [-0.3, 0, 0],
  rKnee: [1.3, 0, 0],
  hipsY: -0.38,
};

/** Generic enemy windup/strike poses, keyed by attack shape. */
export const ENEMY_POSES = {
  overhead: [
    { rShoulder: [-2.9, 0, -0.2], rElbow: [-0.6, 0, 0], lShoulder: [-2.6, 0, 0.2], lElbow: [-0.6, 0, 0], spine: [-0.25, 0, 0], hipsY: 0.02 },
    { rShoulder: [-0.5, 0, 0], rElbow: [-0.1, 0, 0], lShoulder: [-0.5, 0, 0], spine: [0.55, 0, 0], lHip: [-0.6, 0, 0], lKnee: [0.6, 0, 0], hipsY: -0.2 },
  ] as [Pose, Pose],
  sweep: [
    { chest: [0, -1.1, 0], rShoulder: [-1.4, 0, -1.3], rElbow: [-0.3, 0, 0], lShoulder: [-0.4, 0, 0.4], spine: [0.1, 0, 0] },
    { chest: [0, 1.0, 0], rShoulder: [-1.5, 0, 0.8], rElbow: [-0.1, 0, 0], lShoulder: [0.3, 0, 0.6], spine: [0.2, 0, 0], rHip: [-0.4, 0, 0], rKnee: [0.4, 0, 0] },
  ] as [Pose, Pose],
  thrust: [
    { chest: [0, -0.6, 0], rShoulder: [-0.6, 0, -0.4], rElbow: [-1.9, 0, 0], lShoulder: [-1.0, 0, 0.3], spine: [-0.1, 0, 0], rHip: [0.4, 0, 0], lKnee: [0.4, 0, 0] },
    { chest: [0.15, 0.3, 0], rShoulder: [-1.6, 0, 0], rElbow: [0, 0, 0], lShoulder: [0.4, 0, 0.3], spine: [0.35, 0, 0], lHip: [-0.9, 0, 0], lKnee: [0.6, 0, 0], rHip: [0.6, 0, 0] },
  ] as [Pose, Pose],
  guard: { lShoulder: [-1.5, 0.6, 0.6], lElbow: [-1.4, 0, 0], rShoulder: [-0.6, 0, -0.2], rElbow: [-1.0, 0, 0], spine: [0.15, 0, 0], hipsY: -0.08 } as Pose,
};
