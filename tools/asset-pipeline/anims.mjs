// Write a set of rest-relative clips into one compact GLB (+ metadata).
import { sampleClip, peakOf } from './lib.mjs';
import fs from 'node:fs';
import { Document, NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

import { SOURCE } from './paths.mjs';
/** Animation packs. DAE packs are retargeted against their pack's own T-pose character. */
export const SRC = {
  ss: (n) => ({ file: `${SOURCE}/Sword_and_Shield_Pack/${n}.fbx`, rest: null }),
  gs: (n) => ({ file: `${SOURCE}/Great_Sword_Pack/${n}.dae`, rest: `${SOURCE}/Great_Sword_Pack/Y Bot.dae` }),
  axe: (n) => ({ file: `${SOURCE}/Pro_Melee_Axe_Pack/${n}.dae`, rest: `${SOURCE}/Pro_Melee_Axe_Pack/Ch50_nonPBR.dae` }),
  af: (n) => ({ file: `${SOURCE}/AF Zipped/${n}.fbx`, rest: null }),
};

/**
 * clips: { id: { src: [pack, name], effector?, peakWindow?: [from,to] } }
 * Returns metadata per clip.
 */
export async function writeAnims(clips, outGlb) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Anims');
  const nodes = new Map();
  const node = (name) => {
    if (!nodes.has(name)) {
      const n = doc.createNode(name);
      scene.addChild(n);
      nodes.set(name, n);
    }
    return nodes.get(name);
  };
  const meta = {};
  for (const [id, c] of Object.entries(clips)) {
    const { file, rest } = SRC[c.src[0]](c.src[1]);
    const s = sampleClip(file, rest);
    const eff = c.effector ?? 'RightHand';
    const pk = peakOf(s, eff, ...(c.peakWindow ?? [0, 1]));
    meta[id] = { source: `${c.src[0]}:${c.src[1]}`, duration: +s.duration.toFixed(4), peak: +pk.t.toFixed(4), effector: eff, travel: s.travel.map((v) => +v.toFixed(4)) };
    const anim = doc.createAnimation(id);
    const times = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Float32Array(Array.from({ length: s.frames }, (_, i) => i / s.fps))).setBuffer(buffer);
    for (const [bone, frames] of Object.entries(s.q)) {
      const out = doc.createAccessor().setType(Accessor.Type.VEC4).setArray(new Float32Array(frames.flat())).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(times).setOutput(out).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node(bone)).setTargetPath('rotation').setSampler(sampler));
    }
    const hp = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(s.hips.flat())).setBuffer(buffer);
    const hs = doc.createAnimationSampler().setInput(times).setOutput(hp).setInterpolation('LINEAR');
    anim.addSampler(hs).addChannel(doc.createAnimationChannel().setTargetNode(node('Hips')).setTargetPath('translation').setSampler(hs));
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await MeshoptEncoder.ready;
  await doc.transform(resample({ tolerance: 1e-4 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(outGlb, bytes);
  return { meta, bytes: bytes.byteLength };
}
