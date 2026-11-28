/**
 * Generated ("found") blueprints: the records, sealing and validation the game relies on
 * (docs/blueprint-contract.md), and a STAND-IN generator.
 *
 * The real generator is the creative director's (contract section 1). Until it lands, `generateBlueprint`
 * here makes plausible blueprints from the standard patterns, so drops, scrolls, learning and forging can be
 * built and tested. Replace the body of `generateBlueprint` (and the drop table) freely: the rest of the game
 * only relies on the `GeneratedBlueprint` shape and on `sealBlueprint` / `validateBlueprint`.
 */
import { BLUEPRINTS, getBlueprint, type BlueprintDefinition } from './blueprints';
import { isMaterialId } from './materials';
import { rarityFromScore } from './rating';
import { Rng, hashHex, stableStringify } from './rng';
import { RARITY_ORDER, type Rarity } from './types';

export type BlueprintArea = 'village' | 'trail' | 'quarry' | 'foundry';
export type BlueprintSource = 'enemy' | 'chest' | 'environment' | 'quest' | 'trade';

/** Where and why a blueprint is being made. The server fills this in. */
export interface BlueprintContext {
  area: BlueprintArea;
  source: BlueprintSource;
  /** The enemy type, container id or quest step. */
  sourceId: string;
  /** The area's current enemy level (adaptive world), 1-10. */
  level: number;
}

/** One found blueprint: it teaches one item (a set piece is its own blueprint). */
export interface GeneratedBlueprint {
  /** 'gbp_' + a hash of the generator, seed and context. */
  id: string;
  generator: { name: string; version: number };
  seed: string;
  context: BlueprintContext;
  rarity: Rarity;
  name: string;
  lore: string;
  /** What it makes, in the standard blueprint format; `piece.id` is the blueprint's id. */
  piece: BlueprintDefinition;
  set?: { id: string; name: string; pieces: number };
  requirement: { branch: 'smithing' | 'crafting' | 'alchemy'; level: number };
  worth: number;
  /** Hash of everything above (tampering check). */
  integrity: string;
}

export const BLUEPRINT_LIMITS = { name: 48, lore: 600, setPieces: 8, materials: 6, quantity: 99, worth: 1_000_000, level: 1000 } as const;

const AREAS: readonly BlueprintArea[] = ['village', 'trail', 'quarry', 'foundry'];
const SOURCES: readonly BlueprintSource[] = ['enemy', 'chest', 'environment', 'quest', 'trade'];
const SLOTS = ['weapon', 'offhand', 'head', 'shoulders', 'neck', 'cape', 'chest', 'belt', 'hands', 'legs', 'feet', 'ring', 'tool'];

// ---------------------------------------------------------------- sealing and validation

function body(bp: Omit<GeneratedBlueprint, 'integrity'> | GeneratedBlueprint): Omit<GeneratedBlueprint, 'integrity'> {
  const { integrity: _i, ...rest } = bp as GeneratedBlueprint;
  return rest;
}

/** Seal a blueprint: its integrity hash covers every field. */
export function sealBlueprint(bp: Omit<GeneratedBlueprint, 'integrity'>): GeneratedBlueprint {
  return { ...bp, integrity: hashHex(stableStringify(body(bp))) };
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Whether a blueprint definition is one the forge can safely use (a generated piece, or one copied into an item). */
export function validPiece(p: unknown): p is BlueprintDefinition {
  if (!p || typeof p !== 'object') return false;
  const b = p as BlueprintDefinition;
  if (!str(b.id, 64) || !str(b.name, BLUEPRINT_LIMITS.name) || !str(b.family, 32) || typeof b.tier !== 'string' || typeof b.description !== 'string' || b.description.length > BLUEPRINT_LIMITS.lore) return false;
  if (!num(b.baseDamage, 0, 10_000) || !num(b.baseAttackSpeed, 0.1, 10) || !num(b.baseStagger, 0, 10_000) || !num(b.baseStaminaMultiplier, 0.1, 10)) return false;
  if (b.baseDefense !== undefined && !num(b.baseDefense, 0, 10_000)) return false;
  if (b.equip !== undefined && (!b.equip || !SLOTS.includes(b.equip.slot))) return false;
  if (!Array.isArray(b.materials) || b.materials.length === 0 || b.materials.length > BLUEPRINT_LIMITS.materials) return false;
  for (const m of b.materials) if (!m || !isMaterialId(m.materialId) || !Number.isInteger(m.quantity) || m.quantity < 1 || m.quantity > BLUEPRINT_LIMITS.quantity) return false;
  if (!b.buffer || !isMaterialId(b.buffer.materialId) || !Number.isInteger(b.buffer.min) || b.buffer.min < 0 || b.buffer.min > BLUEPRINT_LIMITS.quantity || !Number.isInteger(b.buffer.standardBatch) || b.buffer.standardBatch < 1) return false;
  if (!num(b.masteryRequirement, 0, BLUEPRINT_LIMITS.level) || typeof b.craftable !== 'boolean') return false;
  if (!Array.isArray(b.modes) || !b.modes.length || b.modes.some((m) => m !== 'quick' && m !== 'masterwork')) return false;
  if (!Array.isArray(b.allowedSpecializations) || !b.allowedSpecializations.length || !Array.isArray(b.potentialImbuements)) return false;
  if (!b.masteryXp || !num(b.masteryXp.quick, 0, 10_000) || !num(b.masteryXp.masterwork, 0, 10_000)) return false;
  if (!b.visual || typeof b.visual !== 'object' || !num(b.visual.length, 0.1, 5)) return false;
  return true;
}

/** Whether something is an intact generated blueprint (shape, bounds and seal). */
export function validateBlueprint(raw: unknown): raw is GeneratedBlueprint {
  if (!raw || typeof raw !== 'object') return false;
  const b = raw as GeneratedBlueprint;
  if (!str(b.id, 64) || !b.id.startsWith('gbp_') || !str(b.seed, 128) || !b.generator || !str(b.generator.name, 32) || !num(b.generator.version, 0, 1e6)) return false;
  const c = b.context;
  if (!c || !AREAS.includes(c.area) || !SOURCES.includes(c.source) || !str(c.sourceId, 64) || !num(c.level, 0, 100)) return false;
  if (!RARITY_ORDER.includes(b.rarity) || !str(b.name, BLUEPRINT_LIMITS.name) || typeof b.lore !== 'string' || b.lore.length > BLUEPRINT_LIMITS.lore) return false;
  if (!validPiece(b.piece) || b.piece.id !== b.id) return false;
  if (b.set !== undefined && (!b.set || !str(b.set.id, 64) || !str(b.set.name, BLUEPRINT_LIMITS.name) || !Number.isInteger(b.set.pieces) || b.set.pieces < 1 || b.set.pieces > BLUEPRINT_LIMITS.setPieces)) return false;
  if (!b.requirement || !['smithing', 'crafting', 'alchemy'].includes(b.requirement.branch) || !num(b.requirement.level, 0, BLUEPRINT_LIMITS.level)) return false;
  if (!num(b.worth, 0, BLUEPRINT_LIMITS.worth)) return false;
  return typeof b.integrity === 'string' && b.integrity === hashHex(stableStringify(body(b)));
}

// ---------------------------------------------------------------- STAND-IN generator

/** STAND-IN: the chance a blueprint drops, per source. The creative director's table replaces this. */
export const BLUEPRINT_DROP = {
  /** A defeated enemy (elites much more). */
  enemy: 0.05,
  elite: 0.5,
  /** Searching: chests and trail caches often, barrels rarely. */
  chest: 0.3,
  cache: 0.2,
  barrel: 0.02,
} as const;

/** The standard patterns a found blueprint can be a variation of, by area (STAND-IN). */
const BASES: Record<BlueprintArea, string[]> = {
  village: ['iron_longsword', 'iron_mace', 'iron_shield', 'iron_helmet'],
  trail: ['iron_longsword', 'tempered_longsword', 'iron_mace', 'iron_shield', 'iron_helmet', 'iron_chestplate', 'iron_platelegs'],
  quarry: ['ironglass_longsword', 'ironglass_mace', 'ironglass_shield', 'ironglass_helmet', 'ironglass_chestplate', 'ironglass_platelegs'],
  foundry: ['tempered_longsword', 'ironglass_longsword', 'ironglass_mace', 'ironglass_shield', 'ironglass_chestplate', 'ironglass_platelegs'],
};
/** Other workshop shapes a variation may take. */
const SHAPES: Record<string, string[]> = {
  mace: ['flanged', 'spiked', 'cog', 'cage', 'hammer', 'turned'],
  shield: ['round', 'heater', 'kite', 'tower', 'cog', 'buckler'],
  helmet: ['kettle', 'crested', 'greathelm', 'horned', 'hood'],
  chest: ['plate', 'lamellar', 'brigandine', 'jerkin'],
  legs: ['platelegs', 'lamellar', 'splint', 'breeches'],
};
const PREFIX: Record<Rarity, string[]> = {
  common: ['Plain', 'Sturdy', 'Frontier'],
  uncommon: ['Fine', 'Balanced', 'Watchman’s'],
  rare: ['Ember-etched', 'Quarry-tempered', 'Scout’s'],
  epic: ['Warden’s', 'Compact', 'Gilded'],
  legendary: ['Meridian', 'Foundry-born', 'Sunforged'],
  mythic: ['Aetherbound', 'First Forge', 'Starsteel'],
};
const AREA_NAME: Record<BlueprintArea, string> = { village: 'Emberhold', trail: 'Ironwood', quarry: 'Ironglass Quarry', foundry: 'Dormant Foundry' };
const SOURCE_LORE: Record<BlueprintSource, string> = {
  enemy: 'Taken from a fallen foe, the vellum still smells of smoke.',
  chest: 'Folded small and tucked beneath a false bottom.',
  environment: 'Scratched into slate by a smith who never came back for it.',
  quest: 'Given in thanks, with instructions to make good use of it.',
  trade: 'Passed from hand to hand along the frontier.',
};
/**
 * How often a found armor blueprint is a set piece. The creative director asked for set blueprints to be rare
 * (2026-11-28): a low, arbitrary number, theirs to tune.
 */
export const SET_CHANCE = 0.05;

/** The stand-in's one set per area (armor pieces only). */
const SETS: Record<BlueprintArea, { id: string; name: string; pieces: number }> = {
  village: { id: 'set_emberhold_watch', name: 'Emberhold Watch', pieces: 4 },
  trail: { id: 'set_ironwood_ranger', name: 'Ironwood Ranger', pieces: 4 },
  quarry: { id: 'set_quarry_warden', name: 'Quarry Warden', pieces: 4 },
  foundry: { id: 'set_foundry_core', name: 'Foundry Core', pieces: 4 },
};

const GENERATOR = { name: 'standin', version: 1 };

/**
 * Make a found blueprint. STAND-IN for the creative director's generator: a variation of one of the area's
 * standard patterns, stronger and harder to make when rarer. Pure: the same seed and context give the same
 * blueprint.
 */
export function generateBlueprint(seed: string, ctx: BlueprintContext): GeneratedBlueprint {
  const r = new Rng(`blueprint:${GENERATOR.name}:${GENERATOR.version}:${seed}:${stableStringify(ctx)}`);
  const level = Math.max(1, Math.min(10, Math.floor(ctx.level) || 1));
  const bonus = ctx.source === 'chest' ? 0.05 : ctx.source === 'quest' ? 0.1 : 0;
  const rarity = rarityFromScore(Math.min(0.999, r.next() * 0.8 + level * 0.025 + bonus));
  const tier = RARITY_ORDER.indexOf(rarity);
  const bases = BASES[ctx.area];
  const base = getBlueprint(bases[Math.floor(r.next() * bases.length)]) ?? BLUEPRINTS.iron_longsword;
  const id = `gbp_${hashHex(stableStringify({ g: GENERATOR, seed, ctx })).slice(0, 16)}`;
  const prefix = PREFIX[rarity][Math.floor(r.next() * PREFIX[rarity].length)];
  const name = `${prefix} ${base.name}`.slice(0, BLUEPRINT_LIMITS.name);
  const armor = base.baseDefense !== undefined;
  const shapes = base.look ? SHAPES[base.look.type] : undefined;
  const look = base.look && shapes ? { ...base.look, shape: shapes[Math.floor(r.next() * shapes.length)] } : base.look;
  const set = armor && r.next() < SET_CHANCE ? SETS[ctx.area] : undefined;
  const up = 1 + 0.05 * tier;
  const piece: BlueprintDefinition = {
    ...base,
    id,
    name,
    tier: `${rarity[0].toUpperCase()}${rarity.slice(1)} pattern`,
    description: `A ${rarity} variation of the ${base.name.toLowerCase()}, found near ${AREA_NAME[ctx.area]}.`,
    baseDamage: armor ? base.baseDamage : Math.round(base.baseDamage * up),
    baseStagger: armor ? base.baseStagger : Math.round(base.baseStagger * up),
    ...(armor ? { baseDefense: Math.round((base.baseDefense ?? 0) * (1 + 0.06 * tier)) } : {}),
    materials: base.materials.map((m) => ({ ...m, quantity: Math.min(BLUEPRINT_LIMITS.quantity, m.quantity + Math.floor(tier / 2)) })),
    buffer: { ...base.buffer, min: base.buffer.min + Math.floor(tier / 2), standardBatch: base.buffer.standardBatch + Math.floor(tier / 2) },
    masteryRequirement: base.masteryRequirement + 3 * tier,
    craftable: true,
    masteryXp: { quick: base.masteryXp.quick + 5 * tier, masterwork: base.masteryXp.masterwork + 10 * tier },
    ...(look ? { look } : {}),
  };
  const lore = `${SOURCE_LORE[ctx.source]} ${set ? `One piece of the ${set.name} set. ` : ''}The margins are full of a smith's notes on ${AREA_NAME[ctx.area]} ${armor ? 'plate' : 'steel'}.`.slice(0, BLUEPRINT_LIMITS.lore);
  const worth = Math.round((10 + piece.materials.reduce((a, m) => a + m.quantity, 0) * 2) * (1 + tier) ** 2);
  return sealBlueprint({ id, generator: GENERATOR, seed, context: { ...ctx, level }, rarity, name, lore, piece, ...(set ? { set } : {}), requirement: { branch: 'smithing', level: piece.masteryRequirement }, worth });
}
