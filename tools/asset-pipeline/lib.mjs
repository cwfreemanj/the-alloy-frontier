import { blobStore } from './env.mjs';
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';

THREE.TextureLoader.prototype.load = function (url) {
  const t = new THREE.Texture();
  t.userData.src = url;
  return t;
};
const quiet = console.warn;
console.warn = (...a) => {
  const s = String(a[0]);
  if (s.includes('not supported') || s.includes('File version') || s.includes('ColladaLoader')) return;
  quiet(...a);
};

export const strip = (n) => n.replace(/^.*mixamorig\d*[:_]?/, '');
export { blobStore };

export function parseFile(path) {
  const buf = fs.readFileSync(path);
  if (path.toLowerCase().endsWith('.dae')) {
    // Mixamo's .dae downloads are often zip archives holding the real .dae.
    let text = buf.toString('utf8');
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const files = unzipSync(new Uint8Array(buf));
      const name = Object.keys(files).find((n) => n.toLowerCase().endsWith('.dae'));
      text = strFromU8(files[name]);
    }
    const c = new ColladaLoader().parse(text, '');
    const scene = c.scene;
    const clip = scene.animations?.[0] ?? null;
    if (clip) {
      // Tracks target node uuids; rename them to (stripped) node names.
      for (const t of clip.tracks) {
        const [uuid, prop] = t.name.split('.');
        const node = scene.getObjectByProperty('uuid', uuid);
        t.name = `${node ? node.name : uuid}.${prop}`;
      }
    }
    return { root: scene, clip };
  }
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = root.animations.filter((a) => a.tracks.length).sort((a, b) => b.duration - a.duration)[0] ?? null;
  return { root, clip };
}

/** First node of each stripped bone name. */
export function boneMap(root) {
  const m = {};
  root.traverse((o) => {
    if (!/mixamorig/.test(o.name)) return;
    const n = strip(o.name);
    if (!m[n]) m[n] = o;
  });
  return m;
}

const restCache = new Map();
export const EFFECTORS = ['RightHand', 'LeftHand', 'RightFoot', 'LeftFoot'];
const FPS = 30;

/**
 * Sample a clip into rest-relative data:
 *  q[bone][frame] = inverse(restLocal) * animatedLocal     (rotation delta in the bone's rest frame)
 *  hips[frame]    = (hipsPos - restHipsPos) / restHipsHeight, horizontal travel removed
 * plus effector speed curves (for finding the strike moment).
 */
export function sampleClip(animPath, restPath = null) {
  const { root, clip } = parseFile(animPath);
  if (!clip) throw new Error(`no animation in ${animPath}`);
  const bones = boneMap(root);
  if (restPath && !restCache.has(restPath)) restCache.set(restPath, boneMap(parseFile(restPath).root));
  const rest = restPath ? restCache.get(restPath) : null;
  // Rest pose: the reference file (DAE packs), or this file's own nodes before playing (FBX: T-pose).
  const restQ = {};
  const restP = {};
  for (const [n, b] of Object.entries(bones)) {
    const r = rest?.[n] ?? b;
    restQ[n] = r.quaternion.clone();
    restP[n] = r.position.clone();
  }
  const hipH = restP.Hips.y;
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const names = Object.keys(bones).filter((n) => !/_End$|End$|Top_End/.test(n) && clip.tracks.some((t) => strip(t.name.split('.')[0]) === n || t.name.split('.')[0] === bones[n].name));
  const q = Object.fromEntries(names.map((n) => [n, []]));
  const hips = [];
  const eff = Object.fromEntries(EFFECTORS.map((e) => [e, []]));
  const inv = new THREE.Matrix4();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration - 1e-4, f / FPS);
    action.time = t;
    mixer.update(0);
    root.updateMatrixWorld(true);
    for (const n of names) {
      const d = restQ[n].clone().invert().multiply(bones[n].quaternion);
      q[n].push([d.x, d.y, d.z, d.w]);
    }
    const p = bones.Hips.position;
    hips.push([(p.x - restP.Hips.x) / hipH, (p.y - restP.Hips.y) / hipH, (p.z - restP.Hips.z) / hipH]);
    // Effector positions relative to the hips' parent (character space), in hip-height units.
    inv.copy(bones.Hips.parent.matrixWorld).invert();
    for (const e of EFFECTORS) {
      if (!bones[e]) continue;
      const w = new THREE.Vector3().setFromMatrixPosition(bones[e].matrixWorld).applyMatrix4(inv).divideScalar(hipH);
      eff[e].push(w.toArray());
    }
  }
  // Remove horizontal travel (the game moves characters itself), keep sway.
  const a = hips[0].slice();
  const z = hips[hips.length - 1].slice();
  for (let f = 0; f < frames; f++) {
    const k = f / (frames - 1);
    const dx = a[0] + (z[0] - a[0]) * k;
    const dz = a[2] + (z[2] - a[2]) * k;
    hips[f][0] -= dx;
    hips[f][2] -= dz;
    for (const e of EFFECTORS) if (eff[e][f]) {
      eff[e][f][0] -= dx;
      eff[e][f][2] -= dz;
    }
  }
  // Effector speed (hip-heights per second), lightly smoothed.
  const speed = {};
  for (const e of EFFECTORS) {
    const pts = eff[e];
    if (!pts.length) continue;
    const s = pts.map((p, i) => (i === 0 ? 0 : Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) * FPS));
    speed[e] = s.map((_, i) => (s[Math.max(0, i - 1)] + 2 * s[i] + s[Math.min(s.length - 1, i + 1)]) / 4);
  }
  const dur = (frames - 1) / FPS;
  const travel = [(z[0] - a[0]) / dur, (z[2] - a[2]) / dur];
  return { duration: dur, fps: FPS, frames, q, hips, speed, travel, eff };
}

export function peakOf(sample, effector = 'RightHand', from = 0, to = 1) {
  const s = sample.speed[effector];
  let best = 0;
  let bi = 0;
  const lo = Math.floor(from * (s.length - 1));
  const hi = Math.ceil(to * (s.length - 1));
  for (let i = lo; i <= hi; i++)
    if (s[i] > best) {
      best = s[i];
      bi = i;
    }
  return { t: bi / sample.fps, speed: best };
}
