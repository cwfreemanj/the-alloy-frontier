/**
 * A live 3D view of the player's character for the Character screen: the chosen model with
 * the equipped weapon, playing its idle animation. Drag to turn it.
 *
 * It has its own small renderer, created when the screen opens and disposed when it closes,
 * so the main scene is untouched.
 */
import * as THREE from 'three';
import type { ItemInstance } from '@alloy/item-gen';
import { makePlayerBody } from '../entities/Player';
import { CharacterBody, type PlayerCharacterId } from '../entities/models/Characters';
import { buildSword } from '../entities/Weapons';

export class CharacterPreview {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private pivot = new THREE.Group();
  private body: ReturnType<typeof makePlayerBody> | null = null;
  private raf = 0;
  private last = 0;
  private yaw = Math.PI + 0.55; // three-quarter view from behind, like the mockup; drag to turn
  private drag: { x: number; yaw: number } | null = null;
  private disposed = false;

  constructor(character: PlayerCharacterId, weapon: ItemInstance | null) {
    this.canvas.className = 'cs-preview';
    this.canvas.setAttribute('aria-label', 'Your character');
    this.canvas.setAttribute('data-testid', 'character-preview');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    } catch {
      this.renderer = null; // no WebGL: the screen still works without the model
      return;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene.add(new THREE.HemisphereLight('#ffe2c4', '#1a1410', 1.4));
    const key = new THREE.DirectionalLight('#ffb070', 2.2);
    key.position.set(2, 3, 3);
    const rim = new THREE.DirectionalLight('#4fe3ff', 1.6);
    rim.position.set(-3, 2, -2);
    this.scene.add(key, rim);

    const body = makePlayerBody(character);
    this.body = body;
    body.rHand.add(buildSword(weapon).group);
    this.pivot.add(body.root);
    this.scene.add(this.pivot);
    this.camera.position.set(0, 1.05, 5.2);
    this.camera.lookAt(0, 0.92, 0);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, yaw: this.yaw };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012;
    });
    const end = () => (this.drag = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number): void {
    if (this.disposed || !this.renderer) return;
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
    this.last = t;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      const c = this.renderer.domElement;
      const pr = this.renderer.getPixelRatio();
      if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.pivot.rotation.y = this.yaw;
      if (this.body instanceof CharacterBody) this.body.update(dt, { kind: 'loco', speed: 0 });
      this.renderer.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.body instanceof CharacterBody) this.body.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
