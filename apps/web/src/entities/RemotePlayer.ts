/**
 * Another player in a co-op session: same procedural rig as the local player, a different
 * colour scheme, driven by interpolated network state (~100 ms behind real time).
 */
import * as THREE from 'three';
import type { AvatarState } from '@alloy/protocol';
import type { ItemInstance } from '@alloy/item-gen';
import { ATTACK_POSES, POSE_BLOCK, POSE_DEAD, POSE_DODGE, POSE_GATHER, POSE_GUARD, POSE_STAGGER, Rig, easeIn, easeOut, locomotionPose, mixPose, type Pose } from './Rig';
import { buildSword, type SwordVisual } from './Weapons';

const PALETTES = [
  { body: '#5a3a52', armor: '#7a6a5a', accent: '#ffb03a' },
  { body: '#2f5a3a', armor: '#6a7068', accent: '#9aff6a' },
  { body: '#5a4a2a', armor: '#7a7672', accent: '#ff6aa8' },
  { body: '#2a4a6a', armor: '#7a7e86', accent: '#ffe06a' },
];

interface Sample {
  t: number;
  s: AvatarState;
}

const INTERP_DELAY = 110; // ms

export class RemotePlayer {
  readonly rig: Rig;
  readonly object = new THREE.Group();
  readonly position = new THREE.Vector3();
  yaw = 0;
  state: AvatarState | null = null;
  private buffer: Sample[] = [];
  private sword: SwordVisual;
  private swordKey = '';
  private walkPhase = 0;
  private lastPhase = '';
  private lastAtk: string | null = null;
  /** Set when the remote starts an attack's active window (for slash effects). */
  onActive: ((atk: string) => void) | null = null;

  constructor(
    readonly id: string,
    public name: string,
    index: number,
  ) {
    const p = PALETTES[index % PALETTES.length];
    this.rig = new Rig({ kind: 'organic', skin: '#c49478', body: p.body, armor: p.armor, legs: '#2e2a26', boots: '#241c16', accent: p.accent, scale: 1 });
    this.rig.snapshotEmissive();
    this.object.add(this.rig.root);
    this.sword = buildSword(null);
    this.rig.rHand.add(this.sword.group);
    this.object.visible = false;
  }

  get pos2() {
    return { x: this.position.x, z: this.position.z };
  }

  get alive(): boolean {
    return !!this.state && this.state.ph !== 'dead' && this.state.hp > 0;
  }

  push(s: AvatarState, now: number): void {
    // Snap on big jumps (respawn, fast travel) instead of sliding across the map.
    const last = this.buffer[this.buffer.length - 1];
    if (last && Math.hypot(last.s.x - s.x, last.s.z - s.z) > 12) this.buffer = [];
    this.buffer.push({ t: now, s });
    if (this.buffer.length > 30) this.buffer.shift();
    if (!this.state) {
      this.position.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
    }
    this.state = s;
    this.object.visible = true;
  }

  update(dt: number, now: number): void {
    if (!this.state) return;
    const rt = now - INTERP_DELAY;
    const b = this.buffer;
    let target = b[b.length - 1].s;
    let tx = target.x,
      ty = target.y,
      tz = target.z,
      tyaw = target.yaw;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= rt && b[i].t >= rt) {
        const a = b[i - 1],
          c = b[i];
        const k = (rt - a.t) / Math.max(1, c.t - a.t);
        tx = a.s.x + (c.s.x - a.s.x) * k;
        ty = a.s.y + (c.s.y - a.s.y) * k;
        tz = a.s.z + (c.s.z - a.s.z) * k;
        const dy = Math.atan2(Math.sin(c.s.yaw - a.s.yaw), Math.cos(c.s.yaw - a.s.yaw));
        tyaw = a.s.yaw + dy * k;
        target = k < 0.5 ? a.s : c.s;
        break;
      }
    }
    const f = Math.min(1, dt * 18);
    this.position.x += (tx - this.position.x) * f;
    this.position.y += (ty - this.position.y) * f;
    this.position.z += (tz - this.position.z) * f;
    this.yaw += Math.atan2(Math.sin(tyaw - this.yaw), Math.cos(tyaw - this.yaw)) * f;
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;

    const s = this.state;
    if (s.ph === 'active' && (this.lastPhase !== 'active' || this.lastAtk !== s.atk) && s.atk) this.onActive?.(s.atk);
    this.lastPhase = s.ph;
    this.lastAtk = s.atk;
    this.updateSword(s);
    this.animate(dt, s, target.spd);
  }

  private updateSword(s: AvatarState): void {
    const key = s.wpn ? `${s.wpn.bp}|${s.wpn.spec}|${s.wpn.imb}|${s.wpn.rar}` : '';
    if (key === this.swordKey) return;
    this.swordKey = key;
    this.rig.rHand.remove(this.sword.group);
    const look = s.wpn
      ? ({ blueprintId: s.wpn.bp, forge: { specialization: s.wpn.spec }, result: { imbuements: s.wpn.imb ? ['storm_arc'] : [], rarity: s.wpn.rar } } as unknown as ItemInstance)
      : null;
    this.sword = buildSword(look);
    this.rig.rHand.add(this.sword.group);
  }

  private animate(dt: number, s: AvatarState, spd: number): void {
    let pose: Pose;
    let blend = Math.min(1, dt * 16);
    const k = Math.max(0, Math.min(1, s.pr));
    if (s.ph === 'dead') {
      pose = POSE_DEAD;
      blend = Math.min(1, dt * 6);
    } else if (s.ph === 'gather') {
      pose = { ...POSE_GATHER, rShoulder: [-1.6 + Math.sin(performance.now() / 70) * 0.5, 0, -0.2] };
    } else if (s.ph === 'dodge') {
      pose = POSE_DODGE;
      blend = Math.min(1, dt * 22);
    } else if (s.ph === 'stagger') {
      pose = POSE_STAGGER;
    } else if ((s.ph === 'windup' || s.ph === 'active' || s.ph === 'recovery') && s.atk) {
      const [w, sw] = ATTACK_POSES[s.atk] ?? ATTACK_POSES.light1;
      pose = s.ph === 'windup' ? mixPose(POSE_GUARD, w, easeOut(k)) : s.ph === 'active' ? mixPose(w, sw, easeOut(k)) : mixPose(sw, POSE_GUARD, easeIn(k));
      blend = s.ph === 'active' ? 1 : Math.min(1, dt * 30);
    } else if (s.ph === 'block') {
      pose = POSE_BLOCK;
    } else {
      const running = spd > 6;
      this.walkPhase += dt * (running ? 11 : 8.5) * Math.min(1, spd / 4.6 + 0.2);
      pose = { ...POSE_GUARD, ...locomotionPose(this.walkPhase, spd > 0.3 ? Math.min(1.2, spd / 4.6) : 0, running) };
      if (running) pose.rShoulder = [0.35, 0, -0.2];
      if (s.ph === 'air') pose = { ...pose, lKnee: [0.9, 0, 0], rKnee: [0.4, 0, 0], lHip: [-0.6, 0, 0] };
    }
    this.rig.apply(pose, blend);
    if (this.sword.glow) this.sword.glow.emissiveIntensity = 1.2 + Math.sin(performance.now() / 160) * 0.4;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.object);
  }
}
