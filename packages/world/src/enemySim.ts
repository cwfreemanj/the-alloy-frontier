/**
 * Enemy simulation without rendering: rules-side EnemyBrain plus movement, collision and
 * terrain following. The server runs these for the shared world; the browser runs one
 * for offline play and for the local training post.
 */
import { ENEMIES, EnemyBrain, scaledArchetype, angleDelta, dist2, forwardPoint, turnToward, yawTo, type Vec2 } from '@alloy/game-rules';
import { Rng } from '@alloy/item-gen';
import type { ColliderWorld } from './Colliders';
import type { EnemySpawn } from './Layout';
import { terrainHeight } from './Terrain';

export interface SimTarget {
  pos: Vec2;
  alive: boolean;
}

export class EnemySim {
  readonly id: string;
  readonly brain: EnemyBrain;
  x = 0;
  y = 0;
  z = 0;
  yaw: number;
  readonly home: Vec2;
  readonly patrol: Vec2[];
  speedNow = 0;
  /** Committed circle centre for circle attacks. */
  attackCenter: Vec2 | null = null;
  /** Seconds since death (for respawn timers). */
  deadFor = 0;

  constructor(
    readonly spawn: EnemySpawn,
    private colliders: ColliderWorld,
  ) {
    const def = ENEMIES[spawn.type];
    this.id = spawn.id;
    const rng = new Rng(`enemy:${spawn.id}`);
    this.brain = new EnemyBrain(def, () => rng.next());
    this.home = { ...spawn.pos };
    this.patrol = spawn.patrol ?? [];
    this.yaw = spawn.yaw;
    this.reset();
  }

  get def() {
    return this.brain.def;
  }
  /** Current level (the archetype's own, or what the world server set for its area). */
  get level(): number {
    return this.brain.def.level;
  }
  /** Scale this enemy to a level (health keeps its fraction; see scaledArchetype). */
  setLevel(level: number): void {
    this.brain.setDef(scaledArchetype(ENEMIES[this.spawn.type], level));
  }
  get pos2(): Vec2 {
    return { x: this.x, z: this.z };
  }

  reset(): void {
    this.brain.reset();
    this.x = this.home.x;
    this.z = this.home.z;
    this.y = terrainHeight(this.x, this.z);
    this.yaw = this.spawn.yaw;
    this.speedNow = 0;
    this.attackCenter = null;
    this.deadFor = 0;
  }

  step(dt: number, target: SimTarget): void {
    const b = this.brain;
    if (!b.alive) this.deadFor += dt;
    const d = dist2(this.pos2, target.pos);
    const ang = Math.abs(angleDelta(this.yaw, yawTo(this.pos2, target.pos)));
    const wp = this.patrol.length > 0 ? this.patrol[b.waypointIndex % this.patrol.length] : this.home;
    const intent = b.update(dt, {
      distToPlayer: d,
      angleToPlayer: ang,
      playerAlive: target.alive,
      distFromHome: dist2(this.pos2, this.home),
      atWaypoint: dist2(this.pos2, wp) < 1.2,
      hasPatrol: this.patrol.length > 0,
    });

    if (intent.facePlayer && intent.turnRate > 0) this.yaw = turnToward(this.yaw, yawTo(this.pos2, target.pos), intent.turnRate * dt);

    let goal: Vec2 | null = null;
    if (intent.move === 'toPlayer') goal = target.pos;
    else if (intent.move === 'toHome') goal = this.home;
    else if (intent.move === 'toWaypoint') goal = wp;
    let speed = 0;
    let dir = { x: 0, z: 0 };
    if (goal) {
      const ty = yawTo(this.pos2, goal);
      if (!intent.facePlayer) this.yaw = turnToward(this.yaw, ty, intent.turnRate * dt);
      dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      speed = intent.speed;
    } else if (intent.move === 'lunge') {
      dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      speed = d > this.def.radius + 0.6 ? intent.speed : 0;
    }
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 10);
    if (this.def.kind !== 'dummy' && b.alive) {
      const nx = this.x + dir.x * this.speedNow * dt;
      const nz = this.z + dir.z * this.speedNow * dt;
      const r = this.colliders.resolve({ x: nx, z: nz }, this.def.radius, this.y);
      // Do not walk into the target.
      if (dist2(r, target.pos) > this.def.radius + 0.4 || dist2(r, target.pos) > d) {
        this.x = r.x;
        this.z = r.z;
      }
      this.y = terrainHeight(this.x, this.z);
    }

    // Commit circle-attack centre at the start of the active window.
    if (b.state === 'telegraph' && b.attack?.shape === 'circle') this.attackCenter = forwardPoint(this.pos2, this.yaw, b.attack.circleOffset ?? 0);
    else if (b.state !== 'attack') this.attackCenter = null;
  }
}
