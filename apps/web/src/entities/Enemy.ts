/**
 * Enemy entity: presentation for a shared EnemySim. Offline (and for the local training
 * post) the browser runs the sim; online the server runs it and this mirrors its state.
 */
import * as THREE from 'three';
import { angleDelta, forwardPoint, type EnemyAttackDef, type Vec2 } from '@alloy/game-rules';
import type { EnemyNetState } from '@alloy/protocol';
import { EnemySim, terrainHeight, type ColliderWorld, type EnemySpawn, type SimTarget } from '@alloy/world';
import { Telegraph } from '../fx/Effects';
import { ENEMY_POSES, POSE_DEAD, POSE_STAGGER, Rig, easeIn, easeOut, locomotionPose, mixPose, type Pose, type RigStyle } from './Rig';
import { buildConstructArm, buildHatchet, buildShield, buildSword } from './Weapons';
import { CharacterBody, createBody, phaseClipTime, type AnimRequest } from './models/Characters';
import { ENEMY_ANIMS, type RoleAnims } from './models/animSets';

const STYLES: Record<string, RigStyle> = {
  scavenger: { kind: 'organic', skin: '#a77d62', body: '#5a3b2a', armor: '#4a4038', legs: '#3a2e24', boots: '#2a1e16', accent: '#c06030', scale: 1 },
  sentinel: { kind: 'construct', skin: '#5c646c', body: '#4a525a', armor: '#6c747c', legs: '#3c4249', boots: '#30353b', accent: '#45e0ff', core: '#45e0ff', scale: 1.35, bulk: 1.2 },
  warden: { kind: 'construct', skin: '#4e4a48', body: '#3e3a38', armor: '#6e5a4a', legs: '#33302e', boots: '#2a2726', accent: '#ff7a2e', core: '#ff7a2e', scale: 1.8, bulk: 1.45 },
  dummy: { kind: 'organic', skin: '#8a6a4a', body: '#6a5038', armor: '#5a4632', legs: '#5a4632', boots: '#3a2a1e', accent: '#000000', scale: 1 },
};

function poseFor(a: EnemyAttackDef): [Pose, Pose] {
  if (a.shape === 'circle') return ENEMY_POSES.overhead;
  if (a.id === 'lunge' || a.id === 'piston') return ENEMY_POSES.thrust;
  if ((a.arcDeg ?? 90) >= 100) return ENEMY_POSES.sweep;
  return ENEMY_POSES.overhead;
}

export class Enemy {
  readonly id: string;
  readonly sim: EnemySim;
  readonly body: Rig | CharacterBody;
  private readonly anims: RoleAnims | null;
  readonly object = new THREE.Group();
  position = new THREE.Vector3();
  readonly telegraphs = new Map<string, Telegraph>();
  private walkPhase = Math.random() * 6;
  private speedNow = 0;
  deadTime = 0;
  hitFlash = 0;
  private alertMarker: THREE.Mesh;
  private shield?: THREE.Group;

  constructor(
    readonly spawn: EnemySpawn,
    colliders: ColliderWorld,
    scene: THREE.Scene,
  ) {
    this.sim = new EnemySim(spawn, colliders);
    this.id = spawn.id;
    const def = this.sim.def;
    const roleAnims = ENEMY_ANIMS[spawn.type] ?? null;
    const model = roleAnims ? createBody(roleAnims.model, roleAnims.heightM, roleAnims.loco) : null;
    this.anims = model ? roleAnims : null;
    if (model) {
      this.body = model;
      if (spawn.type === 'scavenger') this.body.rHand.add(buildHatchet());
      if (spawn.type === 'warden') {
        // A furnace-forged great blade sized to the Warden.
        const blade = buildSword({ blueprintId: 'ironglass_longsword', forge: { specialization: 'heavy' }, result: { imbuements: [], rarity: 'common' } } as unknown as Parameters<typeof buildSword>[0]);
        blade.group.scale.setScalar(1.7);
        this.body.rHand.add(blade.group);
      }
    } else {
      const rig = new Rig(STYLES[spawn.type]);
      rig.snapshotEmissive();
      this.body = rig;
      if (spawn.type === 'scavenger') rig.rHand.add(buildHatchet());
      if (spawn.type === 'sentinel') {
        rig.rHand.add(buildConstructArm('#6c747c', 1));
        this.shield = buildShield();
        rig.lHand.add(this.shield);
      }
      if (spawn.type === 'warden') {
        rig.rHand.add(buildConstructArm('#7a6a5a', 1.6));
        rig.lHand.add(buildConstructArm('#7a6a5a', 1.3));
      }
    }
    this.object.add(this.body.root);
    if (spawn.type === 'dummy') {
      // A post: hide legs by planting the rig in a stake.
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 6), new THREE.MeshStandardMaterial({ color: '#4a3626' }));
      post.position.y = 0.6;
      this.object.add(post);
    }
    for (const a of def.attacks) {
      const t = a.shape === 'circle' ? new Telegraph('circle', a.circleRadius ?? 3) : new Telegraph('arc', a.range, a.arcDeg ?? 90);
      this.telegraphs.set(a.id, t);
      scene.add(t.group);
    }
    this.alertMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: '#ffb03a' }));
    this.alertMarker.scale.y = 2;
    this.alertMarker.visible = false;
    this.object.add(this.alertMarker);
    this.alertMarker.position.y = 2.3 * def.scale;
    this.respawn();
    scene.add(this.object);
  }

  get brain() {
    return this.sim.brain;
  }
  get def() {
    return this.sim.brain.def;
  }
  get home(): Vec2 {
    return this.sim.home;
  }
  get yaw(): number {
    return this.sim.yaw;
  }
  set yaw(v: number) {
    this.sim.yaw = v;
  }
  get attackCenter(): Vec2 | null {
    return this.sim.attackCenter;
  }
  get pos2(): Vec2 {
    return { x: this.position.x, z: this.position.z };
  }

  respawn(): void {
    this.sim.reset();
    this.position.set(this.sim.x, this.sim.y, this.sim.z);
    this.deadTime = 0;
    this.object.visible = true;
    this.body.root.rotation.set(0, 0, 0);
    this.body.root.position.y = 0;
  }

  /** Local simulation (offline play and the training post). */
  update(dt: number, target: SimTarget): void {
    this.sim.step(dt, target);
    this.position.set(this.sim.x, this.sim.y, this.sim.z);
    this.speedNow = this.sim.speedNow;
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    this.updateTelegraphs();
    this.animate(dt);
  }

  // ---------------- Online (the server streams state; this mirrors it) ----------------
  private net: EnemyNetState | null = null;

  /** Receive the server's latest state for this enemy. */
  applyNet(s: EnemyNetState): void {
    const b = this.brain;
    const wasDead = !b.alive;
    if (s.s !== b.state || s.a !== (b.attack?.id ?? null)) {
      b.state = s.s as typeof b.state;
      b.stateTime = s.st;
      b.attack = s.a ? (this.def.attacks.find((a) => a.id === s.a) ?? null) : null;
    } else if (Math.abs(b.stateTime - s.st) > 0.25) b.stateTime = s.st;
    b.health = s.hp;
    b.phase2 = s.p2;
    this.sim.attackCenter = s.cx !== undefined && s.cz !== undefined ? { x: s.cx, z: s.cz } : null;
    if (wasDead && b.alive) {
      // Respawned on the server.
      this.deadTime = 0;
      this.object.visible = true;
      this.body.root.position.y = 0;
      this.position.set(s.x, terrainHeight(s.x, s.z), s.z);
    }
    if (wasDead === false && !b.alive) this.deadTime = 0;
    if (!this.net || Math.hypot(this.net.x - s.x, this.net.z - s.z) > 10) this.position.set(s.x, terrainHeight(s.x, s.z), s.z);
    this.net = s;
  }

  /** Mirror mode: smooth toward the server's state and animate; no AI runs here. */
  puppetUpdate(dt: number): void {
    const s = this.net;
    if (s) {
      const f = Math.min(1, dt * 12);
      const prevX = this.position.x,
        prevZ = this.position.z;
      this.position.x += (s.x - this.position.x) * f;
      this.position.z += (s.z - this.position.z) * f;
      this.position.y = terrainHeight(this.position.x, this.position.z);
      this.yaw += angleDelta(this.yaw, s.yaw) * f;
      this.speedNow = Math.hypot(this.position.x - prevX, this.position.z - prevZ) / Math.max(dt, 1e-3);
    }
    this.brain.stateTime += dt;
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    this.updateTelegraphs();
    this.animate(dt);
  }

  private updateTelegraphs(): void {
    const b = this.brain;
    for (const [id, t] of this.telegraphs) {
      const a = b.attack;
      if (a && a.id === id && (b.state === 'telegraph' || b.state === 'attack')) {
        if (a.shape === 'circle') {
          const c = this.attackCenter ?? forwardPoint(this.pos2, this.yaw, a.circleOffset ?? 0);
          t.group.position.set(c.x, terrainHeight(c.x, c.z) + 0.06, c.z);
        } else {
          t.group.position.set(this.position.x, this.position.y + 0.06, this.position.z);
          t.group.rotation.y = this.yaw;
        }
        t.show(b.state === 'attack' ? 1 : b.telegraphProgress(), b.state === 'attack');
      } else t.hide();
    }
  }

  /** Idle presentation while the game isn't simulating (title screen). */
  presentIdle(dt: number): void {
    if (this.body instanceof CharacterBody && this.brain.alive) this.body.update(dt, { kind: 'loco', speed: 0 });
  }

  /** Brain state -> animation request for a skinned model. */
  private animRequest(A: RoleAnims): AnimRequest {
    const b = this.brain;
    if (b.state === 'dead') return { kind: 'clip', clip: A.death!, time: this.deadTime, fade: 0.1 };
    if (b.state === 'stagger') return { kind: 'clip', clip: A.stagger!, time: b.stateTime, fade: 0.06 };
    if (b.state === 'guard' && A.guard) return { kind: 'loop', clip: A.guard, fade: 0.12 };
    if ((b.state === 'telegraph' || b.state === 'attack' || b.state === 'recover') && b.attack) {
      const a = A.attacks[b.attack.id] ?? Object.values(A.attacks)[0];
      const phase = b.state === 'telegraph' ? 'windup' : b.state === 'attack' ? 'active' : 'recovery';
      const k = b.state === 'telegraph' ? b.telegraphProgress() : b.state === 'attack' ? b.stateTime / b.attack.active : b.stateTime / b.attack.recovery;
      return { kind: 'clip', clip: a.clip, time: phaseClipTime(a.clip, phase, k, a.shape), fade: phase === 'windup' ? 0.12 : 0.05 };
    }
    return { kind: 'loco', speed: this.speedNow };
  }

  private animate(dt: number): void {
    const b = this.brain;
    if (b.state === 'dead') this.deadTime += dt;
    if (this.body instanceof CharacterBody && this.anims) {
      this.alertMarker.visible = b.state === 'alert' || (b.state === 'telegraph' && (b.attack?.heavy ?? false));
      if (this.alertMarker.visible) this.alertMarker.rotation.y += dt * 6;
      if (b.state === 'dead' && this.deadTime > 3) {
        this.body.root.position.y = -Math.min(2, (this.deadTime - 3) * 0.8);
        if (this.deadTime > 5.5) this.object.visible = false;
      }
      this.body.update(dt, this.animRequest(this.anims));
      this.applyTint(dt);
      return;
    }
    const rig = this.body as Rig;
    let pose: Pose;
    let blend = Math.min(1, dt * 14);
    this.alertMarker.visible = b.state === 'alert' || (b.state === 'telegraph' && (b.attack?.heavy ?? false));
    if (this.alertMarker.visible) this.alertMarker.rotation.y += dt * 6;
    if (b.state === 'dead') {
      pose = POSE_DEAD;
      blend = Math.min(1, dt * 5);
      if (this.deadTime > 2.5) {
        rig.root.position.y = -Math.min(1.5, (this.deadTime - 2.5) * 0.8);
        if (this.deadTime > 4.5) this.object.visible = false;
      }
    } else if (b.state === 'stagger') {
      pose = { ...POSE_STAGGER, spine: [-0.5, 0, Math.sin(b.stateTime * 20) * 0.08] };
      blend = Math.min(1, dt * 20);
    } else if (b.state === 'guard') {
      pose = ENEMY_POSES.guard;
    } else if ((b.state === 'telegraph' || b.state === 'attack' || b.state === 'recover') && b.attack) {
      const [w, s] = poseFor(b.attack);
      if (b.state === 'telegraph') {
        // Slow, readable wind-up with a slight tremble near the end.
        const k = b.telegraphProgress();
        pose = mixPose({}, w, easeOut(k));
        if (k > 0.8) pose.chest = [(pose.chest?.[0] ?? 0) + Math.sin(b.stateTime * 40) * 0.03, pose.chest?.[1] ?? 0, 0];
      } else if (b.state === 'attack') {
        pose = mixPose(w, s, easeOut(Math.min(1, b.stateTime / b.attack.active)));
        blend = 1;
      } else {
        pose = mixPose(s, {}, easeIn(Math.min(1, b.stateTime / b.attack.recovery)));
      }
    } else {
      this.walkPhase += dt * 7 * Math.min(1.4, this.speedNow / 2.5 + 0.2);
      pose = locomotionPose(this.walkPhase, Math.min(1, this.speedNow / 2.5), this.speedNow > 3);
      pose.rShoulder = [-0.4, 0, -0.1];
      pose.rElbow = [-0.6, 0, 0];
    }
    if (this.def.kind === 'dummy') {
      pose = { lShoulder: [0, 0, 1.4], rShoulder: [0, 0, -1.4], ...(b.state === 'stagger' ? { spine: [-0.3, 0, 0] } : {}) };
    }
    rig.apply(pose, blend);
    this.applyTint(dt);
    if (this.shield) this.shield.visible = true;
  }

  private applyTint(dt: number): void {
    const b = this.brain;
    // Telegraph glow: weapon arms and core heat up as the attack approaches.
    const glow = b.state === 'telegraph' ? b.telegraphProgress() : b.state === 'attack' ? 1 : 0;
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.body.setTint(new THREE.Color('#ffffff'), this.hitFlash * 3);
    } else if (glow > 0) {
      this.body.setTint(new THREE.Color('#ff4a1a'), glow * 0.45);
    } else if (b.state === 'stagger') {
      this.body.setTint(new THREE.Color('#ffe08a'), 0.25 + Math.sin(b.stateTime * 18) * 0.1);
    } else if (b.phase2 && this.body instanceof CharacterBody) {
      this.body.setTint(new THREE.Color('#ff5a1a'), 0.12 + Math.sin(b.stateTime * 4) * 0.05);
    } else {
      this.body.setTint(null);
    }
    if (this.body.coreMaterial) this.body.coreMaterial.emissiveIntensity = 1.2 + glow * 2.5 + (b.phase2 ? 0.8 : 0);
  }
}
