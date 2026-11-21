/** Enemy entity: rules-side EnemyBrain + movement + readable presentation. */
import * as THREE from 'three';
import { ENEMIES, EnemyBrain, angleDelta, dist2, forwardPoint, turnToward, yawTo, type EnemyAttackDef, type Vec2 } from '@alloy/game-rules';
import { Rng } from '@alloy/item-gen';
import { Telegraph } from '../fx/Effects';
import type { ColliderWorld } from '../world/Colliders';
import type { EnemySpawn } from '../world/Layout';
import { terrainHeight } from '../world/Terrain';
import { ENEMY_POSES, POSE_DEAD, POSE_STAGGER, Rig, easeIn, easeOut, locomotionPose, mixPose, type Pose, type RigStyle } from './Rig';
import { buildConstructArm, buildHatchet, buildShield } from './Weapons';

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
  readonly brain: EnemyBrain;
  readonly rig: Rig;
  readonly object = new THREE.Group();
  position = new THREE.Vector3();
  yaw: number;
  readonly home: Vec2;
  readonly patrol: Vec2[];
  readonly telegraphs = new Map<string, Telegraph>();
  private walkPhase = Math.random() * 6;
  private speedNow = 0;
  deadTime = 0;
  hitFlash = 0;
  private alertMarker: THREE.Mesh;
  private shield?: THREE.Group;
  /** Committed circle centre for circle attacks. */
  attackCenter: Vec2 | null = null;

  constructor(
    readonly spawn: EnemySpawn,
    private colliders: ColliderWorld,
    scene: THREE.Scene,
  ) {
    const def = ENEMIES[spawn.type];
    this.id = spawn.id;
    const rng = new Rng(`enemy:${spawn.id}`);
    this.brain = new EnemyBrain(def, () => rng.next());
    this.rig = new Rig(STYLES[spawn.type]);
    this.rig.snapshotEmissive();
    this.object.add(this.rig.root);
    this.home = { ...spawn.pos };
    this.patrol = spawn.patrol ?? [];
    this.yaw = spawn.yaw;
    if (spawn.type === 'scavenger') this.rig.rHand.add(buildHatchet());
    if (spawn.type === 'sentinel') {
      this.rig.rHand.add(buildConstructArm('#6c747c', 1));
      this.shield = buildShield();
      this.rig.lHand.add(this.shield);
    }
    if (spawn.type === 'warden') {
      this.rig.rHand.add(buildConstructArm('#7a6a5a', 1.6));
      this.rig.lHand.add(buildConstructArm('#7a6a5a', 1.3));
    }
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

  get def() {
    return this.brain.def;
  }

  get pos2(): Vec2 {
    return { x: this.position.x, z: this.position.z };
  }

  respawn(): void {
    this.brain.reset();
    this.position.set(this.home.x, terrainHeight(this.home.x, this.home.z), this.home.z);
    this.yaw = this.spawn.yaw;
    this.deadTime = 0;
    this.object.visible = true;
    this.rig.root.rotation.set(0, 0, 0);
  }

  update(dt: number, player: { pos: Vec2; alive: boolean }): void {
    const b = this.brain;
    const d = dist2(this.pos2, player.pos);
    const ang = Math.abs(angleDelta(this.yaw, yawTo(this.pos2, player.pos)));
    const wp = this.patrol.length > 0 ? this.patrol[b.waypointIndex % this.patrol.length] : this.home;
    const intent = b.update(dt, {
      distToPlayer: d,
      angleToPlayer: ang,
      playerAlive: player.alive,
      distFromHome: dist2(this.pos2, this.home),
      atWaypoint: dist2(this.pos2, wp) < 1.2,
      hasPatrol: this.patrol.length > 0,
    });

    if (intent.facePlayer && intent.turnRate > 0) this.yaw = turnToward(this.yaw, yawTo(this.pos2, player.pos), intent.turnRate * dt);

    let target: Vec2 | null = null;
    if (intent.move === 'toPlayer') target = player.pos;
    else if (intent.move === 'toHome') target = this.home;
    else if (intent.move === 'toWaypoint') target = wp;
    let speed = 0;
    let dir = { x: 0, z: 0 };
    if (target) {
      const ty = yawTo(this.pos2, target);
      if (!intent.facePlayer) this.yaw = turnToward(this.yaw, ty, intent.turnRate * dt);
      dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      speed = intent.speed;
    } else if (intent.move === 'lunge') {
      dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      speed = d > this.def.radius + 0.6 ? intent.speed : 0;
    }
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 10);
    if (this.def.kind !== 'dummy' && b.alive) {
      const nx = this.position.x + dir.x * this.speedNow * dt;
      const nz = this.position.z + dir.z * this.speedNow * dt;
      const r = this.colliders.resolve({ x: nx, z: nz }, this.def.radius, this.position.y);
      // Do not walk into the player.
      if (dist2(r, player.pos) > this.def.radius + 0.4 || dist2(r, player.pos) > d) {
        this.position.x = r.x;
        this.position.z = r.z;
      }
      this.position.y = terrainHeight(this.position.x, this.position.z);
    }

    // Commit circle-attack centre at the start of the active window.
    if (b.state === 'telegraph' && b.attack?.shape === 'circle') {
      this.attackCenter = forwardPoint(this.pos2, this.yaw, b.attack.circleOffset ?? 0);
    }

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

  private animate(dt: number): void {
    const b = this.brain;
    let pose: Pose;
    let blend = Math.min(1, dt * 14);
    this.alertMarker.visible = b.state === 'alert' || (b.state === 'telegraph' && (b.attack?.heavy ?? false));
    if (this.alertMarker.visible) this.alertMarker.rotation.y += dt * 6;
    if (b.state === 'dead') {
      this.deadTime += dt;
      pose = POSE_DEAD;
      blend = Math.min(1, dt * 5);
      if (this.deadTime > 2.5) {
        this.rig.root.position.y = -Math.min(1.5, (this.deadTime - 2.5) * 0.8);
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
    this.rig.apply(pose, blend);

    // Telegraph glow: weapon arms and core heat up as the attack approaches.
    const glow = b.state === 'telegraph' ? b.telegraphProgress() : b.state === 'attack' ? 1 : 0;
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.rig.setTint(new THREE.Color('#ffffff'), this.hitFlash * 3);
    } else if (glow > 0) {
      this.rig.setTint(new THREE.Color('#ff4a1a'), glow * 0.45);
    } else if (b.state === 'stagger') {
      this.rig.setTint(new THREE.Color('#ffe08a'), 0.25 + Math.sin(b.stateTime * 18) * 0.1);
    } else {
      this.rig.setTint(null);
    }
    if (this.rig.coreMaterial) this.rig.coreMaterial.emissiveIntensity = 1.2 + glow * 2.5 + (b.phase2 ? 0.8 : 0);
    if (this.shield) this.shield.visible = true;
  }
}
