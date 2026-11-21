/** Lightweight combat feedback effects. Restrained by design: readability over spectacle. */
import * as THREE from 'three';

interface Transient {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (k: number, dt: number) => void;
}

export class Effects {
  private items: Transient[] = [];
  private sparkGeo: THREE.BufferGeometry;
  private sparkPos: Float32Array;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private sparkCol: Float32Array;
  private sparkIdx = 0;
  private readonly SPARKS = 400;
  private sparkPoints: THREE.Points;

  constructor(private scene: THREE.Scene) {
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(this.SPARKS * 3).fill(-9999);
    this.sparkVel = new Float32Array(this.SPARKS * 3);
    this.sparkLife = new Float32Array(this.SPARKS);
    this.sparkCol = new Float32Array(this.SPARKS * 3);
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkPoints = new THREE.Points(
      this.sparkGeo,
      new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.sparkPoints.frustumCulled = false;
    scene.add(this.sparkPoints);
  }

  sparks(pos: THREE.Vector3, color: string, count = 14, speed = 4): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.sparkIdx++ % this.SPARKS;
      this.sparkPos[k * 3] = pos.x;
      this.sparkPos[k * 3 + 1] = pos.y;
      this.sparkPos[k * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 0.8 + 0.2;
      this.sparkVel[k * 3] = Math.cos(a) * speed * u;
      this.sparkVel[k * 3 + 1] = Math.random() * speed * 0.9 + 1;
      this.sparkVel[k * 3 + 2] = Math.sin(a) * speed * u;
      this.sparkLife[k] = 0.35 + Math.random() * 0.3;
      this.sparkCol[k * 3] = c.r;
      this.sparkCol[k * 3 + 1] = c.g;
      this.sparkCol[k * 3 + 2] = c.b;
    }
  }

  /** A short readable slash arc in front of the attacker. */
  slash(origin: THREE.Vector3, yaw: number, opts: { radius: number; arcDeg: number; tilt: number; color: string; reverse?: boolean; y?: number }): void {
    const theta = (opts.arcDeg * Math.PI) / 180;
    const geo = new THREE.RingGeometry(opts.radius * 0.45, opts.radius, 28, 1, -theta / 2, theta);
    const mat = new THREE.MeshBasicMaterial({ color: opts.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    const holder = new THREE.Group();
    holder.position.copy(origin);
    holder.position.y += opts.y ?? 1.1;
    holder.rotation.y = yaw;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.PI / 2; // ring centre angle 0 (+X) -> +Z (forward) after the X rotation
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = opts.tilt;
    tiltGroup.add(mesh);
    holder.add(tiltGroup);
    this.scene.add(holder);
    this.items.push({
      obj: holder,
      t: 0,
      life: 0.18,
      update: (k) => {
        mat.opacity = 0.55 * (1 - k);
        mesh.scale.setScalar(0.85 + k * 0.25);
      },
    });
  }

  ring(pos: THREE.Vector3, color: string, maxRadius: number, life = 0.45): void {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.08;
    this.scene.add(m);
    this.items.push({
      obj: m,
      t: 0,
      life,
      update: (k) => {
        m.scale.setScalar(0.5 + k * maxRadius);
        mat.opacity = 0.8 * (1 - k);
      },
    });
  }

  lightning(center: THREE.Vector3, radius: number, color = '#7ff0ff'): void {
    const segs = 14;
    const pts: number[] = [];
    for (let b = 0; b < segs; b++) {
      const a = (b / segs) * Math.PI * 2;
      let x = center.x;
      let y = center.y + 1;
      let z = center.z;
      for (let s = 1; s <= 4; s++) {
        const r = (radius * s) / 4;
        const nx = center.x + Math.sin(a + (Math.random() - 0.5) * 0.4) * r;
        const nz = center.z + Math.cos(a + (Math.random() - 0.5) * 0.4) * r;
        const ny = center.y + 1 - s * 0.22 + (Math.random() - 0.5) * 0.4;
        pts.push(x, y, z, nx, ny, nz);
        x = nx;
        y = ny;
        z = nz;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(geo, mat);
    this.scene.add(lines);
    this.items.push({ obj: lines, t: 0, life: 0.35, update: (k) => (mat.opacity = 1 - k) });
    this.ring(center, color, radius, 0.4);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      it.update(k, dt);
      if (k >= 1) {
        this.scene.remove(it.obj);
        it.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material as THREE.Material | undefined;
          if (mat && 'dispose' in mat) mat.dispose();
        });
        this.items.splice(i, 1);
      }
    }
    for (let k = 0; k < this.SPARKS; k++) {
      if (this.sparkLife[k] <= 0) continue;
      this.sparkLife[k] -= dt;
      if (this.sparkLife[k] <= 0) {
        this.sparkPos[k * 3 + 1] = -9999;
        continue;
      }
      this.sparkVel[k * 3 + 1] -= 14 * dt;
      this.sparkPos[k * 3] += this.sparkVel[k * 3] * dt;
      this.sparkPos[k * 3 + 1] += this.sparkVel[k * 3 + 1] * dt;
      this.sparkPos[k * 3 + 2] += this.sparkVel[k * 3 + 2] * dt;
    }
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Ground telegraph decal: sector or circle, with an inner fill that grows with windup progress. */
export class Telegraph {
  readonly group = new THREE.Group();
  private outline: THREE.Mesh;
  private fill: THREE.Mesh;
  private outlineMat: THREE.MeshBasicMaterial;
  private fillMat: THREE.MeshBasicMaterial;

  constructor(shape: 'arc' | 'circle', radius: number, arcDeg = 360) {
    const theta = Math.min(Math.PI * 2, (arcDeg * Math.PI) / 180);
    const mk = (r: number) =>
      shape === 'circle' ? new THREE.CircleGeometry(r, 40) : new THREE.CircleGeometry(r, 32, Math.PI / 2 - theta / 2, theta);
    this.outlineMat = new THREE.MeshBasicMaterial({ color: '#ff5a2a', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    this.fillMat = new THREE.MeshBasicMaterial({ color: '#ff3a1a', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    this.outline = new THREE.Mesh(mk(radius), this.outlineMat);
    this.fill = new THREE.Mesh(mk(radius), this.fillMat);
    for (const m of [this.outline, this.fill]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
    }
    // Sector geometry is built around +Y in XY; after rotation that becomes -Z, so flip to +Z.
    if (shape === 'arc') {
      this.outline.rotation.z = Math.PI;
      this.fill.rotation.z = Math.PI;
    }
    this.group.add(this.outline, this.fill);
    this.group.visible = false;
  }

  show(progress: number, active: boolean): void {
    this.group.visible = true;
    const p = Math.max(0.02, Math.min(1, progress));
    this.fill.scale.setScalar(p);
    this.fillMat.opacity = active ? 0.6 : 0.22 + p * 0.25;
    this.outlineMat.opacity = active ? 0.35 : 0.16;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.outline.geometry.dispose();
    this.fill.geometry.dispose();
    this.outlineMat.dispose();
    this.fillMat.dispose();
  }
}
