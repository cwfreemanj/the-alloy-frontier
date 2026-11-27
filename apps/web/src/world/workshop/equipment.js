// Procedural equipment for The Alloy Frontier, smithed from resources and fitted to the Ch36 mannequin.
//
//   generateEquipment(type, spec) -> workshop recipe (editable parts of the shared shape kit)
//
// The pipeline, all seeded and deterministic:
//   1. Ingredients -> compound (resources.js): proportions blend trait vectors (density, heat, growth,
//      tech, organic, void, celestial, cold...), pick a construction family and list reactions.
//   2. Compound -> morphology: the family and traits set proportions (length / width / bulk) and choose
//      a silhouette from the item's shape grammar (62% the family's signature forms, else any form).
//   3. Silhouette -> parts: every builder reads the compound for material roles (forged stock, dark
//      stock, polished edges, trim, shards, grown crystal, light channels, cloth, leather, timber),
//      for family motifs (crystal growths, rivets and slabs, leaves and roots, rails and gears, sun
//      disks, crescents and hooks, swept fins, filigree) and for reactions.
//   4. Rarity adds ornament on top (gems in the rarity colour, fullers and runes, halos at mythic).
//
// Space: item pieces (weapons, tools, shields, rings) stand on y = 0 with meta.grip / meta.tip.
// Worn pieces are authored on the Ch36 mannequin in its T-pose rest (metres, facing +Z, the figure's
// left on +X), sized from measured cross-sections of its skin (body.js), and every part names the
// bone it rides on, so the Forge can pose the figure and a game can parent pieces to a Mixamo rig.
import * as THREE from 'three';
import { part } from './core.js';
import { MANNEQUIN } from './body.js';
import { FAMILIES, RESOURCES, synthesizeCompound, normalizeIngredients, recipeFromBlend, BLENDS, rng, hashSeed } from './resources.js';

export const GENERATOR = 'alloy-equipment';
export const GENERATOR_VERSION = 2;
export { MANNEQUIN };

export const RARITIES = [
  { id: 'common', label: 'Common', color: '#b9b4aa' },
  { id: 'uncommon', label: 'Uncommon', color: '#6fd17a' },
  { id: 'rare', label: 'Rare', color: '#4fa8ff' },
  { id: 'epic', label: 'Epic', color: '#b57bff' },
  { id: 'legendary', label: 'Legendary', color: '#ffb03a' },
  { id: 'mythic', label: 'Mythic', color: '#ff5a7a' },
];
const RARITY_INDEX = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

/** Shape grammars: silhouette id -> label, and each family's signature silhouettes. */
const SWORD_SHAPES = { straight: 'Tempered straight blade', leaf: 'Leaf blade', sabre: 'Swept sabre', serpentine: 'Serpentine flame blade', cleaver: 'Broad war cleaver', needle: 'Long needle blade', forked: 'Forked twin edge', shard: 'Grown crystal blade', segmented: 'Linked rail blade', falchion: 'Clip-point falchion' };
const SWORD_PREFS = { crystalline: ['shard', 'forked', 'leaf'], bulwark: ['cleaver', 'straight'], sylvan: ['leaf', 'sabre'], artificer: ['segmented', 'straight'], celestial: ['straight', 'leaf'], void: ['serpentine', 'forked'], tempest: ['sabre', 'falchion'], duelist: ['needle', 'straight'] };
const LIMB_SHAPES = { plate: 'Fluted plate', lamellar: 'Overlapping lames', ribs: 'Bound ribs', geode: 'Crystal-grown', frame: 'Open rail frame', wrap: 'Strapped wrap' };
const LIMB_PREFS = { crystalline: ['geode', 'plate'], bulwark: ['plate', 'lamellar'], sylvan: ['wrap', 'ribs'], artificer: ['frame', 'plate'], celestial: ['lamellar', 'plate'], void: ['ribs', 'geode'], tempest: ['lamellar', 'wrap'], duelist: ['wrap', 'plate'] };

export const EQUIPMENT_TYPES = [
  { id: 'greatsword', label: 'Greatsword', group: 'Weapons', slot: 'two_hand', space: 'item', shapes: SWORD_SHAPES, prefs: SWORD_PREFS },
  { id: 'long_sword', label: 'Long sword', group: 'Weapons', slot: 'main_hand', space: 'item', shapes: SWORD_SHAPES, prefs: SWORD_PREFS },
  { id: 'short_sword', label: 'Short sword', group: 'Weapons', slot: 'main_hand', space: 'item', shapes: SWORD_SHAPES, prefs: SWORD_PREFS },
  { id: 'dagger', label: 'Dagger', group: 'Weapons', slot: 'main_hand', space: 'item', shapes: SWORD_SHAPES, prefs: SWORD_PREFS },
  { id: 'axe', label: 'Axe', group: 'Weapons', slot: 'main_hand', space: 'item', shapes: { bearded: 'Deep bearded axe', double: 'Double crescent', felling: 'Felling hatchet', hooked: 'Hooked axe', halberd: 'Hooked halberd head', rail: 'Open frame axe', knapped: 'Knapped crystal head' }, prefs: { crystalline: ['knapped', 'double'], bulwark: ['bearded', 'felling'], sylvan: ['knapped', 'felling'], artificer: ['rail', 'bearded'], celestial: ['double'], void: ['halberd', 'hooked'], tempest: ['hooked', 'felling'], duelist: ['felling', 'hooked'] } },
  { id: 'mace', label: 'Mace', group: 'Weapons', slot: 'main_hand', space: 'item', shapes: { flanged: 'Flanged mace', spiked: 'Spiked war orb', cog: 'Stacked cog mace', cage: 'Caged luminous core', cluster: 'Raw geode cluster', hammer: 'Block-head war hammer', turned: 'Turned head' }, prefs: { crystalline: ['cluster', 'cage'], bulwark: ['hammer', 'spiked'], sylvan: ['cage', 'turned'], artificer: ['cog', 'hammer'], celestial: ['flanged', 'turned'], void: ['spiked', 'cluster'], tempest: ['cage', 'flanged'], duelist: ['turned', 'cog'] } },
  { id: 'staff', label: 'Staff', group: 'Weapons', slot: 'two_hand', space: 'item', shapes: { cage: 'Caged focus crystal', orrery: 'Orrery and rings', lantern: 'Hanging lantern crook', coil: 'Tesla coil', root: 'Twisted living branch', trident: 'Trident sceptre', monolith: 'Prism monolith', sun: 'Sun disk' }, prefs: { crystalline: ['monolith', 'cage'], bulwark: ['lantern', 'monolith'], sylvan: ['root', 'cage'], artificer: ['coil', 'orrery'], celestial: ['sun', 'orrery'], void: ['lantern', 'cage'], tempest: ['trident', 'root'], duelist: ['orrery', 'cage'] } },
  { id: 'bow', label: 'Bow', group: 'Weapons', slot: 'two_hand', space: 'item', shapes: { longbow: 'Tall longbow', recurve: 'Swept recurve', compound: 'Cam-wheel compound', asymmetric: 'Asymmetric greatbow', horn: 'Twin horn bow', lattice: 'Open lattice bow' }, prefs: { crystalline: ['horn', 'recurve'], bulwark: ['compound', 'longbow'], sylvan: ['asymmetric', 'longbow'], artificer: ['compound', 'lattice'], celestial: ['longbow', 'recurve'], void: ['horn', 'recurve'], tempest: ['recurve', 'asymmetric'], duelist: ['asymmetric', 'recurve'] } },
  { id: 'shield', label: 'Shield', group: 'Weapons', slot: 'off_hand', space: 'item', shapes: { round: 'Round boss shield', heater: 'Heater shield', kite: 'Kite shield', tower: 'Tower shield', cog: 'Cog shield', crescent: 'Open crescent', petal: 'Radial petal', buckler: 'Dueling buckler', fan: 'Layered fan' }, prefs: { crystalline: ['petal', 'kite'], bulwark: ['tower', 'heater'], sylvan: ['fan', 'round'], artificer: ['cog', 'heater'], celestial: ['round', 'petal'], void: ['crescent', 'kite'], tempest: ['kite', 'fan'], duelist: ['buckler', 'heater'] } },
  { id: 'pickaxe', label: 'Pickaxe', group: 'Tools', slot: 'tool', space: 'item', shapes: { twin: 'Twin curved picks', mattock: 'Pick and adze', drill: 'Auger drill head', claw: 'Crystal claw pick', ice: 'Long ice pick', hammer: 'Pick and hammer' }, prefs: { crystalline: ['claw', 'twin'], bulwark: ['mattock', 'hammer'], sylvan: ['mattock', 'ice'], artificer: ['drill', 'hammer'], celestial: ['twin'], void: ['ice', 'claw'], tempest: ['ice', 'twin'], duelist: ['mattock', 'ice'] } },
  { id: 'helmet', label: 'Helmet / hat', group: 'Armour', slot: 'head', space: 'body', shapes: { kettle: 'Brimmed kettle helm', crested: 'Crested open helm', greathelm: 'Enclosed great helm', horned: 'Swept horn helm', hood: 'Forged hood', aviator: 'Aviator cap and goggles', tophat: 'Top hat', wizard: 'Bent wizard hat', ranger: 'Low ranger brim', crown: 'Spired crown' }, prefs: { crystalline: ['crown', 'wizard'], bulwark: ['greathelm', 'kettle'], sylvan: ['horned', 'ranger'], artificer: ['aviator', 'greathelm'], celestial: ['crown', 'crested'], void: ['hood', 'horned'], tempest: ['crested', 'ranger'], duelist: ['tophat', 'crested'] } },
  { id: 'chest', label: 'Chest / chestplate', group: 'Armour', slot: 'chest', space: 'body', shapes: { plate: 'Rounded breastplate', lamellar: 'Lamellar cuirass', brigandine: 'Riveted brigandine', jerkin: 'Buckled jerkin', harness: 'Steam harness', ribs: 'Open rib cage', robe: 'Armoured tabard robe', geode: 'Crystal carapace' }, prefs: { crystalline: ['geode', 'plate'], bulwark: ['plate', 'brigandine'], sylvan: ['jerkin', 'ribs'], artificer: ['harness', 'plate'], celestial: ['lamellar', 'plate'], void: ['ribs', 'robe'], tempest: ['robe', 'lamellar'], duelist: ['jerkin', 'brigandine'] } },
  { id: 'pauldrons', label: 'Pauldrons', group: 'Armour', slot: 'shoulders', space: 'body', shapes: { dome: 'Forged dome', lamellar: 'Overlapping lames', wing: 'Winged fan', geode: 'Geode mantle', frame: 'Open mechanical frame', wrap: 'Bound leather pad' }, prefs: { crystalline: ['geode'], bulwark: ['dome', 'lamellar'], sylvan: ['wrap', 'wing'], artificer: ['frame'], celestial: ['wing', 'lamellar'], void: ['lamellar', 'geode'], tempest: ['lamellar', 'wing'], duelist: ['wrap', 'dome'] } },
  { id: 'bracers', label: 'Bracers', group: 'Armour', slot: 'forearms', space: 'body', shapes: LIMB_SHAPES, prefs: LIMB_PREFS },
  { id: 'gloves', label: 'Gloves / gauntlets', group: 'Armour', slot: 'hands', space: 'body', shapes: { gauntlet: 'Knuckle gauntlet', lames: 'Layered finger lames', leather: 'Wrapped leather gloves', mech: 'Piston-tendon frame', claw: 'Open claw gloves', crystal: 'Crystal-backed gloves' }, prefs: { crystalline: ['crystal', 'lames'], bulwark: ['gauntlet'], sylvan: ['leather', 'claw'], artificer: ['mech', 'gauntlet'], celestial: ['lames'], void: ['claw', 'crystal'], tempest: ['lames', 'leather'], duelist: ['leather', 'lames'] } },
  { id: 'legs', label: 'Pants / platelegs', group: 'Armour', slot: 'legs', space: 'body', shapes: { platelegs: 'Plate cuisses and greaves', lamellar: 'Lamellar leg armour', splint: 'Vertical splint trousers', frame: 'Segmented field armour', trousers: 'Woven trousers', breeches: 'Strapped leather breeches' }, prefs: { crystalline: ['platelegs', 'lamellar'], bulwark: ['platelegs', 'splint'], sylvan: ['breeches', 'trousers'], artificer: ['frame', 'platelegs'], celestial: ['lamellar', 'platelegs'], void: ['splint', 'trousers'], tempest: ['trousers', 'lamellar'], duelist: ['trousers', 'breeches'] } },
  { id: 'greaves', label: 'Greaves', group: 'Armour', slot: 'shins', space: 'body', shapes: LIMB_SHAPES, prefs: LIMB_PREFS },
  { id: 'boots', label: 'Boots', group: 'Armour', slot: 'feet', space: 'body', shapes: { sabatons: 'Layered sabatons', leather: 'Buckled leather boots', trail: 'Hob-nailed trail boots', pointed: 'Long pointed boots', crystal: 'Crystal-heel boots', field: 'Wide field boots' }, prefs: { crystalline: ['crystal', 'pointed'], bulwark: ['sabatons', 'field'], sylvan: ['leather', 'trail'], artificer: ['field', 'sabatons'], celestial: ['sabatons', 'pointed'], void: ['pointed', 'crystal'], tempest: ['pointed', 'leather'], duelist: ['leather', 'pointed'] } },
  { id: 'cape', label: 'Cape', group: 'Armour', slot: 'back', space: 'body', shapes: { cloak: 'Long cloak', split: 'Twin-tail mantle', capelet: 'Short capelet', mantle: 'Shoulder mantle', ragged: 'Ragged mantle', leaves: 'Overlapping leaf cape', fan: 'Radial feather mantle', tabard: 'Narrow ceremonial backcloth' }, prefs: { crystalline: ['split', 'cloak'], bulwark: ['tabard', 'cloak'], sylvan: ['leaves', 'capelet'], artificer: ['capelet', 'tabard'], celestial: ['fan', 'cloak'], void: ['ragged', 'split'], tempest: ['cloak', 'split'], duelist: ['capelet', 'mantle'] } },
  { id: 'ring', label: 'Ring', group: 'Accessories', slot: 'ring', space: 'item', shapes: { band: 'Ridged band', setting: 'Prong-set stone', signet: 'Broad signet', cog: 'Cog-toothed band', coil: 'Aether coil', serpent: 'Coiled serpent', cluster: 'Geode cluster', thorn: 'Woven thorn' }, prefs: { crystalline: ['cluster', 'setting'], bulwark: ['signet', 'band'], sylvan: ['thorn', 'serpent'], artificer: ['cog', 'coil'], celestial: ['setting', 'signet'], void: ['serpent', 'cluster'], tempest: ['serpent', 'band'], duelist: ['setting', 'band'] } },
  { id: 'necklace', label: 'Necklace', group: 'Accessories', slot: 'neck', space: 'body', shapes: { gem: 'Set pendant stone', cog: 'Cog amulet', shard: 'Crystal shard pendant', locket: 'Clockwork locket', sunburst: 'Sunburst amulet', tusk: 'Twin fang necklace', chandelier: 'Crystal chandelier', torque: 'Open collar torque' }, prefs: { crystalline: ['chandelier', 'shard'], bulwark: ['locket', 'torque'], sylvan: ['tusk', 'gem'], artificer: ['cog', 'locket'], celestial: ['sunburst', 'gem'], void: ['tusk', 'shard'], tempest: ['chandelier', 'torque'], duelist: ['torque', 'gem'] } },
  { id: 'potion', label: 'Potion / elixir', group: 'Consumables', slot: 'consumable', space: 'item', shapes: { flask: 'Round-bottom flask', vial: 'Slim vial', phial: 'Teardrop phial', decanter: 'Cut decanter', gourd: 'Twin-bulb gourd', ampoule: 'Sealed ampoule', hipflask: 'Flat hip flask', cell: 'Caged reagent cell', orb: 'Orb on a stand' }, prefs: { crystalline: ['phial', 'decanter'], bulwark: ['hipflask', 'flask'], sylvan: ['gourd', 'flask'], artificer: ['cell', 'vial'], celestial: ['orb', 'decanter'], void: ['ampoule', 'phial'], tempest: ['phial', 'gourd'], duelist: ['vial', 'decanter'] } },
];
const TYPE = Object.fromEntries(EQUIPMENT_TYPES.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------------------------
// Maths helpers
// ---------------------------------------------------------------------------------------------
const DEG = THREE.MathUtils.radToDeg;
const RAD = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const r2 = (v) => Math.round(v * 100) / 100;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const mixc = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1)).getHexString()}`;
function eulerOf(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [r2(DEG(e.x)), r2(DEG(e.y)), r2(DEG(e.z))];
}
function quatOf(rot) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(RAD(rot[0]), RAD(rot[1]), RAD(rot[2]), 'XYZ'));
}
const aim = (dir) => eulerOf(new THREE.Quaternion().setFromUnitVectors(UP, V(dir).normalize()));
const face = (dir) => eulerOf(new THREE.Quaternion().setFromUnitVectors(ZAX, V(dir).normalize()));
const ellipsePts = (rx, ry, n = 24, cx = 0, cy = 0, phase = 0) => Array.from({ length: n }, (_, i) => [r5(cx + Math.cos((i / n) * Math.PI * 2 + phase) * rx), r5(cy + Math.sin((i / n) * Math.PI * 2 + phase) * ry)]);
const mirrorX = (pts) => pts.map(([x, y]) => [-x, y]);
const scalePts = (pts, sx, sy = sx) => pts.map(([x, y]) => [r5(x * sx), r5(y * sy)]);
function symmetric(half) {
  const back = half
    .slice()
    .reverse()
    .filter(([x]) => Math.abs(x) > 1e-6)
    .map(([x, y]) => [-x, y]);
  return [...half, ...back].map(([x, y]) => [r5(x), r5(y)]);
}
function spanAt(pts, x) {
  const ys = [];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    if ((x0 - x) * (x1 - x) <= 0 && x0 !== x1) ys.push(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
  }
  return ys.length >= 2 ? [Math.min(...ys), Math.max(...ys)] : null;
}

// ---------------------------------------------------------------------------------------------
// The mannequin's body: interpolated cross-sections from the measured tables
// ---------------------------------------------------------------------------------------------
function sample(table, s) {
  if (s <= table[0][0]) return table[0];
  for (let i = 1; i < table.length; i++)
    if (s <= table[i][0]) {
      const a = table[i - 1];
      const b = table[i];
      const t = (s - a[0]) / (b[0] - a[0]);
      return a.map((v, k) => lerp(v, b[k], t));
    }
  return table[table.length - 1];
}
/** Torso ring at height y. */
function torsoAt(y) {
  const [, x0, x1, z0, z1] = sample(MANNEQUIN.torso, y);
  return { cx: 0, cz: (z0 + z1) / 2, hx: Math.max(0.03, (x1 - x0) / 2), hz: Math.max(0.03, (z1 - z0) / 2) };
}
/** Left-leg ring at height y (pair() mirrors it for the right leg). */
function legAt(y) {
  const [, x0, x1, z0, z1] = sample(MANNEQUIN.leg, y);
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
}
/** Left-arm ring at distance x along the T-pose arm: centre (cy, cz), half height, half depth. */
function armAt(x) {
  const [, y0, y1, z0, z1] = sample(MANNEQUIN.arm, x);
  return { cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2 };
}
function headAt(y) {
  const [, x0, x1, z0, z1] = sample(MANNEQUIN.head, y);
  return { cx: 0, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
}
const B = MANNEQUIN.bones;
const HEAD_TOP = B.HeadTop_End[1];
const SHOULDER_X = B.LeftArm[0];
const ELBOW_X = B.LeftForeArm[0];
const WRIST_X = B.LeftHand[0];
const KNEE_Y = B.LeftLeg[1];
const HIP_Y = B.LeftUpLeg[1];
const ANKLE_Y = B.LeftFoot[1];
const NECK_Y = B.Neck[1];
const ARM_Y = B.LeftArm[1];
const ARM_Z = B.LeftArm[2];
const ARM_START = SHOULDER_X;

// ---------------------------------------------------------------------------------------------
// Build kit: seeded choices, compound-driven material roles, placement helpers, mirroring
// ---------------------------------------------------------------------------------------------
class Kit {
  constructor(seed, rarity, compound, morph) {
    this.R = rng(seed);
    this.parts = [];
    this.features = [];
    this.o = RARITY_INDEX[rarity] ?? 0;
    this.rarity = rarity;
    this.c = compound;
    this.fam = compound.family;
    this.T = compound.traits;
    this.m = morph;
    this.detail = 0.35 + this.o * 0.12;
    this.gemTint = RARITIES[this.o].color;
    this.bone = null;
    this.techy = compound.family === 'artificer' || compound.traits.tech > 0.35;
    // Underlayers: chainmail for metal-working families, cloth for woodland and storm-light ones.
    this.under = compound.organic || compound.family === 'sylvan' || compound.family === 'tempest' ? 'cloth' : 'mail';
    const C = compound.colors;
    const organic = compound.organic;
    /** Material role -> workshop material + tint. Unknown roles are workshop material ids. */
    this.roles = {
      metal: { mat: organic ? 'timber_stock' : compound.dense > 0.74 ? 'forged_rough' : 'forged', tint: C.metal },
      plate: { mat: compound.dense > 0.74 ? 'forged_rough' : 'forged', tint: organic ? mixc(C.metal, C.edge, 0.3) : C.metal },
      dark: { mat: 'forged_rough', tint: C.dark },
      blade: { mat: 'polished', tint: mixc(C.metal, '#cfd6dc', organic ? 0.55 : 0.32) },
      edge: { mat: 'polished', tint: mixc(C.edge, '#d8dde2', 0.45) },
      trim: { mat: this.o >= 4 ? 'polished' : 'forged', tint: this.o >= 3 ? mixc(C.trim, '#e0b84e', 0.25) : C.trim },
      shard: { mat: 'crystal', tint: C.shard },
      crystal: { mat: 'gem', tint: C.crystal },
      light: { mat: compound.glow > 0.4 ? 'glowline' : 'crystal', tint: C.light },
      cloth: { mat: 'cloth', tint: C.cloth },
      // Chainmail takes the compound's own steel, brightened toward polished iron.
      mail: { mat: 'mail', tint: mixc(organic ? '#8d949b' : C.metal, '#b3bac1', 0.5) },
      cloth2: { mat: 'cloth', tint: mixc(C.cloth, C.trim, 0.55) },
      leather: { mat: 'leather', tint: C.leather },
      wood: { mat: 'timber_stock', tint: organic ? C.metal : mixc('#6b4a30', C.dark, 0.25) },
      rgem: { mat: 'gem', tint: RARITIES[this.o].color },
    };
  }
  rand(a, b) {
    return a + (b - a) * this.R();
  }
  int(a, b) {
    return Math.floor(this.rand(a, b + 1 - 1e-9));
  }
  chance(p) {
    return this.R() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.R() * arr.length) % arr.length];
  }
  wpick(w) {
    const e = Object.entries(w).filter(([, x]) => x > 0);
    let t = this.R() * e.reduce((s, [, x]) => s + x, 0);
    for (const [k, x] of e) if ((t -= x) <= 0) return k;
    return e[e.length - 1][0];
  }
  feature(s) {
    if (s && !this.features.includes(s)) this.features.push(s);
  }
  add(shape, name, role, o = {}) {
    const R = this.roles[role] ?? { mat: role, tint: null };
    const p = part(shape, { name, mat: R.mat, pos: (o.pos ?? [0, 0, 0]).map(r5), rot: o.rot ?? [0, 0, 0], scale: (o.scale ?? [1, 1, 1]).map(r5), tint: o.tint ?? R.tint ?? null, p: o.p ?? {} });
    for (const [k, v] of Object.entries(p.params)) if (typeof v === 'number') p.params[k] = r5(v);
    if (Array.isArray(p.params.pts)) p.params.pts = p.params.pts.map((q) => q.map(r5));
    const bone = o.bone ?? this.bone;
    if (bone) p.bone = bone;
    this.parts.push(p);
    return p;
  }
  rod(name, role, a, b, ra, rb = ra, seg = 10, o = {}) {
    const d = V(b).sub(V(a));
    return this.add('cylinder', name, role, { ...o, pos: a, rot: aim(d.toArray()), p: { rb: ra, rt: rb, h: Math.max(0.0005, d.length()), seg } });
  }
  disc(name, role, c, axis, r, h, seg = 16, o = {}) {
    const n = V(axis).normalize();
    return this.rod(name, role, V(c).addScaledVector(n, -h / 2).toArray(), V(c).addScaledVector(n, h / 2).toArray(), r, r, seg, o);
  }
  ring(name, role, c, axis, r, tube, o = {}) {
    return this.add('torus', name, role, { ...o, pos: c, rot: face(axis), p: { r, tube, arc: o.arc ?? 360, seg: o.seg ?? 24, sides: o.sides ?? (tube < 0.004 ? 5 : 8) } });
  }
  collar(name, role, c, axis, ro, ri, h, o = {}) {
    const n = V(axis).normalize();
    return this.add('tube', name, role, { ...o, pos: V(c).addScaledVector(n, -h / 2).toArray(), rot: aim(axis), p: { ro, ri, h, seg: o.seg ?? 20 } });
  }
  gem(name, c, r, o = {}) {
    return this.add('sphere', name, o.role ?? 'rgem', { pos: c, rot: o.rot ?? [0, 0, 0], scale: o.scale ?? [1, o.stretch ?? 1.15, 1], tint: o.tint, p: { r, seg: o.facets ?? 6 } });
  }
  rivet(c, r, role = 'trim') {
    return this.add('sphere', 'Rivet', role, { pos: c, p: { r, seg: 6 } });
  }
  gear(name, role, c, axis, r, o = {}) {
    return this.add('gear', name, role, { pos: c, rot: face(axis), p: { r, teeth: o.teeth ?? 10, tooth: o.tooth ?? r * 0.22, depth: o.depth ?? r * 0.3, hole: o.hole ?? r * 0.3 } });
  }
  /** One crystal facet growing from c along dir. */
  crystal(name, role, c, dir, r, h, o = {}) {
    const ing = this.c.ingredients[role === 'shard' ? 'shards' : 'crystal'];
    return this.add('crystal', name, role, { pos: c, rot: aim(dir), p: { r, h, sides: o.sides ?? ing.facets, lean: o.lean ?? 0, tip: o.tip ?? 0.3 } });
  }
  /**
   * A flat, table-cut gem pressed into a surface at c, facing `normal`: a low faceted slab
   * (the crystal's own facet count), sunk a little so it reads as inlaid, with a thin bezel.
   * o: { flat (height / radius), stretch (elongate across the surface), bezel, sides }
   */
  inlay(name, role, c, normal, r, o = {}) {
    const n = V(normal).normalize();
    const ing = this.c.ingredients[role === 'shard' ? 'shards' : 'crystal'];
    const sides = o.sides ?? Math.max(5, Math.min(8, ing?.facets ?? 6));
    const h = Math.max(0.0008, r * (o.flat ?? 0.28));
    const stretch = o.stretch ?? 1;
    this.add('cylinder', name, role, { pos: V(c).addScaledVector(n, -h * 0.4).toArray(), rot: aim(n.toArray()), scale: [1, 1, stretch], p: { rt: r * 0.66, rb: r, h, seg: sides } });
    if ((o.bezel ?? true) && stretch === 1 && r > 0.004) this.ring('Gem bezel', 'trim', V(c).addScaledVector(n, h * 0.02).toArray(), n.toArray(), r * 1.05, Math.max(0.0007, r * 0.1), { seg: Math.max(12, sides * 2), sides: 4 });
  }
  /** A small cluster of flat gems pressed into the surface around c (normal = dir). */
  growth(c, dir, scale = 0.03, n = 3, role = 'shard') {
    const d = V(dir).normalize();
    const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? UP : ZAX).normalize();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.R() * 0.6;
      const size = 0.85 + this.R() * 0.3;
      const off = side.clone().applyAxisAngle(d, a);
      // Growth roots were placed a few mm inside the surface; lift the gems back onto it.
      const p = V(c).addScaledVector(off, i === 0 ? 0 : scale * 1.05).addScaledVector(d, 0.0045);
      this.inlay('Pressed gem', i % 2 ? 'crystal' : role, p.toArray(), d.toArray(), scale * (i === 0 ? 0.62 : 0.38) * size, { bezel: i === 0 });
    }
  }
  /** Rigid transform for the parts fn() adds. */
  group(fn, matrix) {
    const start = this.parts.length;
    fn();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (const p of this.parts.slice(start)) {
      m.compose(V(p.pos), quatOf(p.rot), V(p.scale)).premultiply(matrix);
      m.decompose(pos, q, s);
      p.pos = pos.toArray().map(r5);
      p.rot = eulerOf(q);
      p.scale = s.toArray().map(r5);
    }
  }
  /** Build the figure's left side with fn(1, 'Left'), then mirror it across x = 0 for the right. */
  pair(fn) {
    const start = this.parts.length;
    fn(1, 'Left');
    for (const p of this.parts.slice(start)) {
      const q = JSON.parse(JSON.stringify(p));
      q.pos[0] = -q.pos[0];
      q.rot = [q.rot[0], -q.rot[1], -q.rot[2]];
      const pr = q.params;
      if (q.shape === 'loft') pr.pts = pr.pts.map((a) => [a[0], -a[1], ...a.slice(2)]);
      if ((q.shape === 'extrude' || q.shape === 'sweep') && pr.pts) pr.pts = pr.pts.map(([x, y]) => [-x, y]);
      if (q.shape === 'blade') pr.curve = -pr.curve;
      if (q.shape === 'crystal') pr.lean = -pr.lean;
      if (q.bone) q.bone = q.bone.replace(/^Left/, 'Right');
      this.parts.push(q);
    }
  }
  shift(dy) {
    for (const p of this.parts) p.pos[1] = r5(p.pos[1] + dy);
  }
}

/** Loft points along a body region: f(s) -> {cx, cz, hx, hz}; grow pads every ring outward. */
function loftAlong(from, to, n, f, grow = 0, flare = () => 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = lerp(from, to, i / n);
    const q = f(s);
    const g = grow + flare(i / n);
    pts.push([s, q.cx, q.cz, q.hx + g, q.hz + g, q.hz + g]);
  }
  return pts;
}
/** Arm loft (left arm, T-pose): rings along x, emitted in loft space (rot Z -90 lays loft-y along +x). */
function armLoft(x0, x1, n, grow = 0, flare = () => 0) {
  // Loft space -> world under rot [0,0,-90]: (lx, ly, lz) -> (ly, -lx, lz).
  return loftAlong(x0, x1, n, (x) => {
    const a = armAt(x);
    return { cx: -a.cy, cz: a.cz, hx: a.hy, hz: a.hz };
  }, grow, flare);
}
const ARM_ROT = [0, 0, -90];

// ---------------------------------------------------------------------------------------------
// Limbs: one grammar for sleeves, bracers, greaves, cuisses and boot shafts
// ---------------------------------------------------------------------------------------------
/** A left limb region. s runs along the limb (x for arms, y for legs); θ = 0 is the front (+z). */
function limb(region) {
  if (region === 'arm') {
    return {
      axis: [1, 0, 0],
      at: (s) => {
        const a = armAt(s);
        return { c: [s, a.cy, a.cz], h1: a.hy, h2: a.hz };
      },
      /** Point on the surface at s, angle θ (0 front, 90° up), pushed out by `out`. */
      pt(s, th, out = 0) {
        const a = armAt(s);
        return [s, a.cy + Math.sin(th) * (a.hy + out), a.cz + Math.cos(th) * (a.hz + out)];
      },
      n: (s, th) => [0, Math.sin(th), Math.cos(th)],
      loft: (s0, s1, n, grow, flare) => ({ pts: armLoft(s0, s1, n, grow, flare), rot: ARM_ROT }),
      /** Ellipse scale for a ring() around this limb (local x -> world -z, local y -> world y). */
      ringScale: (a, out, r) => [(a.h2 + out) / r, (a.h1 + out) / r, 1],
    };
  }
  return {
    axis: [0, 1, 0],
    at: (s) => {
      const a = legAt(s);
      return { c: [a.cx, s, a.cz], h1: a.hx, h2: a.hz };
    },
    /** θ = 0 front, 90° outward (+x). */
    pt(s, th, out = 0) {
      const a = legAt(s);
      return [a.cx + Math.sin(th) * (a.hx + out), s, a.cz + Math.cos(th) * (a.hz + out)];
    },
    n: (s, th) => [Math.sin(th), 0, Math.cos(th)],
    loft: (s0, s1, n, grow, flare) => ({ pts: loftAlong(s0, s1, n, legAt, grow, flare), rot: [0, 0, 0] }),
    ringScale: (a, out, r) => [(a.h1 + out) / r, (a.h2 + out) / r, 1],
  };
}
function shell(k, L, name, role, s0, s1, grow, o = {}) {
  const lo = L.loft(s0, s1, o.n ?? 6, grow, o.flare);
  return k.add('loft', name, role, { rot: lo.rot, tint: o.tint, p: { pts: lo.pts, power: o.power ?? 2.4, thick: o.thick ?? 0.004, seg: o.seg ?? 18 } });
}
function rim(k, L, s, out, tube, role, name = 'Rim', tilt = 0) {
  const a = L.at(s);
  const r = (a.h1 + a.h2) / 2 + out;
  let axis = V(L.axis);
  if (tilt) axis = axis.applyAxisAngle(V(L.axis[0] ? [0, 0, 1] : [1, 0, 0]), RAD(tilt));
  return k.ring(name, role, a.c, axis.toArray(), r, tube, { scale: L.ringScale(a, out, r), seg: 22, sides: 5 });
}
function polyline(k, pts, r, role, name = 'Ridge') {
  for (let i = 0; i < pts.length - 1; i++) k.rod(name, role, pts[i], pts[i + 1], r, r, 6);
}

/**
 * Armour over a limb segment in one of six forms. s0..s1 along the limb; grow is the gap to the skin.
 * Returns the outer offset so callers can stack details on top.
 */
function limbArmor(k, region, form, s0, s1, { grow = 0.02, bone, joint = null, flare = 0.01, under = true } = {}) {
  const L = limb(region);
  k.bone = bone;
  const span = Math.abs(s1 - s0);
  const fl = (t) => flare * (region === 'arm' ? 1 - t : t) ** 2; // flares away from the hand / foot
  const plate = k.c.organic ? 'plate' : 'plate';
  if (under && form !== 'wrap') shell(k, L, 'Padding', k.c.family === 'artificer' ? 'dark' : 'cloth', s0 - span * 0.04, s1 + span * 0.04, 0.007, { thick: 0.003 });
  switch (form) {
    case 'plate': {
      shell(k, L, 'Plate', plate, s0, s1, grow, { flare: fl, power: 2.6 });
      rim(k, L, s0, grow + 0.002, 0.0045, 'trim');
      rim(k, L, s1, grow + fl(1) + 0.002, 0.0045, 'trim');
      const ridge = [];
      for (let i = 0; i <= 4; i++) ridge.push(L.pt(lerp(s0, s1, 0.05 + i * 0.225), 0, grow + 0.004));
      polyline(k, ridge, 0.004, 'edge');
      if (k.o >= 1) for (const th of [-0.9, 0.9]) k.rivet(L.pt(s0 + (s1 - s0) * 0.1, th, grow + 0.003), 0.0045);
      k.feature('fluted plate');
      break;
    }
    case 'lamellar': {
      const n = 4 + Math.min(2, k.o);
      for (let i = 0; i < n; i++) {
        const a = lerp(s0, s1, i / n);
        const b = lerp(s0, s1, (i + 1.25) / n);
        const t = i / n;
        shell(k, L, 'Lame', i % 2 ? 'trim' : plate, a, b, grow + fl(t) + 0.002 * (i % 2), { n: 2, flare: (u) => u * 0.006, power: 2.8, thick: 0.003 });
      }
      k.feature('overlapping lames');
      break;
    }
    case 'ribs': {
      shell(k, L, 'Wrap', k.c.organic ? 'leather' : 'cloth', s0, s1, 0.009, { thick: 0.003 });
      const n = 4 + Math.min(3, k.o);
      for (let i = 0; i <= n; i++) rim(k, L, lerp(s0, s1, i / n), 0.012, 0.0055, i % 2 ? 'dark' : plate, 'Rib');
      const spine = [];
      for (let i = 0; i <= 4; i++) spine.push(L.pt(lerp(s0, s1, i / 4), 0, 0.016));
      polyline(k, spine, 0.006, 'trim', 'Spine bar');
      k.feature('bound ribs');
      break;
    }
    case 'geode': {
      shell(k, L, 'Plate', plate, s0, s1, grow, { flare: fl, power: 2.2 });
      rim(k, L, s1, grow + fl(1) + 0.002, 0.004, 'trim');
      const n = 2 + Math.min(3, k.o);
      for (let i = 0; i < n; i++) {
        const s = lerp(s0, s1, 0.2 + (0.6 * i) / Math.max(1, n - 1));
        const th = region === 'arm' ? k.rand(0.6, 1.6) : k.rand(0.5, 1.5);
        k.growth(L.pt(s, th, grow - 0.004), L.n(s, th), 0.016 + k.o * 0.002, 3);
      }
      k.feature('crystal growths');
      break;
    }
    case 'frame': {
      shell(k, L, 'Sleeve', 'dark', s0, s1, 0.01, { thick: 0.003 });
      for (const s of [s0, (s0 + s1) / 2, s1]) rim(k, L, s, grow, 0.006, plate, 'Frame ring');
      for (const th of [-1.2, 0, 1.2, Math.PI]) polyline(k, [L.pt(s0, th, grow), L.pt(s1, th, grow)], 0.0045, th === 0 ? 'light' : 'trim', th === 0 ? 'Light channel' : 'Rail');
      const mid = (s0 + s1) / 2;
      k.gear('Joint cog', 'trim', L.pt(mid, Math.PI / 2, grow + 0.004), L.n(mid, Math.PI / 2), 0.02, { teeth: 10, depth: 0.007, hole: 0.006 });
      k.feature('open rail frame');
      break;
    }
    default: {
      shell(k, L, 'Wrap', k.c.organic ? 'leather' : k.pick(['leather', 'cloth']), s0, s1, 0.009, { thick: 0.003, flare: (t) => fl(t) * 0.5 });
      const n = 3 + Math.min(2, k.o);
      for (let i = 0; i < n; i++) rim(k, L, lerp(s0, s1, (i + 0.5) / n), 0.013, 0.004, 'leather', 'Strap', region === 'arm' ? 18 : 14);
      k.add('box', 'Buckle', 'trim', { pos: L.pt(lerp(s0, s1, 0.5 / n), Math.PI / 2, 0.016), p: { w: 0.012, h: 0.016, d: 0.012 } });
      k.feature('strapped wrap');
    }
  }
  if (joint && form !== 'wrap') {
    // Couter / poleyn: a cup over the joint, with family flourish.
    const a = L.at(joint.s);
    const c = L.pt(joint.s, joint.th, grow - 0.012);
    const n = L.n(joint.s, joint.th);
    k.add('sphere', joint.name, k.o >= 2 ? 'trim' : plate, { pos: c, rot: aim(n), scale: [1, 0.62, 1], p: { r: Math.max(a.h1, a.h2) * 0.78 + grow, seg: 14, hemi: true } });
    if (k.fam === 'artificer') k.gear('Joint cog', 'trim', L.pt(joint.s, joint.th, grow + 0.02), n, 0.018, { teeth: 9, depth: 0.006, hole: 0.006 });
    if (k.fam === 'crystalline' || k.fam === 'void') k.inlay('Joint gem', 'shard', L.pt(joint.s, joint.th, grow + 0.002), n, 0.011);
    if (k.fam === 'celestial') k.disc('Sun boss', 'trim', L.pt(joint.s, joint.th, grow + 0.016), n, 0.02, 0.006, 16);
  }
  k.bone = null;
  return grow;
}

// ---------------------------------------------------------------------------------------------
// Armour builders (T-pose body space, bones named)
// ---------------------------------------------------------------------------------------------
const TORSO_TOP = 1.505;
/** Torso loft rings from y0 to the neck, closing in towards a neck ring so the top is a collar. */
function torsoLoft(y0, y1, grow, n = 14, flareBottom = 0) {
  const pts = loftAlong(y0, Math.min(y1, 1.48), n, torsoAt, grow, (t) => flareBottom * (1 - t) ** 2);
  if (y1 >= 1.48) {
    // Yoke over the shoulder slope (measured: skin top 1.507 m at x 0.08 falling to 1.475 m at x 0.22)
    // up to a snug neck opening, with ~1.5-2 cm over the trapezius so poses don't push skin through.
    const g = grow;
    pts.push([1.5, 0, -0.04, 0.1557 + g + 0.006, 0.066 + g + 0.004, 0.066 + g + 0.004]);
    pts.push([1.514, 0, -0.04, 0.112 + g * 0.9, 0.066 + g * 0.8, 0.066 + g * 0.8]);
    pts.push([TORSO_TOP + 0.024, 0, -0.037, 0.072 + g * 0.35, 0.062 + g * 0.35, 0.062 + g * 0.35]);
  }
  return pts;
}
/** Front surface z of the torso at (x, y). */
function torsoFront(x, y, out = 0) {
  const t = torsoAt(y);
  const u = Math.min(0.98, Math.abs(x) / (t.hx + out));
  return t.cz + (t.hz + out) * Math.sqrt(1 - u * u);
}
function torsoBack(x, y, out = 0) {
  const t = torsoAt(y);
  const u = Math.min(0.98, Math.abs(x) / (t.hx + out));
  return t.cz - (t.hz + out) * Math.sqrt(1 - u * u);
}

/** Cloth layer under chest armour: torso plus sleeves cut by the coverage mode. */
function garment(k, coverage, role = 'cloth') {
  if (coverage === 'open') return;
  k.bone = 'Spine2';
  k.add('loft', 'Undershirt', role, { p: { pts: torsoLoft(0.94, 1.5, 0.006, 16), power: 2.3, thick: 0.003, seg: 22 } });
  if (coverage === 'sleeveless') return (k.bone = null);
  const L = limb('arm');
  const upTo = coverage === 'short' ? lerp(SHOULDER_X, ELBOW_X, 0.6) : ELBOW_X + 0.01;
  k.pair((sx, side) => {
    k.bone = `${side}Arm`;
    // Shoulder cap: covers the top of the shoulder joint, which the sleeve and torso part around when
    // the arm hangs down.
    k.add('sphere', 'Shoulder cap', role, { pos: [SHOULDER_X + 0.012, ARM_Y + 0.006, ARM_Z], scale: [1.05, 1, 1.1], p: { r: 0.066, seg: 16 } });
    shell(k, L, 'Sleeve', role, ARM_START - 0.02, upTo, 0.006, { thick: 0.003, n: 5 });
    if (coverage === 'full') {
      k.bone = `${side}ForeArm`;
      shell(k, L, 'Forearm sleeve', role, ELBOW_X - 0.01, WRIST_X - 0.025, 0.005, { thick: 0.003, n: 5 });
    }
    k.bone = null;
  });
  k.feature(coverage === 'short' ? 'short-sleeved underlayer' : 'sleeved underlayer');
}

// Rigid torso armour ------------------------------------------------------------------------
/** Front-profile fill: a breastplate falls straight from the chest to the belt instead of hugging the
 *  waist hollow (which reads as the plate being pushed into the abdomen). Extra front depth at y. */
let FRONT = null;
function frontFill(y) {
  if (!FRONT) {
    const ys = [];
    for (let v = 0.95; v <= 1.4201; v += 0.01) ys.push(v);
    const f = ys.map((v) => torsoAt(v).cz + torsoAt(v).hz);
    let m = 0;
    f.forEach((v, i) => v > f[m] && (m = i));
    FRONT = { ys, f, m };
  }
  const { ys, f, m } = FRONT;
  if (y >= ys[m]) return 0;
  const t = clamp((y - ys[0]) / (ys[m] - ys[0]), 0, 1);
  const tt = torsoAt(Math.max(y, ys[0]));
  return Math.max(0, lerp(f[0], f[m], t) - (tt.cz + tt.hz));
}
function fillFront(pts) {
  for (const p of pts) p[4] += frontFill(p[0]);
  return pts;
}
/** Which spine bone a torso height rides, so armour bends with the spine instead of swinging as one board. */
function spineBoneAt(y) {
  if (y < B.Spine[1]) return 'Hips';
  if (y < B.Spine1[1]) return 'Spine';
  if (y < B.Spine2[1]) return 'Spine1';
  return 'Spine2';
}
/**
 * Re-bone torso parts added since `from`: small parts follow the spine bone at their height; vertical
 * lofts are cut into overlapping bands, one per spine bone (each band 0.8 mm proud of the one below, so
 * the overlaps read as lames and never z-fight).
 */
function splitTorso(k, from) {
  const cuts = [B.Spine[1], B.Spine1[1], B.Spine2[1]];
  const out = [];
  for (const part of k.parts.slice(from)) {
    if (part.bone !== 'Spine2') {
      out.push(part);
      continue;
    }
    const vertical = part.shape === 'loft' && part.rot.every((v) => Math.abs(v) < 1e-6) && part.pos.every((v) => Math.abs(v) < 1e-6);
    if (!vertical) {
      part.bone = spineBoneAt(part.pos[1]);
      out.push(part);
      continue;
    }
    const pts = part.params.pts;
    const ringAt = (y) => {
      for (let i = 1; i < pts.length; i++)
        if (y <= pts[i][0] || i === pts.length - 1) {
          const t = clamp((y - pts[i - 1][0]) / Math.max(1e-6, pts[i][0] - pts[i - 1][0]), 0, 1);
          return pts[i].map((v, j) => r5(lerp(pts[i - 1][j], v, t)));
        }
      return pts[0];
    };
    const lo = pts[0][0];
    const hi = pts[pts.length - 1][0];
    const edges = [lo, ...cuts.filter((c) => c > lo + 0.02 && c < hi - 0.02), hi];
    if (edges.length === 2) {
      part.bone = spineBoneAt((lo + hi) / 2);
      out.push(part);
      continue;
    }
    for (let b = 0; b < edges.length - 1; b++) {
      const y0 = b === 0 ? lo : edges[b] - 0.022;
      const y1 = b === edges.length - 2 ? hi : edges[b + 1] + 0.006;
      const band = [ringAt(y0), ...pts.filter((p) => p[0] > y0 + 1e-4 && p[0] < y1 - 1e-4), ringAt(y1)];
      const proud = b * 0.0008;
      out.push({ ...part, id: `${part.id}b${b}`, bone: spineBoneAt((edges[b] + edges[b + 1]) / 2), params: { ...part.params, pts: band.map((p) => [p[0], p[1], p[2], r5(p[3] + proud), r5(p[4] + proud), r5(p[5] + proud)]) } });
    }
  }
  k.parts.splice(from, k.parts.length - from, ...out);
}

function chest(k, shape, spec) {
  const torsoFrom = k.parts.length;
  const fam = k.fam;
  const coverage = spec.coverage === 'auto' ? (fam === 'sylvan' ? 'short' : shape === 'harness' || shape === 'ribs' ? 'full' : 'full') : spec.coverage;
  garment(k, coverage, k.under);
  k.bone = 'Spine2';
  const bulk = 0.85 + k.m.bulk * 0.2;
  const g = (0.022 + k.c.dense * 0.008) * bulk;
  const plateRole = 'plate';
  const shellMain = (role, grow, name, y0 = 0.96, thick = 0.006) => k.add('loft', name, role, { p: { pts: fillFront(torsoLoft(y0, 1.5, grow, 16)), power: 2.5, thick, seg: 26 } });
  switch (shape) {
    case 'plate':
    case 'geode':
    case 'harness': {
      shellMain(plateRole, g, shape === 'harness' ? 'Boiler cuirass' : 'Cuirass');
      // Fauld lames at the hips. They stay above ~0.92 m, where the body splits into the legs, and
      // flare outward like a short skirt, so they never wrap the crotch.
      const n = 1 + (k.c.dense > 0.6 ? 1 : 0);
      const hip = torsoAt(0.945);
      for (let i = 0; i < n; i++) {
        const top = 0.972 - i * 0.026;
        const bot = top - 0.034;
        const fl = 0.012 + i * 0.008;
        k.add('loft', 'Fauld lame', i % 2 ? 'trim' : plateRole, { p: { pts: [[bot, 0, hip.cz, hip.hx + g + fl, hip.hz + g + fl, hip.hz + g + fl * 0.6], [top, 0, hip.cz, hip.hx + g + 0.004 + i * 0.006, hip.hz + g + 0.004 + i * 0.006, hip.hz + g + 0.002]], power: 2.6, thick: 0.004, seg: 24 } });
      }
      // Ridge down the front.
      const ridge = [];
      for (let y = 1.0; y <= 1.43; y += 0.07) ridge.push([0, y, torsoFront(0, y, g) + 0.003]);
      polyline(k, ridge, 0.005, 'edge');
      // Rivet line along the bottom edge.
      if (k.o >= 1) for (const x of [-0.1, -0.05, 0.05, 0.1]) k.rivet([x, 0.975, torsoFront(x, 0.975, g) + 0.002], 0.005);
      if (shape === 'geode') {
        for (const [x, y] of [[0.13, 1.42], [-0.13, 1.42], [0.07, 1.25], [-0.1, 1.12]]) k.growth([x, y, torsoFront(x, y, g) - 0.004], [x * 2.5, 0.4, 1], 0.022 + k.o * 0.002, 3);
        k.feature('crystal carapace');
      }
      if (shape === 'harness') {
        for (const sx of [1, -1]) {
          const pipe = [[sx * 0.085, 1.36], [sx * 0.11, 1.25], [sx * 0.105, 1.1], [sx * 0.08, 1.0]];
          for (let i = 0; i < pipe.length - 1; i++) {
            const a = [pipe[i][0], pipe[i][1], torsoFront(pipe[i][0], pipe[i][1], g) + 0.008];
            const b = [pipe[i + 1][0], pipe[i + 1][1], torsoFront(pipe[i + 1][0], pipe[i + 1][1], g) + 0.008];
            k.rod('Steam pipe', 'trim', a, b, 0.008, 0.008, 8);
          }
          const by = 1.4;
          const bz = torsoBack(sx * 0.08, by, g);
          k.rod('Exhaust', 'dark', [sx * 0.08, by, bz - 0.005], [sx * 0.11, 1.6, bz - 0.05], 0.016, 0.013, 10);
          k.collar('Exhaust lip', 'trim', [sx * 0.11, 1.59, bz - 0.05], [0.12, 1, -0.2], 0.019, 0.012, 0.016);
        }
        k.disc('Chest gauge', 'clockface', [0.07, 1.22, torsoFront(0.07, 1.22, g) + 0.004], [0, 0, 1], 0.03, 0.012, 16);
        k.ring('Gauge rim', 'trim', [0.07, 1.22, torsoFront(0.07, 1.22, g) + 0.01], [0, 0, 1], 0.031, 0.004, { seg: 20 });
        k.feature('steam harness');
      }
      k.feature(shape === 'plate' ? 'rounded breastplate' : null);
      break;
    }
    case 'lamellar': {
      const rows = 6 + Math.min(3, k.o);
      for (let i = 0; i < rows; i++) {
        const y0 = lerp(0.94, 1.42, i / rows);
        const y1 = lerp(0.94, 1.42, (i + 1.3) / rows);
        k.add('loft', 'Lamellar row', i % 2 ? 'trim' : plateRole, { p: { pts: fillFront(loftAlong(y0, y1, 2, torsoAt, g + 0.004, (t) => (1 - t) * 0.008)), power: 2.6, thick: 0.004, seg: 26 } });
      }
      k.add('loft', 'Shoulder yoke', plateRole, { p: { pts: torsoLoft(1.42, 1.5, g, 4), power: 2.5, thick: 0.005, seg: 26 } });
      k.feature('lamellar rows');
      break;
    }
    case 'brigandine':
    case 'jerkin':
    case 'robe': {
      const role = shape === 'jerkin' ? 'leather' : 'cloth';
      // Torso shells stop at the belt line: below ~0.93 m the body narrows into the crotch, and a loft
      // taken lower pinches into a 'briefs' shape over the groin (and a long rigid skirt clips the legs).
      shellMain(role, 0.014, shape === 'jerkin' ? 'Jerkin' : shape === 'robe' ? 'Robe' : 'Brigandine', 0.94, 0.004);
      if (shape === 'brigandine') {
        const rows = 5 + Math.min(2, k.o);
        for (let i = 0; i < rows; i++) {
          const y = 0.98 + i * (0.42 / rows);
          for (const x of [-0.12, -0.075, -0.03, 0.03, 0.075, 0.12]) k.rivet([x, y, torsoFront(x, y, 0.014) + 0.001], 0.0055, i % 2 ? 'trim' : 'dark');
        }
        k.feature('riveted brigandine');
      }
      if (shape === 'jerkin') {
        for (let i = 0; i < 3; i++) {
          const y = 1.05 + i * 0.11;
          k.add('box', 'Strap', 'leather', { pos: [0, y - 0.012, torsoFront(0, y, 0.018)], tint: k.roles.dark.tint, p: { w: 0.12, h: 0.024, d: 0.008 } });
          k.add('box', 'Buckle', 'trim', { pos: [0.035, y - 0.016, torsoFront(0.035, y, 0.022)], p: { w: 0.022, h: 0.032, d: 0.006 } });
        }
        k.ring('Collar', 'leather', [0, 1.5, -0.045], [0, 1, 0], 0.08, 0.02, { scale: [1, 0.9, 1], seg: 20 });
        k.feature('buckled jerkin');
      }
      if (shape === 'robe') {
        // Plate breastpiece over the robe, belted.
        k.add('loft', 'Breastpiece', plateRole, { p: { pts: fillFront(torsoLoft(1.16, 1.5, 0.03, 8)), power: 2.5, thick: 0.005, seg: 24 } });
        k.feature('armoured robe');
      }
      break;
    }
    case 'ribs': {
      shellMain('dark', 0.012, 'Undercoat', 0.94, 0.004);
      for (let i = 0; i < 5; i++) {
        const y = 1.08 + i * 0.065;
        const pts = [];
        for (let j = -4; j <= 4; j++) {
          const x = (j / 4) * (torsoAt(y).hx + 0.02) * 0.92;
          pts.push([x, y - Math.abs(j) * 0.006, torsoFront(x, y, 0.022)]);
        }
        polyline(k, pts, 0.0075 - i * 0.0004, 'plate', 'Rib');
      }
      const spine = [];
      for (let y = 1.0; y <= 1.46; y += 0.06) spine.push([0, y, torsoFront(0, y, 0.026)]);
      polyline(k, spine, 0.009, 'trim', 'Sternum');
      k.feature('open rib cage');
      break;
    }
  }
  // Gorget and belt.
  k.collar('Gorget', shape === 'jerkin' ? 'leather' : 'trim', [0, 1.505, -0.045], [0, 1, 0], 0.088, 0.066, 0.05, { scale: [1, 1, 0.9] });
  const by = shape === 'robe' ? 0.96 : 0.955;
  const bt = torsoAt(by);
  k.collar('Belt', 'leather', [0, by, bt.cz], [0, 1, 0], 1, 0.94, 0.038, { scale: [bt.hx + g + 0.006, 1, bt.hz + g + 0.006], tint: k.roles.dark.tint });
  k.add('box', 'Buckle', 'trim', { pos: [0, by - 0.022, bt.cz + bt.hz + g + 0.01], p: { w: 0.045, h: 0.04, d: 0.008 } });
  // Family emblem on the sternum.
  const ey = 1.3;
  const ez = torsoFront(0, ey, shape === 'brigandine' || shape === 'jerkin' || shape === 'robe' ? 0.02 : g) + 0.004;
  const emblem = { artificer: 'cog', celestial: 'sun', crystalline: 'crystal', void: 'crescent', sylvan: 'leaf', duelist: 'filigree', tempest: 'wave', bulwark: 'boss' }[fam];
  if (k.o >= 1 || fam === 'artificer' || fam === 'celestial') heraldry(k, emblem, [0, ey, ez], [0, 0, 1], 0.045);
  if (k.o >= 3) k.add('sphere', 'Heart-core', k.c.glow > 0.4 ? 'light' : 'rgem', { pos: [0, ey, ez + 0.004], p: { r: 0.016, seg: 10 } });
  if (k.o >= 4 || fam === 'celestial') {
    // A wide cloth sash wrapped above the belt (instead of a flat tabard hanging over the groin).
    const sy = by + 0.042;
    const st = torsoAt(sy);
    const pad = shape === 'brigandine' || shape === 'jerkin' || shape === 'robe' ? 0.024 : g + 0.008;
    k.collar('Sash', 'cloth', [0, sy, st.cz], [0, 1, 0], 1, 0.95, 0.05, { scale: [st.hx + pad, 1, st.hz + pad], tint: k.roles.cloth2.tint });
    k.ring('Sash knot', 'cloth', [st.hx * 0.55, sy + 0.022, st.cz + st.hz * 0.86 + pad], [0.35, 0, 1], 0.016, 0.007, { tint: k.roles.cloth2.tint, seg: 14, sides: 6 });
    k.feature('heraldic sash');
  }
  splitTorso(k, torsoFrom);
  k.bone = null;
  return { noun: { plate: 'Cuirass', lamellar: 'Lamellar Cuirass', brigandine: 'Brigandine', jerkin: 'Jerkin', harness: 'Steam Harness', ribs: 'Ribcage Harness', robe: 'Battle Robe', geode: 'Carapace' }[shape] };
}

/** Family emblem at c facing dir. */
function heraldry(k, kind, c, dir, r) {
  const n = V(dir).normalize();
  switch (kind) {
    case 'cog':
      k.gear('Cog emblem', 'trim', c, dir, r, { teeth: 12, depth: 0.01, hole: r * 0.4 });
      k.feature('cog emblem');
      break;
    case 'sun': {
      const pts = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const rr = i % 2 ? r * 0.55 : r;
        return [r5(Math.cos(a) * rr), r5(Math.sin(a) * rr)];
      });
      k.add('extrude', 'Sun emblem', 'trim', { pos: c, rot: face(dir), p: { pts, depth: 0.006, bevel: 0.0015 } });
      k.feature('sun emblem');
      break;
    }
    case 'crystal':
      k.growth(c, dir, r * 0.5, 3, 'crystal');
      break;
    case 'crescent': {
      const out = [];
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      for (let i = 12; i >= 0; i--) {
        const a = -Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
        out.push([Math.cos(a) * r * 0.62 + r * 0.32, Math.sin(a) * r * 0.78]);
      }
      k.add('extrude', 'Crescent emblem', 'trim', { pos: c, rot: face(dir), p: { pts: out.map(([x, y]) => [r5(x), r5(y)]), depth: 0.006, bevel: 0.0015 } });
      k.feature('crescent emblem');
      break;
    }
    case 'leaf':
      for (const a of [-35, 0, 35]) k.add('extrude', 'Leaf', 'shard', { pos: c, rot: eulerOf(new THREE.Quaternion().setFromUnitVectors(ZAX, n).multiply(new THREE.Quaternion().setFromAxisAngle(ZAX, RAD(a)))), p: { pts: [[0, -r * 0.2], [r * 0.35, r * 0.4], [0, r * 1.1], [-r * 0.35, r * 0.4]], depth: 0.005, bevel: 0.0012 } });
      k.feature('leaf emblem');
      break;
    case 'wave':
      k.ring('Wave emblem', 'trim', c, dir, r * 0.75, 0.005, { arc: 270 });
      k.ring('Wave emblem', 'edge', c, dir, r * 0.45, 0.004, { arc: 270 });
      break;
    case 'filigree':
      k.ring('Filigree', 'trim', c, dir, r * 0.7, 0.003);
      k.ring('Filigree', 'trim', c, dir, r * 0.45, 0.003);
      break;
    default:
      k.add('sphere', 'Boss', 'trim', { pos: c, rot: aim(dir), scale: [1, 0.5, 1], p: { r: r * 0.7, seg: 14, hemi: true } });
  }
}

function pauldrons(k, shape) {
  const g = 0.02 + k.c.dense * 0.008;
  k.pair((sx, side) => {
    // Pauldrons ride the clavicle, so they stay capping the shoulder when the arm swings down.
    k.bone = `${side}Shoulder`;
    const c = [SHOULDER_X + 0.005, ARM_Y + 0.03, ARM_Z];
    const R = 0.088 + g + k.m.bulk * 0.01;
    switch (shape) {
      case 'lamellar':
        for (let i = 0; i < 4; i++) k.add('sphere', 'Pauldron lame', i % 2 ? 'trim' : 'plate', { pos: [c[0] + i * 0.026, c[1] - i * 0.016, c[2]], rot: [0, 0, -(28 + i * 11)], scale: [1, 0.55, 1.02], p: { r: R - i * 0.008, seg: 16, hemi: true } });
        k.feature('lamellar pauldrons');
        break;
      case 'wing': {
        k.add('sphere', 'Pauldron', 'plate', { pos: c, rot: [0, 0, -30], scale: [1, 0.55, 1], p: { r: R, seg: 16, hemi: true } });
        for (let i = 0; i < 4; i++) k.add('extrude', 'Wing feather', i % 2 ? 'trim' : 'edge', { pos: [c[0] + 0.03, c[1] + 0.03, c[2] - 0.02 + i * 0.012], rot: [0, 0, -10 - i * 14], p: { pts: [[0, -0.012], [0.12 + i * 0.01, 0.02], [0.15 + i * 0.012, 0.05], [0.02, 0.022]], depth: 0.006, bevel: 0.0015 } });
        k.feature('winged pauldrons');
        break;
      }
      case 'geode':
        k.add('sphere', 'Pauldron', 'plate', { pos: c, rot: [0, 0, -32], scale: [1, 0.6, 1], p: { r: R, seg: 16, hemi: true } });
        for (let i = 0; i < 4; i++) k.growth([c[0] + 0.02 + i * 0.012, c[1] + 0.035, c[2] - 0.04 + i * 0.027], [0.5, 1, (i - 1.5) * 0.3], 0.02, 3);
        k.feature('geode mantle');
        break;
      case 'frame':
        k.add('sphere', 'Pauldron shell', 'dark', { pos: c, rot: [0, 0, -30], scale: [1, 0.5, 1], p: { r: R - 0.01, seg: 14, hemi: true } });
        for (const t of [0.6, 0.85, 1.05]) k.ring('Frame arc', 'trim', [c[0], c[1] - 0.01, c[2]], [0.45, 1, 0], R * t, 0.0045, { arc: 200, seg: 18 });
        k.gear('Shoulder cog', 'trim', [c[0] + R * 0.55, c[1] - 0.01, c[2]], [1, 0.3, 0], 0.028, { teeth: 10, depth: 0.008, hole: 0.008 });
        k.feature('open frame pauldrons');
        break;
      case 'wrap':
        k.add('sphere', 'Shoulder pad', 'leather', { pos: c, rot: [0, 0, -30], scale: [1, 0.5, 0.95], p: { r: R - 0.006, seg: 14, hemi: true } });
        k.ring('Strap', 'leather', [c[0] + 0.03, c[1] - 0.03, c[2]], [1, 0.2, 0], 0.07, 0.005, { tint: k.roles.dark.tint });
        k.rivet([c[0] + 0.045, c[1] + 0.03, c[2] + 0.05], 0.006);
        k.feature('leather pads');
        break;
      default:
        k.add('sphere', 'Pauldron', 'plate', { pos: c, rot: [0, 0, -30], scale: [1, 0.62, 1], p: { r: R, seg: 18, hemi: true } });
        k.ring('Pauldron rim', 'trim', [c[0] + 0.03, c[1] - 0.025, c[2]], [0.5, 1, 0], R * 0.92, 0.005, { seg: 28 });
        if (k.c.dense > 0.5) for (let i = 0; i < 5; i++) k.rivet([c[0] + 0.03 + Math.cos(i * 0.6) * 0.02, c[1] + 0.02 + Math.sin(i * 0.6) * 0.02, c[2] + R * 0.8 - i * 0.03], 0.005);
        k.feature('forged dome pauldrons');
    }
    if (k.fam === 'crystalline' && shape !== 'geode') k.growth([c[0] + 0.02, c[1] + 0.05, c[2]], [0.4, 1, 0], 0.02, 2);
    if (k.fam === 'void') k.add('cone', 'Hook', 'edge', { pos: [c[0] + 0.05, c[1] + 0.03, c[2] - 0.02], rot: [0, 0, -50], p: { r: 0.012, h: 0.07, seg: 5 } });
    if (k.o >= 3) k.gem('Pauldron gem', [c[0] + 0.03, c[1] + R * 0.55, c[2] + R * 0.4], 0.011, { scale: [1, 1, 0.6], stretch: 1 });
    k.bone = null;
  });
  return { noun: { dome: 'Pauldrons', lamellar: 'Lamellar Pauldrons', wing: 'Winged Pauldrons', geode: 'Geode Mantle', frame: 'Frame Pauldrons', wrap: 'Shoulder Pads' }[shape] };
}

function bracers(k, shape) {
  k.pair((sx, side) => {
    limbArmor(k, 'arm', shape, ELBOW_X + 0.035, WRIST_X - 0.03, { bone: `${side}ForeArm`, grow: 0.016 + k.c.dense * 0.006, flare: 0.012 });
  });
  return { noun: { plate: 'Vambraces', lamellar: 'Splinted Bracers', ribs: 'Ribbed Bracers', geode: 'Geode Bracers', frame: 'Frame Bracers', wrap: 'Wrapped Bracers' }[shape] };
}

function greaves(k, shape) {
  k.pair((sx, side) => {
    limbArmor(k, 'leg', shape, ANKLE_Y + 0.07, KNEE_Y - 0.02, { bone: `${side}Leg`, grow: 0.018 + k.c.dense * 0.008, flare: 0.012, joint: { s: KNEE_Y + 0.01, th: 0, name: 'Poleyn' } });
  });
  return { noun: { plate: 'Greaves', lamellar: 'Lamellar Greaves', ribs: 'Ribbed Greaves', geode: 'Geode Greaves', frame: 'Frame Greaves', wrap: 'Wrapped Greaves' }[shape] };
}

function legs(k, shape) {
  const soft = shape === 'trousers' || shape === 'breeches';
  // Trousers stay cloth; under plate legs it's chainmail (or cloth for woodland/storm families).
  const fabric = shape === 'breeches' ? 'leather' : shape === 'trousers' ? 'cloth' : k.under;
  // Waist: the shared pelvis piece (hips table), then each leg in two bone segments.
  k.bone = 'Hips';
  // Below the hip line the body narrows into the crotch; keep the hip width there so the seat and the
  // tops of the thighs stay covered (the thigh shells reach up underneath).
  k.add('loft', 'Waist', fabric, { p: { pts: loftAlong(0.88, 1.0, 6, (y) => torsoAt(Math.max(y, 0.945)), 0.008, (t) => (1 - t) * 0.004), power: 2.2, thick: 0.003, seg: 24 } });
  // Gusset: follows the body itself down into the crotch, under the waist and between the thighs.
  // (Measured off the mesh: the slice table degenerates below 0.88 m where the legs split.)
  const groin = [[0.835, 0.04, 0.095], [0.86, 0.058, 0.106], [0.88, 0.064, 0.116], [0.9, 0.068, 0.12], [0.925, 0.085, 0.123], [0.95, 0.12, 0.125]];
  k.add('loft', 'Gusset', fabric, { p: { pts: groin.map(([y, hx, front]) => [y, 0, 0, hx, front, 0.1]), power: 2.6, thick: 0.003, seg: 22 } });
  const L = limb('leg');
  k.pair((sx, side) => {
    k.bone = `${side}UpLeg`;
    shell(k, L, 'Thigh', fabric, KNEE_Y - 0.02, 0.965, 0.008, { thick: 0.003, n: 7 });
    k.bone = `${side}Leg`;
    shell(k, L, 'Shin', fabric, soft ? 0.12 : 0.14, KNEE_Y + 0.03, 0.007, { thick: 0.003, n: 6, flare: (t) => (shape === 'trousers' ? (1 - t) * 0.012 : 0) });
    if (shape === 'trousers') rim(k, L, 0.125, 0.018, 0.006, 'cloth2', 'Hem');
    if (shape === 'breeches') {
      for (const s of [0.2, 0.35, 0.66, 0.78]) rim(k, L, s, 0.012, 0.0045, 'leather', 'Strap', 10);
      k.add('sphere', 'Knee guard', 'leather', { pos: L.pt(KNEE_Y, 0, 0.0), rot: [90, 0, 0], scale: [1, 0.5, 1.1], p: { r: 0.05, seg: 12, hemi: true }, tint: k.roles.dark.tint });
    }
    if (!soft) {
      const form = { platelegs: 'plate', lamellar: 'lamellar', splint: 'ribs', frame: 'frame' }[shape];
      limbArmor(k, 'leg', form, 0.58, 0.9, { bone: `${side}UpLeg`, grow: 0.022 + k.c.dense * 0.008, flare: 0.006, under: false });
      limbArmor(k, 'leg', form, ANKLE_Y + 0.08, KNEE_Y - 0.03, { bone: `${side}Leg`, grow: 0.02, flare: 0.01, under: false, joint: { s: KNEE_Y + 0.01, th: 0, name: 'Poleyn' } });
      // Tasset hanging from the belt over the thigh.
      k.bone = 'Hips';
      const tz = legAt(0.88).cz + legAt(0.88).hz + 0.03;
      k.add('extrude', 'Tasset', shape === 'lamellar' ? 'trim' : 'plate', { pos: [sx * 0.095, 0.93, tz], rot: [-10, sx * 10, 0], p: { pts: [[-0.065, 0], [0.065, 0], [0.06, -0.13], [0, -0.15], [-0.06, -0.13]], depth: 0.007, bevel: 0.002, curve: 2.5 } });
    }
    k.bone = null;
  });
  k.bone = 'Hips';
  const bt = torsoAt(0.95);
  k.collar('Belt', 'leather', [0, 0.95, bt.cz], [0, 1, 0], 1, 0.94, 0.04, { scale: [bt.hx + 0.02, 1, bt.hz + 0.02], tint: k.roles.dark.tint });
  k.add('box', 'Buckle', 'trim', { pos: [0, 0.93, bt.cz + bt.hz + 0.024], p: { w: 0.045, h: 0.04, d: 0.008 } });
  if (k.o >= 3) k.gem('Buckle gem', [0, 0.95, bt.cz + bt.hz + 0.03], 0.009, { scale: [1, 1, 0.6], stretch: 1 });
  if (k.chance(0.5)) {
    k.add('box', 'Pouch', 'leather', { pos: [-0.15, 0.86, bt.cz + 0.07], rot: [0, -38, 0], p: { w: 0.07, h: 0.08, d: 0.04 } });
    k.feature('belt pouch');
  }
  k.bone = null;
  k.feature(soft ? (shape === 'breeches' ? 'strapped leather breeches' : 'woven trousers') : 'armoured legs over trousers');
  return { noun: { platelegs: 'Platelegs', lamellar: 'Lamellar Legs', splint: 'Splinted Legs', frame: 'Field Legs', trousers: 'Trousers', breeches: 'Breeches' }[shape] };
}

/** Foot: loft along +z (heel to toe) for the left foot; ring "z" maps to world -y. */
function footLoft(grow, toeLen = 1, height = 1) {
  const [mn, mx] = MANNEQUIN.foot;
  const cx = (mn[0] + mx[0]) / 2;
  const z0 = mn[2] - grow * 0.6;
  const z1 = mx[2] + 0.012 + (toeLen - 1) * 0.08;
  const prof = [[0, 0.035, 0.08], [0.18, 0.045, 0.1], [0.42, 0.05, 0.085], [0.7, 0.054, 0.06], [0.88, 0.05, 0.042], [1, 0.032, 0.028]];
  return prof.map(([t, hx, h]) => {
    const H = h * height + grow;
    return [lerp(z0, z1, t), cx, -(H / 2), hx + grow * 0.8, H / 2, H / 2];
  });
}

function boots(k, shape) {
  const L = limb('leg');
  k.pair((sx, side) => {
    k.bone = `${side}Foot`;
    const pointed = shape === 'pointed' ? 1.3 : 1;
    const soleH = shape === 'trail' || shape === 'field' ? 0.016 : 0.01;
    const footRole = shape === 'sabatons' ? 'plate' : 'leather';
    k.add('loft', 'Foot', footRole, { pos: [0, soleH, 0], rot: [90, 0, 0], p: { pts: footLoft(0.012, pointed, shape === 'field' ? 1.1 : 1), power: 2.4, thick: 0, seg: 16 } });
    const [mn, mx] = MANNEQUIN.foot;
    const cx = (mn[0] + mx[0]) / 2;
    k.add('loft', 'Sole', 'dark', { pos: [0, soleH, 0], rot: [90, 0, 0], p: { pts: footLoft(0.016, pointed, 0.2).map((q) => [q[0], q[1], soleH / 2, q[3] + 0.003, soleH / 2, soleH / 2]), power: 3, thick: 0, seg: 14 } });
    const top = shape === 'pointed' || shape === 'leather' ? 0.34 : shape === 'field' ? 0.26 : 0.3;
    const shaftRole = shape === 'sabatons' ? 'plate' : shape === 'trail' ? 'leather' : 'leather';
    shell(k, L, 'Shaft', shaftRole, 0.05, top, 0.012, { thick: 0.004, n: 6, flare: (t) => (shape === 'field' ? t * t * 0.02 : shape === 'pointed' ? t * t * 0.012 : 0), tint: shape === 'trail' ? k.roles.dark.tint : undefined });
    switch (shape) {
      case 'sabatons':
        for (let i = 0; i < 4; i++) {
          const z = lerp(0.03, 0.15, i / 3);
          k.add('sphere', 'Sabaton lame', i % 2 ? 'trim' : 'plate', { pos: [cx, 0.035 + (0.08 - i * 0.016), z], rot: [-12 - i * 5, 0, 0], scale: [1, 0.42, 0.6], p: { r: 0.06 - i * 0.004, seg: 14, hemi: true } });
        }
        rim(k, L, top, 0.016, 0.005, 'trim', 'Cuff rim');
        k.feature('articulated sabatons');
        break;
      case 'trail':
      case 'leather':
      case 'pointed': {
        const straps = shape === 'trail' ? 3 : 2;
        for (let i = 0; i < straps; i++) {
          const y = 0.1 + i * ((top - 0.12) / straps);
          rim(k, L, y, 0.016, 0.0045, 'leather', 'Strap', 0);
          k.add('box', 'Buckle', 'trim', { pos: L.pt(y, Math.PI / 2, 0.018), p: { w: 0.008, h: 0.018, d: 0.014 } });
        }
        k.add('loft', 'Cuff', 'leather', { tint: k.roles.dark.tint, p: { pts: loftAlong(top - 0.03, top + 0.02, 2, legAt, 0.02, (t) => t * 0.008), power: 2.3, thick: 0.004, seg: 18 } });
        if (shape === 'trail') for (let i = 0; i < 5; i++) k.rivet([cx + (i % 2 ? 0.03 : -0.03), 0.004, lerp(-0.06, 0.14, i / 4)], 0.005, 'dark');
        if (shape === 'pointed') k.add('cone', 'Toe point', 'trim', { pos: [cx, 0.03, mx[2] + 0.05], rot: [90, 0, 0], p: { r: 0.016, h: 0.05, seg: 6 } });
        k.feature(shape === 'trail' ? 'hob-nailed soles' : shape === 'pointed' ? 'long pointed toes' : 'buckled leather boots');
        break;
      }
      case 'crystal':
        k.growth([cx, 0.05, mn[2] - 0.005], [0, 0.4, -1], 0.02, 3);
        rim(k, L, top, 0.016, 0.005, 'trim');
        k.feature('crystal heels');
        break;
      default:
        rim(k, L, top, 0.024, 0.006, 'trim', 'Cuff rim');
        k.add('box', 'Toe cap', 'plate', { pos: [cx, 0.016, mx[2] - 0.03], p: { w: 0.11, h: 0.05, d: 0.06 } });
        k.feature('wide field boots');
    }
    if (k.techy && shape !== 'crystal') {
      k.gear('Spur rowel', 'trim', [cx, 0.06, mn[2] - 0.03], [1, 0, 0], 0.02, { teeth: 9, tooth: 0.008, depth: 0.004, hole: 0.004 });
      k.rod('Spur neck', 'trim', [cx, 0.06, mn[2] + 0.005], [cx, 0.06, mn[2] - 0.025], 0.004, 0.004, 6);
    }
    if (k.o >= 3) k.gem('Boot gem', L.pt(top - 0.05, Math.PI / 2, 0.02), 0.009, { scale: [0.6, 1, 1], stretch: 1 });
    k.bone = null;
  });
  return { noun: { sabatons: 'Sabatons', leather: 'Boots', trail: 'Trail Boots', pointed: 'Pointed Boots', crystal: 'Crystal-heel Boots', field: 'Field Boots' }[shape] };
}

function gloves(k, shape) {
  const L = limb('arm');
  const hb = MANNEQUIN.hand;
  k.pair((sx, side) => {
    // Cuff on the forearm bone.
    k.bone = `${side}ForeArm`;
    const cuffLen = shape === 'leather' || shape === 'claw' ? 0.06 : 0.12;
    shell(k, L, 'Cuff', shape === 'leather' || shape === 'claw' ? 'leather' : 'plate', WRIST_X - cuffLen, WRIST_X + 0.015, 0.012, { thick: 0.004, n: 4, flare: (t) => (shape === 'leather' ? 0 : (1 - t) ** 2 * 0.02) });
    if (shape !== 'leather') rim(k, L, WRIST_X - cuffLen, 0.012 + 0.02, 0.004, 'trim');
    // Hand on the hand bone: palm block, fingers along +x, thumb forward.
    k.bone = `${side}Hand`;
    const palmRole = shape === 'leather' || shape === 'claw' ? 'leather' : 'dark';
    const px0 = B.LeftHand[0] + 0.002;
    const px1 = B.LeftHandMiddle1[0] + 0.004;
    const py = B.LeftHand[1] - 0.008;
    // Palm: a rounded shell sized to the measured hand (x 0.671-0.799, y 1.409-1.459, z -0.104 to -0.011),
    // ending at the knuckles so a closed fist doesn't push a corner out.
    const palmPts = [[0.668, 0.024, 0.044], [0.7, 0.028, 0.049], [0.74, 0.029, 0.051], [0.775, 0.027, 0.05], [0.8, 0.021, 0.045]].map(([x, hy, hz]) => [x, -1.434, -0.057, hy, hz, hz]);
    k.add('loft', 'Palm', palmRole, { rot: ARM_ROT, p: { pts: palmPts, power: 2.4, thick: 0, seg: 16 } });
    // Fingers and thumb: one segment per finger bone, so the glove curls with the hand.
    const plated = shape === 'gauntlet' || shape === 'lames' || shape === 'mech' || shape === 'crystal';
    const fingerSeg = (f, j, r0, r1, drop) => {
      const a = V(B[`LeftHand${f}${j}`]);
      const b = V(B[`LeftHand${f}${j + 1}`]);
      const dir = b.clone().sub(a).normalize();
      const p0 = a.clone().addScaledVector(dir, -0.004).add(V([0, -drop, 0]));
      const p1 = b.clone().addScaledVector(dir, j === 3 ? 0.002 : 0.003).add(V([0, -drop, 0]));
      k.bone = `${side}Hand${f}${j}`;
      k.rod(f === 'Thumb' ? 'Thumb' : 'Finger', palmRole, p0.toArray(), p1.toArray(), r0, r1, 12);
      if (j === 1) k.add('sphere', 'Knuckle', palmRole, { pos: a.clone().add(V([0, -drop, 0])).toArray(), p: { r: r0 * (f === 'Thumb' ? 1.12 : 1.1), seg: 10 } });
      if (j === 3) k.add('sphere', 'Fingertip', palmRole, { pos: p1.toArray(), p: { r: r1, seg: 10 } });
      else k.add('sphere', 'Knuckle', palmRole, { pos: b.clone().add(V([0, -drop, 0])).toArray(), p: { r: r1 * 1.04, seg: 10 } });
      if (plated && f !== 'Thumb') {
        const len = p0.distanceTo(p1);
        const mid = p0.clone().lerp(p1, 0.5).add(V([0, r0 * 0.75, 0]));
        k.add('box', 'Finger lame', 'plate', { pos: mid.toArray(), rot: [0, 0, DEG(Math.atan2(dir.y, dir.x))], p: { w: len * (shape === 'lames' ? 0.9 : 0.8), h: 0.005, d: r0 * 1.9 } });
      }
      if (shape === 'claw' && j === 3) k.add('cone', 'Claw tip', 'edge', { pos: p1.toArray(), rot: aim(dir.toArray()), p: { r: 0.006, h: 0.026, seg: 5 } });
    };
    // Radii from the measured fingers (segment 1 ~12 mm with the knuckle, 2 ~9 mm, 3 ~8 mm) plus a layer.
    // (The finger skin sits ~3 mm above the bone line, hence the lift.)
    const R = { Index: [0.0156, 0.0132, 0.0118, 0.0104], Middle: [0.016, 0.0135, 0.012, 0.0106], Ring: [0.015, 0.0126, 0.0113, 0.01], Pinky: [0.0138, 0.0116, 0.0104, 0.0092], Thumb: [0.0178, 0.0156, 0.0134, 0.0114] };
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (let j = 1; j <= 3; j++) fingerSeg(f, j, R[f][j - 1], R[f][j], f === 'Thumb' ? 0 : -0.0025);
    // Thenar pad: the fleshy base of the thumb, riding the thumb's first bone.
    k.bone = `${side}HandThumb1`;
    k.add('sphere', 'Thumb pad', palmRole, { pos: [0.706, 1.427, -0.026], rot: [0, -30, 0], scale: [1.45, 1, 1.15], p: { r: 0.02, seg: 12 } });
    k.bone = `${side}Hand`;
    if (shape !== 'leather' && shape !== 'claw') {
      k.add('box', 'Hand plate', 'plate', { pos: [(px0 + 0.795) / 2, 1.4605, -0.057], p: { w: 0.795 - px0, h: 0.007, d: 0.094 } });
      k.add('box', 'Knuckle plate', 'trim', { pos: [0.792, 1.4605, -0.057], p: { w: 0.016, h: 0.009, d: 0.098 } });
    }
    if (shape === 'mech') {
      for (const z of [-0.07, -0.035]) {
        k.rod('Tendon piston', 'dark', [WRIST_X - 0.1, B.LeftHand[1] + 0.045, z], [WRIST_X - 0.005, B.LeftHand[1] + 0.03, z], 0.0065, 0.0065, 8);
        k.rod('Tendon rod', 'edge', [WRIST_X - 0.005, B.LeftHand[1] + 0.03, z], [px1 - 0.01, py + 0.008, z], 0.003, 0.003, 6);
      }
      k.gear('Wrist cog', 'trim', [WRIST_X - 0.02, B.LeftHand[1] + 0.045, -0.055], [0, 1, 0], 0.022, { teeth: 10, depth: 0.007, hole: 0.007 });
      k.feature('piston tendons');
    }
    if (shape === 'crystal') k.growth([0.735, 1.459, -0.057], [0, 1, 0], 0.016, 3);
    if (k.o >= 2) k.gem('Knuckle gem', [0.79, 1.472, -0.052], 0.008, { scale: [1, 0.6, 1], stretch: 1 });
    if (k.o >= 4) k.add('sphere', 'Palm core', 'light', { pos: [0.735, 1.406, -0.057], p: { r: 0.009, seg: 8 } });
    if (shape === 'leather') {
      for (const x of [WRIST_X - 0.04, WRIST_X - 0.01]) rim(k, L, x, 0.016, 0.004, 'leather', 'Cuff strap');
      k.feature('wrapped leather');
    }
    k.bone = null;
  });
  k.feature({ gauntlet: 'knuckle gauntlets', lames: 'articulated finger lames', claw: 'open claw tips', crystal: 'crystal-backed hands' }[shape]);
  return { noun: { gauntlet: 'Gauntlets', lames: 'Lamed Gauntlets', leather: 'Gloves', mech: 'Piston Gauntlets', claw: 'Claw Gloves', crystal: 'Crystal Gauntlets' }[shape] };
}

function helmetDome(k, yb, grow, role, name = 'Dome', o = {}) {
  const pts = loftAlong(yb, HEAD_TOP - 0.012, o.n ?? 7, headAt, grow, o.flare);
  const t = headAt(HEAD_TOP - 0.012);
  pts.push([HEAD_TOP + grow * 0.7 + (o.peak ?? 0), 0, t.cz - 0.005, 0.012, 0.012, 0.012]);
  return k.add('loft', name, role, { tint: o.tint, p: { pts, power: o.power ?? 2.15, thick: 0.006, seg: o.seg ?? 22 } });
}

function helmet(k, shape) {
  k.bone = 'Head';
  const g = 0.016 + k.c.dense * 0.006;
  const brow = 1.625;
  const hf = (y, out = g) => {
    const h = headAt(y);
    return h.cz + h.hz + out;
  };
  const crest = () => {
    // A comb whose lower edge follows the dome from brow to nape.
    const prof = [];
    for (let y = brow + 0.04; y <= HEAD_TOP - 0.005; y += 0.02) {
      const h = headAt(y);
      prof.push([h.cz + h.hz + g, y], [h.cz - h.hz - g, y]);
    }
    const front = prof.filter((_, i) => i % 2 === 0);
    const back = prof.filter((_, i) => i % 2 === 1).reverse();
    const bottom = [...front, [headAt(HEAD_TOP).cz, HEAD_TOP + g], ...back].map(([z, y]) => [z, y - 0.01]);
    const H = 0.05 + k.m.length * 0.02;
    const top = bottom.map(([z, y], i) => [z, y + 0.02 + H * Math.sin((i / (bottom.length - 1)) * Math.PI)]).reverse();
    return [...bottom, ...top].map(([z, y]) => [r5(-z), r5(y)]);
  };
  switch (shape) {
    case 'kettle': {
      helmetDome(k, brow + 0.01, g, 'plate', 'Kettle dome', { peak: 0.02 });
      const brim = 0.2 + k.m.width * 0.04;
      const h = headAt(brow);
      k.add('loft', 'Brim', 'plate', { p: { pts: [[brow - 0.012, 0, h.cz, brim, brim * 1.05, brim * 1.05], [brow, 0, h.cz, brim * 0.98, brim, brim], [brow + 0.025, 0, h.cz, h.hx + g + 0.006, h.hz + g + 0.006, h.hz + g + 0.006]], power: 2, thick: 0.004, seg: 28 } });
      k.collar('Brow band', 'trim', [0, brow + 0.03, h.cz], [0, 1, 0], 1, 0.92, 0.022, { scale: [h.hx + g + 0.006, 1, h.hz + g + 0.006] });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        k.rivet([Math.sin(a) * (h.hx + g + 0.008), brow + 0.03, h.cz + Math.cos(a) * (h.hz + g + 0.008)], 0.005);
      }
      k.feature('wide brim');
      break;
    }
    case 'crested':
    case 'horned': {
      helmetDome(k, brow - 0.03, g, 'plate', 'Helm', { peak: 0.012 });
      k.add('box', 'Nasal', 'trim', { pos: [0, brow - 0.09, hf(brow - 0.03) - 0.004], p: { w: 0.02, h: 0.11, d: 0.01 } });
      k.pair((sx) => {
        const h = headAt(brow - 0.05);
        k.add('extrude', 'Cheek guard', 'plate', { pos: [sx * (h.hx + g), brow - 0.04, h.cz + 0.02], rot: [0, 90, 6], p: { pts: [[-0.06, 0], [0.04, 0], [0.035, -0.08], [-0.01, -0.11], [-0.055, -0.06]], depth: 0.006, bevel: 0.0015, curve: 1.5 } });
        if (shape === 'horned') {
          const base = [sx * (h.hx + 0.005), brow + 0.07, h.cz];
          const horn = [[0, 0], [0.07, 0.06], [0.11, 0.15], [0.08, 0.24]].map(([x, y]) => [x * k.m.length, y * k.m.length]);
          k.add('sweep', 'Horn', k.fam === 'sylvan' ? 'wood' : 'edge', { pos: base, rot: [0, 0, 0], p: { pts: horn, r: 0.024, r2: 0.004, flat: 1, sides: 8, seg: 8 } });
          if (k.fam === 'crystalline') k.inlay('Horn gem', 'crystal', [base[0] + sx * 0.004, base[1] - 0.012, base[2] + 0.01], [sx, 0.2, 0.3], 0.011);
        }
      });
      if (shape === 'crested') {
        const kind = k.wpick({ fin: 3, plume: k.fam === 'tempest' || k.fam === 'celestial' ? 4 : 2, cog: k.fam === 'artificer' ? 4 : 0, crystal: k.fam === 'crystalline' ? 4 : 0 });
        if (kind === 'fin') k.add('extrude', 'Crest', 'trim', { rot: [0, 90, 0], p: { pts: crest(), depth: 0.007, bevel: 0.0015 } });
        if (kind === 'plume') k.add('sweep', 'Plume', 'cloth', { pos: [0, HEAD_TOP + g - 0.01, headAt(HEAD_TOP).cz], rot: [0, -90, 0], tint: k.roles.cloth2.tint, p: { pts: [[0.03, 0], [-0.04, 0.07], [-0.14, 0.06], [-0.22, -0.02], [-0.25, -0.1]], r: 0.03, r2: 0.012, flat: 0.35, sides: 8, seg: 10 } });
        if (kind === 'cog') k.gear('Crest cog', 'trim', [0, HEAD_TOP + g + 0.02, headAt(HEAD_TOP).cz], [1, 0, 0], 0.05, { teeth: 12, depth: 0.012, hole: 0.015 });
        if (kind === 'crystal') for (let i = 0; i < 5; i++) k.inlay('Crest gem', i % 2 ? 'crystal' : 'shard', [0, HEAD_TOP + g - 0.004 - Math.abs(i - 2) * 0.012, headAt(HEAD_TOP).cz + (i - 2) * 0.035], [0, 1, (i - 2) * 0.45], 0.012 + (2 - Math.abs(i - 2)) * 0.002);
        k.feature(kind === 'fin' ? 'crested comb' : kind === 'plume' ? 'plume' : kind === 'cog' ? 'cog crest' : 'gem-studded crest');
      } else k.feature('swept horns');
      break;
    }
    case 'greathelm': {
      const pts = loftAlong(1.5, HEAD_TOP - 0.012, 9, headAt, g + 0.006);
      pts.push([HEAD_TOP + g, 0, headAt(HEAD_TOP).cz, 0.03, 0.03, 0.03]);
      k.add('loft', 'Great helm', 'plate', { p: { pts, power: 2.6, thick: 0.006, seg: 22 } });
      const ys = 1.655;
      const vis = k.o >= 3 ? 'light' : 'dark';
      k.add('box', 'Eye slit', vis, { pos: [0, ys - 0.008, hf(ys, g + 0.006) - 0.004], p: { w: 0.11, h: 0.016, d: 0.012 } });
      k.add('box', 'Face bar', 'trim', { pos: [0, 1.52, hf(1.58, g + 0.006) - 0.003], p: { w: 0.024, h: 0.2, d: 0.012 } });
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) k.add('box', 'Breath', 'dark', { pos: [0.03 + c * 0.015, 1.57 - r * 0.022, hf(1.57 - r * 0.022, g + 0.006) - 0.005], rot: [0, 18, 0], p: { w: 0.008, h: 0.012, d: 0.01 } });
      if (k.o >= 4 || k.fam === 'celestial') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const h = headAt(1.72);
          k.add('cone', 'Crown point', 'trim', { pos: [Math.sin(a) * (h.hx + g), 1.72, h.cz + Math.cos(a) * (h.hz + g)], p: { r: 0.012, h: 0.045, seg: 4 } });
        }
        k.feature('coronet');
      }
      k.feature(vis === 'dark' ? 'eye-slit visor' : 'glowing visor');
      break;
    }
    case 'hood': {
      helmetDome(k, 1.6, 0.028, 'cloth', 'Hood', { flare: (t) => (1 - t) * 0.02 });
      k.pair((sx) => {
        const h = headAt(1.6);
        k.add('extrude', 'Hood side', 'cloth', { pos: [sx * (h.hx + 0.04), 1.6, h.cz - 0.01], rot: [0, 90, 0], p: { pts: [[-0.1, 0.02], [0.08, 0.02], [0.06, -0.14], [-0.04, -0.17], [-0.11, -0.1]], depth: 0.006, bevel: 0.002, curve: 1 } });
      });
      k.add('banner', 'Hood drape', 'cloth', { pos: [0, 1.3, -0.14], rot: [8, 180, 0], p: { w: 0.22, h: 0.3, wave: 0.01 } });
      const h = headAt(1.62);
      k.collar('Brow band', 'trim', [0, 1.625, h.cz], [0, 1, 0], 1, 0.9, 0.02, { scale: [h.hx + 0.034, 1, h.hz + 0.034] });
      k.feature('forged hood');
      break;
    }
    case 'aviator': {
      helmetDome(k, 1.6, 0.012, 'leather', 'Cap');
      k.pair((sx) => {
        const h = headAt(1.6);
        k.add('extrude', 'Ear flap', 'leather', { pos: [sx * (h.hx + 0.012), 1.6, h.cz], rot: [0, 90, 0], p: { pts: [[-0.045, 0.02], [0.045, 0.02], [0.04, -0.06], [0, -0.08], [-0.04, -0.06]], depth: 0.008, bevel: 0.002, curve: 1.5 } });
      });
      const gy = 1.705;
      const h = headAt(gy);
      k.ring('Goggle strap', 'leather', [0, gy, h.cz], [0, 1, 0], 1, 0.006, { scale: [h.hx + 0.016, h.hz + 0.016, 1], tint: k.roles.dark.tint, seg: 28 });
      k.pair((sx) => {
        const z = hf(gy, 0.02);
        k.collar('Goggle rim', 'trim', [sx * 0.04, gy, z], [0, 0.2, 1], 0.027, 0.019, 0.022);
        k.disc('Goggle lens', k.o >= 3 ? 'light' : 'lamp_warm', [sx * 0.04, gy, z + 0.004], [0, 0.2, 1], 0.02, 0.006, 16);
      });
      k.rod('Goggle bridge', 'trim', [-0.018, gy, hf(gy, 0.024)], [0.018, gy, hf(gy, 0.024)], 0.004, 0.004, 6);
      k.feature('flight goggles');
      break;
    }
    case 'tophat':
    case 'wizard':
    case 'ranger': {
      const h = headAt(1.7);
      const y0 = 1.69;
      const brim = shape === 'ranger' ? 0.2 + k.m.width * 0.03 : shape === 'wizard' ? 0.19 : 0.16;
      const hatRole = shape === 'tophat' ? 'dark' : 'cloth';
      k.add('loft', 'Brim', hatRole, { p: { pts: [[y0 - 0.006, 0, h.cz, brim, brim * 1.08, brim * 1.08], [y0 + 0.004, 0, h.cz, brim, brim * 1.08, brim * 1.08]], power: 2, thick: 0, seg: 28 } });
      if (shape === 'tophat') {
        const ch = 0.14 + k.m.length * 0.04;
        k.add('loft', 'Crown', hatRole, { p: { pts: [[y0, 0, h.cz, h.hx + 0.018, h.hz + 0.018, h.hz + 0.018], [y0 + ch, 0, h.cz, h.hx + 0.026, h.hz + 0.026, h.hz + 0.026]], power: 2.2, thick: 0, seg: 22 } });
        k.collar('Hat band', 'cloth', [0, y0 + 0.022, h.cz], [0, 1, 0], 1, 0.94, 0.03, { scale: [h.hx + 0.022, 1, h.hz + 0.022], tint: k.roles.cloth2.tint });
        k.gear('Hat pin', 'trim', [h.hx * 0.7, y0 + 0.03, h.cz + h.hz + 0.015], [0.5, 0, 1], 0.02, { teeth: 10, depth: 0.006, hole: 0.006 });
      } else if (shape === 'wizard') {
        const H = 0.32 + k.m.length * 0.08;
        const lean = k.rand(0.05, 0.12);
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const r = lerp(h.hx + 0.02, 0.006, t ** 0.9);
          pts.push([y0 + t * H, -lean * t * t, h.cz - lean * 0.6 * t * t, r, r * 1.05, r * 1.05]);
        }
        k.add('loft', 'Cone', hatRole, { p: { pts, power: 2, thick: 0, seg: 18 } });
        if (k.fam === 'crystalline' || k.o >= 3) k.inlay('Band gem', 'crystal', [0, y0 + 0.015, h.cz + h.hz + 0.022], [0, 0, 1], 0.009);
      } else {
        k.add('loft', 'Crown', hatRole, { p: { pts: [[y0, 0, h.cz, h.hx + 0.016, h.hz + 0.016, h.hz + 0.016], [y0 + 0.06, 0, h.cz, h.hx + 0.012, h.hz + 0.01, h.hz + 0.01], [y0 + 0.085, 0, h.cz, h.hx * 0.7, h.hz * 0.6, h.hz * 0.6]], power: 2.3, thick: 0, seg: 22 } });
        k.add('sweep', 'Feather', 'cloth2', { pos: [h.hx + 0.01, y0 + 0.03, h.cz - 0.02], rot: [0, -60, 0], p: { pts: [[0, 0], [0.03, 0.06], [0.04, 0.14], [0.02, 0.2]], r: 0.012, r2: 0.002, flat: 0.3, sides: 6, seg: 8 } });
      }
      k.collar('Band', 'trim', [0, y0 + 0.008, h.cz], [0, 1, 0], 1, 0.95, 0.014, { scale: [h.hx + 0.02, 1, h.hz + 0.02] });
      k.feature(shape === 'tophat' ? 'top hat' : shape === 'wizard' ? 'bent wizard cone' : 'low ranger brim');
      break;
    }
    default: {
      // Crown: circlet plus family ornament.
      const y = 1.69;
      const h = headAt(y);
      k.collar('Circlet', 'trim', [0, y, h.cz], [0, 1, 0], 1, 0.9, 0.028, { scale: [h.hx + 0.012, 1, h.hz + 0.012] });
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = ((i - (n - 1) / 2) / n) * Math.PI * 2;
        const p = [Math.sin(a) * (h.hx + 0.014), y + 0.012, h.cz + Math.cos(a) * (h.hz + 0.014)];
        const hh = (0.06 + k.m.length * 0.03) * (i === (n - 1) / 2 ? 1.5 : 1);
        if (k.fam === 'sylvan') k.add('extrude', 'Laurel leaf', 'shard', { pos: p, rot: [0, DEG(a), (i % 2 ? 1 : -1) * 25], p: { pts: [[0, 0], [0.012, 0.03], [0, 0.065], [-0.012, 0.03]], depth: 0.004, bevel: 0.001 } });
        else {
          k.add('extrude', 'Spire', 'trim', { pos: p, rot: [0, DEG(a), 0], p: { pts: [[-0.016, 0], [0.016, 0], [0, hh]], depth: 0.006, bevel: 0.0015 } });
          if (k.fam === 'crystalline' || k.fam === 'void') k.inlay('Spire gem', i % 2 ? 'crystal' : 'shard', [p[0] + Math.sin(a) * 0.0032, p[1] + hh * 0.3, p[2] + Math.cos(a) * 0.0032], [Math.sin(a), 0, Math.cos(a)], 0.0055, { bezel: false });
        }
      }
      k.gem('Crown jewel', [0, y + 0.03, h.cz + h.hz + 0.02], 0.013, { scale: [1, 1.2, 0.6], stretch: 1 });
      k.feature('spired crown');
    }
  }
  if (k.o >= 2 && (shape === 'kettle' || shape === 'crested' || shape === 'horned' || shape === 'aviator')) k.gem('Brow gem', [0, brow + 0.02, hf(brow + 0.02) + 0.002], 0.011, { scale: [1, 1, 0.6], stretch: 1 });
  k.bone = null;
  return { noun: { kettle: 'Kettle Helm', crested: 'Crested Helm', greathelm: 'Great Helm', horned: 'Horned Helm', hood: 'Forged Hood', aviator: 'Aviator Cap', tophat: 'Top Hat', wizard: 'Wizard Hat', ranger: 'Ranger Hat', crown: 'Crown' }[shape] };
}

function cape(k, shape) {
  k.bone = 'Spine2';
  // Capes are cloth sheets (core 'cloth' shape) hung from an arc over the shoulders behind the neck; in
  // the Forge they are simulated as cloth. Linings, hem and edge trims and the sigil are bands of the
  // same grid, so they move with it. Feather and leaf mantles stay rigid.
  const topY = 1.468;
  const back = torsoAt(1.43);
  // Hung clear of a cuirass's back (armour stands up to ~5 cm proud of the skin).
  const zTop = back.cz - back.hz - 0.062;
  const W = 0.42 * (0.94 + k.m.width * 0.06);
  const lining = k.roles.cloth2.tint;
  const len = (a, b) => k.rand(a, b) * (0.9 + k.m.length * 0.1);
  const S = (o) => ({ w: W, h: 1.1, cols: 13, rows: 20, wrap: 92, slope: 0.035, flare: 1.4, drape: 0.12, billow: 0.012, hem: 1, hemDepth: 0.06, scallops: 6, seed: k.int(1, 999), u0: 0, u1: 1, r0: 0, r1: -1, c0: 0, c1: -1, offset: 0, group: 1, ...o });
  const sheet = (name, role, p, extra = {}) => k.add('cloth', name, role, { pos: [0, topY, zTop], p, ...extra });
  const dressed = (p, { trims = true, sigil = true } = {}) => {
    sheet('Cape', 'cloth', p);
    sheet('Lining', 'cloth', { ...p, offset: -0.004 }, { tint: lining });
    if (trims && k.o >= 1) sheet('Hem trim', 'cloth2', { ...p, r0: p.rows - 3, offset: 0.0022 });
    if (trims && k.o >= 2) {
      sheet('Edge trim', 'cloth2', { ...p, c1: 1, offset: 0.0022 });
      sheet('Edge trim', 'cloth2', { ...p, c0: p.cols - 2, offset: 0.0022 });
    }
    if (sigil && k.o >= 3 && p.h > 0.6 && p.cols >= 11) {
      const r0 = Math.round(p.rows * 0.16);
      const mid = (p.cols - 1) / 2;
      sheet('Order sigil', 'banner', { ...p, r0, r1: r0 + 5, c0: Math.floor(mid - 3), c1: Math.ceil(mid + 3), offset: 0.0032 });
      k.feature('woven Order sigil');
    }
  };
  switch (shape) {
    case 'split':
      for (const [g, u0, u1] of [[1, 0, 0.47], [2, 0.53, 1]]) dressed(S({ group: g, u0, u1, cols: 8, h: len(1.0, 1.2), flare: 1.18, hem: 2, hemDepth: k.rand(0.14, 0.22), drape: 0.1 }), { sigil: false });
      k.feature('split riding tails');
      break;
    case 'ragged':
      dressed(S({ h: len(0.95, 1.15), flare: k.rand(1.25, 1.4), hem: 5, hemDepth: k.rand(0.2, 0.32), billow: 0.02 }), { trims: false });
      k.feature('torn hem');
      break;
    case 'capelet':
      dressed(S({ w: W * 1.3, wrap: 124, h: len(0.36, 0.46), rows: 10, flare: 1.75, drape: 0.04, hem: k.chance(0.5) ? 1 : 4, hemDepth: k.rand(0.08, 0.14), scallops: 7 }), { sigil: false });
      k.feature('short capelet');
      break;
    case 'mantle':
      dressed(S({ w: W * 1.22, wrap: 120, h: len(0.5, 0.64), rows: 12, flare: 1.55, drape: 0.05, hem: 4, scallops: k.int(6, 8), hemDepth: k.rand(0.06, 0.1) }), { sigil: false });
      break;
    case 'tabard':
      dressed(S({ w: W * 0.55, wrap: 32, h: len(0.85, 1.05), cols: 7, flare: 1.06, drape: 0.08, hem: 2, hemDepth: k.rand(0.1, 0.16) }), { sigil: false });
      k.feature('narrow backcloth');
      break;
    case 'leaves':
    case 'fan': {
      // Rigid feathers can't move aside like cloth, so they stay short and sweep back off the legs.
      const h = shape === 'fan' ? len(0.55, 0.72) : len(0.95, 1.2);
      const w = 0.44 + k.m.width * 0.06;
      const tilt = shape === 'fan' ? 16 : 10;
      const rows = shape === 'fan' ? 1 : 4;
      const per = shape === 'fan' ? 9 : 5;
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < per; i++) {
          const t = (i - (per - 1) / 2) / ((per - 1) / 2);
          const ll = shape === 'fan' ? h * (0.7 + 0.3 * (1 - Math.abs(t))) : 0.24;
          const y = topY - 0.04 - r * 0.2;
          const z = zTop - 0.01 - r * 0.025;
          const rot = [tilt + (shape === 'fan' ? 6 * Math.abs(t) : 0), 180, t * (shape === 'fan' ? 26 : 8)];
          const wl = shape === 'fan' ? 0.06 : 0.065;
          k.add('extrude', shape === 'fan' ? 'Feather' : 'Leaf plate', (r + i) % 2 ? 'cloth' : 'shard', { pos: [t * w * 0.42, y, z], rot, p: { pts: [[0, 0], [wl, -ll * 0.4], [0, -ll], [-wl, -ll * 0.4]], depth: 0.006, bevel: 0.0015, curve: 1.2 } });
        }
      if (shape === 'leaves') dressed(S({ h: len(0.75, 0.9), flare: 1.3, hem: 4, scallops: 5, hemDepth: 0.1, drape: 0.14 }), { trims: false, sigil: false });
      k.feature(shape === 'fan' ? 'feather fan' : 'overlapping leaves');
      break;
    }
    default: {
      const hem = k.wpick({ 1: 4, 2: 2, 0: 1, 3: k.fam === 'duelist' || k.fam === 'void' ? 2 : 0.5 });
      dressed(S({ h: len(0.98, 1.18), flare: k.rand(1.35, 1.6), hem: +hem, hemDepth: +hem === 0 ? 0 : k.rand(0.05, 0.12) }));
      k.feature({ 0: 'straight hem', 1: 'rounded hem', 2: 'pointed hem', 3: 'swallowtail hem' }[hem]);
    }
  }
  // Collar or mantle over the shoulders.
  const t = torsoAt(topY);
  if (shape === 'mantle') {
    k.add('loft', 'Mantle', 'cloth', { p: { pts: [[1.3, 0, t.cz, t.hx + 0.07, t.hz + 0.07, t.hz + 0.07], [1.42, 0, t.cz, t.hx + 0.055, t.hz + 0.05, t.hz + 0.05], [1.5, 0, -0.045, 0.085, 0.075, 0.075]], power: 2.4, thick: 0.004, seg: 26 } });
    k.feature('shoulder mantle');
  } else {
    // A short cowl over the shoulders, shaped on the torso yoke and grown clear of any cuirass, so the
    // collar sits on top of chest armour instead of cutting through it.
    // (Grown past the cape's own top edge too, so the cape emerges from under it.)
    k.add('loft', 'Collar', 'cloth', { tint: lining, p: { pts: torsoLoft(1.44, 1.5, 0.074, 2).filter((q) => q[0] >= 1.44).map((q) => (q[0] > 1.49 ? [q[0], q[1], q[2], q[3] + 0.008, q[4] + 0.008, q[5] + 0.008] : q)), power: 2.4, thick: 0.004, seg: 26 } });
  }
  // Clasps at the collarbones.
  const clasp = { artificer: 'cog', celestial: 'sun', crystalline: 'crystal', void: 'crescent', sylvan: 'leaf' }[k.fam] ?? 'boss';
  k.pair((sx) => {
    const c = [0.1, 1.44, torsoFront(0.1, 1.44, 0.012)];
    heraldry(k, clasp, c, [0, 0.25, 1], 0.022);
  });
  if (k.o >= 2) {
    const a = [-0.1, 1.44, torsoFront(0.1, 1.44, 0.018)];
    const b = [0, 1.41, torsoFront(0, 1.41, 0.018)];
    const c = [0.1, 1.44, torsoFront(0.1, 1.44, 0.018)];
    polyline(k, [a, b, c], 0.0025, 'trim', 'Clasp chain');
  }
  k.bone = null;
  return { noun: { cloak: 'Cloak', split: 'Riding Cape', capelet: 'Capelet', mantle: 'Mantle', ragged: 'Ragged Mantle', leaves: 'Leaf Cape', fan: 'Feather Mantle', tabard: 'Backcloth' }[shape] };
}

/** Necklace path: a loop draped on the shoulders, found by searching the measured torso for the surface. */
// Necklaces are laid over an armour envelope (this far off the skin), so chains and pendants sit on top
// of a cuirass or jerkin instead of being buried in it with only a few links poking through.
const NECK_CLEAR = 0.04;
function necklacePath(n, drop) {
  const inside = (x, z, y) => {
    const t = torsoAt(y);
    const u = Math.abs(x) / (t.hx + NECK_CLEAR);
    const v = Math.abs(z - t.cz) / (t.hz + NECK_CLEAR);
    return u ** 2.3 + v ** 2.3 < 1;
  };
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const f = (Math.sin(a) + 1) / 2; // 1 at the front
    const rx = 0.072 + NECK_CLEAR * 0.55 + f * 0.03;
    const x = Math.cos(a) * rx;
    const zc = -0.045;
    let z = zc + Math.sin(a) * (0.062 + NECK_CLEAR * 0.55 + f * 0.05);
    let y = 1.53;
    while (y > 1.3 && !inside(x, z, y)) y -= 0.004;
    if (f > 0.6) {
      y -= drop * ((f - 0.6) / 0.4) ** 1.5;
      z = torsoFront(x, y, NECK_CLEAR + 0.006) + frontFill(y);
    }
    pts.push([x, y + 0.006, z + Math.sin(a) * 0.006]);
  }
  return pts;
}

function necklace(k, shape) {
  k.bone = 'Neck';
  const chain = k.wpick({ links: 4, beads: 2, cord: k.fam === 'sylvan' ? 4 : 1, torque: shape === 'torque' ? 50 : 0 });
  const metalRole = 'trim';
  const drop = shape === 'torque' ? 0 : k.rand(0.03, 0.06);
  const path = necklacePath(chain === 'links' ? 62 : chain === 'beads' ? 44 : 30, drop);
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const q = path[(i + 1) % path.length];
    const front = i === Math.round(path.length / 4);
    if (chain === 'torque') {
      if (Math.abs(i / path.length - 0.25) < 0.03) continue;
      k.rod('Torque', metalRole, p, q, 0.0065, 0.0065, 8);
    } else if (chain === 'cord') k.rod('Cord', 'leather', p, q, 0.0024, 0.0024, 6);
    else if (chain === 'links') {
      if (front) continue;
      const tan = V(q).sub(V(p)).normalize();
      const side = i % 2 ? tan.clone().cross(UP).normalize() : UP.clone();
      k.ring('Link', metalRole, p, side.toArray(), 0.0058, 0.0012, { seg: 8, sides: 4 });
    } else if (!front) k.add('sphere', 'Bead', i % 3 === 0 ? 'crystal' : metalRole, { pos: p, p: { r: 0.0058, seg: 8 } });
  }
  k.feature({ links: 'link chain', beads: 'beaded strand', cord: 'leather cord', torque: 'open torque' }[chain]);
  const F = path[Math.round(path.length / 4)];
  const px = F[0];
  const py = F[1] - 0.008;
  const pz = F[2] + 0.008;
  if (shape !== 'torque') k.ring('Bail', metalRole, [px, F[1], pz], [1, 0, 0], 0.006, 0.0015, { seg: 12 });
  switch (shape) {
    case 'cog':
      k.gear('Cog pendant', metalRole, [px, py - 0.022, pz], [0, 0, 1], 0.02, { teeth: 12, depth: 0.004, hole: 0.008 });
      k.add('sphere', 'Cog core', 'light', { pos: [px, py - 0.022, pz], p: { r: 0.0075, seg: 10 } });
      break;
    case 'shard':
      k.add('cone', 'Shard cap', metalRole, { pos: [px, py - 0.006, pz], rot: [180, 0, 0], p: { r: 0.007, h: 0.008, seg: 6 } });
      k.inlay('Pendant gem', 'crystal', [px, py - 0.026, pz + 0.002], [0, 0, 1], 0.011, { stretch: 1.7, flat: 0.32 });
      break;
    case 'locket':
      k.disc('Locket', metalRole, [px, py - 0.02, pz], [0, 0, 1], 0.017, 0.008, 18);
      k.disc('Locket face', 'clockface', [px, py - 0.02, pz + 0.0045], [0, 0, 1], 0.0135, 0.002, 18);
      break;
    case 'sunburst':
      heraldry(k, 'sun', [px, py - 0.024, pz], [0, 0, 1], 0.022);
      k.gem('Sun stone', [px, py - 0.024, pz + 0.004], 0.007, { scale: [1, 1, 0.6], stretch: 1 });
      break;
    case 'tusk':
      for (const s of [-1, 1]) k.add('sweep', 'Fang', 'ivory', { pos: [px + s * 0.012, py - 0.004, pz], p: { pts: [[0, 0], [s * 0.006, -0.02], [s * 0.004, -0.04], [-s * 0.004, -0.055]], r: 0.0055, r2: 0.0008, flat: 1, sides: 6, seg: 6 } });
      break;
    case 'chandelier':
      k.ring('Chandelier bar', metalRole, [px, py - 0.006, pz], [0, 0, 1], 0.024, 0.0018, { arc: 180, seg: 12 });
      for (let i = 0; i < 5; i++) {
        const t = (i - 2) / 2;
        k.inlay('Drop gem', i % 2 ? 'shard' : 'crystal', [px + t * 0.022, py - 0.016 - (1 - Math.abs(t)) * 0.01, pz + 0.002], [0, 0, 1], 0.0045 + (1 - Math.abs(t)) * 0.002, { stretch: 1.6, flat: 0.35 });
      }
      break;
    case 'torque':
      for (const s of [-1, 1]) k.add('sphere', 'Torque terminal', 'crystal', { pos: [path[Math.round(path.length / 4) + s * 2][0], path[Math.round(path.length / 4) + s * 2][1], path[Math.round(path.length / 4) + s * 2][2] + 0.004], p: { r: 0.009, seg: 8 } });
      break;
    default:
      k.ring('Setting', metalRole, [px, py - 0.016, pz], [0, 0, 1], 0.016, 0.0028, { seg: 20 });
      k.gem('Pendant stone', [px, py - 0.016, pz], 0.0125, { role: k.o >= 2 ? 'rgem' : 'crystal', facets: 8, scale: [1, 1.2, 0.65], stretch: 1 });
  }
  k.feature({ cog: 'cog amulet', shard: 'crystal shard', locket: 'clockwork locket', sunburst: 'sunburst', tusk: 'twin fangs', chandelier: 'crystal chandelier', torque: null, gem: 'set stone' }[shape]);
  k.bone = null;
  return { noun: { gem: 'Pendant', cog: 'Cog Amulet', shard: 'Shard Pendant', locket: 'Locket', sunburst: 'Sunburst Amulet', tusk: 'Fang Necklace', chandelier: 'Chandelier Pendant', torque: 'Torque' }[shape] };
}

// ---------------------------------------------------------------------------------------------
// Weapons and tools (item space: stand on y = 0, edge plane XY)
// ---------------------------------------------------------------------------------------------
function pommel(k, r, style) {
  const role = k.o >= 3 ? 'trim' : k.pick(['trim', 'dark', 'plate']);
  switch (style) {
    case 'disc':
      k.disc('Wheel pommel', role, [0, r, 0], [0, 0, 1], r, r * 0.75, 18);
      if (k.o >= 2) for (const z of [1, -1]) k.gem('Pommel gem', [0, r, z * r * 0.4], r * 0.38, { scale: [1, 1, 0.6], stretch: 1 });
      return r * 2;
    case 'gear':
      k.gear('Gear pommel', role, [0, r * 1.05, 0], [0, 0, 1], r * 0.82, { teeth: k.int(8, 11), tooth: r * 0.26, depth: r * 0.62, hole: k.o >= 2 ? r * 0.38 : r * 0.2 });
      if (k.o >= 2) k.gem('Pommel gem', [0, r * 1.05, 0], r * 0.36, { stretch: 1 });
      return r * 2.15;
    case 'crystal':
      // A faceted disc pommel with a gem pressed flat into each face.
      k.disc('Gem pommel', role, [0, r, 0], [0, 0, 1], r, r * 0.9, k.c.ingredients.crystal.facets * 2);
      for (const z of [1, -1]) k.inlay('Pommel gem', 'crystal', [0, r, z * r * 0.45], [0, 0, z], r * 0.62);
      return r * 2;
    case 'ring':
      k.ring('Ring pommel', role, [0, r, 0], [0, 0, 1], r * 0.78, r * 0.24, { seg: 20 });
      return r * 1.85;
    case 'faceted':
      k.add('sphere', 'Faceted pommel', role, { pos: [0, r * 1.25, 0], scale: [1, 1.3, 1], p: { r, seg: 6 } });
      return r * 2.5;
    default:
      k.add('lathe', 'Turned pommel', role, { p: { pts: [[0, 0], [r * 0.55, r * 0.12], [r, r * 0.9], [r * 0.72, r * 1.55], [r * 0.32, r * 2.05], [0, r * 2.1]], seg: 14 } });
      return r * 2.05;
  }
}
function grip(k, y0, len, r) {
  const role = k.wpick({ leather: 4, dark: 2, ivory: k.o >= 2 ? 2 : 0, wood: k.c.organic ? 4 : 1 });
  k.rod('Grip', role, [0, y0, 0], [0, y0 + len, 0], r * 0.94, r, 10);
  const wrap = k.wpick({ none: 2, bands: 3, wire: k.fam === 'duelist' || k.o >= 1 ? 3 : 1, vine: k.c.organic ? 4 : 0 });
  if (wrap === 'bands') {
    const n = k.int(2, 3);
    for (let i = 0; i < n; i++) k.ring('Grip band', 'trim', [0, y0 + (len * (i + 1)) / (n + 1), 0], [0, 1, 0], r * 1.02, r * 0.18, { seg: 16 });
  } else if (wrap === 'wire') {
    const n = Math.max(4, Math.round(len / (r * 0.8)));
    for (let i = 0; i < n; i++) k.ring('Wire wrap', 'trim', [0, y0 + (len * (i + 0.5)) / n, 0], [0, 1, 0.12 * (i % 2 ? 1 : -1)], r * 1.0, r * 0.12, { seg: 12 });
    k.feature('wire-wrapped grip');
  } else if (wrap === 'vine') {
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push([Math.cos(i * 1.4) * r * 1.05, y0 + (len * i) / 12]);
    k.add('sweep', 'Vine wrap', 'wood', { rot: [0, 0, 0], p: { pts, r: r * 0.2, r2: r * 0.2, flat: 1, sides: 5, seg: 4 } });
    k.feature('vine-bound grip');
  }
  k.collar('Ferrule', 'trim', [0, y0 + 0.004, 0], [0, 1, 0], r * 1.18, r * 0.8, 0.01, { seg: 14 });
  k.collar('Ferrule', 'trim', [0, y0 + len - 0.004, 0], [0, 1, 0], r * 1.18, r * 0.8, 0.01, { seg: 14 });
  return y0 + len;
}
function guard(k, y, w, bw, bt, style) {
  const role = k.o >= 3 ? 'trim' : k.pick(['trim', 'plate', 'dark']);
  const gt = Math.max(0.016, w * 0.11);
  const d = Math.max(bt * 2.6, 0.022);
  switch (style) {
    case 'swept': {
      k.add('box', 'Guard block', role, { pos: [0, y, 0], p: { w: bw * 1.7, h: gt * 1.3, d } });
      const up = k.fam === 'tempest' || k.chance(0.5) ? 1 : -1;
      for (const s of [1, -1]) k.add('sweep', 'Quillon', role, { pos: [0, y + gt * 0.65, 0], p: { pts: [[0, 0], [s * w * 0.22, up * 0.004], [s * w * 0.4, up * w * 0.1], [s * w * 0.48, up * w * 0.2]], r: gt * 0.42, r2: gt * 0.26, flat: 1, sides: 8, seg: 8 } });
      k.feature(up > 0 ? 'forward-swept quillons' : 'drooping quillons');
      return gt * 1.3;
    }
    case 'winged': {
      const half = [[0, gt * 0.9], [w * 0.28, gt * 1.05], [w * 0.5, gt * 2.2], [w * 0.44, gt * 0.6], [w * 0.2, 0]];
      k.add('extrude', 'Winged guard', role, { pos: [0, y, 0], p: { pts: symmetric(half.slice().reverse()), depth: d * 0.8, bevel: 0.003 } });
      k.feature('winged guard');
      return gt;
    }
    case 'basket': {
      // Duelist basket: arcs from guard to pommel side.
      k.add('box', 'Guard bar', role, { pos: [0, y, 0], p: { w: w * 0.7, h: gt * 0.7, d: d * 0.8 } });
      for (const z of [-1, 0, 1]) k.add('sweep', 'Basket bar', 'trim', { pos: [0, y, z * 0.018], p: { pts: [[w * 0.32, gt * 0.3], [w * 0.4, -0.04], [w * 0.25, -0.1], [0.012, -0.12]], r: 0.0035, r2: 0.0035, flat: 1, sides: 6, seg: 8 } });
      k.ring('Finger ring', 'trim', [-w * 0.1, y - 0.02, 0], [0, 0, 1], 0.02, 0.003, { seg: 16 });
      k.feature('basket hilt');
      return gt * 0.7;
    }
    case 'disc':
      k.disc('Disc guard', role, [0, y + gt * 0.3, 0], [0, 1, 0], Math.max(bw * 1.2, w * 0.32), gt * 0.6, 18);
      k.feature('disc guard');
      return gt * 0.6;
    case 'gear': {
      k.add('box', 'Guard bar', role, { pos: [0, y, 0], p: { w: w * 0.9, h: gt * 0.8, d: d * 0.8 } });
      const gr = Math.max(bw * 0.95, w * 0.17);
      k.gear('Guard cog', 'trim', [0, y + gt * 0.4, 0], [0, 0, 1], gr, { teeth: k.int(9, 12), depth: d * 1.1, hole: gr * 0.35 });
      k.add('sphere', 'Guard core', k.o >= 2 ? 'rgem' : 'light', { pos: [0, y + gt * 0.4, 0], p: { r: gr * 0.33, seg: 8 } });
      k.feature('cog guard');
      return gt * 0.8;
    }
    case 'sun': {
      heraldry(k, 'sun', [0, y + gt * 0.5, 0], [0, 0, 1], Math.max(bw * 1.3, w * 0.22));
      k.add('box', 'Guard bar', 'trim', { pos: [0, y, 0], p: { w, h: gt * 0.7, d: d * 0.7 } });
      return gt;
    }
    case 'crescent': {
      const out = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * (0.1 + (0.8 * i) / 12);
        out.push([Math.cos(a) * w * 0.5, -Math.sin(a) * w * 0.22 + gt * 1.6]);
      }
      for (let i = 12; i >= 0; i--) {
        const a = Math.PI * (0.1 + (0.8 * i) / 12);
        out.push([Math.cos(a) * w * 0.4, -Math.sin(a) * w * 0.13 + gt * 1.6]);
      }
      k.add('extrude', 'Crescent guard', role, { pos: [0, y - gt * 0.6, 0], p: { pts: out.map(([x, yy]) => [r5(x), r5(yy)]), depth: d * 0.8, bevel: 0.002 } });
      k.feature('crescent guard');
      return gt;
    }
    case 'branch': {
      for (const s of [1, -1]) k.add('sweep', 'Branch guard', 'wood', { pos: [0, y, 0], p: { pts: [[0, 0], [s * w * 0.2, gt * 0.5], [s * w * 0.42, gt * 2], [s * w * 0.5, gt * 3.4]], r: gt * 0.5, r2: gt * 0.18, flat: 1, sides: 6, seg: 6 } });
      k.add('box', 'Guard knot', 'wood', { pos: [0, y - gt * 0.2, 0], p: { w: bw * 1.6, h: gt * 1.3, d } });
      k.feature('branching guard');
      return gt;
    }
    default: {
      k.add('box', 'Crossguard', role, { pos: [0, y, 0], p: { w, h: gt, d } });
      const fin = k.pick(['ball', 'cube', 'none']);
      for (const s of [1, -1]) {
        if (fin === 'ball') k.add('sphere', 'Guard finial', role, { pos: [s * w * 0.5, y + gt / 2, 0], p: { r: gt * 0.62, seg: 10 } });
        if (fin === 'cube') k.add('box', 'Guard finial', role, { pos: [s * w * 0.5, y - gt * 0.15, 0], rot: [0, 45, 0], p: { w: gt * 1.1, h: gt * 1.3, d: gt * 1.1 } });
      }
      if (k.fam === 'bulwark') for (const s of [1, -1]) k.rivet([s * w * 0.2, y + gt / 2, d / 2], gt * 0.25);
      return gt;
    }
  }
}
const GUARD_FOR = { crystalline: { winged: 2, bar: 1, disc: 1 }, bulwark: { bar: 3, winged: 1 }, sylvan: { branch: 4, swept: 1 }, artificer: { gear: 4, bar: 1 }, celestial: { sun: 3, winged: 2 }, void: { crescent: 4, swept: 1 }, tempest: { swept: 4, crescent: 1 }, duelist: { basket: 4, swept: 1, disc: 1 } };
const POMMEL_FOR = { crystalline: { crystal: 4, faceted: 2 }, bulwark: { disc: 3, ball: 2 }, sylvan: { turned: 3, ring: 1 }, artificer: { gear: 4, disc: 1 }, celestial: { disc: 3, faceted: 1 }, void: { faceted: 3, ring: 2 }, tempest: { turned: 3, ring: 1 }, duelist: { faceted: 2, turned: 2, ring: 1 } };

function sword(k, kind, shape) {
  const dims = {
    dagger: { len: [0.18, 0.27], w: [0.026, 0.04], grip: [0.085, 0.1], gw: [0.07, 0.11], pr: [0.014, 0.018], gr: 0.012 },
    short_sword: { len: [0.45, 0.58], w: [0.042, 0.06], grip: [0.105, 0.13], gw: [0.13, 0.2], pr: [0.018, 0.023], gr: 0.0145 },
    long_sword: { len: [0.8, 0.96], w: [0.044, 0.06], grip: [0.19, 0.25], gw: [0.19, 0.28], pr: [0.021, 0.027], gr: 0.0155 },
    greatsword: { len: [1.08, 1.28], w: [0.062, 0.085], grip: [0.3, 0.36], gw: [0.3, 0.42], pr: [0.026, 0.034], gr: 0.018 },
  }[kind];
  const len = k.rand(...dims.len) * (0.88 + k.m.length * 0.12);
  let w = k.rand(...dims.w) * (0.85 + k.m.width * 0.15);
  let thick = w * 0.21;
  let curve = 0;
  let pts = [];
  let tip = k.rand(0.09, 0.2);
  let taper = k.rand(0.08, 0.32);
  let role = 'blade';
  switch (shape) {
    case 'leaf':
      pts = [[0, 0.78], [0.55, 1.22], [0.84, 0.75], [1, 0]];
      break;
    case 'needle':
      w *= 0.6;
      thick = w * 0.5;
      taper = 0.55;
      tip = 0.3;
      break;
    case 'serpentine': {
      const n = kind === 'dagger' ? 5 : 9;
      pts = Array.from({ length: n }, (_, i) => [i / n, i % 2 ? 0.84 : 1.06]).concat([[0.93, 0.6], [1, 0]]);
      break;
    }
    case 'sabre':
      curve = k.rand(0.06, 0.12);
      pts = [[0, 0.95], [0.6, 1.05], [0.88, 0.8], [1, 0]];
      break;
    case 'falchion':
      curve = k.rand(0.03, 0.07);
      pts = [[0, 0.85], [0.7, 1.25], [0.9, 0.95], [1, 0]];
      break;
    case 'cleaver':
      w *= 1.45;
      thick = w * 0.24;
      pts = [[0, 0.9], [0.8, 1.1], [0.96, 1.05], [1, 0.35]];
      break;
    case 'shard':
      role = 'shard';
      w *= 1.15;
      pts = [[0, 0.7], [0.3, 1.1], [0.62, 0.95], [0.86, 0.55], [1, 0]];
      break;
  }
  if ((kind === 'long_sword' || kind === 'greatsword') && !['serpentine', 'shard', 'segmented', 'forked'].includes(shape) && k.chance(kind === 'greatsword' ? 0.75 : 0.5)) {
    const base = pts.length ? pts : [[0, 1], [1 - tip, 1 - taper], [1, 0]];
    pts = [[0, 0.68], [0.08, 0.68], [0.095, base[0][1]], ...base.filter(([t]) => t > 0.095)];
    k.feature('ricasso');
  }
  const pr = k.rand(...dims.pr);
  const gripR = dims.gr * k.rand(0.92, 1.1);
  const gw = k.rand(...dims.gw);
  const pStyle = k.wpick({ ...(POMMEL_FOR[k.fam] ?? {}), ball: 1, disc: 1, ring: kind === 'dagger' ? 2 : 0 });
  const gStyle = k.wpick({ ...(GUARD_FOR[k.fam] ?? {}), bar: 1, disc: kind === 'dagger' ? 1 : 0 });
  const ph = pommel(k, pr, pStyle);
  k.rod('Tang', 'dark', [0, ph * 0.5, 0], [0, ph + 0.01, 0], gripR * 0.55, gripR * 0.55, 8);
  const glen = k.rand(...dims.grip);
  const gy = grip(k, ph, glen, gripR);
  const gt = guard(k, gy, gw, w, thick, gStyle);
  const by = gy + gt - 0.002;
  let edge = [];
  if (shape === 'forked') {
    k.add('box', 'Fork root', 'plate', { pos: [0, by, 0], p: { w: w * 1.6, h: len * 0.12, d: thick * 1.3 } });
    for (const s of [1, -1]) k.add('blade', 'Fork tine', role, { pos: [s * w * 0.42, by + len * 0.1, 0], p: { len: len * 0.88, w: w * 0.52, thick: thick * 0.9, bevel: 0.5, tip: len * 0.15, taper: 0.2, curve: s * 0.02, seg: 8 } });
    k.feature('forked twin edge');
  } else if (shape === 'segmented') {
    k.rod('Spine rail', 'dark', [0, by, 0], [0, by + len * 0.98, 0], thick * 0.6, thick * 0.4, 6);
    const n = 4 + k.int(0, 3);
    for (let i = 0; i < n; i++) {
      const y = by + (i * len) / n;
      const ww = w * (1 - (i / n) * 0.55);
      const segL = (len / n) * 0.82;
      k.add('extrude', 'Blade segment', 'blade', { pos: [0, y, 0], p: { pts: [[-ww / 2, 0], [ww / 2, 0], [ww * 0.4, segL], [0, segL + 0.03], [-ww * 0.4, segL]], depth: thick, bevel: 0.0015 } });
      if (i < n - 1) k.add('box', 'Light seam', 'light', { pos: [0, y + segL, 0], p: { w: ww * 0.6, h: (len / n) * 0.18, d: thick * 0.7 } });
    }
    k.feature('linked rail segments');
  } else {
    k.add('blade', 'Blade', role, { pos: [0, by, 0], p: { len, w, thick, bevel: k.rand(0.35, 0.6), tip: tip * len, taper, curve, seg: 12, pts } });
    for (let i = 1; i < 6; i++) edge.push([curve * len * (i / 6) ** 2 + w * 0.45, by + (len * i) / 7, 0]);
  }
  // Fuller (dark, or a light channel when the compound glows / rarity is high).
  if (curve === 0 && !['serpentine', 'shard', 'segmented', 'forked', 'cleaver'].includes(shape) && (k.o >= 2 || k.chance(0.35))) {
    const glow = k.o >= 3 || k.c.glow > 0.55;
    k.add('box', glow ? 'Light fuller' : 'Fuller', glow ? 'light' : 'dark', { pos: [0, by + len * 0.06, 0], p: { w: w * 0.16, h: len * 0.56, d: thick * 1.04 } });
    if (glow && k.o >= 4) for (let i = 0; i < 3; i++) k.gem('Rune', [0, by + len * (0.16 + i * 0.16), 0], w * 0.15, { facets: 4, scale: [1, 1.6, thick * 7] });
    k.feature(glow ? 'light fuller' : 'fuller');
  }
  // Family motifs on the blade.
  if ((k.fam === 'crystalline' || k.c.crystalline > 0.55) && shape !== 'shard') {
    const n = 2 + Math.min(3, k.o);
    for (let i = 0; i < n; i++) {
      const t = 0.12 + (0.45 * i) / n;
      for (const z of [1, -1]) k.inlay('Blade gem', i % 2 ? 'crystal' : 'shard', [w * 0.1 * (i % 2 ? -1 : 1), by + len * t, z * thick * 0.42], [0, 0, z], w * 0.17, { bezel: k.o >= 2 });
    }
    k.feature('gems pressed into the blade');
  }
  if (shape === 'shard') k.rod('Spine', 'plate', [0, by - 0.01, -thick * 0.2], [0, by + len * 0.8, -thick * 0.2], thick * 0.45, thick * 0.25, 6);
  if (k.fam === 'void' && shape !== 'forked') k.add('cone', 'Hook', 'edge', { pos: [-w * 0.45, by + len * 0.42, 0], rot: [0, 0, 120], p: { r: w * 0.18, h: w * 0.9, seg: 4 } });
  if (k.c.reactions.some((r) => r.id === 'ember' || r.id === 'quenchglass')) {
    k.add('box', 'Heat seam', 'light', { pos: [w * 0.28, by + len * 0.05, 0], p: { w: 0.0025, h: len * 0.45, d: thick * 1.06 } });
    k.feature('glowing temper seam');
  }
  if (k.o >= 1 && k.chance(0.5)) k.add('box', 'Blade collar', 'trim', { pos: [0, by, 0], p: { w: w * 1.08, h: Math.min(0.035, len * 0.06), d: thick * 1.5 } });
  if (k.o >= 5) {
    k.ring('Halo', 'rgem', [0, by + len * 0.35, 0], [0, 1, 0], w * 1.25, w * 0.06, { seg: 24 });
    k.feature('floating halo');
  }
  void edge;
  return { grip: [0, ph + glen / 2, 0], tip: [0, by + len, 0], noun: { dagger: { straight: 'Dagger', leaf: 'Leaf Dagger', needle: 'Stiletto', serpentine: 'Kris', falchion: 'Dirk', cleaver: 'Cleaver Knife', shard: 'Shard Knife' }, short_sword: { straight: 'Shortsword', leaf: 'Leaf Blade', sabre: 'Cutlass', falchion: 'Falchion', cleaver: 'Seax' }, long_sword: { straight: 'Longsword', needle: 'Estoc', serpentine: 'Flame Blade', cleaver: 'Broadsword', sabre: 'Sabre' }, greatsword: { straight: 'Greatsword', serpentine: 'Flamberge', cleaver: 'Executioner', needle: 'Bastard Estoc', sabre: 'Great Sabre' } }[kind][shape] ?? { dagger: 'Dagger', short_sword: 'Shortsword', long_sword: 'Longsword', greatsword: 'Greatsword' }[kind] };
}

function haft(k, h, r, { metal = false } = {}) {
  const role = metal ? 'dark' : 'wood';
  if (k.c.organic && !metal) {
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push([Math.sin(i * 1.3) * 0.008, 0.02 + (h * i) / 6]);
    k.add('sweep', 'Root haft', 'wood', { p: { pts, r: r * 1.05, r2: r * 0.85, flat: 1, sides: 8, seg: 6 } });
  } else k.rod('Haft', role, [0, 0.02, 0], [0, h, 0], r, r * 0.9, 10);
  const cap = k.wpick({ cap: 3, spike: k.o >= 1 ? 2 : 0, knob: 2, gear: k.fam === 'artificer' ? 4 : 0, crystal: k.fam === 'crystalline' ? 4 : 0 });
  if (cap === 'spike') k.add('cone', 'Butt spike', 'trim', { pos: [0, 0.04, 0], rot: [180, 0, 0], p: { r: r * 1.15, h: 0.05, seg: 8 } });
  else if (cap === 'knob') k.add('sphere', 'Butt knob', 'trim', { pos: [0, 0.022, 0], p: { r: r * 1.35, seg: 12 } });
  else if (cap === 'gear') k.gear('Butt cog', 'trim', [0, 0.02, 0], [0, 1, 0], r * 1.5, { teeth: 8, depth: 0.018, hole: 0 });
  else if (cap === 'crystal') {
    k.add('sphere', 'Butt knob', 'trim', { pos: [0, 0.022, 0], p: { r: r * 1.35, seg: 12 } });
    for (const z of [1, -1]) k.inlay('Butt gem', 'crystal', [0, 0.022, z * r * 1.3], [0, 0, z], r * 0.7, { bezel: false });
  }
  k.collar('Butt ferrule', 'trim', [0, 0.03, 0], [0, 1, 0], r * 1.25, r * 0.9, 0.022, { seg: 14 });
  const gl = k.rand(0.13, 0.2);
  k.rod('Grip wrap', 'leather', [0, 0.05, 0], [0, 0.05 + gl, 0], r * 1.12, r * 1.12, 10);
  const n = k.int(3, 6);
  for (let i = 0; i < n; i++) k.ring('Wrap cord', 'dark', [0, 0.055 + (gl * (i + 0.5)) / n, 0], [0, 1, 0], r * 1.13, r * 0.14, { seg: 12 });
  if (k.o >= 2 || k.fam === 'bulwark') {
    const bands = k.int(1, 3);
    for (let i = 0; i < bands; i++) k.collar('Haft band', 'trim', [0, h * (0.45 + i * 0.12), 0], [0, 1, 0], r * 1.2, r * 0.9, 0.012, { seg: 14 });
  }
  if (k.fam === 'artificer' && k.o >= 2) {
    k.rod('Light rail', 'light', [r * 0.9, h * 0.3, 0], [r * 0.9, h * 0.8, 0], 0.003, 0.003, 5);
  }
  return 0.05 + gl / 2;
}

const AXE_HEADS = {
  bearded: [[0, 0.03], [0.05, 0.028], [0.105, 0.06], [0.135, 0.045], [0.148, -0.02], [0.13, -0.105], [0.095, -0.13], [0.072, -0.065], [0.035, -0.032], [0, -0.03]],
  double: [[0, 0.03], [0.06, 0.045], [0.12, 0.105], [0.152, 0.04], [0.158, -0.04], [0.122, -0.105], [0.06, -0.045], [0, -0.03]],
  felling: [[0, 0.032], [0.1, 0.048], [0.135, 0.052], [0.142, 0], [0.135, -0.052], [0.1, -0.048], [0, -0.032]],
  hooked: [[0, 0.03], [0.07, 0.04], [0.135, 0.085], [0.12, 0.03], [0.15, -0.01], [0.14, -0.07], [0.08, -0.05], [0, -0.03]],
  halberd: [[0, 0.04], [0.09, 0.05], [0.16, 0.11], [0.17, 0.0], [0.15, -0.12], [0.09, -0.06], [0, -0.04]],
};
function axe(k, shape) {
  const h = k.rand(0.62, 0.86) * (0.9 + k.m.length * 0.1);
  const r = k.rand(0.0155, 0.02) * (0.9 + k.c.dense * 0.2);
  const gripY = haft(k, h, r);
  const s = k.rand(0.95, 1.2) * (0.9 + k.m.width * 0.1);
  const hy = h - 0.07;
  const eyeH = 0.085 * s;
  const eye = 0.034 * s;
  k.add('box', 'Axe eye', 'plate', { pos: [0, hy - eyeH / 2, 0], p: { w: 0.05, h: eyeH, d: eye * 1.25 } });
  let outline;
  if (shape === 'rail') {
    for (const sd of [1, -1]) {
      polyline(k, [[sd * 0.02, hy - 0.03, 0], [sd * 0.11 * s, hy - 0.09 * s, 0], [sd * 0.16 * s, hy, 0], [sd * 0.11 * s, hy + 0.09 * s, 0], [sd * 0.02, hy + 0.03, 0]], 0.009, 'plate', 'Frame');
      k.add('extrude', 'Edge plate', 'edge', { pos: [sd * 0.13 * s, hy, 0], p: { pts: [[-0.012, -0.08 * s], [0.03 * sd, 0], [-0.012, 0.08 * s]].map(([x, y]) => [x * sd, y]), depth: 0.012, bevel: 0.0015 } });
      k.rod('Light rail', 'light', [sd * 0.03, hy, 0], [sd * 0.12 * s, hy, 0], 0.004, 0.004, 5);
    }
    k.feature('open frame head');
  } else if (shape === 'knapped') {
    const head = k.add('sphere', 'Knapped head', k.c.crystalline > 0.45 ? 'shard' : 'plate', { pos: [0.075 * s, hy, 0], scale: [1.3, 0.85, 0.35], p: { r: 0.075 * s, seg: 5 } });
    void head;
    for (let i = 0; i < 4; i++) k.rod('Binding', 'leather', [0.0, hy - 0.04 + i * 0.025, eye * 0.7], [0.035, hy - 0.04 + i * 0.025, eye * 0.7], 0.004, 0.004, 5);
    k.feature('knapped head');
  } else {
    outline = scalePts(AXE_HEADS[shape] ?? AXE_HEADS.bearded, s);
    k.add('extrude', 'Axe head', 'blade', { pos: [0.02, hy, 0], p: { pts: outline, depth: eye, bevel: 0.002, wedge: 0.88 } });
    if (shape === 'double') k.add('extrude', 'Axe head', 'blade', { pos: [-0.02, hy, 0], p: { pts: mirrorX(outline), depth: eye, bevel: 0.002, wedge: -0.88 } });
    else if (shape === 'halberd') k.add('cone', 'Top spike', 'blade', { pos: [0, hy + eyeH / 2, 0], p: { r: 0.016, h: 0.14 * s, seg: 4 } });
    else {
      const poll = k.wpick({ hammer: 3, spike: k.fam === 'void' ? 4 : 2, cog: k.fam === 'artificer' ? 4 : 0 });
      if (poll === 'hammer') k.add('box', 'Hammer poll', 'dark', { pos: [-0.045, hy - 0.022, 0], p: { w: 0.05, h: 0.044, d: eye * 1.3 } });
      if (poll === 'spike') k.add('cone', 'Back spike', 'dark', { pos: [-0.02, hy, 0], rot: [0, 0, 90], p: { r: 0.018, h: 0.09 * s, seg: 6 } });
      if (poll === 'cog') k.gear('Poll cog', 'trim', [-0.05, hy, 0], [0, 0, 1], 0.03, { teeth: 10, depth: eye * 1.2, hole: 0.008 });
    }
    const maxX = Math.max(...outline.map((p) => p[0]));
    const edge = outline.filter(([x]) => x > maxX * 0.72);
    if (edge.length >= 2 && (k.o >= 2 || k.c.glow > 0.5)) {
      for (const sd of shape === 'double' ? [1, -1] : [1]) k.add('sweep', 'Edge glow', 'light', { pos: [sd * 0.021, hy, 0], p: { pts: sd > 0 ? edge : mirrorX(edge), r: 0.0028, r2: 0.0028, flat: 1, sides: 6, seg: 6 } });
      k.feature('glowing edge');
    }
    if (k.fam === 'crystalline') for (const z of [1, -1]) k.growth([0.07 * s, hy, z * eye * 0.5], [0, 0, z], 0.016, 3);
    k.feature(`${shape} head`);
  }
  for (const z of [1, -1]) k.rivet([0, hy, z * eye * 0.64], 0.0055);
  if (k.o >= 2) for (const z of [1, -1]) k.gem('Head gem', [0.075 * s, hy + 0.005, z * eye * 0.42], 0.011 * s, { scale: [1, 1, 0.55], stretch: 1 });
  k.collar('Head collar', 'trim', [0, hy - eyeH / 2 - 0.007, 0], [0, 1, 0], r * 1.35, r * 0.9, 0.014);
  k.add('cone', 'Haft cap', 'trim', { pos: [0, hy + eyeH / 2, 0], p: { r: r * 1.1, h: 0.022, seg: 8 } });
  return { grip: [0, gripY, 0], tip: [0.15 * s, hy, 0], noun: { bearded: 'Bearded Axe', double: 'Double Axe', felling: 'Hatchet', hooked: 'Hooked Axe', halberd: 'Halberd Axe', rail: 'Frame Axe', knapped: 'Knapped Axe' }[shape] };
}

function pickaxe(k, shape) {
  const h = k.rand(0.7, 0.9) * (0.9 + k.m.length * 0.1);
  const r = k.rand(0.016, 0.02);
  const gripY = haft(k, h, r);
  const hy = h - 0.05;
  const s = k.rand(0.9, 1.2) * (0.9 + k.m.width * 0.1);
  k.add('box', 'Pick eye', 'dark', { pos: [0, hy - 0.04, 0], p: { w: 0.055, h: 0.08, d: 0.042 } });
  const droop = k.rand(0.04, 0.09) * s;
  const reach = k.rand(0.22, 0.3) * s * (shape === 'ice' ? 1.3 : 1);
  const pick = [[0, 0], [reach * 0.4, -0.004], [reach * 0.75, -droop * 0.45], [reach, -droop]];
  if (shape === 'claw') {
    for (const z of [-0.022, 0, 0.022]) k.add('sweep', 'Claw', 'blade', { pos: [0.02, hy, z], p: { pts: pick, r: 0.012, r2: 0.003, flat: 0.8, sides: 6, seg: 8 } });
    k.growth([0.02 + reach * 0.4, hy + 0.01, 0], [0.4, 1, 0], 0.022, 3);
    k.feature('crystal claw');
  } else k.add('sweep', 'Pick', 'blade', { pos: [0.02, hy, 0], p: { pts: pick, r: 0.021, r2: 0.0035, flat: 0.8, sides: 6, seg: 8 } });
  const back = { twin: 'pick', mattock: 'adze', hammer: 'hammer', drill: 'drill', ice: 'none', claw: 'hammer' }[shape];
  if (back === 'pick') k.add('sweep', 'Pick', 'blade', { pos: [-0.02, hy, 0], p: { pts: mirrorX(pick), r: 0.021, r2: 0.0035, flat: 0.8, sides: 6, seg: 8 } });
  if (back === 'adze') k.add('extrude', 'Adze blade', 'blade', { pos: [-0.02, hy, 0], p: { pts: [[0, 0.022], [-0.08 * s, 0.012], [-0.17 * s, -0.035], [-0.18 * s, -0.07], [-0.14 * s, -0.04], [0, -0.022]], depth: 0.032, bevel: 0.002, wedge: -0.85 } });
  if (back === 'hammer') k.add('box', 'Hammer face', 'dark', { pos: [-0.06, hy - 0.026, 0], p: { w: 0.08, h: 0.052, d: 0.05 } });
  if (back === 'drill') {
    k.rod('Drill housing', 'trim', [-0.02, hy, 0], [-0.08, hy, 0], 0.024, 0.022, 12);
    for (let i = 0; i < 3; i++) k.ring('Drill thread', 'dark', [-0.09 - i * 0.022, hy, 0], [1, 0, 0], 0.016 - i * 0.004, 0.0035, { seg: 12 });
    k.add('cone', 'Drill bit', 'edge', { pos: [-0.08, hy, 0], rot: [0, 0, 90], p: { r: 0.019, h: 0.085, seg: 8 } });
    k.feature('auger drill');
  }
  k.collar('Head collar', 'trim', [0, hy - 0.047, 0], [0, 1, 0], r * 1.35, r * 0.9, 0.014);
  k.add('cone', 'Haft cap', 'trim', { pos: [0, hy + 0.04, 0], p: { r: r * 1.0, h: 0.02, seg: 8 } });
  for (const z of [1, -1]) k.rivet([0, hy - 0.02, z * 0.021], 0.006);
  if (k.fam === 'artificer' || k.o >= 3) {
    const gz = r + 0.012;
    k.rod('Gauge stem', 'dark', [0, h * 0.62, r * 0.6], [0, h * 0.62, gz], 0.005, 0.005, 6);
    k.disc('Pressure gauge', 'clockface', [0, h * 0.62, gz + 0.004], [0, 0, 1], 0.022, 0.01, 16);
    k.ring('Gauge rim', 'trim', [0, h * 0.62, gz + 0.008], [0, 0, 1], 0.022, 0.003, { seg: 18 });
    const px = r + 0.009;
    k.rod('Piston', 'dark', [px, h * 0.4, 0], [px, h * 0.56, 0], 0.008, 0.008, 8);
    k.rod('Piston rod', 'edge', [px, h * 0.56, 0], [px, hy - 0.05, 0], 0.004, 0.004, 6);
    k.feature('steam-assisted head');
  }
  if (k.o >= 3) for (const z of [1, -1]) k.inlay('Seeker gem', 'crystal', [0, hy - 0.004, z * 0.021], [0, 0, z], 0.012);
  return { grip: [0, gripY, 0], tip: [0.02 + reach, hy - droop, 0], noun: { twin: 'Rock Pick', mattock: 'Mattock', hammer: 'Pickaxe', drill: 'Auger Pick', ice: 'Ice Pick', claw: 'Claw Pick' }[shape] };
}

function mace(k, shape) {
  const h = k.rand(0.48, 0.64) * (0.9 + k.m.length * 0.1);
  const r = k.rand(0.015, 0.019);
  const gripY = haft(k, h, r, { metal: k.c.dense > 0.55 && !k.c.organic });
  const hy = h - 0.01;
  const W = (0.045 + k.m.width * 0.012) * (0.9 + k.c.dense * 0.2);
  let top = hy;
  switch (shape) {
    case 'flanged': {
      const n = k.int(5, 8);
      const fh = W * 2.5;
      k.rod('Mace core', 'dark', [0, hy - 0.02, 0], [0, hy + fh + 0.01, 0], r * 1.5, r * 1.2, 10);
      const outline = [[r, 0], [r + W * 0.6, 0], [r + W, fh * 0.45], [r + W * 0.7, fh * 0.85], [r, fh]];
      for (let i = 0; i < n; i++) k.add('extrude', 'Flange', 'plate', { pos: [0, hy - 0.01, 0], rot: [0, (360 * i) / n, 0], p: { pts: outline, depth: 0.009, bevel: 0.0015, wedge: 0.6 } });
      top = hy + fh;
      k.feature(`${n}-flanged head`);
      break;
    }
    case 'spiked': {
      const R = W * 1.15;
      const cy = hy + R * 0.9;
      k.add('sphere', 'Mace orb', 'plate', { pos: [0, cy, 0], p: { r: R, seg: 16 } });
      const n = k.int(10, 16);
      const ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 1.6;
        const rr = Math.sqrt(Math.max(0, 1 - y * y));
        const d = [Math.cos(ga * i) * rr, y, Math.sin(ga * i) * rr];
        if ((k.fam === 'crystalline' || k.fam === 'void') && i % 2) k.inlay('Orb gem', 'crystal', V([0, cy, 0]).addScaledVector(V(d), R).toArray(), d, R * 0.24, { bezel: false });
        else k.add('cone', 'Spike', 'edge', { pos: V([0, cy, 0]).addScaledVector(V(d), R * 0.85).toArray(), rot: aim(d), p: { r: R * 0.22, h: R * 0.75, seg: 6 } });
      }
      top = cy + R * 1.6;
      k.feature('spiked orb');
      break;
    }
    case 'cog': {
      const n = k.int(2, 3);
      let y = hy;
      k.rod('Mace core', 'dark', [0, hy - 0.02, 0], [0, hy + 0.11, 0], r * 1.4, r * 1.4, 10);
      for (let i = 0; i < n; i++) {
        const gr = W * (i === 1 ? 1.15 : 1);
        k.gear('Head cog', i % 2 ? 'trim' : 'plate', [0, y + 0.015, 0], [0, 1, 0], gr, { teeth: k.int(8, 12), tooth: gr * 0.3, depth: 0.026, hole: 0 });
        y += 0.036;
      }
      k.add('sphere', 'Core', 'light', { pos: [0, y + 0.008, 0], p: { r: 0.014, seg: 10 } });
      top = y + 0.02;
      k.feature('stacked cogs');
      break;
    }
    case 'cage': {
      const n = 5;
      for (let i = 0; i < n; i++) k.add('sweep', 'Cage bar', 'plate', { pos: [0, hy - 0.01, 0], rot: [0, (360 * i) / n, 0], p: { pts: [[0.008, 0], [W * 1.3, W * 0.9], [W * 1.2, W * 2.4], [0.006, W * 3.3]], r: 0.0065, r2: 0.005, flat: 1, sides: 6, seg: 6 } });
      k.crystal('Caged core', 'crystal', [0, hy + W * 0.6, 0], [0, 1, 0], W * 0.55, W * 2.1);
      top = hy + W * 3.3;
      k.feature('caged luminous core');
      break;
    }
    case 'cluster': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        k.crystal('Geode crystal', i % 2 ? 'shard' : 'crystal', [Math.cos(a) * W * 0.4, hy + 0.01, Math.sin(a) * W * 0.4], [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], W * 0.42, W * k.rand(2, 3.2));
      }
      k.collar('Geode cup', 'plate', [0, hy, 0], [0, 1, 0], W * 0.75, W * 0.5, 0.03);
      top = hy + W * 2.8;
      k.feature('raw geode cluster');
      break;
    }
    case 'hammer': {
      k.add('box', 'Hammer block', 'plate', { pos: [0, hy, 0], p: { w: W * 3.6, h: W * 2, d: W * 1.8 } });
      for (const sd of [1, -1]) k.add('box', 'Striking face', 'edge', { pos: [sd * W * 1.85, hy - W * 0.1, 0], p: { w: 0.01, h: W * 2.2, d: W * 2 } });
      for (const sd of [1, -1]) for (const z of [1, -1]) k.rivet([sd * W * 0.9, hy + W, z * W * 0.9], 0.006);
      top = hy + W * 2;
      k.feature('block war hammer');
      break;
    }
    default: {
      const R = W * 1.05;
      k.add('lathe', 'Turned head', 'plate', { pos: [0, hy - 0.02, 0], p: { pts: [[r, 0], [R * 0.7, 0.02], [R, 0.05], [R * 1.02, 0.085], [R * 0.7, 0.12], [r * 1.2, 0.14], [0, 0.145]], seg: 16 } });
      for (let i = 0; i < 3; i++) k.ring('Head rib', 'trim', [0, hy + 0.03 + i * 0.028, 0], [0, 1, 0], R * (i === 1 ? 1.03 : 0.96), 0.004, { seg: 20 });
      top = hy + 0.125;
      k.feature('turned head');
    }
  }
  const fin = k.wpick({ spike: 3, ball: 2, gem: k.o >= 2 ? 2 : 0 });
  if (fin === 'spike') k.add('cone', 'Top spike', 'edge', { pos: [0, top, 0], p: { r: 0.012, h: 0.05, seg: 6 } });
  if (fin === 'ball') k.add('sphere', 'Top knob', 'trim', { pos: [0, top + 0.01, 0], p: { r: 0.016, seg: 10 } });
  if (fin === 'gem') k.gem('Crown gem', [0, top + 0.018, 0], 0.016, { facets: 4, stretch: 1.6 });
  if (k.o >= 5) k.ring('Halo', 'rgem', [0, top - 0.03, 0], [0, 1, 0], 0.09, 0.003);
  return { grip: [0, gripY, 0], tip: [0, top, 0], noun: { flanged: 'Flanged Mace', spiked: 'Morningstar', cog: 'Cog Mace', cage: 'Cage Mace', cluster: 'Geode Mace', hammer: 'War Hammer', turned: 'Mace' }[shape] };
}

function staff(k, shape) {
  const h = k.rand(1.5, 1.8) * (0.92 + k.m.length * 0.08);
  const r = k.rand(0.016, 0.02) * (0.9 + k.c.dense * 0.2);
  const metalShaft = k.fam === 'artificer' || (k.c.dense > 0.7 && !k.c.organic);
  if (shape === 'root' || k.c.organic) {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([Math.sin(i * 1.1) * 0.012, 0.03 + (h * i) / 8]);
    k.add('sweep', 'Root shaft', 'wood', { p: { pts, r, r2: r * 0.8, flat: 1, sides: 8, seg: 6 } });
  } else k.rod('Shaft', metalShaft ? 'plate' : 'wood', [0, 0.03, 0], [0, h, 0], r, r * 0.85, 10);
  k.add('cone', 'Ferrule', 'dark', { pos: [0, 0.04, 0], rot: [180, 0, 0], p: { r: r * 1.05, h: 0.04, seg: 8 } });
  k.collar('Foot collar', 'trim', [0, 0.05, 0], [0, 1, 0], r * 1.3, r * 0.9, 0.02);
  for (let i = 0; i < k.int(2, 4); i++) k.ring('Shaft node', 'trim', [0, h * (0.3 + i * 0.16), 0], [0, 1, 0], r * 1.08, r * 0.3, { seg: 16 });
  k.rod('Grip wrap', 'leather', [0, h * 0.5, 0], [0, h * 0.62, 0], r * 1.12, r * 1.1, 10);
  const top = h;
  let tip = top;
  switch (shape) {
    case 'cage': {
      const cr = k.rand(0.03, 0.045);
      k.crystal('Focus crystal', 'crystal', [0, top + cr * 0.4, 0], [0, 1, 0], cr, cr * 3.6);
      const n = k.int(3, 5);
      for (let i = 0; i < n; i++) k.add('sweep', 'Cage prong', 'trim', { pos: [0, top - 0.01, 0], rot: [0, (360 * i) / n, 0], p: { pts: [[0, 0], [cr * 1.4, cr * 1.2], [cr * 1.6, cr * 2.6], [cr * 0.9, cr * 3.9], [cr * 0.2, cr * 4.3]], r: 0.0055, r2: 0.0035, flat: 1, sides: 6, seg: 8 } });
      k.collar('Cage socket', 'trim', [0, top - 0.005, 0], [0, 1, 0], r * 1.6, r * 0.8, 0.03);
      tip = top + cr * 4.4;
      k.feature('caged focus crystal');
      break;
    }
    case 'orrery': {
      const R = k.rand(0.07, 0.095);
      const cy = top + R + 0.03;
      k.rod('Orrery post', 'trim', [0, top - 0.01, 0], [0, cy, 0], r * 0.8, r * 0.6, 8);
      k.add('sphere', 'Core', 'light', { pos: [0, cy, 0], p: { r: R * 0.33, seg: 12 } });
      k.ring('Orbit ring', 'trim', [0, cy, 0], [1, 0.25, 0], R, 0.004, { seg: 32 });
      k.ring('Orbit ring', 'edge', [0, cy, 0], [-0.3, 0.2, 1], R * 0.82, 0.0035, { seg: 32 });
      if (k.o >= 3) k.ring('Orbit ring', 'trim', [0, cy, 0], [0.2, 1, 0.3], R * 0.64, 0.003, { seg: 28 });
      k.add('sphere', 'Planet', 'crystal', { pos: [0, cy + R * 0.25, R * 0.97], p: { r: 0.009, seg: 8 } });
      k.gear('Orrery base', 'trim', [0, top, 0], [0, 1, 0], r * 2.2, { teeth: 10, depth: 0.012, hole: 0 });
      tip = cy + R;
      k.feature('orrery head');
      break;
    }
    case 'lantern': {
      k.add('sweep', 'Crook', metalShaft ? 'plate' : 'wood', { pos: [0, top - 0.02, 0], p: { pts: [[0, 0], [0.02, 0.09], [0.08, 0.14], [0.13, 0.11], [0.13, 0.06]], r: r * 0.85, r2: r * 0.6, flat: 1, sides: 8, seg: 10 } });
      const lx = 0.13;
      const ly = top + 0.01;
      k.rod('Lantern chain', 'dark', [lx, top + 0.04, 0], [lx, ly, 0], 0.0025, 0.0025, 5);
      k.add('cylinder', 'Lantern cap', 'trim', { pos: [lx, ly - 0.012, 0], p: { rt: 0.012, rb: 0.026, h: 0.014, seg: 8 } });
      k.add('cylinder', 'Lantern glass', 'light', { pos: [lx, ly - 0.07, 0], p: { rt: 0.021, rb: 0.021, h: 0.058, seg: 8 } });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.rod('Lantern bar', 'trim', [lx + Math.cos(a) * 0.023, ly - 0.072, Math.sin(a) * 0.023], [lx + Math.cos(a) * 0.023, ly - 0.012, Math.sin(a) * 0.023], 0.0022, 0.0022, 4);
      }
      k.add('cylinder', 'Lantern base', 'trim', { pos: [lx, ly - 0.082, 0], p: { rt: 0.026, rb: 0.018, h: 0.012, seg: 8 } });
      tip = top + 0.13;
      k.feature('hanging lantern');
      break;
    }
    case 'coil': {
      for (const sd of [1, -1]) k.add('sweep', 'Prong', 'trim', { pos: [0, top - 0.01, 0], p: { pts: [[0, 0], [sd * 0.03, 0.06], [sd * 0.035, 0.16], [sd * 0.012, 0.24]], r: 0.007, r2: 0.004, flat: 1, sides: 6, seg: 8 } });
      for (let i = 0; i < 4; i++) k.ring('Coil ring', i % 2 ? 'edge' : 'trim', [0, top + 0.03 + i * 0.03, 0], [0, 1, 0], 0.035 - i * 0.005, 0.0035, { seg: 20 });
      k.add('sphere', 'Spark core', 'light', { pos: [0, top + 0.2, 0], p: { r: 0.022, seg: 10 } });
      tip = top + 0.24;
      k.feature('tesla coil head');
      break;
    }
    case 'root': {
      for (const sd of [1, -1]) k.add('sweep', 'Root branch', 'wood', { pos: [0, top - 0.06, 0], p: { pts: [[0, 0], [sd * 0.05, 0.08], [sd * 0.08, 0.2], [sd * 0.03, 0.28]], r: 0.012, r2: 0.004, flat: 1, sides: 6, seg: 6 } });
      k.crystal('Seed crystal', 'crystal', [0, top + 0.06, 0], [0, 1, 0], 0.03, 0.14);
      for (let i = 0; i < 3; i++) k.add('extrude', 'Leaf', 'shard', { pos: [0, top - 0.2 + i * 0.07, 0.01], rot: [0, 0, (i % 2 ? 1 : -1) * 50], p: { pts: [[0, 0], [0.012, 0.03], [0, 0.07], [-0.012, 0.03]], depth: 0.004, bevel: 0.001 } });
      tip = top + 0.2;
      k.feature('living branch');
      break;
    }
    case 'trident':
      for (const sd of [-1, 0, 1]) {
        k.add('sweep', 'Tine', 'plate', { pos: [0, top - 0.18, 0], p: { pts: [[0, 0], [sd * 0.1, 0.11], [sd * 0.13, 0.36 - Math.abs(sd) * 0.08]], r: 0.012, r2: 0.008, flat: 1, sides: 6, seg: 6 } });
        k.add('cone', 'Tine point', 'edge', { pos: [sd * 0.13, top + 0.18 - Math.abs(sd) * 0.08, 0], rot: aim([sd * 0.15, 1, 0]), p: { r: 0.012, h: 0.07, seg: 6 } });
        for (const z of [1, -1]) k.inlay('Tine gem', 'crystal', [sd * 0.115, top + 0.1 - Math.abs(sd) * 0.06, z * 0.011], [0, 0, z], 0.01);
      }
      tip = top + 0.28;
      k.feature('trident head');
      break;
    case 'sun': {
      k.rod('Sun post', 'trim', [0, top - 0.01, 0], [0, top + 0.12, 0], r * 0.8, r * 0.6, 8);
      heraldry(k, 'sun', [0, top + 0.12, 0], [0, 0, 1], 0.1);
      k.add('sphere', 'Sun core', 'light', { pos: [0, top + 0.12, 0], p: { r: 0.03, seg: 12 } });
      tip = top + 0.22;
      k.feature('sun disk');
      break;
    }
    default: {
      for (const sd of [1, -1]) k.rod('Monolith rail', 'plate', [sd * 0.055, top - 0.17, 0], [sd * 0.055, top + 0.17, 0], 0.014, 0.014, 6);
      k.crystal('Monolith', 'crystal', [0, top - 0.1, 0], [0, 1, 0], 0.05, 0.42);
      for (let i = 0; i < 3; i++) k.ring('Band', 'trim', [0, top - 0.04 + i * 0.1, 0], [0, 1, 0.3], 0.085, 0.005);
      tip = top + 0.32;
      k.feature('prism monolith');
    }
  }
  if (k.o >= 2) k.gem('Shaft gem', [0, h * 0.68, r * 0.95], 0.008, { scale: [1, 1.4, 0.6], stretch: 1 });
  return { grip: [0, h * 0.56, 0], tip: [0, tip, 0], noun: { cage: 'Conduit Staff', orrery: 'Orrery Staff', lantern: 'Lantern Staff', coil: 'Coil Staff', root: 'Rootstaff', trident: 'Trident Sceptre', monolith: 'Monolith Staff', sun: 'Sun Staff' }[shape] };
}

function bow(k, shape) {
  const half = (shape === 'longbow' ? k.rand(0.7, 0.8) : k.rand(0.58, 0.68)) * (0.92 + k.m.length * 0.08);
  const brace = k.rand(0.13, 0.17);
  const limbRole = shape === 'compound' || shape === 'lattice' ? 'plate' : 'wood';
  const riserH = shape === 'longbow' ? 0.1 : 0.15;
  const r0 = shape === 'longbow' ? 0.014 : 0.012;
  const tips = [];
  for (const sd of [1, -1]) {
    const len = half * (shape === 'asymmetric' ? (sd > 0 ? 1.18 : 0.8) : 1);
    let path;
    if (shape === 'longbow') path = [[0, riserH], [0.04, len * 0.4], [0.1, len * 0.75], [brace, len]];
    else if (shape === 'horn') path = [[0, riserH], [0.12, len * 0.45], [0.06, len * 0.82], [brace - 0.06, len]];
    else if (shape === 'compound' || shape === 'lattice') path = [[0, riserH], [0.06, len * 0.5], [0.11, len * 0.86]];
    else path = [[0, riserH], [0.05, len * 0.42], [0.125, len * 0.78], [brace + 0.02, len * 0.93], [brace - 0.012, len]];
    const pts = path.map(([x, y]) => [x, sd * y]);
    k.add('sweep', sd > 0 ? 'Upper limb' : 'Lower limb', limbRole, { p: { pts, r: r0, r2: r0 * 0.45, flat: 2.0, sides: 8, seg: 10 } });
    if ((k.o >= 3 || k.c.glow > 0.6) && shape !== 'compound') k.add('sweep', 'Limb inlay', 'light', { p: { pts: pts.slice(1, -1).map(([x, y]) => [x - r0 * 0.75, y]), r: 0.0025, r2: 0.0025, flat: 1, sides: 5, seg: 8 } });
    if (shape === 'lattice') {
      k.add('sweep', 'Lattice limb', 'edge', { pos: [0, 0, -0.02], p: { pts: [[0.015, sd * riserH], [0.2, sd * len * 0.46], [path[path.length - 1][0], sd * path[path.length - 1][1]]], r: 0.008, r2: 0.005, flat: 1, sides: 6, seg: 8 } });
      for (let i = 1; i < 4; i++) k.rod('Strut', 'trim', [0.06 + i * 0.02, (sd * len * i) / 4, 0], [0.16, (sd * len * i) / 4, -0.02], 0.004, 0.004, 5);
    }
    if (k.fam === 'crystalline' || k.c.crystalline > 0.6) for (const z of [1, -1]) k.inlay('Limb gem', 'shard', [path[2][0], sd * path[2][1], z * r0 * 1.25], [0, 0, z], 0.008, { stretch: 1.6 });
    if (k.c.organic && shape !== 'compound') k.add('extrude', 'Leaf', 'shard', { pos: [path[1][0] + 0.01, sd * path[1][1], 0], rot: [0, 0, sd > 0 ? -40 : 220], p: { pts: [[0, 0], [0.015, 0.04], [0, 0.09], [-0.015, 0.04]], depth: 0.004, bevel: 0.001 } });
    tips.push([path[path.length - 1][0], sd * path[path.length - 1][1]]);
  }
  k.add('extrude', 'Riser', shape === 'compound' ? 'trim' : k.o >= 2 ? 'trim' : limbRole, { p: { pts: [[-0.012, -riserH], [0.016, -riserH * 0.7], [0.02, 0], [0.016, riserH * 0.7], [-0.012, riserH], [-0.026, riserH * 0.5], [-0.024, -riserH * 0.5]], depth: 0.03, bevel: 0.003 } });
  k.rod('Grip', 'leather', [-0.004, -0.05, 0], [-0.004, 0.05, 0], 0.019, 0.019, 10);
  k.add('box', 'Arrow rest', 'dark', { pos: [0.015, 0.05, 0], p: { w: 0.012, h: 0.006, d: 0.02 } });
  let [tu, tl] = tips;
  if (shape === 'compound') {
    for (const t of tips) {
      k.gear('Cam', 'trim', [t[0] + 0.01, t[1], 0], [0, 0, 1], 0.028, { teeth: 12, depth: 0.012, hole: 0.006 });
      k.disc('Axle', 'edge', [t[0] + 0.01, t[1], 0], [0, 0, 1], 0.005, 0.03, 8);
    }
    tu = [tu[0] + 0.035, tu[1]];
    tl = [tl[0] + 0.035, tl[1]];
    k.rod('Cable', 'edge', [tips[0][0] - 0.012, tips[0][1] - 0.02, 0.006], [tips[1][0] - 0.012, tips[1][1] + 0.02, 0.006], 0.0015, 0.0015, 4);
    k.add('box', 'Stabiliser', 'dark', { pos: [-0.03, -0.012, 0], rot: [0, 0, 90], p: { w: 0.016, h: 0.14, d: 0.016 } });
    k.feature('cam-wheel limbs');
  } else for (const t of tips) k.add('sphere', 'Nock', 'trim', { pos: [t[0], t[1], 0], p: { r: 0.008, seg: 8 } });
  k.rod('String', shape === 'compound' ? 'edge' : 'ivory', [tl[0], tl[1], 0], [tu[0], tu[1], 0], 0.0016, 0.0016, 4);
  if (k.o >= 2) k.gem('Riser gem', [-0.006, riserH * 0.6, 0.016], 0.008, { scale: [1, 1.3, 0.6], stretch: 1 });
  if (k.o >= 1) for (const sd of [1, -1]) k.ring('Limb binding', 'trim', [0.004, sd * (riserH + 0.004), 0], [0, 1, 0], 0.016, 0.003, { seg: 14 });
  const low = Math.min(...k.parts.map((p) => p.pos[1]), tl[1]);
  k.shift(-low + 0.01);
  return { grip: [-0.004, -low + 0.01, 0], tip: [tu[0], tu[1] - low + 0.01, 0], noun: { longbow: 'Longbow', recurve: 'Recurve Bow', compound: 'Compound Bow', asymmetric: 'Greatbow', horn: 'Horn Bow', lattice: 'Lattice Bow' }[shape] };
}

function shieldOutline(form, w, h) {
  switch (form) {
    case 'round':
    case 'buckler':
      return ellipsePts(w, w, 28);
    case 'heater': {
      const right = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        right.push([w * Math.pow(Math.max(0, 1 - Math.pow(t, 2.6)), 0.6), h * 0.55 - t * h * 1.55]);
      }
      return [...right, ...right.slice(0, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [r5(x), r5(y)]);
    }
    case 'kite': {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        pts.push([Math.cos(a) * w, h * 0.45 + Math.sin(a) * w * 0.55]);
      }
      pts.push([-w * 0.92, h * 0.25], [-w * 0.45, -h * 0.45], [0, -h], [w * 0.45, -h * 0.45], [w * 0.92, h * 0.25]);
      return pts;
    }
    case 'tower':
      return [[-w, -h], [w, -h], [w * 1.02, h * 0.92], [w * 0.8, h], [-w * 0.8, h], [-w * 1.02, h * 0.92]];
    case 'petal':
      return Array.from({ length: 32 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2;
        const rr = w * (1 + 0.14 * Math.cos(a * 8));
        return [r5(Math.cos(a) * rr), r5(Math.sin(a) * rr)];
      });
    case 'crescent': {
      const out = [];
      for (let i = 0; i <= 18; i++) {
        const a = -Math.PI * 0.72 + (i / 18) * Math.PI * 1.44;
        out.push([Math.sin(a) * w, Math.cos(a) * h - h * 0.1]);
      }
      for (let i = 18; i >= 0; i--) {
        const a = -Math.PI * 0.72 + (i / 18) * Math.PI * 1.44;
        out.push([Math.sin(a) * w * 0.6, Math.cos(a) * h * 0.5 + h * 0.18]);
      }
      return out.map(([x, y]) => [r5(x), r5(y)]);
    }
    case 'fan': {
      const out = [[0, -h]];
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI * 0.42 + (i / 12) * Math.PI * 0.84;
        const rr = h * 1.75 * (1 + (i % 2 ? -0.05 : 0.04));
        out.push([Math.sin(a) * rr, -h + Math.cos(a) * rr]);
      }
      return out.map(([x, y]) => [r5(x), r5(y)]);
    }
    default:
      return ellipsePts(w, w, 28);
  }
}
function shield(k, shape) {
  const small = shape === 'buckler';
  const w = (shape === 'round' || shape === 'cog' || shape === 'petal' ? k.rand(0.3, 0.36) : small ? 0.17 : k.rand(0.27, 0.33)) * (0.9 + k.m.width * 0.1);
  const h = { round: w, cog: w, petal: w, buckler: w, heater: k.rand(0.36, 0.42), kite: k.rand(0.48, 0.56), tower: k.rand(0.52, 0.6), crescent: k.rand(0.34, 0.4), fan: k.rand(0.24, 0.28) }[shape];
  const curve = shape === 'tower' ? k.rand(0.35, 0.55) : small ? 0.6 : k.rand(0.12, 0.3);
  const faceKind = k.wpick({ planks: k.c.organic ? 5 : shape === 'tower' || shape === 'round' ? 2 : 1, metal: 3, cloth: k.fam === 'celestial' || k.fam === 'tempest' ? 3 : 1, crystal: k.fam === 'crystalline' ? 3 : 0 });
  const faceRole = faceKind === 'planks' ? 'wood' : faceKind === 'metal' ? 'plate' : faceKind === 'crystal' ? 'shard' : 'cloth';
  const rimRole = k.o >= 3 ? 'trim' : k.pick(['trim', 'dark']);
  let outline;
  if (shape === 'cog') {
    const teeth = k.int(12, 16);
    k.gear('Cog rim', rimRole, [0, 0, -0.008], [0, 0, 1], w * 0.9, { teeth, tooth: w * 0.12, depth: 0.035, hole: 0 });
    k.add('cylinder', 'Shield face', faceRole, { pos: [0, 0, -0.01], rot: [90, 0, 0], p: { rt: w * 0.8, rb: w * 0.8, h: 0.032, seg: 28 } });
    k.feature(`${teeth}-tooth cog rim`);
    outline = ellipsePts(w * 0.8, w * 0.8, 24);
  } else {
    outline = shieldOutline(shape, w, h);
    k.add('extrude', 'Shield rim', rimRole, { pos: [0, 0, -0.004], p: { pts: outline, depth: 0.032, bevel: 0.004, curve } });
    const inset = outline.map(([x, y]) => [r5(x * (w - 0.025) / w), r5(y * (h - 0.025) / h)]);
    k.add('extrude', 'Shield face', faceRole, { p: { pts: inset, depth: 0.034, bevel: 0.002, curve } });
    if (faceKind === 'planks')
      for (const x of [-w * 0.33, 0, w * 0.33]) {
        const sp = spanAt(inset, x);
        if (sp) k.add('extrude', 'Plank seam', 'dark', { p: { pts: [[x - 0.002, sp[0] + 0.006], [x + 0.002, sp[0] + 0.006], [x + 0.002, sp[1] - 0.006], [x - 0.002, sp[1] - 0.006]], depth: 0.0372, bevel: 0, curve } });
      }
    const n = shape === 'round' || shape === 'petal' ? 14 : 12;
    for (let i = 0; i < n && k.c.dense > 0.35; i++) {
      const [x, y] = inset[Math.floor((i / n) * inset.length)];
      const px = x * 0.96;
      const py = y * 0.96;
      k.rivet([px, py, 0.019 - curve * (px * px + 0.35 * py * py)], 0.007);
    }
    if (k.fam !== 'artificer' && k.chance(0.5)) {
      const bw = w * 0.15;
      const a = spanAt(inset, -bw);
      const b = spanAt(inset, bw);
      if (a && b) {
        const lo = Math.max(a[0], b[0], shape === 'heater' || shape === 'kite' ? -h * 0.45 : -Infinity) + 0.01;
        const hi = Math.min(a[1], b[1]) - 0.01;
        k.add('extrude', 'Heraldic pale', 'cloth2', { p: { pts: [[-bw, lo], [bw, lo], [bw, hi], [-bw, hi]], depth: 0.0365, bevel: 0, curve } });
        k.feature('painted pale');
      }
    }
    k.feature(`${shape} shield`);
  }
  // Boss: family-driven.
  const bz = 0.018;
  const br = small ? 0.05 : k.rand(0.055, 0.075);
  const boss = { crystalline: 'crystal', artificer: 'core', celestial: 'sun', void: 'crescent', sylvan: 'leaf', duelist: 'filigree', tempest: 'wave', bulwark: 'boss' }[k.fam];
  if (boss === 'core') {
    k.gear('Boss cog', rimRole, [0, 0, bz + 0.006], [0, 0, 1], br, { teeth: 12, depth: 0.014, hole: br * 0.45 });
    k.add('sphere', 'Aether core', 'light', { pos: [0, 0, bz + 0.01], p: { r: br * 0.5, seg: 12 } });
    k.feature('aether core boss');
  } else if (boss === 'crystal') {
    k.add('sphere', 'Boss', rimRole, { pos: [0, 0, bz], rot: [90, 0, 0], scale: [1, 0.4, 1], p: { r: br, seg: 14, hemi: true } });
    k.growth([0, 0, bz + 0.01], [0, 0, 1], 0.03, 4);
  } else if (boss === 'boss') {
    k.add('sphere', 'Boss', rimRole, { pos: [0, 0, bz], rot: [90, 0, 0], scale: [1, 0.55, 1], p: { r: br, seg: 16, hemi: true } });
    if (k.chance(0.5)) k.add('cone', 'Boss spike', 'edge', { pos: [0, 0, bz + br * 0.45], rot: [90, 0, 0], p: { r: br * 0.35, h: br * 1.1, seg: 8 } });
  } else heraldry(k, boss, [0, 0, bz + 0.004], [0, 0, 1], br * 1.3);
  if (k.o >= 2 && boss !== 'core') for (const sd of [1, -1]) k.gem('Shield gem', [sd * w * 0.55, h * (shape === 'kite' || shape === 'heater' ? 0.3 : 0), 0.02 - curve * 0.3 * w * w], 0.012, { scale: [1, 1, 0.6], stretch: 1 });
  // Straps on the back, laid out for the Ch36 forearm mount (fit.js): the forearm runs along item X
  // about 7 cm behind the face, through two leather enarmes, and the fist closes on a hand strap.
  const ARM_Z = -0.068;
  for (const x of [0.03, -0.09]) {
    k.ring('Enarme', 'leather', [x, 0, ARM_Z], [1, 0, 0], 0.05, 0.0065, { tint: k.roles.dark.tint, seg: 16, sides: 5 });
    k.add('box', 'Strap anchor', 'trim', { pos: [x, -0.018, -0.022], p: { w: 0.03, h: 0.036, d: 0.012 } });
  }
  const FIST_X = -0.2;
  if (Math.abs(FIST_X) < (small ? 0 : w * 0.82)) {
    k.ring('Hand strap', 'leather', [FIST_X, 0, ARM_Z - 0.03], [0, 1, 0], 0.034, 0.006, { seg: 16, sides: 5 });
    k.add('box', 'Strap anchor', 'trim', { pos: [FIST_X, -0.02, -0.022], p: { w: 0.03, h: 0.04, d: 0.012 } });
  }
  let bottom = Math.max(...outline.map(([, y]) => -y));
  if (shape === 'cog') bottom = w * 1.02;
  k.shift(bottom + 0.01);
  return { grip: [0, bottom + 0.01, -0.03], center: [0, bottom + 0.01, 0], noun: { round: 'Roundshield', heater: 'Heater Shield', kite: 'Kite Shield', tower: 'Tower Shield', cog: 'Cog Shield', crescent: 'Crescent Shield', petal: 'Petal Shield', buckler: 'Buckler', fan: 'Fan Shield' }[shape] };
}

function ring(k, shape) {
  const ri = 0.0095;
  const tube = k.rand(0.0017, 0.0028) * (0.9 + k.c.dense * 0.25);
  const R = ri + tube;
  const cy = R + tube;
  const metal = 'trim';
  if (shape === 'cog') k.gear('Cog band', metal, [0, cy, 0], [0, 0, 1], R + 0.0006, { teeth: k.int(16, 22), tooth: 0.0018, depth: 0.0045, hole: ri });
  else if (shape === 'serpent' || shape === 'thorn') {
    const pts = [];
    const turns = shape === 'serpent' ? 1.25 : 1;
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2 * turns - Math.PI / 2;
      const rr = R + (shape === 'thorn' ? Math.sin(i * 2.2) * tube * 0.5 : (i / 28) * tube * 1.2);
      pts.push([Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    k.add('sweep', shape === 'serpent' ? 'Serpent' : 'Thorn vine', shape === 'thorn' ? 'wood' : metal, { p: { pts, r: tube * 1.1, r2: tube * 0.5, flat: 1, sides: 6, seg: 2 } });
    if (shape === 'serpent') {
      k.add('sphere', 'Serpent head', metal, { pos: [pts[pts.length - 1][0], pts[pts.length - 1][1], 0], scale: [1.4, 1, 1], p: { r: tube * 1.5, seg: 8 } });
      for (const z of [1, -1]) k.gem('Eye', [pts[pts.length - 1][0], pts[pts.length - 1][1] + tube * 0.6, z * tube], 0.0006, { stretch: 1 });
    } else for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.add('cone', 'Thorn', 'wood', { pos: [Math.cos(a) * (R + tube * 0.5), cy + Math.sin(a) * (R + tube * 0.5), 0], rot: [0, 0, DEG(a) - 90], p: { r: tube * 0.5, h: tube * 1.6, seg: 4 } });
    }
  } else k.ring('Band', metal, [0, cy, 0], [0, 0, 1], R, tube, { seg: 40 });
  const top = cy + R;
  switch (shape) {
    case 'setting':
    case 'cluster': {
      const gr = k.rand(0.0035, 0.0055);
      k.disc('Bezel', metal, [0, top + 0.0008, 0], [0, 1, 0], gr * 1.15, 0.0026, 12);
      if (shape === 'cluster') {
        k.inlay('Cluster gem', 'crystal', [0, top + 0.0021, 0], [0, 1, 0], gr * 0.5, { bezel: false });
        for (let i = 0; i < 5; i++) k.inlay('Cluster gem', i % 2 ? 'shard' : 'crystal', [Math.cos(i * 1.257) * gr * 0.78, top + 0.0021, Math.sin(i * 1.257) * gr * 0.78], [0, 1, 0], gr * 0.28, { bezel: false });
      }
      else {
        k.gem('Stone', [0, top + 0.0026 + gr * 0.5, 0], gr, { role: k.o >= 2 ? 'rgem' : 'crystal', facets: k.pick([6, 8]), stretch: k.rand(0.85, 1.25) });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          k.rod('Prong', metal, [Math.cos(a) * gr * 1.05, top + 0.001, Math.sin(a) * gr * 1.05], [Math.cos(a) * gr * 0.8, top + 0.0026 + gr, Math.sin(a) * gr * 0.8], 0.0006, 0.0004, 4);
        }
      }
      break;
    }
    case 'signet':
      k.disc('Signet face', metal, [0, top + 0.0012, 0], [0, 1, 0], 0.0062, 0.0028, 16);
      heraldry(k, { artificer: 'cog', celestial: 'sun', void: 'crescent' }[k.fam] ?? 'cog', [0, top + 0.0028, 0], [0, 1, 0], 0.0038);
      break;
    case 'coil': {
      const n = k.int(5, 8);
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.22;
        k.ring('Coil turn', 'edge', [Math.cos(a) * R, cy + Math.sin(a) * R, 0], [-Math.sin(a), Math.cos(a), 0], tube * 1.6, 0.0006, { seg: 10 });
      }
      k.add('sphere', 'Aether bead', 'light', { pos: [0, top + 0.0022, 0], p: { r: 0.0028, seg: 10 } });
      break;
    }
    case 'band':
      for (const s of [1, -1]) k.ring('Band ridge', 'dark', [0, cy, s * tube * 0.85], [0, 0, 1], R, tube * 0.35, { seg: 40 });
      break;
  }
  if (k.o >= 5) k.ring('Halo', 'rgem', [0, top + 0.009, 0], [0, 1, 0], 0.006, 0.0004, { seg: 20 });
  k.feature(TYPE.ring.shapes[shape].toLowerCase());
  return { center: [0, cy, 0], noun: { band: 'Band', setting: 'Ring', signet: 'Signet', cog: 'Cog Ring', coil: 'Coil Ring', serpent: 'Serpent Ring', cluster: 'Geode Ring', thorn: 'Thorn Ring' }[shape] };
}

// ---------------------------------------------------------------------------------------------
// Traits -> effects. One table drives potion buffs, jewellery / armour affixes and stat leanings,
// so a red-hot Emberhold blend brews fire elixirs and smiths blades with ember affixes alike.
// ---------------------------------------------------------------------------------------------
export const TRAIT_EFFECTS = {
  heat: { id: 'emberblood', name: 'Emberblood', stat: 'fireDamage', unit: '%', base: 10, color: '#ff6a2a', text: (v) => `+${v}% fire damage, hits leave burning embers` },
  cold: { id: 'frostward', name: 'Frostward', stat: 'frostResist', unit: '%', base: 14, color: '#8fe0ff', text: (v) => `+${v}% frost resistance, attackers are slowed` },
  density: { id: 'ironskin', name: 'Ironskin', stat: 'armor', unit: '', base: 6, color: '#a7b0b8', text: (v) => `+${v} armour` },
  ductility: { id: 'quickstep', name: 'Quickstep', stat: 'moveSpeed', unit: '%', base: 6, color: '#d8e6f0', text: (v) => `+${v}% movement speed` },
  grain: { id: 'keen_edge', name: 'Keen Edge', stat: 'critChance', unit: '%', base: 4, color: '#d9c08a', text: (v) => `+${v}% critical chance` },
  celestial: { id: 'radiance', name: 'Radiance', stat: 'heal', unit: ' hp', base: 40, color: '#ffd65a', instant: true, text: (v) => `Restores ${v} health at once` },
  tech: { id: 'overclock', name: 'Overclock', stat: 'attackSpeed', unit: '%', base: 7, color: '#3fe6ff', text: (v) => `+${v}% attack speed` },
  organic: { id: 'regrowth', name: 'Regrowth', stat: 'healthRegen', unit: ' hp/s', base: 1.5, color: '#6fd16a', text: (v) => `Regenerates ${v} health per second` },
  growth: { id: 'vigor', name: 'Vigor', stat: 'maxHealth', unit: '', base: 20, color: '#c56bff', text: (v) => `+${v} maximum health` },
  elasticity: { id: 'second_wind', name: 'Second Wind', stat: 'staminaRegen', unit: '%', base: 12, color: '#7affc8', text: (v) => `+${v}% stamina recovery` },
  void: { id: 'hunger', name: 'Hunger', stat: 'lifesteal', unit: '%', base: 3, color: '#8a4cff', text: (v) => `${v}% of damage dealt returns as health` },
  light: { id: 'clarity', name: 'Clarity', stat: 'cooldown', unit: '%', base: 6, color: '#fff3b8', text: (v) => `-${v}% skill cooldowns` },
};
const RARITY_POWER = [1, 1.25, 1.55, 1.9, 2.3, 2.8];
const roundFor = (unit, v) => (unit === ' hp/s' ? Math.round(v * 10) / 10 : Math.max(1, Math.round(v)));

/** Traits ranked for this compound, with a small seeded jitter so near-ties vary between brews. */
function rankedTraits(compound, R) {
  return Object.keys(TRAIT_EFFECTS)
    .map((t) => [t, compound.traits[t] + (R() - 0.5) * 0.08])
    .sort((a, b) => b[1] - a[1]);
}
function effectOf(trait, strength, power) {
  const e = TRAIT_EFFECTS[trait];
  const value = roundFor(e.unit, e.base * (0.55 + strength * 0.9) * power);
  return { id: e.id, trait, name: e.name, stat: e.stat, value, unit: e.unit.trim(), instant: !!e.instant, color: e.color, text: e.text(value) };
}

/** Potion chemistry: kind, effects, duration, cooldown, drawbacks and colours from the compound. */
export function brewPotion(compound, rarity, seed) {
  const o = RARITY_INDEX[rarity] ?? 0;
  const R = rng(`${seed}|brew|${JSON.stringify(compound.recipe)}`);
  const ranked = rankedTraits(compound, R);
  const count = [1, 1, 2, 2, 3, 3][o];
  const effects = [];
  for (const [t, v] of ranked) {
    if (effects.length >= count) break;
    if (effects.length && v < 0.16) break;
    effects.push(effectOf(t, Math.max(0, v), RARITY_POWER[o] * (0.85 + compound.weights.infusion * 1.2)));
  }
  const primary = effects[0];
  const kind = primary.trait === 'celestial' ? 'draught' : primary.trait === 'organic' ? 'tonic' : 'elixir';
  const lasting = effects.filter((e) => !e.instant);
  const duration = lasting.length ? Math.round((kind === 'tonic' ? 20 : 45) + o * 15 + compound.weights.infusion * 160 + compound.traits.growth * 30) : 0;
  const drawbacks = [];
  if (compound.reactions.some((r) => r.id === 'thermal')) drawbacks.push('Volatile: -10% maximum stamina while active');
  if (compound.reactions.some((r) => r.id === 'cleave') && primary.trait !== 'void') drawbacks.push('Hollowing: -6% maximum health while active');
  if (o === 0 && compound.dense > 0.75) drawbacks.push('Heavy brew: takes 2 s to take effect');
  // A vivid draught in the primary effect's hue, nudged toward the compound's light colour.
  const hsl = {};
  new THREE.Color(primary.color).lerp(new THREE.Color(compound.colors.light), 0.08).getHSL(hsl);
  const liquid = `#${new THREE.Color().setHSL(hsl.h, clamp(hsl.s * 1.15, 0.45, 1), clamp(hsl.l, 0.32, 0.42)).getHexString()}`;
  const glass = compound.family === 'void' ? mixc('#2a2433', compound.colors.shard, 0.25) : mixc('#7d97a3', compound.colors.shard, 0.22);
  const fill = 0.55 + R() * 0.35;
  return { kind, effects, duration, cooldown: 20 + effects.length * 10, drawbacks, liquid, glass, fill: r2(fill) };
}

/** Permanent affixes for jewellery and rare+ armour: the same trait table at reduced strength. */
function affixesFor(compound, rarity, seed, slot) {
  const o = RARITY_INDEX[rarity] ?? 0;
  const jewel = slot === 'ring' || slot === 'neck';
  const n = jewel ? [1, 1, 2, 2, 3, 3][o] : [0, 0, 1, 1, 2, 2][o];
  if (!n) return [];
  const R = rng(`${seed}|affix|${slot}`);
  return rankedTraits(compound, R)
    .filter(([t]) => !TRAIT_EFFECTS[t].instant)
    .slice(0, n)
    .map(([t, v]) => effectOf(t, Math.max(0, v), RARITY_POWER[o] * (jewel ? 0.5 : 0.35)));
}

const WEAPON_BASE = { greatsword: [34, 0.8], long_sword: [22, 1], short_sword: [16, 1.2], dagger: [11, 1.5], axe: [24, 0.9], mace: [23, 0.85], staff: [18, 0.95], bow: [20, 0.9], pickaxe: [14, 0.9] };
const ARMOUR_BASE = { helmet: 6, chest: 14, pauldrons: 5, bracers: 3, gloves: 3, legs: 10, greaves: 4, boots: 4, cape: 2, shield: 12 };
/** Gameplay numbers leaning on the compound: dense stock hits harder and swings slower, and so on. */
function itemStats(t, compound, morph, rarity, res) {
  const o = RARITY_INDEX[rarity] ?? 0;
  const T = compound.traits;
  const pow = 1 + o * 0.18;
  const out = {};
  if (WEAPON_BASE[t.id]) {
    const [dmg, spd] = WEAPON_BASE[t.id];
    out.damage = Math.round(dmg * pow * (0.85 + compound.dense * 0.25 + T.heat * 0.1) * (0.9 + morph.width * 0.1));
    out.speed = r2(spd * (1 + T.ductility * 0.15 + T.tech * 0.1 - compound.dense * 0.12) * (1.06 - morph.length * 0.06));
    if (res.tip && res.grip) out.reach = r2(V(res.tip).distanceTo(V(res.grip)));
    if (t.id === 'pickaxe') out.gatherPower = Math.round((10 + o * 4) * (0.8 + compound.dense * 0.4));
    if (t.id === 'staff') out.spellPower = Math.round((12 + o * 5) * (0.7 + compound.glow * 0.6));
  }
  if (ARMOUR_BASE[t.id]) {
    out.armor = Math.round(ARMOUR_BASE[t.id] * pow * (0.6 + compound.dense * 0.6) * (compound.organic ? 0.85 : 1));
    out.weight = r2(ARMOUR_BASE[t.id] * 0.25 * (0.6 + compound.dense * 0.8) * morph.bulk);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Potions: lathe-turned glass around a lathe-turned draught, stopper, family ornament and label
// ---------------------------------------------------------------------------------------------
/** Outer glass profiles [radius, y] from the base up to the lip, per vessel. */
function vesselProfile(shape, k) {
  const S = k.rand(0.92, 1.12) * (0.94 + k.m.length * 0.06);
  const W = 0.92 + k.m.width * 0.08;
  const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  let pts;
  let neck;
  let body; // [y0, y1] of the part that holds the draught
  switch (shape) {
    case 'vial': {
      const r = 0.017 * W;
      const h = 0.12 * S;
      pts = [...arc(0, r, r, -Math.PI / 2, 0, 5), [r, h * 0.9], [r * 0.82, h * 0.95], [r * 0.82, h], [r * 1.08, h + 0.004]];
      neck = { r: r * 0.82, y: h + 0.004 };
      body = [0.004, h * 0.9];
      break;
    }
    case 'phial': {
      const R = 0.042 * W;
      const h = 0.13 * S;
      pts = [[0, 0]];
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        pts.push([R * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.75) * (1 - t * 0.55) + 0.011 * t, t * h * 0.82]);
      }
      pts.push([0.011, h * 0.92], [0.014, h]);
      neck = { r: 0.011, y: h };
      body = [0.004, h * 0.62];
      break;
    }
    case 'decanter': {
      const r = 0.038 * W;
      const h = 0.15 * S;
      pts = [[0, 0], [r * 0.9, 0], [r, 0.008], [r, h * 0.58], [r * 0.6, h * 0.72], [0.012, h * 0.8], [0.012, h * 0.93], [0.017, h * 0.96], [0.014, h]];
      neck = { r: 0.012, y: h };
      body = [0.005, h * 0.62];
      break;
    }
    case 'gourd': {
      const a = 0.045 * W;
      const b = 0.03 * W;
      pts = [...arc(0, a, a, -Math.PI / 2, Math.PI * 0.32, 8)];
      const top = pts[pts.length - 1][1];
      pts.push(...arc(0, top + b * 0.9, b, -Math.PI * 0.3, Math.PI * 0.38, 6).slice(1));
      const y = pts[pts.length - 1][1];
      pts.push([0.011, y + 0.012], [0.011, y + 0.026], [0.015, y + 0.03]);
      neck = { r: 0.011, y: y + 0.03 };
      body = [0.004, top + b * 0.6];
      break;
    }
    case 'ampoule': {
      const r = 0.022 * W;
      const h = 0.09 * S;
      pts = [...arc(0, r * 0.8, r, -Math.PI / 2, 0, 5).map(([x, y]) => [x, y * 0.8]), [r, h], [r * 0.55, h + 0.02], [0.004, h + 0.05], [0.0035, h + 0.07], [0, h + 0.074]];
      neck = { r: 0.004, y: h + 0.074, sealed: true };
      body = [0.004, h];
      break;
    }
    case 'hipflask': {
      const r = 0.052 * W;
      const h = 0.13 * S;
      pts = [[0, 0], [r * 0.9, 0], [r, 0.012], [r, h * 0.72], [r * 0.5, h * 0.88], [0.014, h * 0.9], [0.014, h]];
      neck = { r: 0.014, y: h };
      body = [0.005, h * 0.74];
      break;
    }
    case 'cell': {
      const r = 0.026 * W;
      const h = 0.13 * S;
      pts = [[0, 0.012], [r, 0.012], [r, h - 0.012], [0, h - 0.012]];
      neck = { r: r * 0.5, y: h, capped: true };
      body = [0.014, h - 0.014];
      break;
    }
    case 'orb': {
      const r = 0.048 * W;
      pts = [...arc(0, r + 0.03, r, -Math.PI / 2, Math.PI * 0.42, 10)];
      const y = pts[pts.length - 1][1];
      pts.push([0.012, y + 0.014], [0.015, y + 0.02]);
      neck = { r: 0.012, y: y + 0.02 };
      body = [0.034, 0.03 + r * 1.5];
      break;
    }
    default: {
      // Round-bottom flask: a bulb and a long neck.
      const r = 0.05 * W;
      pts = [...arc(0, r, r, -Math.PI / 2, Math.PI * 0.4, 10)];
      const y = pts[pts.length - 1][1];
      const nh = 0.06 * S;
      pts.push([0.013, y + nh * 0.5], [0.013, y + nh], [0.017, y + nh + 0.004]);
      neck = { r: 0.013, y: y + nh + 0.004 };
      body = [0.004, r * 1.55];
    }
  }
  return { pts: pts.map(([x, y]) => [r5(Math.max(0, x)), r5(y)]), neck, body };
}
/** Radius of a profile at height y (linear between samples). */
function profileAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1];
    const [r1, y1] = pts[i];
    if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) return y1 === y0 ? Math.max(r0, r1) : lerp(r0, r1, (y - y0) / (y1 - y0));
  }
  return pts[pts.length - 1][0];
}

function potion(k, shape) {
  const brew = brewPotion(k.c, k.rarity, k.seed);
  const prof = vesselProfile(shape, k);
  const P = prof.pts;
  const seg = shape === 'decanter' ? (k.fam === 'crystalline' ? 6 : 4) : shape === 'phial' && k.fam === 'crystalline' ? 8 : 20;
  const rotY = seg === 4 ? 45 : 0;
  const flat = shape === 'hipflask' ? 0.5 : 1;
  const top = Math.max(...P.map((p) => p[1]));
  const baseY = Math.min(...P.map((p) => p[1]));
  // Liquid: the inside of the glass up to the fill line, a touch smaller so it reads through.
  const [b0, b1] = prof.body;
  const fillY = lerp(b0, b1, brew.fill);
  const liq = [[0, 0]];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const y = lerp(b0, fillY, i / n);
    liq.push([Math.max(0.001, profileAt(P, y) * 0.86 - 0.001), y - b0]);
  }
  liq.push([0, fillY - b0]);
  k.add('lathe', 'Draught', 'draught', { pos: [0, b0, 0], rot: [0, rotY, 0], scale: [1, 1, flat], tint: brew.liquid, p: { pts: liq.map((q) => q.map(r5)), seg } });
  k.add('lathe', 'Glass', 'glass', { pos: [0, baseY, 0], rot: [0, rotY, 0], scale: [1, 1, flat], tint: brew.glass, p: { pts: P.map(([x, y]) => [x, r5(y - baseY)]), seg } });
  // Meniscus ring and suspended motes / a floating crystal as rarity climbs.
  if (k.o >= 2) {
    const m = k.int(3, 6);
    for (let i = 0; i < m; i++) {
      const a = k.rand(0, Math.PI * 2);
      const y = lerp(b0, fillY, k.rand(0.2, 0.85));
      const rr = profileAt(P, y) * k.rand(0.1, 0.55);
      k.add('sphere', 'Mote', 'light', { pos: [Math.cos(a) * rr, y, Math.sin(a) * rr * flat], tint: mixc(brew.liquid, '#ffffff', 0.6), p: { r: k.rand(0.0025, 0.0045), seg: 6 } });
    }
    k.feature('glowing motes');
  }
  if (k.o >= 3 && shape !== 'vial' && shape !== 'ampoule') {
    k.crystal('Suspended crystal', 'crystal', [0, lerp(b0, fillY, 0.35), 0], [0.15, 1, 0], 0.006, 0.022);
    k.feature('suspended crystal');
  }
  // Stopper.
  const N = prof.neck;
  if (N.capped) {
    // Reagent cell: brass end caps, rails, a valve and a pressure dial.
    const r = P[1][0];
    for (const [y, h] of [[0, 0.014], [top - 0.002, 0.014]]) k.add('cylinder', 'End cap', 'trim', { pos: [0, y, 0], p: { rt: r * 1.12, rb: r * 1.12, h, seg: 16 } });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      k.rod('Cage rail', 'dark', [Math.cos(a) * r * 1.04, 0.012, Math.sin(a) * r * 1.04], [Math.cos(a) * r * 1.04, top, Math.sin(a) * r * 1.04], 0.0022, 0.0022, 5);
    }
    k.gear('Valve', 'trim', [0, top + 0.016, 0], [0, 1, 0], r * 0.55, { teeth: 8, depth: 0.004, hole: 0.002 });
    k.rod('Valve stem', 'dark', [0, top + 0.01, 0], [0, top + 0.016, 0], 0.003, 0.003, 6);
    k.disc('Dial', 'clockface', [0, top * 0.62, r * 1.12 + 0.002], [0, 0, 1], r * 0.42, 0.004, 14);
    k.ring('Dial rim', 'trim', [0, top * 0.62, r * 1.12 + 0.004], [0, 0, 1], r * 0.42, 0.0018, { seg: 16 });
    k.feature('caged reagent cell');
  } else if (N.sealed) {
    k.add('sphere', 'Glass seal', 'light', { pos: [0, top, 0], tint: brew.liquid, p: { r: 0.0045, seg: 8 } });
    k.ring('Score line', 'trim', [0, top - 0.035, 0], [0, 1, 0], 0.0062, 0.0011, { seg: 14 });
    k.feature('sealed ampoule');
  } else {
    const style = k.wpick({ cork: k.fam === 'sylvan' || k.fam === 'bulwark' ? 4 : 2, crystal: k.fam === 'crystalline' || k.fam === 'celestial' ? 4 : k.o >= 3 ? 1 : 0, cap: k.fam === 'artificer' || k.fam === 'duelist' ? 3 : 1, wax: k.o >= 1 ? 2 : 1 });
    const y = N.y - 0.008;
    if (style === 'crystal') {
      k.add('cylinder', 'Stopper plug', 'glass', { pos: [0, y, 0], tint: brew.glass, p: { rt: N.r * 1.1, rb: N.r * 0.9, h: 0.012, seg: 10 } });
      k.crystal('Crystal stopper', 'crystal', [0, y + 0.011, 0], [0, 1, 0], N.r * 1.25, N.r * 3.2, { sides: 6, tip: 0.45 });
      k.feature('cut crystal stopper');
    } else if (style === 'cap') {
      k.add('cylinder', 'Screw cap', 'trim', { pos: [0, y, 0], p: { rt: N.r * 1.3, rb: N.r * 1.4, h: 0.016, seg: 14 } });
      for (let i = 0; i < 3; i++) k.ring('Cap thread', 'dark', [0, y + 0.003 + i * 0.004, 0], [0, 1, 0], N.r * 1.38, 0.0008, { seg: 14 });
      k.add('sphere', 'Cap finial', k.o >= 2 ? 'rgem' : 'trim', { pos: [0, y + 0.02, 0], p: { r: N.r * 0.5, seg: 8 } });
    } else {
      k.add('cylinder', 'Cork', 'cork', { pos: [0, y, 0], p: { rt: N.r * 1.15, rb: N.r * 0.9, h: 0.02, seg: 10 } });
      if (style === 'wax') {
        k.add('sphere', 'Wax seal', 'wax', { pos: [0, y + 0.018, 0], scale: [1, 0.7, 1], tint: k.o >= 2 ? mixc(k.gemTint, '#6a1a1a', 0.35) : mixc(k.c.colors.trim, '#7a2020', 0.6), p: { r: N.r * 1.35, seg: 10, hemi: true } });
        k.feature('wax-sealed cork');
      } else {
        k.ring('Cork tie', 'leather', [0, y + 0.006, 0], [0, 1, 0], N.r * 1.02, 0.0012, { seg: 12 });
        k.feature('cork stopper');
      }
    }
  }
  // Label: a parchment tag tied at the neck (or a wrapped band on straight-sided vessels).
  const neckY = N.y - 0.022;
  if (shape === 'vial' || shape === 'decanter' || shape === 'hipflask') {
    const ly = lerp(b0, b1, 0.45);
    const lr = profileAt(P, ly);
    if (shape === 'vial') k.add('tube', 'Label band', 'parchment', { pos: [0, ly - 0.012, 0], p: { ro: lr + 0.0008, ri: lr - 0.0004, h: 0.024, seg: 20 } });
    else k.add('box', 'Label', 'parchment', { pos: [0, ly - 0.016, (shape === 'decanter' ? lr * 0.72 : lr * flat) + 0.0008], rot: [0, 0, 0], p: { w: lr * 0.9, h: 0.032, d: 0.0012 } });
  } else if (!N.capped && !N.sealed) {
    k.ring('Neck cord', 'leather', [0, neckY, 0], [0, 1, 0], N.r + 0.0014, 0.0011, { seg: 12 });
    const tz = profileAt(P, neckY - 0.02) * flat + 0.006;
    k.rod('Tag string', 'leather', [N.r * 0.5, neckY, N.r], [N.r * 0.8, neckY - 0.022, tz], 0.0006, 0.0006, 4);
    k.add('box', 'Tag', 'parchment', { pos: [N.r * 0.8, neckY - 0.044, tz], rot: [0, 0, -8], p: { w: 0.02, h: 0.024, d: 0.0012 } });
  }
  // Family ornament.
  const midY = lerp(b0, b1, 0.5);
  const midR = profileAt(P, midY);
  switch (k.fam) {
    case 'bulwark': {
      if (shape !== 'cell' && shape !== 'hipflask') for (const y of [lerp(b0, b1, 0.15), lerp(b0, b1, 0.8)]) k.ring('Iron band', 'dark', [0, y, 0], [0, 1, 0], profileAt(P, y) + 0.0016, 0.0018, { seg: 20 });
      const straps = shape === 'hipflask' ? 2 : 4;
      for (let i = 0; i < straps; i++) {
        const pts = [];
        for (let j = 0; j <= 6; j++) {
          const y = lerp(b0, b1, 0.15 + (0.65 * j) / 6);
          pts.push([profileAt(P, y) + 0.0016, y]);
        }
        k.add('sweep', 'Strap', 'dark', { rot: [0, (360 * i) / straps + (shape === 'hipflask' ? 0 : 45), 0], p: { pts, r: 0.0016, r2: 0.0016, flat: 2.2, sides: 4, seg: 3 } });
      }
      k.feature('iron-strapped');
      break;
    }
    case 'sylvan':
      for (let i = 0; i < (shape === 'hipflask' ? 0 : 5); i++) {
        const y = lerp(b0, b1, 0.04 + i * 0.07);
        k.ring('Wicker', 'wood', [0, y, 0], [0, 1, 0], profileAt(P, y) + 0.0022, 0.0024, { seg: 18 });
      }
      for (const a of [-40, 40]) k.add('extrude', 'Leaf', 'shard', { pos: [0, neckY + 0.004, N.r + 0.002], rot: [0, 0, a], p: { pts: [[0, 0], [0.006, 0.01], [0, 0.024], [-0.006, 0.01]], depth: 0.0015, bevel: 0.0005 } });
      k.feature('wicker-wrapped');
      break;
    case 'crystalline':
      k.growth([midR * 0.7, lerp(b0, b1, 0.85), 0], [0.6, 1, 0.2], 0.012, 3);
      break;
    case 'celestial':
      heraldry(k, 'sun', [0, midY, midR * flat + 0.002], [0, 0, 1], Math.min(0.022, midR * 0.55));
      break;
    case 'void':
      heraldry(k, 'crescent', [0, midY, midR * flat + 0.002], [0, 0, 1], Math.min(0.02, midR * 0.5));
      k.add('cone', 'Hook', 'dark', { pos: [N.r + 0.004, neckY - 0.004, 0], rot: [0, 0, -150], p: { r: 0.0025, h: 0.014, seg: 4 } });
      break;
    case 'tempest':
      heraldry(k, 'wave', [0, midY, midR * flat + 0.003], [0, 0, 1], Math.min(0.02, midR * 0.55));
      break;
    case 'duelist':
      heraldry(k, 'filigree', [0, midY, midR * flat + 0.003], [0, 0, 1], Math.min(0.018, midR * 0.5));
      if (!N.capped && !N.sealed) for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.ring('Neck chain', 'trim', [Math.cos(a) * (N.r + 0.002), neckY + 0.004, Math.sin(a) * (N.r + 0.002)], [-Math.sin(a), 0, Math.cos(a)], 0.0022, 0.0006, { seg: 8 });
      }
      break;
    case 'artificer':
      if (shape !== 'cell') {
        if (shape !== 'hipflask') for (const y of [lerp(b0, b1, 0.1), lerp(b0, b1, 0.9)]) k.ring('Brass band', 'trim', [0, y, 0], [0, 1, 0], profileAt(P, y) + 0.0016, 0.0018, { seg: 20 });
        k.gear('Gear clasp', 'trim', [0, midY, midR * flat + 0.003], [0, 0, 1], Math.min(0.014, midR * 0.4), { teeth: 9, depth: 0.003, hole: 0.003 });
      }
      break;
  }
  if (shape === 'orb') {
    k.add('lathe', 'Stand', 'trim', { p: { pts: [[0, 0], [0.04, 0], [0.042, 0.006], [0.018, 0.014], [0.022, 0.03], [0, 0.03]], seg: 16 } });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.add('sweep', 'Stand prong', 'trim', { rot: [0, DEG(a), 0], p: { pts: [[0.018, 0.026], [0.034, 0.04], [0.04, 0.06]], r: 0.0022, r2: 0.0014, flat: 1, sides: 5, seg: 5 } });
    }
  }
  if (k.o >= 5) k.ring('Halo', 'rgem', [0, top + 0.03, 0], [0, 1, 0], 0.024, 0.0012, { seg: 24 });
  const noun = { draught: 'Draught', tonic: 'Tonic', elixir: 'Elixir' }[brew.kind];
  return { brew, center: [0, (b0 + b1) / 2, 0], noun: { flask: `${noun} Flask`, vial: `${noun} Vial`, phial: `${noun} Phial`, decanter: `${noun} Decanter`, gourd: `${noun} Gourd`, ampoule: `${noun} Ampoule`, hipflask: `Hip Flask`, cell: `${noun} Cell`, orb: `${noun} Orb` }[shape] };
}

// ---------------------------------------------------------------------------------------------
// Morphology, naming and the public API
// ---------------------------------------------------------------------------------------------
/** Family body multipliers [length, width, bulk] (after the Aurealium Forge's morphology table). */
const FAMILY_BODY = { crystalline: [1.06, 1.15, 1.03], bulwark: [0.84, 1.45, 1.19], sylvan: [1.1, 0.88, 0.91], artificer: [1.02, 0.9, 0.96], celestial: [1.05, 1.08, 1.04], void: [1.1, 1.17, 0.96], tempest: [1.2, 0.76, 0.94], duelist: [1.18, 0.68, 0.88] };

/** Silhouette and proportions for one item: 62% a family signature form, otherwise any form. */
export function morphology(type, spec, compound) {
  const t = TYPE[type] ?? TYPE.long_sword;
  const r = rng(`${spec.seed}|architecture|${t.id}|${JSON.stringify(compound.recipe)}`);
  const ids = Object.keys(t.shapes);
  const prefs = (t.prefs[compound.family] ?? []).filter((s) => t.shapes[s]);
  const roll = r();
  const pi = r();
  const ai = r();
  const shape = spec.shape !== 'auto' && t.shapes[spec.shape] ? spec.shape : roll < 0.62 && prefs.length ? prefs[Math.floor(pi * prefs.length)] : ids[Math.floor(ai * ids.length)];
  const b = FAMILY_BODY[compound.family] ?? [1, 1, 1];
  const T = compound.traits;
  return {
    shape,
    label: t.shapes[shape],
    family: compound.family,
    length: r2(clamp(b[0] * (0.82 + r() * 0.4) * (0.9 + T.ductility * 0.2 + T.elasticity * 0.12) * spec.size, 0.6, 1.6)),
    width: r2(clamp(b[1] * (0.8 + r() * 0.42) * (0.7 + spec.profile * 0.65) * (0.88 + compound.dense * 0.24), 0.5, 1.9)),
    bulk: r2(clamp(b[2] * (0.9 + r() * 0.18) * (0.9 + spec.profile * 0.2), 0.6, 1.5)),
    fracture: T.heat > 0.2 && T.cold > 0.2,
  };
}

export const COVERAGE = { auto: 'Chosen by the design', full: 'Full sleeves and skirt', short: 'Short sleeves', sleeveless: 'Sleeveless', open: 'No undershirt' };
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Validate a generation request (untrusted input welcome). */
export function normalizeSpec(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const ingredients = raw.ingredients ? normalizeIngredients(raw.ingredients) : recipeFromBlend(BLENDS[raw.blend] ? raw.blend : 'emberhold_smithy');
  return {
    seed: String(raw.seed ?? 'FORGE-1').slice(0, 64) || 'FORGE-1',
    rarity: RARITY_INDEX[raw.rarity] !== undefined ? raw.rarity : 'common',
    ingredients: normalizeIngredients(ingredients),
    family: FAMILIES[raw.family] ? raw.family : 'auto',
    shape: typeof raw.shape === 'string' ? raw.shape.slice(0, 24) : 'auto',
    size: clamp(numOr(raw.size, 1), 0.8, 1.25),
    profile: clamp(numOr(raw.profile, 0.5), 0, 1),
    coverage: COVERAGE[raw.coverage] ? raw.coverage : 'auto',
  };
}

const BUILD = {
  greatsword: (k, s) => sword(k, 'greatsword', s),
  long_sword: (k, s) => sword(k, 'long_sword', s),
  short_sword: (k, s) => sword(k, 'short_sword', s),
  dagger: (k, s) => sword(k, 'dagger', s),
  axe,
  mace,
  staff,
  bow,
  shield,
  pickaxe,
  helmet,
  chest,
  pauldrons,
  bracers,
  gloves,
  legs,
  greaves,
  boots,
  cape,
  ring,
  necklace,
  potion,
};

const SYLLABLES = [['Var', 'Orl', 'Kael', 'Bram', 'Thy', 'Ves', 'Ash', 'Cor', 'Ul', 'Myr', 'Dra', 'Sel'], ['ka', 'th', 'ren', 'dor', 'is', 'an', 'ith', 'or', 'ae', 'um'], ['hal', 'mar', 'gard', 'ion', 'rak', 'wen', 'ys', 'oth', 'ane', 'ex']];
function itemName(t, k, res, effects) {
  const word = FAMILIES[k.fam]?.word ?? '';
  const base = t.id === 'potion' ? res.noun : `${word} ${res.noun}`;
  if (t.id === 'potion') {
    const e = res.brew.effects;
    const of = e.length > 1 ? `${e[0].name} and ${e[1].name}` : e[0].name;
    return k.o >= 3 ? `${word} ${res.noun} of ${of}` : `${res.noun} of ${of}`;
  }
  if (k.o >= 4) {
    const R = rng(`${k.seed}|name`);
    const p = (a) => a[Math.floor(R() * a.length)];
    return `${p(SYLLABLES[0])}${p(SYLLABLES[1])}${p(SYLLABLES[2])}, ${base}`;
  }
  if (k.o >= 2 && effects[0]) return `${base} of ${effects[0].name}`;
  return base;
}
const pct = (w) => `${Math.round(w * 100)}%`;
const round3 = (v) => (Array.isArray(v) ? v.map((x) => Math.round(x * 1000) / 1000) : v);

/** Where an item rides on the mannequin (worn pieces carry bones per part instead). */
function mountFor(t, res) {
  if (t.space === 'body') return { mode: 'worn' };
  if (t.id === 'shield') return { mode: 'shield', bone: 'LeftForeArm', point: round3(res.center) };
  if (t.id === 'ring') return { mode: 'ring', bone: 'RightHandRing1', point: round3(res.center) };
  if (t.id === 'potion') return { mode: 'belt', bone: 'Hips', point: round3(res.center) };
  return { mode: 'grip', bone: 'RightHand', point: round3(res.grip ?? [0, 0.1, 0]) };
}

/**
 * Generate one item as a workshop recipe.
 *   type: an EQUIPMENT_TYPES id
 *   spec: { seed, rarity, ingredients | blend, family:'auto'|id, shape:'auto'|id, size, profile, coverage }
 *   compound (optional): a synthesizeCompound() result to share between pieces of a set
 */
export function generateEquipment(type, raw = {}, compoundIn = null) {
  const t = TYPE[type] ?? TYPE.long_sword;
  const spec = normalizeSpec(raw);
  const compound = compoundIn ?? synthesizeCompound(spec.ingredients, spec.seed, spec.family);
  const morph = morphology(t.id, spec, compound);
  const k = new Kit(`${spec.seed}|${t.id}|${morph.shape}|${spec.rarity}`, spec.rarity, compound, morph);
  k.seed = `${spec.seed}|${t.id}`;
  const res = BUILD[t.id](k, morph.shape, spec) ?? {};
  k.parts.forEach((p, i) => (p.id = `${t.id.slice(0, 12)}_${i.toString(36)}`));
  const effects = t.id === 'potion' ? res.brew.effects : affixesFor(compound, spec.rarity, spec.seed, t.slot);
  const name = itemName(t, k, res, effects);
  const ing = spec.ingredients;
  const made = Object.keys(ing.parts)
    .filter((role) => compound.weights[role] > 0)
    .map((role) => `${pct(compound.weights[role])} ${RESOURCES[ing[role]].name}`)
    .join(', ');
  const fam = FAMILIES[compound.family];
  const lines = [
    `${t.label}: ${morph.label.toLowerCase()} (${RARITIES[k.o].label}).`,
    `${t.id === 'potion' ? 'Brewed' : 'Smithed'} from ${made}.`,
    `Construction: ${fam.label.toLowerCase()}. ${fam.note}`,
    k.features.length ? `Details: ${k.features.slice(0, 10).join(', ')}.` : '',
    `Reactions: ${compound.reactions.map((r) => r.text).join('; ')}.`,
  ];
  if (t.id === 'potion') {
    const b = res.brew;
    lines.push(`Effects: ${b.effects.map((e) => e.text).join('; ')}${b.duration ? ` for ${b.duration} s` : ''}.`);
    if (b.drawbacks.length) lines.push(`Side effects: ${b.drawbacks.join('; ')}.`);
  } else if (effects.length) lines.push(`Affixes: ${effects.map((e) => e.text).join('; ')}.`);
  const bones = [...new Set(k.parts.map((p) => p.bone).filter(Boolean))];
  const stats = itemStats(t, compound, morph, spec.rarity, res);
  const id = `eq_${t.id}_${hashSeed(`${spec.seed}|${spec.rarity}|${JSON.stringify(ing)}|${morph.shape}|${spec.family}|${spec.size}|${spec.profile}|${spec.coverage}`).toString(36)}`;
  const meta = {
    generator: GENERATOR,
    generatorVersion: GENERATOR_VERSION,
    type: t.id,
    label: t.label,
    group: t.group,
    slot: t.slot,
    space: t.space,
    seed: spec.seed,
    rarity: spec.rarity,
    shape: morph.shape,
    shapeLabel: morph.label,
    family: compound.family,
    familyRequested: spec.family,
    size: spec.size,
    profile: spec.profile,
    coverage: spec.coverage,
    ingredients: ing,
    proportions: Object.fromEntries(Object.entries(compound.weights).map(([r, w]) => [r, r2(w)])),
    traits: Object.fromEntries(Object.entries(compound.traits).map(([r, w]) => [r, r2(w)])),
    reactions: compound.reactions.map((r) => r.id),
    gameMaterials: compound.gameMaterials,
    morph: { length: morph.length, width: morph.width, bulk: morph.bulk },
    features: k.features.slice(0, 12),
    stats,
    effects: effects.map(({ id, trait, name: en, stat, value, unit, instant, text }) => ({ id, trait, name: en, stat, value, unit, instant, text })),
    mount: mountFor(t, res),
    ...(bones.length ? { bones } : {}),
    ...(res.grip ? { grip: round3(res.grip) } : {}),
    ...(res.tip ? { tip: round3(res.tip) } : {}),
    ...(t.id === 'potion' ? { potion: { kind: res.brew.kind, duration: res.brew.duration, cooldown: res.brew.cooldown, drawbacks: res.brew.drawbacks, liquid: res.brew.liquid, glass: res.brew.glass, fill: res.brew.fill } } : {}),
  };
  return {
    format: 'alloy-recipe',
    version: 1,
    id,
    name,
    category: 'equipment',
    notes: lines.filter(Boolean).join(' ').slice(0, 1990),
    tags: [t.group.toLowerCase(), t.id, compound.family, spec.rarity],
    meta,
    parts: k.parts,
  };
}

export const KIT_PIECES = ['helmet', 'pauldrons', 'chest', 'cape', 'bracers', 'gloves', 'legs', 'greaves', 'boots', 'necklace', 'ring'];
const KIT_WEAPONS = { crystalline: { long_sword: 3, staff: 2, greatsword: 2 }, bulwark: { mace: 3, axe: 2, greatsword: 2 }, sylvan: { bow: 3, short_sword: 2, staff: 1 }, artificer: { long_sword: 2, mace: 2, staff: 1, pickaxe: 1 }, celestial: { long_sword: 3, staff: 2, greatsword: 1 }, void: { greatsword: 2, dagger: 2, axe: 1 }, tempest: { short_sword: 2, bow: 2, staff: 1 }, duelist: { long_sword: 2, dagger: 2, short_sword: 1 } };

/**
 * A matching set from one blend: armour, jewellery, a weapon (and a shield when it is one-handed).
 * opts: { weapon:'auto'|type|'none', offhand:'auto'|'shield'|'none', potion:true }
 */
export function generateKit(raw = {}, opts = {}) {
  const spec = normalizeSpec(raw);
  const compound = synthesizeCompound(spec.ingredients, spec.seed, spec.family);
  const R = rng(`${spec.seed}|kit|${compound.family}`);
  const wpick = (w) => {
    const e = Object.entries(w);
    let t = R() * e.reduce((s, [, x]) => s + x, 0);
    for (const [key, x] of e) if ((t -= x) <= 0) return key;
    return e[0][0];
  };
  const gen = (type) => generateEquipment(type, { ...spec, shape: 'auto', seed: `${spec.seed}|${type}` }, compound);
  const items = [];
  const shapes = {};
  for (const type of KIT_PIECES) {
    if (type === 'greaves' && ['platelegs', 'lamellar', 'frame', 'splint'].includes(shapes.legs)) continue;
    const r = gen(type);
    shapes[type] = r.meta.shape;
    items.push(r);
  }
  // Gloves are generated after bracers in KIT_PIECES order; drop bracers that would clip a gauntlet cuff.
  if (['gauntlet', 'lames', 'mech', 'crystal'].includes(shapes.gloves)) {
    const i = items.findIndex((r) => r.meta.type === 'bracers');
    if (i >= 0) items.splice(i, 1);
  }
  const weapon = opts.weapon && opts.weapon !== 'auto' ? opts.weapon : wpick(KIT_WEAPONS[compound.family] ?? { long_sword: 1 });
  if (weapon !== 'none' && TYPE[weapon]) {
    const w = gen(weapon);
    items.push(w);
    const oneHand = w.meta.slot === 'main_hand';
    const off = opts.offhand ?? 'auto';
    if (off === 'shield' || (off === 'auto' && oneHand && (['bulwark', 'celestial', 'crystalline', 'artificer'].includes(compound.family) || R() < 0.4))) items.push(gen('shield'));
  }
  if (opts.potion !== false) items.push(gen('potion'));
  return { family: compound.family, compound, items };
}

export { FAMILIES, BLENDS, RESOURCES };
