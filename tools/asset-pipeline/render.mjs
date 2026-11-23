// CPU contact-sheet renderer: load GLBs with three's GLTFLoader, play retargeted clips,
// skin vertices on the CPU and splat them into PNGs. Lets us check poses without a GPU.
import './env.mjs';
import fs from 'node:fs';
import sharp from 'sharp';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { captureRest, retargetClip } from './retarget.mjs';

globalThis.Image = class {
  constructor() {
    this.height = 1;
    this.width = 1;
  }
  set src(v) {
    setTimeout(() => this.onload?.());
  }
};
THREE.TextureLoader.prototype.load = function (url, onLoad) {
  const t = new THREE.Texture();
  setTimeout(() => onLoad?.(t));
  return t;
};
delete globalThis.createImageBitmap;

export async function loadGlb(path) {
  const buf = fs.readFileSync(path);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}

/** Procedural-sword placement in RightHand space (same math as the game). */
export function swordFrame(hand, handLenCm, refHandLenCm) {
  const k = handLenCm / refHandLenCm;
  const grip = new THREE.Vector3().fromArray(hand.grip).multiplyScalar(k);
  const y = new THREE.Vector3().fromArray(hand.dir).negate(); // blade runs along local -Y
  const x = new THREE.Vector3().fromArray(hand.width);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return { grip, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
}

export async function contactSheet({ charGlb, animGlb, clipIds, frames = 6, out, hand, handLenCm, refHandLenCm, bladeM = 1.05, label = '', scale = 0.55, W = 160, H = 240, times = null }) {
  const ch = await loadGlb(charGlb);
  const an = await loadGlb(animGlb);
  const root = ch.scene;
  const rest = captureRest(root);
  const meshes = [];
  root.traverse((o) => o.isSkinnedMesh && meshes.push(o));
  const mixer = new THREE.AnimationMixer(root);
  let rightHand;
  root.traverse((o) => o.isBone && o.name === 'RightHand' && (rightHand = o));
  const rows = clipIds.length;
  const img = Buffer.alloc(W * frames * 2 * H * rows * 3, 30);
  const tiles = W * frames * 2;
  const v = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const lib = an.animations.find((a) => a.name === clipIds[r]);
    if (!lib) {
      console.log('missing clip', clipIds[r]);
      continue;
    }
    const clip = retargetClip(lib, rest);
    mixer.stopAllAction();
    const act = mixer.clipAction(clip);
    act.reset().play();
    for (let f = 0; f < frames; f++) {
      act.time = times ? Math.min(clip.duration - 1e-3, times[r][f]) : (clip.duration * f) / (frames - 1) - (f === frames - 1 ? 1e-3 : 0);
      mixer.update(0);
      root.updateMatrixWorld(true);
      for (const m of meshes) m.skeleton.update();
      const pts = [];
      for (const m of meshes) {
        const n = m.geometry.attributes.position.count;
        for (let i = 0; i < n; i += 2) {
          m.getVertexPosition(i, v);
          v.applyMatrix4(m.matrixWorld);
          pts.push(v.x, v.y, v.z);
        }
      }
      // Sword blade (red), drawn densely.
      const blade = [];
      if (hand && rightHand) {
        const sf = swordFrame(hand, handLenCm, refHandLenCm);
        const ws = new THREE.Vector3();
        rightHand.getWorldScale(ws);
        const g = new THREE.Object3D();
        g.position.copy(sf.grip);
        g.quaternion.copy(sf.quat);
        g.scale.setScalar(1 / ws.x);
        rightHand.add(g);
        g.updateMatrixWorld(true);
        for (let s = 0; s <= 40; s++) blade.push(new THREE.Vector3(0, (-s / 40) * bladeM * 100, 0).applyMatrix4(g.matrixWorld));
        rightHand.remove(g);
      }
      for (let view = 0; view < 2; view++) {
        const ox = (f * 2 + view) * W;
        const oy = r * H;
        const zbuf = new Float32Array(W * H).fill(-1e9);
        const put = (x, y, z, col) => {
          // view 0: front (looking at the face, from +Z); view 1: side (from +X)
          const sx = view === 0 ? x : -z;
          const sz = view === 0 ? z : x;
          const px = Math.round(W / 2 + sx * scale);
          const py = Math.round(H - 12 - y * scale);
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const X = px + dx;
              const Y = py + dy;
              if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
              if (sz < zbuf[Y * W + X]) continue;
              zbuf[Y * W + X] = sz;
              const o = ((oy + Y) * tiles + ox + X) * 3;
              img[o] = col[0];
              img[o + 1] = col[1];
              img[o + 2] = col[2];
            }
        };
        for (let i = 0; i < pts.length; i += 3) {
          const shade = Math.max(60, Math.min(255, 150 + (view === 0 ? pts[i + 2] : pts[i]) * 2.2));
          put(pts[i], pts[i + 1], pts[i + 2], [shade, shade, shade * 0.9]);
        }
        for (const b of blade) put(b.x, b.y, b.z + 1000, [255, 60, 40]);
      }
    }
  }
  await sharp(img, { raw: { width: tiles, height: H * rows, channels: 3 } })
    .png()
    .toFile(out);
  console.log('wrote', out, label);
}
