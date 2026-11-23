// Build every character GLB + the animation library + manifest.json into apps/web/public/models.
// Usage: see README.md in this folder.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { convertCharacter } from './character.mjs';
import { writeAnims } from './anims.mjs';
import { OUT, SOURCE } from './paths.mjs';
const AF = `${SOURCE}/AF Zipped`;
fs.mkdirSync(OUT, { recursive: true });
const chars = {
  maria: { src: `${AF}/Maria WProp J J Ong.fbx`, removeMeshes: ['Maria_sword'], measureProp: 'Maria_sword', name: 'Maria', credit: 'Maria WProp (J J Ong)' },
  exo: { src: `${AF}/Exo Gray.fbx`, name: 'Exo Gray', credit: 'Exo Gray' },
  eve: { src: `${AF}/Eve By J.Gonzales.fbx`, name: 'Eve', credit: 'Eve (J. Gonzales)' },
  demon: { src: `${AF}/Demon T Wiezzorek.fbx`, name: 'Demon T', credit: 'Demon T (Wiezzorek)' },
  heraklios: { src: `${AF}/Heraklios By A. Dizon.fbx`, name: 'Heraklios', credit: 'Heraklios (A. Dizon)' },
  maw: { src: `${AF}/Maw J Laygo.fbx`, name: 'Maw J Laygo', credit: 'Maw J Laygo' },
};
const clips = {
  // Player (Maria / Exo Gray)
  p_idle: { src: ['ss', 'sword and shield idle'] },
  p_walk: { src: ['ss', 'sword and shield walk'] },
  p_run: { src: ['ss', 'sword and shield run'] },
  p_back: { src: ['axe', 'standing walk back'] },
  p_strafe_l: { src: ['ss', 'sword and shield strafe (3)'] },
  p_strafe_r: { src: ['ss', 'sword and shield strafe (4)'] },
  p_light1: { src: ['ss', 'sword and shield slash'] },
  p_light2: { src: ['ss', 'sword and shield attack (2)'] },
  p_light3: { src: ['ss', 'sword and shield attack'] },
  p_heavy: { src: ['gs', 'great sword slash'] },
  p_guardbreaker: { src: ['gs', 'great sword kick'], effector: 'RightFoot' },
  p_storm_arc: { src: ['gs', 'great sword high spin attack'] },
  p_block: { src: ['ss', 'sword and shield block idle'] },
  p_dodge: { src: ['ss', 'sword and shield crouch'] },
  p_stagger: { src: ['ss', 'sword and shield impact (3)'] },
  p_death: { src: ['ss', 'sword and shield death'] },
  p_jump: { src: ['gs', 'great sword jump (2)'] },
  chop: { src: ['axe', 'standing melee attack downward'] },
  // NPCs
  npc_happy: { src: ['af', 'Happy Idle'] },
  npc_look: { src: ['axe', 'unarmed idle looking ver. 1'] },
  // Scavenger (Heraklios)
  sc_idle: { src: ['axe', 'standing idle'] },
  sc_walk: { src: ['axe', 'standing walk forward'] },
  sc_run: { src: ['axe', 'standing run forward'] },
  sc_slash: { src: ['axe', 'standing melee attack horizontal'] },
  sc_stagger: { src: ['axe', 'standing react large gut'] },
  sc_guard: { src: ['axe', 'standing block idle'] },
  sc_death: { src: ['gs', 'two handed sword death'] },
  // Boss (Maw J Laygo)
  bo_idle: { src: ['gs', 'great sword idle'] },
  bo_walk: { src: ['gs', 'great sword walk'] },
  bo_run: { src: ['gs', 'great sword run'] },
  bo_sweep: { src: ['gs', 'great sword slash (5)'] },
  bo_slam: { src: ['gs', 'great sword jump attack'] },
  bo_lunge: { src: ['gs', 'great sword attack'] },
  bo_stagger: { src: ['gs', 'great sword impact'] },
  bo_death: { src: ['gs', 'two handed sword death (2)'] },
};
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
const manifest = { version: 1, characters: {}, anims: null, clips: {} };
for (const [id, c] of Object.entries(chars)) {
  const out = `${OUT}/${id}.glb`;
  const m = await convertCharacter({ src: c.src, out, removeMeshes: c.removeMeshes ?? [], measureProp: c.measureProp ?? null });
  manifest.characters[id] = { file: `${id}.glb`, v: hash(out), name: c.name, heightCm: +m.heightCm.toFixed(2), hipsY: +m.hipsY.toFixed(2), handLenCm: +m.handLenCm.toFixed(2), hand: m.hand ? { grip: m.hand.grip.map((v) => +v.toFixed(3)), dir: m.hand.dir.map((v) => +v.toFixed(4)), width: m.hand.width.map((v) => +v.toFixed(4)) } : undefined };
  console.log(id, (m.bytes / 1024).toFixed(0), 'KB', 'height', m.heightCm.toFixed(1));
}
const { meta, bytes } = await writeAnims(clips, `${OUT}/anims.glb`);
manifest.anims = { file: 'anims.glb', v: hash(`${OUT}/anims.glb`) };
manifest.clips = meta;
console.log('anims', (bytes / 1024).toFixed(0), 'KB');
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n');
