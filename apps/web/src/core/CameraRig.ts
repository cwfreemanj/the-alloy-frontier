/**
 * Third-person orbit camera with lock-on framing and collision (AF-002).
 * Collision is analytic (terrain height + collider volumes) to avoid clipping.
 */
import * as THREE from 'three';
import { terrainHeight } from '../world/Terrain';
import type { ColliderWorld } from '../world/Colliders';

export interface CameraSettings {
  sensitivity: number;
  invertY: boolean;
}

export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  distance = 5.2;
  minDistance = 2.2;
  maxDistance = 9;
  private currentDistance = 5.2;
  private pivot = new THREE.Vector3();
  private shake = 0;
  settings: CameraSettings = { sensitivity: 1, invertY: false };

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private colliders: ColliderWorld,
  ) {}

  addShake(amount: number): void {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  /** Horizontal forward direction of the camera. */
  forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  rotate(dx: number, dy: number): void {
    const s = 0.0024 * this.settings.sensitivity;
    this.yaw -= dx * s;
    this.pitch += dy * s * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-0.5, Math.min(1.15, this.pitch));
  }

  zoom(steps: number): void {
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + steps * 0.6));
  }

  snapBehind(yaw: number): void {
    this.yaw = yaw;
  }

  update(dt: number, target: THREE.Vector3, lockTarget: THREE.Vector3 | null): void {
    const desiredPivot = target.clone();
    desiredPivot.y += 1.55;
    if (lockTarget) {
      // Frame both player and target: rotate yaw so the target sits ahead of the camera.
      const toT = new THREE.Vector2(lockTarget.x - target.x, lockTarget.z - target.z);
      const desiredYaw = Math.atan2(toT.x, toT.y);
      let d = desiredYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 6);
      const dist = toT.length();
      const desiredPitch = 0.22 + Math.min(0.25, 2 / Math.max(2, dist));
      this.pitch += (desiredPitch - this.pitch) * Math.min(1, dt * 3);
    }
    this.pivot.lerp(desiredPivot, Math.min(1, dt * 14));

    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // Collision: march from pivot outward; stop before terrain or solid colliders.
    let allowed = this.distance;
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      const px = this.pivot.x + dir.x * d;
      const py = this.pivot.y + dir.y * d;
      const pz = this.pivot.z + dir.z * d;
      if (py < terrainHeight(px, pz) + 0.35 || this.colliders.blocksPoint(px, py, pz, 0.25)) {
        allowed = Math.max(0.8, (this.distance * (i - 1)) / steps - 0.15);
        break;
      }
    }
    // Snap in quickly when blocked, ease back out when clear.
    this.currentDistance = allowed < this.currentDistance ? allowed : this.currentDistance + (allowed - this.currentDistance) * Math.min(1, dt * 4);
    const pos = this.pivot.clone().addScaledVector(dir, this.currentDistance);
    pos.y = Math.max(pos.y, terrainHeight(pos.x, pos.z) + 0.3);
    if (this.shake > 0) {
      pos.x += (Math.random() - 0.5) * this.shake * 0.25;
      pos.y += (Math.random() - 0.5) * this.shake * 0.25;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.position.copy(pos);
    const look = this.pivot.clone();
    if (lockTarget) look.lerp(new THREE.Vector3(lockTarget.x, lockTarget.y + 1.2, lockTarget.z), 0.3);
    this.camera.lookAt(look);
  }
}
