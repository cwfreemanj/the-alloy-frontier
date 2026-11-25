// Meshy GLBs → game-ready models (apps/web/public/models/authored/).
//
// Input: source-assets/meshy/<id>.glb (git-ignored raw downloads; see ASSET_PROVENANCE.md for
// the Meshy task of each). Output per model: WebP textures (1024 px for close-up props, 512 px
// for scenery), welded + meshopt-compressed geometry, the model moved so its footprint centre is
// at x = z = 0 and its lowest point at y = 0, plus manifest.json with sizes and content hashes.
//
//   cd tools/asset-pipeline && npm install && node meshy.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, textureCompress, weld, flatten, join as joinMeshes } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = process.env.MESHY_SRC ?? join(ROOT, 'source-assets/meshy');
const OUT = join(ROOT, 'apps/web/public/models/authored');

/** id → texture size. Hero props seen up close get 1024 px. */
const MODELS = {
  forge_anvil: 1024,
  forge_hearth: 1024,
  emberwake: 1024,
  forge_bellows: 512,
  forge_trough: 512,
  forge_rack: 512,
  forge_workbench: 512,
  forge_grindstone: 512,
  forge_coalbin: 512,
  chest: 512,
  pine_tall: 512,
  pine_wide: 512,
  pine_young: 512,
  oak_autumn: 512,
  tree_golden: 512,
  ironwood: 512,
  ironwood_young: 512,
  boulder: 512,
  stones: 512,
  slab: 512,
  shrub: 512,
  ferns: 512,
  cliff: 1024,
  ridge: 512,
  rockwall: 1024,
};

/** Replace zero-length normals with the area-weighted normal of their faces (or straight up). */
function repairNormals(doc) {
  let fixed = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const nAttr = prim.getAttribute('NORMAL');
      const pAttr = prim.getAttribute('POSITION');
      if (!nAttr || !pAttr) continue;
      const count = nAttr.getCount();
      const bad = new Uint8Array(count);
      const v = [0, 0, 0];
      let any = false;
      for (let i = 0; i < count; i++) {
        nAttr.getElement(i, v);
        if (!(Math.hypot(v[0], v[1], v[2]) > 1e-4) || v.some((x) => !Number.isFinite(x))) {
          bad[i] = 1;
          any = true;
        }
      }
      if (!any) continue;
      const acc = new Float32Array(count * 3);
      const idx = prim.getIndices();
      const tri = idx ? idx.getCount() / 3 : count / 3;
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
      for (let t = 0; t < tri; t++) {
        const i0 = idx ? idx.getScalar(t * 3) : t * 3;
        const i1 = idx ? idx.getScalar(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getScalar(t * 3 + 2) : t * 3 + 2;
        if (!bad[i0] && !bad[i1] && !bad[i2]) continue;
        pAttr.getElement(i0, a);
        pAttr.getElement(i1, b);
        pAttr.getElement(i2, c);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        for (const i of [i0, i1, i2]) {
          acc[i * 3] += nx;
          acc[i * 3 + 1] += ny;
          acc[i * 3 + 2] += nz;
        }
      }
      for (let i = 0; i < count; i++) {
        if (!bad[i]) continue;
        const x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2];
        const l = Math.hypot(x, y, z);
        nAttr.setElement(i, l > 1e-12 ? [x / l, y / l, z / l] : [0, 1, 0]);
        fixed++;
      }
    }
  return fixed;
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const [id, size] of Object.entries(MODELS)) {
  const src = join(SRC, `${id}.glb`);
  if (!existsSync(src)) {
    console.warn(`skip ${id}: ${src} missing`);
    continue;
  }
  const doc = await io.read(src);
  // One mesh per material, transforms baked in.
  await doc.transform(flatten(), joinMeshes(), dedup(), prune(), weld());
  // Meshy exports some zero-length normals; the lighting shader turns those into NaN (and the
  // bloom pass spreads NaN over the whole screen). Rebuild them from the faces around them.
  const fixed = repairNormals(doc);
  if (fixed) console.log(`${id}: repaired ${fixed} zero-length normals`);
  // Footprint centre at the origin, lowest point on the ground.
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const off = [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2];
  for (const node of doc.getRoot().listNodes()) {
    if (node.getParentNode()) continue;
    const t = node.getTranslation();
    node.setTranslation([t[0] + off[0], t[1] + off[1], t[2] + off[2]]);
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const bytes = await io.writeBinary(doc);
  writeFileSync(join(OUT, `${id}.glb`), bytes);
  const nb = getBounds(doc.getRoot().listScenes()[0]);
  const tris = doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  manifest[id] = {
    size: [+(nb.max[0] - nb.min[0]).toFixed(3), +(nb.max[1] - nb.min[1]).toFixed(3), +(nb.max[2] - nb.min[2]).toFixed(3)],
    tris: Math.round(tris),
    bytes: bytes.byteLength,
    hash: createHash('sha256').update(bytes).digest('hex').slice(0, 10),
  };
  console.log(`${id.padEnd(18)} ${(readFileSync(src).byteLength / 1e6).toFixed(1)} MB -> ${(bytes.byteLength / 1e3).toFixed(0)} KB, ${manifest[id].tris} tris, size ${manifest[id].size.join(' x ')}`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`total ${(Object.values(manifest).reduce((a, m) => a + m.bytes, 0) / 1e6).toFixed(2)} MB`);
