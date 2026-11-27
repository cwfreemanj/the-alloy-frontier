/**
 * Inventory state and atomic transactions (GDD 6.2 InventorySystem, 6.4; AF-005).
 * All mutations return a NEW state; on failure the original state is untouched,
 * so a failed or repeated request can never consume materials or duplicate items.
 */
import {
  MATERIALS,
  blueprintOf,
  getBlueprint,
  isMaterialId,
  validateBlueprint,
  validateItem,
  type BlueprintDefinition,
  type GeneratedBlueprint,
  type ConsumedMaterial,
  type EquipInfo,
  type ToolKind,
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
  /** Item id per slot. `weapon` is the main hand (the name predates the other slots). */
  equipped: Equipped;
  seq: { lot: number; item: number; scroll?: number };
  journal: JournalEntry[];
  /**
   * Found blueprints the character carries, by scroll id (docs/blueprint-contract.md). A scroll can be
   * learned, discarded (and later sold, traded or given), learned or not. Optional: older saves have none.
   */
  scrolls?: Record<string, GeneratedBlueprint>;
  /** Found blueprints the character has learned (can forge), by blueprint id. Optional like scrolls. */
  learned?: Record<string, GeneratedBlueprint>;
}

/** Most scrolls a character can carry. */
export const MAX_SCROLLS = 200;

/** Character equipment slots (see docs/equipment-contract.md). */
export const EQUIP_SLOTS = ['head', 'shoulders', 'neck', 'cape', 'chest', 'belt', 'hands', 'legs', 'feet', 'ring1', 'ring2', 'weapon', 'offhand', 'tool'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
export type Equipped = { weapon: string | null } & Partial<Record<Exclude<EquipSlot, 'weapon'>, string | null>>;

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

/** Where an item goes (from its blueprint). Blueprints without `equip` are one-handed main-hand weapons. */
export function equipInfo(item: ItemInstance): EquipInfo {
  return blueprintOf(item)?.equip ?? { slot: 'weapon', hands: 1 };
}

// ---------------- Found blueprints: scrolls and learning ----------------

/** A blueprint this character can forge from: a learned found blueprint, or a standard pattern. */
export function resolveBlueprint(inv: InventoryState, id: string): BlueprintDefinition | undefined {
  const found = typeof id === 'string' && inv.learned && Object.prototype.hasOwnProperty.call(inv.learned, id) ? inv.learned[id] : undefined;
  return found?.piece ?? getBlueprint(id);
}

/** Learned found blueprints, in the order they were learned. */
export function learnedBlueprints(inv: InventoryState): GeneratedBlueprint[] {
  return Object.values(inv.learned ?? {});
}

/** Put a found blueprint in the character's bag (a new scroll). */
export function addScroll(inv: InventoryState, bp: GeneratedBlueprint): { ok: true; inventory: InventoryState; scrollId: string } | Fail {
  if (!validateBlueprint(bp)) return fail('invalid_blueprint', 'That blueprint is damaged.');
  if (Object.keys(inv.scrolls ?? {}).length >= MAX_SCROLLS) return fail('scrolls_full', `You can carry at most ${MAX_SCROLLS} blueprints.`);
  const draft = cloneInventory(inv);
  const n = (draft.seq.scroll ?? 0) + 1;
  const scrollId = `scr-${draft.ownerId}-${n}`;
  draft.seq.scroll = n;
  (draft.scrolls ??= {})[scrollId] = bp;
  return { ok: true, inventory: draft, scrollId };
}

/** Learn a scroll's blueprint. The scroll stays (to sell, trade or give away). */
export function learnScroll(inv: InventoryState, scrollId: string): { ok: true; inventory: InventoryState; blueprint: GeneratedBlueprint } | Fail {
  const bp = typeof scrollId === 'string' && inv.scrolls && Object.prototype.hasOwnProperty.call(inv.scrolls, scrollId) ? inv.scrolls[scrollId] : undefined;
  if (!bp) return fail('unknown_scroll', 'You don’t have that blueprint.');
  if (inv.learned?.[bp.id]) return fail('already_learned', "You've already learned this blueprint.");
  const draft = cloneInventory(inv);
  (draft.learned ??= {})[bp.id] = bp;
  return { ok: true, inventory: draft, blueprint: bp };
}

/** Throw a scroll away (learned blueprints stay learned). */
export function discardScroll(inv: InventoryState, scrollId: string): { ok: true; inventory: InventoryState } | Fail {
  if (typeof scrollId !== 'string' || !inv.scrolls || !Object.prototype.hasOwnProperty.call(inv.scrolls, scrollId)) return fail('unknown_scroll', 'You don’t have that blueprint.');
  const draft = cloneInventory(inv);
  delete draft.scrolls![scrollId];
  return { ok: true, inventory: draft };
}

/** The slot an item currently occupies, if any. */
export function slotOf(inv: InventoryState, itemId: string): EquipSlot | null {
  for (const s of EQUIP_SLOTS) if (inv.equipped[s] === itemId) return s;
  return null;
}

/** The slots an item may go in. */
export function slotsFor(item: ItemInstance): EquipSlot[] {
  const k = equipInfo(item).slot;
  return k === 'ring' ? ['ring1', 'ring2'] : [k];
}

const isTwoHanded = (inv: InventoryState, id: string | null | undefined): boolean => !!id && !!inv.items[id] && equipInfo(inv.items[id]).hands === 2;

/**
 * Equip an item. The slot comes from the item; for rings the caller may pick ring1/ring2
 * (default: the first empty one). A two-handed weapon empties the off-hand; the off-hand
 * can't be used while one is equipped. Moving an item between ring slots is allowed.
 */
export function equipItem(inv: InventoryState, itemId: string, at: number, slot?: EquipSlot): { ok: true; inventory: InventoryState; slot: EquipSlot } | Fail {
  const item = inv.items[itemId];
  if (!item) return fail('not_owned', 'Item is not in this inventory');
  const allowed = slotsFor(item);
  if (slot && !allowed.includes(slot)) return fail('wrong_slot', 'That item does not go in that slot');
  const target = slot ?? allowed.find((x) => !inv.equipped[x]) ?? allowed[0];
  if (inv.equipped[target] === itemId) return { ok: true, inventory: inv, slot: target };
  if (target === 'offhand' && isTwoHanded(inv, inv.equipped.weapon)) return fail('two_handed', 'Your two-handed weapon needs both hands');
  const draft = cloneInventory(inv);
  const from = slotOf(draft, itemId);
  if (from) draft.equipped[from] = null;
  draft.equipped[target] = itemId;
  if (target === 'weapon' && equipInfo(item).hands === 2) draft.equipped.offhand = null;
  draft.items[itemId].history.push({ at, event: 'Equipped' });
  return { ok: true, inventory: draft, slot: target };
}

/** Back-compat wrapper: equip into the main hand. */
export function equipWeapon(inv: InventoryState, itemId: string, at: number): { ok: true; inventory: InventoryState } | Fail {
  const item = inv.items[itemId];
  if (!item) return fail('not_owned', 'Item is not in this inventory');
  if (equipInfo(item).slot !== 'weapon') return fail('wrong_slot', 'Item cannot be equipped as a weapon');
  return equipItem(inv, itemId, at, 'weapon');
}

/** Empty a slot (the item stays in the inventory). */
export function unequip(inv: InventoryState, slot: EquipSlot): { ok: true; inventory: InventoryState } | Fail {
  if (!(EQUIP_SLOTS as readonly string[]).includes(slot)) return fail('wrong_slot', 'Unknown slot');
  if (!inv.equipped[slot]) return fail('empty', 'Nothing is equipped there');
  const draft = cloneInventory(inv);
  draft.equipped[slot] = null;
  return { ok: true, inventory: draft };
}

/** The equipped item in each filled slot. */
export function equippedItems(inv: InventoryState): Array<{ slot: EquipSlot; item: ItemInstance }> {
  const out: Array<{ slot: EquipSlot; item: ItemInstance }> = [];
  for (const x of EQUIP_SLOTS) {
    const id = inv.equipped[x];
    if (id && inv.items[id]) out.push({ slot: x, item: inv.items[id] });
  }
  return out;
}

/** Tool power of an item for a kind of gathering (0 = not that tool). */
export function toolPower(item: ItemInstance | null | undefined, kind: ToolKind): number {
  if (!item) return 0;
  const t = equipInfo(item).tool;
  return t && t.kind === kind ? Math.max(1, t.power) : 0;
}

/** Fill in missing slots of older saves (they only had a main hand). */
export function normalizeEquipped(inv: InventoryState): void {
  const e = (inv.equipped ??= { weapon: null }) as Record<string, string | null | undefined>;
  for (const x of EQUIP_SLOTS) if (e[x] === undefined) e[x] = null;
}

/** Safe discard: refuses equipped items, and the last tool of a kind (gathering needs it). */
export function discardItem(inv: InventoryState, itemId: string): { ok: true; inventory: InventoryState } | Fail {
  const item = inv.items[itemId];
  if (!item) return fail('not_owned', 'Item is not in this inventory');
  if (slotOf(inv, itemId)) return fail('equipped', 'Unequip the item before discarding it');
  const kind = equipInfo(item).tool?.kind;
  if (kind && !Object.values(inv.items).some((o) => o.itemId !== itemId && toolPower(o, kind) > 0)) {
    return fail('last_tool', 'You need at least one tool of this kind for gathering');
  }
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
  const seen = new Set<string>();
  for (const slot of EQUIP_SLOTS) {
    const id = s.equipped?.[slot];
    if (!id) continue;
    const item = s.items[id];
    if (!item) return fail('equipped', 'Equipped item missing');
    if (!slotsFor(item).includes(slot)) return fail('equipped', `Item ${id} cannot be in ${slot}`);
    if (seen.has(id)) return fail('equipped', `Item ${id} is equipped twice`);
    seen.add(id);
  }
  if (s.equipped?.offhand && isTwoHanded(s, s.equipped.weapon)) return fail('equipped', 'Off-hand used with a two-handed weapon');
  if (s.scrolls !== undefined) {
    if (!s.scrolls || typeof s.scrolls !== 'object' || Object.keys(s.scrolls).length > MAX_SCROLLS) return fail('scrolls', 'Invalid blueprints');
    for (const [id, bp] of Object.entries(s.scrolls)) if (!validateBlueprint(bp)) return fail('scroll', `Invalid or tampered blueprint ${id}`);
  }
  if (s.learned !== undefined) {
    if (!s.learned || typeof s.learned !== 'object') return fail('learned', 'Invalid learned blueprints');
    for (const [id, bp] of Object.entries(s.learned)) if (!validateBlueprint(bp) || bp.id !== id) return fail('learned', `Invalid or tampered blueprint ${id}`);
  }
  return { ok: true };
}
