/**
 * Another player in a co-op session: same procedural rig as the local player, a different
 * colour scheme, driven by interpolated network state (~100 ms behind real time).
 */
import * as THREE from 'three';
import type { AvatarState } from '@alloy/protocol';
import type { ItemInstance } from '@alloy/item-gen';
import { ATTACK_POSES, POSE_BLOCK, POSE_DEAD, POSE_DODGE, POSE_GATHER, POSE_GUARD, POSE_STAGGER, Rig, easeIn, easeOut, locomotionPose, mixPose, type Pose } from './Rig';
import { buildSword, buildWorkshopWeapon, type SwordVisual } from './Weapons';
import { GearRack, lookFromNet, wornFromNet } from './Gear';
import { makePlayerBody, playerAnimRequest } from './Player';
import { CharacterBody, DEFAULT_PLAYER_CHARACTER, isPlayerCharacter, type PlayerCharacterId } from './models/Characters';

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
  body: Rig | CharacterBody;
  private character: PlayerCharacterId = DEFAULT_PLAYER_CHARACTER;
  private readonly palette: { body: string; armor: string; accent: string };
  readonly object = new THREE.Group();
  private deadTime = 0;
  private gatherTime = 0;
  private airTime = 0;
  private moveLocal = { x: 0, z: 1 };
  private lastPos = new THREE.Vector3();
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
    this.palette = PALETTES[index % PALETTES.length];
    this.body = makePlayerBody(this.character, this.palette);
    this.object.add(this.body.root);
    this.sword = buildSword(null);
    this.body.rHand.add(this.sword.group);
    this.object.visible = false;
  }

  /** Other players appear as the character they picked. */
  private setCharacter(id: PlayerCharacterId): void {
    if (id === this.character) return;
    this.character = id;
    this.body.rHand.remove(this.sword.group);
    if (this.body instanceof CharacterBody) this.body.dispose();
    else this.object.remove(this.body.root);
    this.body = makePlayerBody(id, this.palette);
    this.object.add(this.body.root);
    this.body.rHand.add(this.sword.group);
    this.gearRack.refresh();
  }

  /** Their shield and helmet (forge expansion). */
  private readonly gearRack = new GearRack(() => this.body);

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
    const want = isPlayerCharacter(s.mdl) ? s.mdl : DEFAULT_PLAYER_CHARACTER;
    if (want !== this.character) this.setCharacter(want);
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
    this.gearRack.set(wornFromNet(s.gr));
    this.animate(dt, s, target.spd);
  }

  private updateSword(s: AvatarState): void {
    const key = s.wpn ? `${s.wpn.bp}|${s.wpn.spec}|${s.wpn.imb}|${s.wpn.rar}|${s.wpn.lk ?? ''}` : '';
    if (key === this.swordKey) return;
    this.swordKey = key;
    this.body.rHand.remove(this.sword.group);
    const look = s.wpn
      ? ({ blueprintId: s.wpn.bp, forge: { specialization: s.wpn.spec }, result: { imbuements: s.wpn.imb ? ['storm_arc'] : [], rarity: s.wpn.rar } } as unknown as ItemInstance)
      : null;
    // A found weapon: its look comes with it (this browser doesn't have its blueprint).
    const found = s.wpn?.lk ? lookFromNet(s.wpn.lk) : undefined;
    this.sword = found && s.wpn ? buildWorkshopWeapon(s.wpn.bp, s.wpn.rar, found) : buildSword(look);
    this.body.rHand.add(this.sword.group);
  }

  private animate(dt: number, s: AvatarState, spd: number): void {
    this.deadTime = s.ph === 'dead' ? this.deadTime + dt : 0;
    this.gatherTime = s.ph === 'gather' ? this.gatherTime + dt : 0;
    this.airTime = s.ph === 'air' ? this.airTime + dt : 0;
    // Movement direction in the avatar's frame (for strafing / walking backwards while locked on).
    const dx = this.position.x - this.lastPos.x;
    const dz = this.position.z - this.lastPos.z;
    this.lastPos.copy(this.position);
    if (dx * dx + dz * dz > 1e-6) {
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      const L = Math.hypot(dx, dz);
      this.moveLocal = { x: (dx * cy - dz * sy) / L, z: (dx * sy + dz * cy) / L };
    }
    if (this.body instanceof CharacterBody) {
      const phase = s.ph === 'block' || s.ph === 'air' || s.ph === 'gather' ? 'idle' : s.ph;
      this.body.update(
        dt,
        playerAnimRequest({
          alive: s.ph !== 'dead' && s.hp > 0,
          deadTime: this.deadTime,
          gatherK: s.ph === 'gather' ? (this.gatherTime % 1) : null,
          phase,
          attackId: s.atk,
          k: Math.max(0, Math.min(1, s.pr)),
          t: s.pr * (s.ph === 'stagger' ? 0.6 : 1),
          blocking: s.ph === 'block',
          airTime: s.ph === 'air' ? this.airTime : null,
          speed: spd,
          dirX: this.moveLocal.x,
          dirZ: this.moveLocal.z,
        }),
      );
      if (this.sword.glow) this.sword.glow.emissiveIntensity = 1.2 + Math.sin(performance.now() / 160) * 0.4;
      return;
    }
    const rig = this.body;
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
    rig.apply(pose, blend);
    if (this.sword.glow) this.sword.glow.emissiveIntensity = 1.2 + Math.sin(performance.now() / 160) * 0.4;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.object);
  }
}
