// Resources: the raw ingredients equipment is smithed from, and the maths that blends them.
//
// Every resource has a role (core stock, shards, crystal, infusion), a colour pair and a trait
// vector. A smithing recipe names one resource per role plus proportions. synthesizeCompound()
// blends the traits by proportion, scores the eight construction families, derives a palette and
// lists the "reactions" between ingredients. The equipment generator reads that compound to choose
// silhouettes, proportions, ornament and materials, so what an item is made of decides its shape.
//
// The ore-node generator (ore.js) reads the same records (plus each resource's deposit profile), so
// a deposit mined in the world carries its identity straight into a recipe.
//
// Catalogue: the Alloy Frontier's own materials (Emberhold iron, ironwood, ironglass, binding flux)
// plus the Aurealium Forge resource set the team designed, kept compatible id-for-id.
import * as THREE from 'three';

/** FNV-1a: any text -> 32-bit integer. */
export function hashSeed(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Seeded PRNG (mulberry32 over the text hash): same text, same sequence. */
export function rng(seed) {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TRAITS = ['density', 'heat', 'ductility', 'grain', 'celestial', 'tech', 'cold', 'organic', 'growth', 'elasticity', 'void', 'light'];
export const ROLES = { metal: 'Core stock', shards: 'Shards', crystal: 'Crystal', infusion: 'Infusion' };

// Deposit profile per resource: [host form, host colour, vein colour, growth colour, growth type].
const R = (name, role, color, edge, traits, description, node, extra = {}) => ({ name, role, color, edge, traits, description, node, ...extra });

export const RESOURCES = {
  // The Alloy Frontier's own materials (item-gen ids in `game`).
  emberhold_iron: R('Emberhold iron', 'metal', '#74352e', '#fa674c', { density: 0.88, heat: 0.98, ductility: 0.4, grain: 0.8 }, 'Dense red iron from the Emberhold trail. Thick forged sections and hot seams.', ['round', '#51565c', '#d95c38', '#ff5146', 'needle'], { game: 'iron_ore', frontier: true }),
  ironwood: R('Ironwood', 'metal', '#4a3626', '#c08a52', { density: 0.55, organic: 0.9, elasticity: 0.85, grain: 1 }, 'Iron-hard timber from the Ironwood Trail. Hafts, limbs, braces and layered grain.', ['strata', '#3e3226', '#8a5a34', '#c9a066', 'plates'], { game: 'ironwood', frontier: true }),
  ironglass: R('Ironglass', 'crystal', '#5fc8e6', '#d6fbff', { growth: 0.8, cold: 0.7, light: 0.85, tech: 0.35 }, 'Cyan quarry glass that grows through iron. Clean prisms and cold light.', ['columns', '#4a5560', '#3fb6d6', '#aef4ff', 'prism'], { game: 'ironglass', frontier: true }),
  binding_flux: R('Binding flux', 'infusion', '#b98a3a', '#ffd27a', { ductility: 0.8, heat: 0.6, tech: 0.55, light: 0.5 }, 'Smiths’ flux that welds unlike materials. Brazed seams, bands and gilded joins.', ['block', '#5a5048', '#c8892f', '#ffd27a', 'ore'], { game: 'binding_flux', frontier: true }),
  quench_slate: R('Quench slate', 'shards', '#4b5866', '#9fc3d8', { density: 0.7, cold: 0.55, grain: 0.8, growth: 0.4 }, 'Layered blue-grey splinters from the quench pools. Laminated edges and slabs.', ['strata', '#3d4650', '#6f90a8', '#b8d8ec', 'plates'], { frontier: true }),
  foundry_cinder: R('Foundry cinder', 'shards', '#5a2c24', '#ff8a3d', { heat: 1, density: 0.6, void: 0.3, growth: 0.45 }, 'Clinker from the Dormant Foundry. Ember-cracked spines and charred barbs.', ['crag', '#3a3232', '#c4502c', '#ff9a4a', 'needle'], { frontier: true }),

  // Aurealium Forge set: core stock.
  starsteel: R('Starsteel', 'metal', '#7888ac', '#d8e9ff', { density: 0.5, ductility: 0.85, celestial: 0.9, tech: 0.45 }, 'Fine pale alloy. Long edges and radial ornament.', ['crag', '#354559', '#d7b56a', '#a9dfff', 'prism']),
  basalt_steel: R('Basalt steel', 'metal', '#41444a', '#c38b6c', { density: 1, grain: 1, heat: 0.48 }, 'Heavy, rough stock. Broad heads, slabs and rivets.', ['columns', '#303238', '#ae5947', '#ffad43', 'needle']),
  moon_silver: R('Moon silver', 'metal', '#b2c5d4', '#e4eaff', { density: 0.35, ductility: 1, cold: 0.8, celestial: 0.65 }, 'Light bright metal. Swept guards and delicate work.', ['strata', '#556b79', '#b6d9d5', '#e2ecff', 'plates']),
  briarwood: R('Living briarwood', 'metal', '#584232', '#92ae65', { density: 0.25, organic: 1, elasticity: 1, grain: 0.9 }, 'Flexible timber. Branches, leaf plates and layered fibers.', ['strata', '#493c2b', '#71934d', '#b3e885', 'plates']),
  bone_ash: R('Ashbone composite', 'metal', '#c5ba9d', '#eee1b5', { density: 0.55, organic: 0.65, void: 0.35, grain: 0.65 }, 'Pale porous stock. Rib cages, hooked edges and tusks.', ['geode', '#b6aa87', '#5c6158', '#e7cea5', 'ore']),
  tide_bronze: R('Tide bronze', 'metal', '#557c79', '#c9ad70', { density: 0.65, ductility: 0.7, cold: 0.55, elasticity: 0.6 }, 'Patinated bronze. Shells, ripples and sweeping curves.', ['round', '#35665f', '#d39b4e', '#73e2d8', 'prism']),
  obsidian_alloy: R('Obsidian alloy', 'metal', '#292435', '#987598', { density: 0.7, void: 1, growth: 0.5, grain: 0.7 }, 'Dark glass metal. Broken planes and deep open profiles.', ['crag', '#252132', '#7b4da1', '#c68bea', 'plates']),
  ion_titanium: R('Ion titanium', 'metal', '#647282', '#b9ccdc', { density: 0.45, tech: 1, ductility: 0.6, elasticity: 0.55 }, 'Engineered alloy. Rails, vents and separated frames.', ['columns', '#344752', '#31b0b5', '#a3f9ee', 'prism']),
  verdigris_copper: R('Verdigris copper', 'metal', '#3c8564', '#e6a047', { ductility: 0.85, tech: 0.5, density: 0.55 }, 'Patinated green stock with copper seams and yellow inclusions.', ['block', '#397955', '#de8435', '#f2de65', 'prism']),
  hematite_iron: R('Cinder hematite iron', 'metal', '#654a46', '#ee6241', { density: 0.95, heat: 0.9, grain: 0.9 }, 'Dense iron from broad red-flecked boulders.', ['round', '#53555b', '#8d3e34', '#ff6f47', 'needle']),
  aurorium_gold: R('Aurorium gold', 'metal', '#bea14b', '#fff0a0', { celestial: 1, ductility: 0.75, light: 0.7 }, 'Warm celestial stock with gilded plates and sunlit growths.', ['columns', '#5b5660', '#c29c4a', '#fff1b0', 'plates']),
  meteor_cobalt: R('Meteor cobalt', 'metal', '#3e5576', '#91d9ec', { tech: 0.9, cold: 0.4, density: 0.65 }, 'Blue meteoric stock. Angular rails and cool hard edges.', ['crag', '#354a60', '#5b88b4', '#60cfea', 'ore']),
  pallid_mithril: R('Pallid mithril', 'metal', '#afc9c1', '#ecffff', { ductility: 1, cold: 0.85, celestial: 0.55 }, 'Light silvery-green stock for slender swept equipment.', ['strata', '#788c82', '#c5d2b6', '#ddffff', 'needle']),
  deep_malachite: R('Deep malachite alloy', 'metal', '#397153', '#a9d063', { organic: 0.85, growth: 0.55, density: 0.6 }, 'Green layered stock with living mineral reinforcement.', ['strata', '#315d45', '#72ac55', '#c9d778', 'plates']),

  // Shards.
  purple_shimmer: R('Purple shimmering shards', 'shards', '#8739b9', '#e79bff', { growth: 0.9, light: 0.72, void: 0.3 }, 'Splintered purple facets. Forks, prongs and layered shimmer.', ['crag', '#48444e', '#865ba4', '#c962ed', 'plates']),
  frost_glass: R('Frostglass splinters', 'shards', '#71bdd8', '#d8ffff', { growth: 0.6, cold: 1, light: 0.6 }, 'Thin ice-like plates. Long tapering edges and pale ribs.', ['strata', '#547582', '#8cc7d4', '#d0fffa', 'needle']),
  sunburst_shards: R('Sunburst shards', 'shards', '#dfa84d', '#fff0ae', { growth: 0.5, celestial: 1, light: 0.8, heat: 0.5 }, 'Warm radial facets. Fans, rays and luminous filigree.', ['round', '#4c4140', '#d58b3e', '#ffe171', 'needle']),
  thorn_prism: R('Thorn-prism fibers', 'shards', '#5b9b62', '#b4e884', { organic: 1, growth: 0.85, elasticity: 0.8 }, 'Branching green inclusions. Vines, ribs and antlers.', ['crag', '#3b5943', '#93ae4b', '#7fdd8e', 'needle']),
  void_flake: R('Void flakes', 'shards', '#493763', '#b38ac8', { void: 1, growth: 0.85, light: 0.35 }, 'Dark angular fragments. Hooks, fractured gaps and hollow forms.', ['geode', '#302637', '#733d83', '#b278d4', 'plates']),
  storm_quartz: R('Storm-quartz slivers', 'shards', '#5e8ac9', '#a5d7ff', { cold: 0.65, tech: 0.4, light: 1, growth: 0.7 }, 'Blue needle facets. Fast silhouettes and branching channels.', ['round', '#485367', '#758ad7', '#9de6ff', 'needle']),
  blood_scarlet: R('Scarlet hematite', 'shards', '#8b294c', '#fb729a', { heat: 0.8, density: 0.7, growth: 0.5, light: 0.45 }, 'Iron-rich red inclusions. Weighted spines and serrated lips.', ['round', '#696468', '#a73d4b', '#ff5257', 'prism']),
  circuit_slivers: R('Circuit-glass slivers', 'shards', '#3ea4b3', '#8effe9', { tech: 1, light: 0.95, elasticity: 0.4 }, 'Ordered luminous flakes. Parallel rails and modular fins.', ['block', '#3e5c60', '#56c6ac', '#b1ffe6', 'plates']),
  garnet_splinters: R('Furnace garnet splinters', 'shards', '#b63d4d', '#ff936c', { heat: 1, growth: 0.7, density: 0.55 }, 'Red angular inclusions and serrated forge growths.', ['crag', '#655557', '#b74145', '#ff9767', 'plates']),
  amber_thorns: R('Amber thorns', 'shards', '#ca7f39', '#ffe292', { organic: 1, growth: 0.75, elasticity: 0.65 }, 'Honey-coloured splinters trapped in dark rootstone.', ['strata', '#5d4931', '#ce8741', '#ffe393', 'needle']),
  jadeite_blades: R('Jadeite blades', 'shards', '#488f78', '#b3f0a2', { organic: 0.95, growth: 0.85, cold: 0.3 }, 'Flat green mineral blades and leafy forged layers.', ['block', '#42675a', '#6eb681', '#9ef1cb', 'plates']),
  neon_kyanite: R('Neon kyanite slivers', 'shards', '#286ca5', '#5effed', { tech: 1, light: 1, growth: 0.65 }, 'Blue blade-like sheets with bright cyan edges.', ['columns', '#2e4961', '#317fb7', '#77ffe4', 'plates']),
  eclipse_mica: R('Eclipse mica', 'shards', '#5c446e', '#c69bf1', { void: 1, growth: 0.65, ductility: 0.5 }, 'Dark violet plates and layered shadow facets.', ['strata', '#4b3b57', '#916296', '#d0a1f4', 'plates']),
  fulgurite_needles: R('Fulgurite needles', 'shards', '#8487b7', '#f0dcff', { cold: 0.6, tech: 0.65, light: 1, growth: 0.75 }, 'Branched pale needles from glassy storm deposits.', ['crag', '#575567', '#a09dbb', '#f1d5ff', 'needle']),

  // Crystals.
  violet_fluorite: R('Fluorescent light-violet crystal', 'crystal', '#b07be8', '#ecc8ff', { growth: 1, light: 1, void: 0.3 }, 'Bright violet growth. Large prisms and luminous fracture lines.', ['geode', '#535060', '#864ccc', '#e7b6ff', 'prism']),
  glacial_heart: R('Glacial heart crystal', 'crystal', '#79c5ec', '#d1f4ff', { growth: 0.8, cold: 1, light: 0.8 }, 'Cool transparent facets. Frost spires and thin long crowns.', ['columns', '#4b6f7d', '#9ad6e0', '#c8f4ff', 'prism']),
  solar_citrine: R('Solar citrine', 'crystal', '#ecbf61', '#fff6ad', { celestial: 1, light: 0.9, heat: 0.6 }, 'Warm captured light. Sun disks, broad fans and ray patterns.', ['geode', '#706049', '#dfb258', '#fff087', 'prism']),
  jade_seed: R('Living jade seed', 'crystal', '#49a983', '#abefc0', { organic: 1, growth: 0.85, light: 0.6, elasticity: 0.75 }, 'Green living inclusions. Buds, leaves and protective cages.', ['round', '#3b6458', '#74ba78', '#a7f3a5', 'ore']),
  abyss_amethyst: R('Abyss amethyst', 'crystal', '#70449d', '#c192ee', { void: 1, growth: 0.9, light: 0.6 }, 'Deep purple cores. Open crescents and clustered geodes.', ['geode', '#34273e', '#7a459e', '#bc87ee', 'prism']),
  azure_lumen: R('Azure lumen', 'crystal', '#289dcc', '#7cdeff', { cold: 0.7, light: 1, elasticity: 0.7 }, 'Flowing blue light. Wave channels and curved struts.', ['crag', '#345865', '#249bc8', '#87efff', 'needle']),
  ember_opal: R('Ember opal', 'crystal', '#cf5547', '#ffd68a', { heat: 1, light: 0.85, growth: 0.5 }, 'Hot opalescent cores. Thick glowing veins and warm fractures.', ['round', '#594348', '#d76a4c', '#ffb779', 'ore']),
  aether_diamond: R('Aether diamond', 'crystal', '#b5d9df', '#f4f4ff', { light: 0.85, celestial: 0.8, tech: 0.8, growth: 0.8 }, 'Sharp pale prisms. Suspended-looking cores with structural cages.', ['block', '#6e7d85', '#a7d0c3', '#edffff', 'prism']),
  dusk_ruby: R('Dusk ruby', 'crystal', '#a33765', '#ff92c8', { heat: 0.7, void: 0.7, growth: 1, light: 0.7 }, 'Crimson geode crystals with deep-violet roots.', ['geode', '#4f344e', '#a73162', '#ff87b3', 'prism']),
  aurora_beryl: R('Aurora beryl', 'crystal', '#64bba9', '#d1ffe2', { cold: 0.9, light: 0.9, growth: 0.8 }, 'Mint spires with pastel green inclusions.', ['columns', '#4d7b76', '#70c5aa', '#c1ffe2', 'prism']),
  dawn_topaz: R('Dawn topaz', 'crystal', '#e8a943', '#fff4b0', { celestial: 1, light: 1, growth: 0.75 }, 'Broad golden crystals and ceremonial radial forms.', ['round', '#676352', '#d4a643', '#ffe892', 'prism']),
  verdant_emerald: R('Verdant emerald', 'crystal', '#24966c', '#8affb2', { organic: 1, growth: 1, light: 0.6 }, 'Rich green prisms in a living mineral matrix.', ['geode', '#304e40', '#399b6b', '#80ecad', 'prism']),
  rift_sapphire: R('Rift sapphire', 'crystal', '#3e51c1', '#b0a0ff', { void: 0.8, tech: 0.65, light: 0.85, growth: 1 }, 'Deep-blue broken spires with electric violet faces.', ['crag', '#313351', '#5c53b4', '#a18bff', 'needle']),
  tidal_tourmaline: R('Tidal tourmaline', 'crystal', '#389b94', '#acf4d3', { cold: 0.8, elasticity: 0.85, ductility: 0.65, growth: 0.65 }, 'Blue-green rods and flowing mineral ribbons.', ['strata', '#37696d', '#53a98a', '#b1f6d7', 'prism']),

  // Infusions.
  copper: R('Copper infusion', 'infusion', '#bd7347', '#ffc087', { ductility: 0.85, heat: 0.6, tech: 0.65, light: 0.6 }, 'Warm conductive veins. Wires, coils and energized crystal seams.', ['block', '#456c4d', '#e0833b', '#ffdd56', 'needle']),
  silver_filament: R('Silver filament', 'infusion', '#bcc9d6', '#f0f5ff', { ductility: 1, cold: 0.65, celestial: 0.7 }, 'Fine cool binding. Narrow loops, bright edges and chain work.', ['strata', '#4b586d', '#b6b4ce', '#dbeaff', 'plates']),
  ember_sap: R('Ember sap', 'infusion', '#9d4928', '#ffb855', { heat: 1, organic: 0.45, light: 0.8 }, 'Hot resin. Lacquered wraps and glowing scar lines.', ['round', '#47362e', '#ce7233', '#ffb953', 'ore']),
  verdant_resin: R('Verdant resin', 'infusion', '#54754a', '#b3cf78', { organic: 1, elasticity: 0.9, growth: 0.6 }, 'Living binder. Woven joints and branching reinforcements.', ['block', '#3a5535', '#96b151', '#d2e67d', 'ore']),
  void_ichor: R('Void ichor', 'infusion', '#30273d', '#b474ca', { void: 1, growth: 0.6, light: 0.5 }, 'Dark binder. Broken silhouettes and violet fracture veins.', ['geode', '#292236', '#67396f', '#b86ec5', 'ore']),
  ion_plasma: R('Ion plasma', 'infusion', '#419cab', '#8fffee', { tech: 1, light: 1, elasticity: 0.45 }, 'Charged blue binder. Light rails, vents and energized seams.', ['columns', '#274654', '#3ca99b', '#9affe2', 'needle']),
  tidal_brine: R('Tidal brine', 'infusion', '#4d8c9a', '#a7e5d6', { cold: 1, elasticity: 0.85, ductility: 0.55 }, 'Flowing green-blue temper. Shell curves and rippling hems.', ['strata', '#4c716e', '#78aeaa', '#d1fae2', 'plates']),
  luminous_gold: R('Luminous gold', 'infusion', '#c9a950', '#fff1ae', { celestial: 1, light: 0.8, ductility: 0.7 }, 'Radiant binding. Sun motifs and thick ornamental edging.', ['round', '#4e5148', '#c1a150', '#fff199', 'prism']),
  phoenix_mercury: R('Phoenix quicksilver', 'infusion', '#ba6751', '#ffbc82', { heat: 0.95, ductility: 0.9, light: 0.7 }, 'Molten-looking nodules that temper warm flexible forms.', ['round', '#5b4a49', '#ce6c49', '#ffc69a', 'ore']),
  electrum_aether: R('Aether electrum', 'infusion', '#c6be72', '#f6ffb5', { celestial: 0.9, tech: 0.75, light: 0.95 }, 'Pale golden binder harvested from luminous fissures.', ['block', '#69725c', '#cec477', '#edffb6', 'plates']),
  moss_ichor: R('Mosslight ichor', 'infusion', '#527c46', '#c2ed77', { organic: 1, growth: 0.8, elasticity: 0.8 }, 'Green binder from mineralized rootstone pockets.', ['round', '#4e6142', '#86a744', '#c3e87a', 'ore']),
  umbral_salts: R('Umbral salts', 'infusion', '#584274', '#bc91df', { void: 1, growth: 0.7, light: 0.4 }, 'Violet crusts and dark angular precipitates.', ['geode', '#3c314f', '#895ca6', '#c595e7', 'plates']),
  cryo_silver: R('Cryosilver solution', 'infusion', '#83b3cb', '#e5ffff', { cold: 1, ductility: 0.95, light: 0.55 }, 'Cool silver-blue binder in icy mineral plates.', ['strata', '#507488', '#9ec6da', '#e7ffff', 'plates']),
  saffron_sulfur: R('Saffron sulfur', 'infusion', '#c49a33', '#ffef75', { heat: 0.9, light: 0.8, grain: 0.7 }, 'Yellow crusts with orange seams and sharp golden points.', ['block', '#70663f', '#e29732', '#ffef70', 'needle']),
};

/** Resources by role, game materials first. */
export function resourcesByRole(role) {
  return Object.entries(RESOURCES)
    .filter(([, r]) => r.role === role)
    .sort((a, b) => (b[1].frontier ? 1 : 0) - (a[1].frontier ? 1 : 0) || a[1].name.localeCompare(b[1].name))
    .map(([id]) => id);
}

export const FAMILIES = {
  crystalline: { label: 'Crystal-grown', word: 'Prism', note: 'Facets grow through the stock: crystal blades, geode crowns, clustered heads.' },
  bulwark: { label: 'Heavy forge', word: 'Ironbound', note: 'Thick slabs, rivets, broad heads and blunt silhouettes.' },
  sylvan: { label: 'Living weave', word: 'Briar', note: 'Branches, leaf plates, root hafts and woven bindings.' },
  artificer: { label: 'Mechanical frame', word: 'Gearwright', note: 'Rails, gears, pistons, vents and light channels.' },
  celestial: { label: 'Solar regalia', word: 'Solar', note: 'Sun disks, rays, wing fans and gilt edging.' },
  void: { label: 'Fractured void', word: 'Voidwake', note: 'Crescents, hooks, broken rims and hollow profiles.' },
  tempest: { label: 'Swept tide', word: 'Tide', note: 'Long swept curves, shell plates and rippling hems.' },
  duelist: { label: 'Fine filigree', word: 'Moonwire', note: 'Narrow blades, basket guards, light cuffs and chains.' },
};

/** Ready-made blends (recipes). The first four are Alloy Frontier smithing; the rest are the Aurealium set. */
export const BLENDS = {
  emberhold_smithy: { name: 'Emberhold Smithy', family: 'bulwark', seed: 'EMBERHOLD-1', metal: 'emberhold_iron', shards: 'quench_slate', crystal: 'ironglass', infusion: 'binding_flux', parts: [62, 14, 14, 10], description: 'Orla’s forge standard: red Emberhold iron, quench-slate edges, ironglass inlay and flux brazing.' },
  ironwood_ranger: { name: 'Ironwood Ranger', family: 'sylvan', seed: 'IRONWOOD-7', metal: 'ironwood', shards: 'amber_thorns', crystal: 'jade_seed', infusion: 'binding_flux', parts: [58, 16, 14, 12], description: 'Ironwood limbs and hafts, amber thorns and living jade buds.' },
  quarry_glass: { name: 'Quarry Glasswright', family: 'crystalline', seed: 'IRONGLASS-12', metal: 'starsteel', shards: 'frost_glass', crystal: 'ironglass', infusion: 'silver_filament', parts: [40, 22, 30, 8], description: 'Ironglass prisms grown through pale starsteel.' },
  foundry_core: { name: 'Foundry Core', family: 'artificer', seed: 'FOUNDRY-WARDEN', metal: 'basalt_steel', shards: 'foundry_cinder', crystal: 'ember_opal', infusion: 'copper', parts: [55, 18, 15, 12], description: 'The Dormant Foundry’s machinery: basalt plates, cinder spines, copper conduits.' },
  prism_ember: { name: 'Prismatic Ember', family: 'crystalline', seed: 'EMBER-PRISM-33', metal: 'emberhold_iron', shards: 'purple_shimmer', crystal: 'violet_fluorite', infusion: 'copper', parts: [38, 28, 24, 10], description: 'Red iron, purple splinters, fluorescent violet and conductive copper.' },
  coalward: { name: 'Coalward Bastion', family: 'bulwark', seed: 'COALWARD-17', metal: 'basalt_steel', shards: 'blood_scarlet', crystal: 'ember_opal', infusion: 'ember_sap', parts: [73, 13, 8, 6], description: 'Broad slab armour, blunt heads, rivets and hot red cracks.' },
  briarheart: { name: 'Briarheart', family: 'sylvan', seed: 'BRIAR-41', metal: 'briarwood', shards: 'thorn_prism', crystal: 'jade_seed', infusion: 'verdant_resin', parts: [52, 20, 17, 11], description: 'Branching timber, woven braces, leaf hems and living jade buds.' },
  ion_assembly: { name: 'Ion Assembly', family: 'artificer', seed: 'ION-808', metal: 'ion_titanium', shards: 'circuit_slivers', crystal: 'aether_diamond', infusion: 'ion_plasma', parts: [53, 20, 16, 11], description: 'Open rail frames, segmented plates and cyan light channels.' },
  solar_aurorium: { name: 'Solar Aurorium', family: 'celestial', seed: 'ILLUMINUS-9', metal: 'starsteel', shards: 'sunburst_shards', crystal: 'solar_citrine', infusion: 'luminous_gold', parts: [56, 18, 18, 8], description: 'Sun disks, wing fans, pale steel and luminous gold edging.' },
  voidwake: { name: 'Voidwake', family: 'void', seed: 'NOCTRA-73', metal: 'obsidian_alloy', shards: 'void_flake', crystal: 'abyss_amethyst', infusion: 'void_ichor', parts: [44, 29, 18, 9], description: 'Open crescents, hooked profiles, ragged cloth and dark geodes.' },
  frostglass: { name: 'Frostglass Current', family: 'tempest', seed: 'AQUIATAS-61', metal: 'tide_bronze', shards: 'frost_glass', crystal: 'azure_lumen', infusion: 'tidal_brine', parts: [47, 24, 21, 8], description: 'Long swept forms, shell curves, icy edges and rippling cloth.' },
  moonwire: { name: 'Moonwire Duelist', family: 'duelist', seed: 'MOONWIRE-12', metal: 'moon_silver', shards: 'storm_quartz', crystal: 'glacial_heart', infusion: 'silver_filament', parts: [67, 11, 12, 10], description: 'Narrow blades, basket guards, light cuffs and fine silver chains.' },
};

export function recipeFromBlend(id) {
  const b = BLENDS[id] ?? BLENDS.emberhold_smithy;
  return { metal: b.metal, shards: b.shards, crystal: b.crystal, infusion: b.infusion, parts: { metal: b.parts[0], shards: b.parts[1], crystal: b.parts[2], infusion: b.parts[3] }, resourceSeed: b.seed };
}

/** Validate a recipe (untrusted JSON welcome): every role filled with a resource of that role. */
export function normalizeIngredients(raw = {}, fallback = 'emberhold_smithy') {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const base = recipeFromBlend(fallback);
  const out = { parts: {}, resourceSeed: String(raw.resourceSeed ?? base.resourceSeed).slice(0, 64) };
  for (const role of Object.keys(ROLES)) {
    out[role] = RESOURCES[raw[role]]?.role === role ? raw[role] : base[role];
    const n = Number(raw.parts?.[role]);
    out.parts[role] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : base.parts[role];
  }
  if (Object.values(out.parts).every((v) => v === 0)) out.parts = { ...base.parts };
  return out;
}

export function randomIngredients(seed) {
  const r = rng(`${seed}|recipe`);
  const pick = (role) => {
    const keys = resourcesByRole(role);
    return keys[Math.floor(r() * keys.length)];
  };
  return normalizeIngredients({ metal: pick('metal'), shards: pick('shards'), crystal: pick('crystal'), infusion: pick('infusion'), parts: { metal: Math.round(30 + r() * 42), shards: Math.round(8 + r() * 30), crystal: Math.round(5 + r() * 28), infusion: Math.round(3 + r() * 16) }, resourceSeed: String(seed) });
}

/** One sample of a resource: its archetype varied by a seed (colour drift, trait spread, facets, grain). */
export function resourceGenome(id, seed = 'GENESIS') {
  const def = RESOURCES[id] ?? RESOURCES.emberhold_iron;
  const r = rng(`${id}|${seed}`);
  const color = new THREE.Color(def.color);
  const hsl = {};
  color.getHSL(hsl);
  color.setHSL((hsl.h + (r() - 0.5) * 0.06 + 1) % 1, THREE.MathUtils.clamp(hsl.s * (0.82 + r() * 0.36), 0.08, 1), THREE.MathUtils.clamp(hsl.l * (0.85 + r() * 0.3), 0.1, 0.9));
  const traits = {};
  for (const k of TRAITS) traits[k] = THREE.MathUtils.clamp((def.traits[k] ?? 0) * (0.82 + r() * 0.36), 0, 1);
  return {
    id,
    name: def.name,
    role: def.role,
    color: `#${color.getHexString()}`,
    edge: def.edge,
    traits,
    grain: 0.5 + r() * 2.5,
    facets: 4 + Math.floor(r() * 4),
    stretch: 1.1 + r() * 2.2,
    roughness: def.role === 'metal' ? 0.24 + r() * 0.5 : 0.08 + r() * 0.28,
    speckle: r(),
    description: def.description,
  };
}

const mix = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1)).getHexString()}`;

/**
 * Blend a recipe into a compound: traits by proportion, construction family (scored, with a seeded
 * nudge so near-ties vary), reactions between specific ingredients, glow, density/crystal fractions
 * and a role palette (metal, edge, trim, shard, crystal, light, dark, cloth, leather).
 */
export function synthesizeCompound(raw, seed = 'GENESIS', family = 'auto') {
  const recipe = normalizeIngredients(raw);
  const roles = Object.keys(ROLES);
  const total = roles.reduce((n, k) => n + recipe.parts[k], 0);
  const weights = Object.fromEntries(roles.map((k) => [k, recipe.parts[k] / total]));
  const ing = Object.fromEntries(roles.map((k) => [k, resourceGenome(recipe[k], recipe.resourceSeed)]));
  const traits = {};
  for (const k of TRAITS) traits[k] = roles.reduce((n, role) => n + ing[role].traits[k] * weights[role], 0);
  const has = (role, id) => recipe[role] === id && weights[role] > 0;
  const emberGlass = has('metal', 'emberhold_iron') && (has('crystal', 'violet_fluorite') || has('crystal', 'ironglass'));
  const scores = {
    crystalline: traits.growth * 1.25 + weights.shards * 0.8 + weights.crystal * 0.8 + (emberGlass ? 0.35 : 0),
    bulwark: traits.density * 1.5 + traits.heat * 0.45,
    sylvan: traits.organic * 2,
    artificer: traits.tech * 1.65,
    celestial: traits.celestial * 1.8,
    void: traits.void * 1.85,
    tempest: traits.cold * 1.2 + traits.elasticity * 0.65,
    duelist: traits.ductility * 1.3 + traits.cold * 0.3,
  };
  const rr = rng(`${seed}|${JSON.stringify(recipe)}|architecture`);
  for (const k of Object.keys(scores)) scores[k] += (rr() - 0.5) * 0.6;
  const fam = family !== 'auto' && FAMILIES[family] ? family : Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];

  const reactions = [];
  let glow = THREE.MathUtils.clamp(traits.light * 0.75 + weights.crystal * 0.8 + weights.infusion * 0.6, 0.05, 1);
  if (has('metal', 'emberhold_iron') && has('crystal', 'ironglass')) {
    reactions.push({ id: 'quenchglass', text: 'Quench-glass: cyan ironglass inlays cool along a red iron spine' });
    glow = Math.min(1, glow + 0.1);
  }
  if (has('metal', 'emberhold_iron') && has('shards', 'purple_shimmer') && has('crystal', 'violet_fluorite')) {
    reactions.push({ id: 'emberglass', text: 'Radiant emberglass: purple facets grow through a red iron spine' });
    glow = Math.min(1, glow + 0.18);
  }
  if (has('infusion', 'binding_flux')) reactions.push({ id: 'brazed', text: 'Flux brazing: bright brazed seams join unlike materials' });
  if (has('infusion', 'copper') && (traits.light > 0.15 || weights.crystal > 0.15)) {
    reactions.push({ id: 'conduction', text: 'Copper conduction: radiant crystal faces and warm metal fittings' });
    glow = Math.min(1, glow + 0.12);
  }
  if (traits.heat > 0.2 && traits.cold > 0.2) reactions.push({ id: 'thermal', text: 'Thermal contrast: stepped fractures and separated hot/cold surfaces' });
  if (traits.organic > 0.3) reactions.push({ id: 'living', text: 'Living binding: branched supports and overlapping fiber plates' });
  if (traits.tech > 0.32) reactions.push({ id: 'lattice', text: 'Ordered lattice: open rails, vent slits and segmented frames' });
  if (traits.void > 0.32) reactions.push({ id: 'cleave', text: 'Void cleavage: crescent cuts, hooks and broken rims' });
  if (traits.celestial > 0.32) reactions.push({ id: 'bloom', text: 'Radial bloom: sun disks, fans and laurel-shaped edges' });
  if (traits.heat > 0.55) reactions.push({ id: 'ember', text: 'Ember temper: glowing heat seams along the forging lines' });
  if (!reactions.length) reactions.push({ id: 'laminate', text: 'Tempered laminate: forged plates with visible inclusions' });

  const dense = THREE.MathUtils.clamp(traits.density + weights.metal * 0.28, 0, 1);
  const crystalline = THREE.MathUtils.clamp(weights.shards + weights.crystal + traits.growth * 0.28, 0, 1);
  const mixed = new THREE.Color(0, 0, 0);
  for (const role of roles) mixed.add(new THREE.Color(ing[role].color).multiplyScalar(weights[role]));
  const dominant = roles.reduce((a, b) => (weights[a] > weights[b] ? a : b));
  const core = weights.metal > 0 ? ing.metal.color : `#${mixed.getHexString()}`;
  const shard = weights.shards > 0 ? ing.shards.color : core;
  const crystal = weights.crystal > 0 ? ing.crystal.color : shard;
  const edge = weights.metal > 0 ? ing.metal.edge : ing[dominant].edge;
  const colors = {
    metal: mix(core, shard, weights.shards * 0.24),
    edge,
    trim: weights.infusion > 0 ? ing.infusion.color : edge,
    shard,
    crystal,
    light: mix(weights.crystal > 0 ? RESOURCES[recipe.crystal].edge : ing[dominant].edge, weights.infusion > 0 ? RESOURCES[recipe.infusion].edge : edge, weights.infusion * 0.8),
    dark: mix(core, '#171421', 0.58),
    cloth: mix(shard, core, 0.43),
    leather: mix('#5e3d28', core, 0.22),
  };
  return {
    recipe,
    ingredients: ing,
    weights,
    traits,
    scores,
    family: fam,
    reactions,
    glow,
    dense,
    crystalline,
    organic: traits.organic > 0.42,
    colors,
    gameMaterials: [...new Set(roles.map((k) => RESOURCES[recipe[k]].game).filter(Boolean))],
  };
}
