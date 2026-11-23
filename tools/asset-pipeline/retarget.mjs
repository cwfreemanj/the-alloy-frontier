// Runtime-equivalent retargeting (mirrors apps/web/src/entities/models/retarget.ts).
import * as THREE from 'three';

export function captureRest(root) {
  const rest = {};
  root.traverse((o) => {
    if (o.isBone) rest[o.name] = { q: o.quaternion.clone(), p: o.position.clone() };
  });
  return rest;
}

/** Turn a rest-relative library clip into a clip for a specific character. */
export function retargetClip(clip, rest) {
  const hipsH = rest.Hips?.p.y ?? 100;
  const tracks = [];
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    const r = rest[bone];
    if (!r) continue;
    if (prop === 'quaternion') {
      const v = new Float32Array(t.values.length);
      const d = new THREE.Quaternion();
      const q = new THREE.Quaternion();
      for (let i = 0; i < v.length; i += 4) {
        d.fromArray(t.values, i);
        q.copy(r.q).multiply(d).toArray(v, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, v));
    } else if (prop === 'position' && bone === 'Hips') {
      const v = new Float32Array(t.values.length);
      for (let i = 0; i < v.length; i += 3) {
        v[i] = r.p.x + t.values[i] * hipsH;
        v[i + 1] = r.p.y + t.values[i + 1] * hipsH;
        v[i + 2] = r.p.z + t.values[i + 2] * hipsH;
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
