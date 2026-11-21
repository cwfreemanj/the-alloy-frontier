/**
 * Inventory state and atomic transactions (GDD 6.2 InventorySystem, 6.4; AF-005).
 * All mutations return a NEW state; on failure the original state is untouched,
 * so a failed or repeated request can never consume materials or duplicate items.
 */
import {
  MATERIALS,
  isMaterialId,
  validateItem,
  type ConsumedMaterial,
  type ItemInstance,
  type MaterialId,
  type MaterialLot,
} from '@alloy/item-gen';

export interface JournalEntry {
  txId: string;
  kind: 'forge' | 'buy' | 'grant';
  requestHash: string;
  at: number;
  itemId?: string;
}

export interface InventoryState {
  version: 1;
  ownerId: string;
  coins: number;
  lots: MaterialLot[];
  items: Record<string, ItemInstance>;
  itemOrder: string[];
  equipped: { weapon: string | null };
  seq: { lot: number; item: number };
  journal: JournalEntry[];
}

export type Fail = { ok: false; error: string; message: string };
export const fail = (error: string, message: string): Fail => ({ ok: false, error, message });

export const MAX_STACK = 1_000_000;

export function createInventory(ownerId: string, coins = 0): InventoryState {
  return {
    version: 1,
    ownerId,
    coins: Math.max(0, Math.floor(coins)),
    lots: [],
    items: {},
    itemOrder: [],
    equipped: { weapon: null },
    seq: { lot: 0, item: 0 },
    journal: [],
  };
}

export function cloneInventory(inv: InventoryState): InventoryState {
  return JSON.parse(JSON.stringify(inv)) as InventoryState;
}

export function materialTotal(inv: InventoryState, id: MaterialId): number {
  let n = 0;
  for (const l of inv.lots) if (l.materialId === id) n += l.quantity;
  return n;
}

export function materialTotals(inv: InventoryState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(MATERIALS)) out[id] = 0;
  for (const l of inv.lots) out[l.materialId] = (out[l.materialId] ?? 0) + l.quantity;
  return out;
}

/** Average quality of all lots of a material (for display). */
export function averageQuality(inv: InventoryState, id: MaterialId): number | null {
  let q = 0;
  let n = 0;
  for (const l of inv.lots)
    if (l.materialId === id) {
      q += l.quality * l.quantity;
      n += l.quantity;
    }
  return n > 0 ? q / n : null;
}

export interface AddMaterialInput {
  materialId: MaterialId;
  quantity: number;
  quality: number;
  origin: string;
  traits?: Record<string, number>;
}

/** Add gathered/bought material. Lots of identical material, origin and quality merge. */
export function addMaterial(inv: InventoryState, input: AddMaterialInput): { ok: true; inventory: InventoryState; lotId: string } | Fail {
  if (!isMaterialId(input.materialId)) return fail('unknown_material', `Unknown material ${String(input.materialId)}`);
  const qty = Math.floor(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_STACK) return fail('invalid_quantity', 'Quantity must be a positive integer');
  const quality = Math.round(Math.max(0, Math.min(1, Number.isFinite(input.quality) ? input.quality : 0)) * 1000) / 1000;
  const draft = cloneInventory(inv);
  const existing = draft.lots.find((l) => l.materialId === input.materialId && l.origin === input.origin && l.quality === quality);
  if (existing) {
    if (existing.quantity + qty > MAX_STACK) return fail('stack_overflow', 'Stack limit reached');
    existing.quantity += qty;
    return { ok: true, inventory: draft, lotId: existing.lotId };
  }
  draft.seq.lot++;
  const lotId = `lot-${draft.ownerId}-${draft.seq.lot}`;
  draft.lots.push({ lotId, materialId: input.materialId, quantity: qty, quality, origin: input.origin, traits: input.traits });
  return { ok: true, inventory: draft, lotId };
}

/** Choose lots to satisfy a requirement, best quality first. Does not mutate. */
export function planConsumption(inv: InventoryState, id: MaterialId, qty: number): ConsumedMaterial[] | null {
  if (!Number.isFinite(qty) || qty < 0) return null;
  let need = Math.floor(qty);
  if (need === 0) return [];
  const lots = inv.lots.filter((l) => l.materialId === id && l.quantity > 0).sort((a, b) => b.quality - a.quality || a.lotId.localeCompare(b.lotId));
  const out: ConsumedMaterial[] = [];
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(need, l.quantity);
    out.push({ lotId: l.lotId, materialId: id, quantity: take, quality: l.quality });
    need -= take;
  }
  return need > 0 ? null : out;
}

/** Apply a consumption plan to a draft (mutates the draft only). Throws if inconsistent. */
export function applyConsumption(draft: InventoryState, consumed: ConsumedMaterial[]): void {
  for (const c of consumed) {
    const lot = draft.lots.find((l) => l.lotId === c.lotId);
    if (!lot || lot.quantity < c.quantity || c.quantity <= 0) throw new Error(`Inconsistent consumption for ${c.lotId}`);
    lot.quantity -= c.quantity;
  }
  draft.lots = draft.lots.filter((l) => l.quantity > 0);
}

export function nextItemId(inv: InventoryState, seed: string): string {
  return `itm-${inv.ownerId}-${inv.seq.item + 1}-${seed.slice(0, 6)}`;
}

export function insertItem(draft: InventoryState, item: ItemInstance): void {
  if (draft.items[item.itemId]) throw new Error(`Duplicate item id ${item.itemId}`);
  draft.items[item.itemId] = item;
  draft.itemOrder.push(item.itemId);
  draft.seq.item++;
}

export function equipWeapon(inv: InventoryState, itemId: string, at: number): { ok: true; inventory: InventoryState } | Fail {
  const item = inv.items[itemId];
  if (!item) return fail('not_owned', 'Item is not in this inventory');
  if (item.family !== 'longsword') return fail('wrong_slot', 'Item cannot be equipped as a weapon');
  if (inv.equipped.weapon === itemId) return { ok: true, inventory: inv };
  const draft = cloneInventory(inv);
  draft.equipped.weapon = itemId;
  draft.items[itemId].history.push({ at, event: 'Equipped' });
  return { ok: true, inventory: draft };
}

/** Safe discard: refuses equipped items. */
export function discardItem(inv: InventoryState, itemId: string): { ok: true; inventory: InventoryState } | Fail {
  if (!inv.items[itemId]) return fail('not_owned', 'Item is not in this inventory');
  if (inv.equipped.weapon === itemId) return fail('equipped', 'Unequip or replace the item before discarding it');
  const draft = cloneInventory(inv);
  delete draft.items[itemId];
  draft.itemOrder = draft.itemOrder.filter((id) => id !== itemId);
  return { ok: true, inventory: draft };
}

export function equippedWeapon(inv: InventoryState): ItemInstance | null {
  return inv.equipped.weapon ? (inv.items[inv.equipped.weapon] ?? null) : null;
}

/** Structural + integrity validation used on load and on receipt from a transport. */
export function validateInventory(inv: unknown): { ok: true } | Fail {
  if (!inv || typeof inv !== 'object') return fail('invalid', 'Inventory missing');
  const s = inv as InventoryState;
  if (s.version !== 1) return fail('version', `Unsupported inventory version ${String(s.version)}`);
  if (!Number.isFinite(s.coins) || s.coins < 0) return fail('coins', 'Invalid coin balance');
  const lotIds = new Set<string>();
  for (const l of s.lots ?? []) {
    if (!isMaterialId(l.materialId) || !Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > MAX_STACK) {
      return fail('lot', `Invalid lot ${l.lotId}`);
    }
    if (lotIds.has(l.lotId)) return fail('lot_dup', `Duplicate lot ${l.lotId}`);
    lotIds.add(l.lotId);
  }
  for (const [id, item] of Object.entries(s.items ?? {})) {
    if (item.itemId !== id || !validateItem(item)) return fail('item', `Invalid or tampered item ${id}`);
  }
  if (new Set(s.itemOrder).size !== s.itemOrder.length) return fail('order', 'Duplicate item order entries');
  if (s.equipped?.weapon && !s.items[s.equipped.weapon]) return fail('equipped', 'Equipped item missing');
  return { ok: true };
}
