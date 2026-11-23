// Convert a Mixamo character FBX into a game-ready GLB (one skeleton, plain bone names,
// webp textures at <=1024px, meshopt-compressed) plus metadata.
import { blobStore, parseFile, strip } from './lib.mjs';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

export async function convertCharacter({ src, out, removeMeshes = [], measureProp = null, texSize = 1024 }) {
  const { root } = parseFile(src);
  root.updateMatrixWorld(true);
  const skins = [];
  root.traverse((o) => o.isSkinnedMesh && skins.push(o));

  // ---- One canonical bone per name (FBXLoader gives each skin its own copy).
  skins.sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length);
  const canon = {};
  for (const s of skins) for (const b of s.skeleton.bones) canon[strip(b.name)] ??= b;
  const allBones = Object.values(canon);
  const canonSet = new Set(allBones);
  // Parent of a canonical bone: nearest ancestor with a different bone name, mapped to its canonical copy.
  const parentOf = (b) => {
    let p = b.parent;
    while (p && /mixamorig/.test(p.name) && strip(p.name) === strip(b.name)) p = p.parent;
    if (p && /mixamorig/.test(p.name)) return canon[strip(p.name)];
    return null;
  };
  const worldOf = new Map(allBones.map((b) => [b, b.matrixWorld.clone()]));
  const out3 = new THREE.Group();
  out3.name = 'Character';
  const rels = allBones.map((b) => [b, parentOf(b)]);
  for (const [b] of rels) b.removeFromParent();
  for (const [b, p] of rels) {
    (p ?? out3).add(b);
  }
  // Restore rest transforms from world matrices (parent chain is now canonical).
  out3.updateMatrixWorld(true);
  const ordered = [];
  const visit = (o) => {
    if (canonSet.has(o)) ordered.push(o);
    o.children.forEach(visit);
  };
  visit(out3);
  for (const b of ordered) {
    const parentWorld = b.parent === out3 ? new THREE.Matrix4() : b.parent.matrixWorld;
    const local = parentWorld.clone().invert().multiply(worldOf.get(b));
    local.decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld(true);
  }
  // Drop stray non-canonical children (duplicate bone copies) left under canonical bones.
  for (const b of ordered) for (const c of [...b.children]) if (/mixamorig/.test(c.name) && !canonSet.has(c)) b.remove(c);
  for (const b of allBones) b.name = strip(b.name);

  // ---- Measure a prop (Maria's sword) in RightHand space, then remove props.
  let hand = null;
  const hips = canon.Hips;
  if (measureProp) {
    const prop = skins.find((s) => s.name === measureProp);
    const rh = canon.RightHand;
    const pts = [];
    const v = new THREE.Vector3();
    const inv = rh.matrixWorld.clone().invert();
    for (let i = 0; i < prop.geometry.attributes.position.count; i++) {
      v.fromBufferAttribute(prop.geometry.attributes.position, i).applyMatrix4(prop.matrixWorld).applyMatrix4(inv);
      pts.push(v.clone());
    }
    // Principal axis via power iteration on the covariance.
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of pts) {
      const d = [p.x - c.x, p.y - c.y, p.z - c.z];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j];
    }
    const pca = (exclude) => {
      let x = new THREE.Vector3(1, 0.3, 0.2);
      for (let k = 0; k < 64; k++) {
        if (exclude) x.addScaledVector(exclude, -x.dot(exclude));
        x = new THREE.Vector3(cov[0] * x.x + cov[1] * x.y + cov[2] * x.z, cov[3] * x.x + cov[4] * x.y + cov[5] * x.z, cov[6] * x.x + cov[7] * x.y + cov[8] * x.z).normalize();
      }
      if (exclude) x.addScaledVector(exclude, -x.dot(exclude)).normalize();
      return x;
    };
    let axis = pca(null);
    // Blade points away from the hand (origin).
    const proj = pts.map((p) => p.dot(axis));
    const far = Math.max(...proj);
    const near = Math.min(...proj);
    if (Math.abs(near) > Math.abs(far)) axis.negate();
    const proj2 = pts.map((p) => p.dot(axis));
    const lo = Math.min(...proj2);
    const hi = Math.max(...proj2);
    const width = pca(axis);
    // Grip: the point on the blade axis closest to the hand origin.
    const gripT = Math.max(lo, Math.min(hi, 0));
    const grip = c.clone().add(axis.clone().multiplyScalar(gripT - c.dot(axis)));
    hand = { grip: grip.toArray(), dir: axis.toArray(), width: width.toArray(), lengthCm: hi - lo, fromHandToTip: hi, fromHandToPommel: lo };
  }

  // ---- Rebind every skin to the canonical skeleton.
  const keep = [];
  for (const s of skins) {
    if (removeMeshes.includes(s.name) || s.geometry.attributes.position.count === 0) continue;
    const bones = s.skeleton.bones.map((b) => canon[strip(b.name)] ?? canon[b.name]);
    if (bones.some((b) => !b)) throw new Error(`unmapped bone in ${s.name}`);
    const world = s.matrixWorld.clone();
    s.removeFromParent();
    out3.add(s);
    world.decompose(s.position, s.quaternion, s.scale);
    s.updateMatrixWorld(true);
    s.bind(new THREE.Skeleton(bones, s.skeleton.boneInverses), s.matrixWorld);
    keep.push(s);
  }

  // ---- Materials: standard PBR, textures attached afterwards (by unique material name).
  const texJobs = new Map();
  let mi = 0;
  const conv = (m) => {
    const src = (t) => (t?.userData?.src ? t.userData.src : null);
    const sig = `${src(m.map)}|${src(m.normalMap)}|${src(m.emissiveMap)}|${m.transparent}`;
    if (!texJobs.has(sig)) {
      const name = `m${mi++}_${m.name.replace(/[^\w]/g, '')}`;
      const nm = new THREE.MeshStandardMaterial({ name, color: 0xffffff, roughness: 0.72, metalness: 0.08 });
      if (m.transparent) {
        nm.alphaTest = /spec/i.test(m.name) ? 0 : 0.5;
        nm.transparent = /spec/i.test(m.name);
        nm.side = THREE.DoubleSide;
      }
      if (m.emissiveMap) nm.emissive = new THREE.Color(0xffffff);
      texJobs.set(sig, { mat: nm, map: src(m.map), normal: src(m.normalMap), emissive: src(m.emissiveMap), alpha: !!m.transparent });
    }
    return texJobs.get(sig).mat;
  };
  for (const s of keep) {
    s.material = Array.isArray(s.material) ? s.material.map(conv) : conv(s.material);
    const g = s.geometry;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    s.castShadow = true;
  }

  // ---- Bind-pose measurements.
  out3.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const s of keep) {
    s.geometry.computeBoundingBox();
    const v = new THREE.Vector3();
    const pos = s.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 7) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(s.matrixWorld));
  }
  const meta = {
    heightCm: box.max.y - box.min.y,
    footY: box.min.y,
    hipsY: hips.position.y,
    hand,
    handLenCm: canon.RightHandMiddle1 ? canon.RightHandMiddle1.position.length() : 8,
  };

  // ---- Export.
  const glb = await new GLTFExporter().parseAsync(out3, { binary: true, onlyVisible: false, animations: [] });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await MeshoptEncoder.ready;
  const doc = await io.readBinary(new Uint8Array(glb));
  const R = doc.getRoot();
  for (const job of texJobs.values()) {
    const mat = R.listMaterials().find((m) => m.getName() === job.mat.name);
    if (!mat) continue;
    const tex = async (id, slot) => {
      const blob = id ? blobStore.get(id) : null;
      if (!blob) return null;
      const bytes = Buffer.from(await blob.arrayBuffer());
      const png = await sharp(bytes).png().toBuffer();
      const t = doc.createTexture(`${job.mat.name}_${slot}`).setImage(png).setMimeType('image/png');
      return t;
    };
    const base = await tex(job.map, 'base');
    if (base) mat.setBaseColorTexture(base);
    const nrm = await tex(job.normal, 'normal');
    if (nrm) mat.setNormalTexture(nrm);
    const em = await tex(job.emissive, 'emissive');
    if (em) mat.setEmissiveTexture(em).setEmissiveFactor([1, 1, 1]);
    if (job.alpha) mat.setAlphaMode(job.mat.transparent ? 'BLEND' : 'MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  }
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }),
    quantize({ quantizeNormal: 10, quantizeTexcoord: 12, quantizePosition: 14 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(out, bytes);
  return { ...meta, bytes: bytes.byteLength };
}
