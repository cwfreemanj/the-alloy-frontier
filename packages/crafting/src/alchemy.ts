/**
 * Alchemy: brewing herbs into consumables, and what a consumable does when used.
 * Consumables are stacked like materials (lots with a quality): a potion's quality is the
 * average quality of the herbs that went into it, and better potions work better.
 */
import type { MaterialId } from '@alloy/item-gen';
import { addMaterial, applyConsumption, cloneInventory, fail, planConsumption, type Fail, type InventoryState } from './inventory';

export interface BrewRecipe {
  id: 'healing_salve' | 'stamina_tonic';
  name: string;
  inputs: Partial<Record<MaterialId, number>>;
  output: MaterialId;
}

export const BREWS: Record<BrewRecipe['id'], BrewRecipe> = {
  healing_salve: { id: 'healing_salve', name: 'Healing Salve', inputs: { emberleaf: 2 }, output: 'healing_salve' },
  stamina_tonic: { id: 'stamina_tonic', name: 'Stamina Tonic', inputs: { emberleaf: 3 }, output: 'stamina_tonic' },
};

export const CONSUMABLES = ['healing_salve', 'stamina_tonic'] as const;
export type ConsumableId = (typeof CONSUMABLES)[number];
/** Seconds between any two potions. */
export const POTION_COOLDOWN = 8;

/** What a consumable of a given quality does. */
export function consumableEffect(id: ConsumableId, quality: number): { heal: number; stamina: number } {
  const q = Number.isFinite(quality) ? Math.max(0, Math.min(1, quality)) : 0.5;
  return id === 'healing_salve' ? { heal: Math.round(60 + 60 * q), stamina: 0 } : { heal: 0, stamina: Math.round(50 + 40 * q) };
}

/** Brew `qty` of a recipe: consumes the best herbs first; the result's quality is their average. */
/** qualityBonus: added to the herbs' quality (the brewer's Alchemy level), up to 1. */
/** extra: potions added on top of qty (the Distiller perk). */
export function brew(inv: InventoryState, recipeId: string, qty: number, qualityBonus = 0, extra = 0): { ok: true; inventory: InventoryState; quality: number; made: number } | Fail {
  const r = (BREWS as Record<string, BrewRecipe | undefined>)[recipeId];
  if (!r) return fail('unknown_recipe', 'Unknown recipe.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) return fail('invalid_quantity', 'Invalid quantity.');
  const draft = cloneInventory(inv);
  let q = 0;
  let n = 0;
  for (const [mat, per] of Object.entries(r.inputs) as Array<[MaterialId, number]>) {
    const plan = planConsumption(draft, mat, per * qty);
    if (!plan) return fail('missing_materials', `Not enough ${mat === 'emberleaf' ? 'Emberleaf' : mat} (need ${per * qty}).`);
    for (const c of plan) {
      q += c.quality * c.quantity;
      n += c.quantity;
    }
    applyConsumption(draft, plan);
  }
  const bonus = Number.isFinite(qualityBonus) ? Math.max(0, Math.min(1, qualityBonus)) : 0;
  const quality = Math.round(Math.min(1, (n ? q / n : 0.5) + bonus) * 1000) / 1000;
  const made = qty + (Number.isInteger(extra) && extra > 0 ? Math.min(extra, 5) : 0);
  const added = addMaterial(draft, { materialId: r.output, quantity: made, quality, origin: 'brewed' });
  if (!added.ok) return added;
  return { ok: true, inventory: added.inventory, quality, made };
}

/** Use one consumable: takes the best one; returns its effect. */
export function consume(inv: InventoryState, id: string): { ok: true; inventory: InventoryState; effect: { heal: number; stamina: number } } | Fail {
  if (!(CONSUMABLES as readonly string[]).includes(id)) return fail('not_consumable', 'You cannot use that.');
  const plan = planConsumption(inv, id as MaterialId, 1);
  if (!plan || plan.length === 0) return fail('none_left', `You have no ${id === 'healing_salve' ? 'Healing Salves' : 'Stamina Tonics'}.`);
  const draft = cloneInventory(inv);
  applyConsumption(draft, plan);
  return { ok: true, inventory: draft, effect: consumableEffect(id as ConsumableId, plan[0].quality) };
}
