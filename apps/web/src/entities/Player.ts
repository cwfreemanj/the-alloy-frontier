/**
 * Player character: movement controller + presentation for the rules-side PlayerCombat.
 * Gameplay decisions (costs, timing, hits) live in @alloy/game-rules.
 */
import * as THREE from 'three';
import { DODGE, PlayerCombat, STAMINA_CONFIG, canAfford, effectiveCost, turnToward } from '@alloy/game-rules';
import type { ItemInstance } from '@alloy/item-gen';
import { terrainHeight } from '@alloy/world';
import type { ColliderWorld } from '@alloy/world';
import { playableSdf } from '@alloy/world';
import { ATTACK_POSES, POSE_BLOCK, POSE_DEAD, POSE_DODGE, POSE_GATHER, POSE_GUARD, POSE_STAGGER, Rig, easeIn, easeOut, locomotionPose, mixPose, type Pose } from './Rig';
import { buildSword, type SwordVisual } from './Weapons';
import { CharacterBody, DEFAULT_PLAYER_CHARACTER, clipMeta, createBody, phaseClipTime, type AnimRequest, type PlayerCharacterId } from './models/Characters';
import { playerAnims } from './models/animSets';

/** The local player's look: a skinned character model, or the procedural rig as a fallback. */
export function makePlayerBody(character: PlayerCharacterId, palette?: { body: string; armor: string; accent: string }): Rig | CharacterBody {
  const a = playerAnims(character);
  const model = createBody(a.model, a.heightM, a.loco);
  if (model) return model;
  const rig = new Rig({ kind: 'organic', skin: '#c89a7a', body: palette?.body ?? '#3a4652', armor: palette?.armor ?? '#6b6f73', legs: '#2e2a26', boots: '#241c16', accent: palette?.accent ?? '#45e0ff', scale: 1 });
  rig.snapshotEmissive();
  return rig;
}

export interface PlayerAnimInput {
  alive: boolean;
  deadTime: number;
  gatherK: number | null;
  phase: string;
  attackId: string | null;
  /** 0..1 within the current phase. */
  k: number;
  /** Seconds in the current phase. */
  t: number;
  blocking: boolean;
  airTime: number | null;
  speed: number;
  dirX: number;
  dirZ: number;
}

/** Shared by the local player and remote players: game state -> animation request. */
export function playerAnimRequest(i: PlayerAnimInput): AnimRequest {
  const A = playerAnims('maria');
  if (!i.alive) return { kind: 'clip', clip: A.death!, time: i.deadTime, fade: 0.12 };
  if (i.gatherK !== null) {
    // One chop per gather; the blow lands as the material is granted.
    const m = clipMeta(A.gather!);
    const peak = m?.peak ?? 0.8;
    return { kind: 'clip', clip: A.gather!, time: peak - 0.7 + i.gatherK * 0.78, fade: 0.15 };
  }
  if (i.phase === 'dodge') return { kind: 'clip', clip: A.dodge!, time: i.k * (clipMeta(A.dodge!)?.duration ?? 0.5), fade: 0.05 };
  if (i.phase === 'stagger') return { kind: 'clip', clip: A.stagger!, time: i.t, fade: 0.05 };
  if ((i.phase === 'windup' || i.phase === 'active' || i.phase === 'recovery') && i.attackId) {
    const a = A.attacks[i.attackId] ?? A.attacks.light1;
    return { kind: 'clip', clip: a.clip, time: phaseClipTime(a.clip, i.phase, i.k, a.shape), fade: i.phase === 'windup' ? 0.06 : 0.04 };
  }
  if (i.blocking) return { kind: 'loop', clip: A.block!, fade: 0.1 };
  if (i.airTime !== null) return { kind: 'clip', clip: A.jump!, time: 0.12 + i.airTime, fade: 0.1 };
  return { kind: 'loco', speed: i.speed, dirX: i.dirX, dirZ: i.dirZ };
}

export const PLAYER_RADIUS = 0.4;
export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 7.6;
export const BLOCK_SPEED = 2.2;

export interface MoveInput {
  /** Desired world-space direction (unnormalised, length 0..1). */
  dir: THREE.Vector2;
  sprint: boolean;
  jump: boolean;
}

export class Player {
  readonly combat = new PlayerCombat(200);
  body: Rig | CharacterBody;
  character: PlayerCharacterId;
  readonly object = new THREE.Group();
  private deadTime = 0;
  private airTime = 0;
  private moveLocal = { x: 0, z: 1 };
  position = new THREE.Vector3();
  yaw = 0;
  velocity = new THREE.Vector3();
  grounded = true;
  sprinting = false;
  private walkPhase = 0;
  private speedNow = 0;
  sword: SwordVisual;
  private lungeRemaining = 0;
  private dodgeDir = new THREE.Vector2();
  gathering = 0;
  hitFlash = 0;

  constructor(
    private colliders: ColliderWorld,
    weapon: ItemInstance | null,
    character: PlayerCharacterId = DEFAULT_PLAYER_CHARACTER,
  ) {
    this.character = character;
    this.body = makePlayerBody(character);
    this.object.add(this.body.root);
    this.sword = buildSword(weapon);
    this.body.rHand.add(this.sword.group);
  }

  /** Swap the character model (keeps the equipped weapon). */
  setCharacter(id: PlayerCharacterId): void {
    if (id === this.character && this.body instanceof CharacterBody) return;
    this.character = id;
    this.body.rHand.remove(this.sword.group);
    if (this.body instanceof CharacterBody) this.body.dispose();
    else this.object.remove(this.body.root);
    this.body = makePlayerBody(id);
    this.object.add(this.body.root);
    this.body.rHand.add(this.sword.group);
  }

  /** Idle presentation while the game isn't simulating (title screen). */
  presentIdle(dt: number): void {
    if (this.body instanceof CharacterBody) this.body.update(dt, { kind: 'loco', speed: 0 });
  }

  setWeapon(item: ItemInstance | null): void {
    this.body.rHand.remove(this.sword.group);
    this.sword = buildSword(item);
    this.body.rHand.add(this.sword.group);
  }

  get pos2() {
    return { x: this.position.x, z: this.position.z };
  }

  spawn(x: number, z: number, yaw: number): void {
    this.position.set(x, terrainHeight(x, z), z);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.object.position.copy(this.position);
  }

  /** Forward unit vector in XZ. */
  forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  beginLunge(distance: number): void {
    this.lungeRemaining = distance;
  }

  beginDodge(dir: THREE.Vector2): void {
    this.dodgeDir.copy(dir.lengthSq() > 0.01 ? dir.clone().normalize() : this.forward().multiplyScalar(-1));
    if (dir.lengthSq() > 0.01) this.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.y);
  }

  update(dt: number, input: MoveInput, faceTarget: THREE.Vector3 | null, maxLungeStop: number): void {
    const c = this.combat;
    const alive = c.alive;
    let move = new THREE.Vector2();
    let speed = 0;

    if (alive && this.gathering > 0) {
      this.gathering = Math.max(0, this.gathering - dt);
    } else if (alive && c.phase === 'idle') {
      const len = Math.min(1, input.dir.length());
      if (len > 0.05) {
        move = input.dir.clone().normalize();
        const wantSprint = input.sprint && !c.blocking && c.stamina.current > 0 && !faceTarget;
        this.sprinting = wantSprint;
        speed = (c.blocking ? BLOCK_SPEED : wantSprint ? SPRINT_SPEED : WALK_SPEED) * len;
        const targetYaw = faceTarget && !wantSprint ? Math.atan2(faceTarget.x - this.position.x, faceTarget.z - this.position.z) : Math.atan2(move.x, move.y);
        this.yaw = turnToward(this.yaw, targetYaw, dt * (faceTarget ? 14 : 11));
      } else {
        this.sprinting = false;
        if (faceTarget) this.yaw = turnToward(this.yaw, Math.atan2(faceTarget.x - this.position.x, faceTarget.z - this.position.z), dt * 12);
      }
      if (input.jump && this.grounded) {
        const cost = effectiveCost(STAMINA_CONFIG.costs.jump);
        if (canAfford(c.stamina, 'jump', cost)) {
          c.stamina = { ...c.stamina, current: Math.max(0, c.stamina.current - cost), regenDelayRemaining: STAMINA_CONFIG.regenDelay };
          this.velocity.y = 6.2;
          this.grounded = false;
        }
      }
    } else {
      this.sprinting = false;
    }

    // Attack lunge (forward movement during windup/active), stopping short of the target.
    if (alive && (c.phase === 'windup' || c.phase === 'active') && this.lungeRemaining > 0) {
      const total = c.durations.windup + c.durations.active;
      const step = Math.min(this.lungeRemaining, ((c.attack?.lunge ?? 0) / Math.max(0.05, total)) * dt);
      if (maxLungeStop > 0.05) {
        move = this.forward();
        speed = step / dt;
        this.lungeRemaining -= step;
      } else this.lungeRemaining = 0;
    } else if (c.phase !== 'windup' && c.phase !== 'active') {
      this.lungeRemaining = 0;
    }

    if (alive && c.phase === 'dodge') {
      const k = c.t / DODGE.duration;
      move = this.dodgeDir.clone();
      speed = (DODGE.distance / DODGE.duration) * 1.6 * (1 - k * 0.8);
    }

    if (move.lengthSq() > 0.01 && c.phase === 'idle') {
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      this.moveLocal = { x: move.x * cy - move.y * sy, z: move.x * sy + move.y * cy };
    }
    // Integrate horizontal movement with acceleration smoothing.
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * (speed > this.speedNow ? 14 : 18));
    const vx = move.x * (c.phase === 'idle' ? this.speedNow : speed);
    const vz = move.y * (c.phase === 'idle' ? this.speedNow : speed);
    let nx = this.position.x + vx * dt;
    let nz = this.position.z + vz * dt;
    // Soft world boundary: hills become impassable.
    if (playableSdf({ x: nx, z: nz }) > 4 && playableSdf({ x: nx, z: nz }) > playableSdf(this.pos2)) {
      nx = this.position.x;
      nz = this.position.z;
    }
    const resolved = this.colliders.resolve({ x: nx, z: nz }, PLAYER_RADIUS, this.position.y);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    // Vertical
    const ground = terrainHeight(this.position.x, this.position.z);
    if (!this.grounded) {
      this.velocity.y -= 20 * dt;
      this.position.y += this.velocity.y * dt;
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.velocity.y = 0;
        this.grounded = true;
      }
    } else {
      this.position.y += (ground - this.position.y) * Math.min(1, dt * 20);
      if (Math.abs(ground - this.position.y) > 1.2) this.position.y = ground;
    }

    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    this.animate(dt);
  }

  private animate(dt: number): void {
    const c = this.combat;
    this.deadTime = c.alive ? 0 : this.deadTime + dt;
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    if (this.body instanceof CharacterBody) {
      const dur = c.phase === 'windup' ? c.durations.windup : c.phase === 'active' ? c.durations.active : c.phase === 'recovery' ? c.durations.recovery : c.phase === 'dodge' ? DODGE.duration : 1;
      this.body.update(
        dt,
        playerAnimRequest({
          alive: c.alive,
          deadTime: this.deadTime,
          gatherK: this.gathering > 0 ? 1 - this.gathering / 1.0 : null,
          phase: c.phase,
          attackId: c.attack?.id ?? null,
          k: c.t / Math.max(0.01, dur),
          t: c.t,
          blocking: c.blocking,
          airTime: this.grounded ? null : this.airTime,
          speed: this.speedNow,
          dirX: this.moveLocal.x,
          dirZ: this.moveLocal.z,
        }),
      );
      this.flash(dt);
      return;
    }
    const rig = this.body;
    const moving = this.speedNow > 0.3 && c.phase === 'idle';
    this.walkPhase += dt * (this.sprinting ? 11 : 8.5) * Math.min(1, this.speedNow / WALK_SPEED + 0.2);
    let pose: Pose;
    let blend = Math.min(1, dt * 16);
    if (!c.alive) {
      pose = POSE_DEAD;
      blend = Math.min(1, dt * 6);
    } else if (this.gathering > 0) {
      pose = POSE_GATHER;
      const swing = Math.sin(this.gathering * 14) * 0.5;
      pose = { ...pose, rShoulder: [-1.6 + swing, 0, -0.2] };
    } else if (c.phase === 'dodge') {
      pose = POSE_DODGE;
      blend = Math.min(1, dt * 22);
    } else if (c.phase === 'stagger') {
      pose = POSE_STAGGER;
      blend = Math.min(1, dt * 20);
    } else if ((c.phase === 'windup' || c.phase === 'active' || c.phase === 'recovery') && c.attack) {
      const [w, s] = ATTACK_POSES[c.attack.id] ?? ATTACK_POSES.light1;
      if (c.phase === 'windup') pose = mixPose(POSE_GUARD, w, easeOut(c.t / Math.max(0.01, c.durations.windup)));
      else if (c.phase === 'active') pose = mixPose(w, s, easeOut(Math.min(1, c.t / Math.max(0.01, c.durations.active))));
      else pose = mixPose(s, POSE_GUARD, easeIn(Math.min(1, c.t / Math.max(0.01, c.durations.recovery))));
      blend = c.phase === 'active' ? 1 : Math.min(1, dt * 30);
    } else if (c.blocking) {
      pose = POSE_BLOCK;
    } else {
      const loco = locomotionPose(this.walkPhase, moving ? Math.min(1.2, this.speedNow / WALK_SPEED) : 0, this.sprinting);
      const breath = Math.sin(performance.now() / 700) * 0.03;
      pose = { ...POSE_GUARD, ...loco, chest: [breath, 0, 0] };
      if (this.sprinting) pose.rShoulder = [0.35, 0, -0.2];
      if (!this.grounded) pose = { ...pose, lKnee: [0.9, 0, 0], rKnee: [0.4, 0, 0], lHip: [-0.6, 0, 0] };
    }
    rig.apply(pose, blend);
    this.flash(dt);
  }

  private flash(dt: number): void {
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.body.setTint(new THREE.Color('#ff4a2a'), this.hitFlash * 2);
      if (this.hitFlash === 0) this.body.setTint(null);
    }
    if (this.sword.glow) this.sword.glow.emissiveIntensity = 1.2 + Math.sin(performance.now() / 160) * 0.4;
  }
}
