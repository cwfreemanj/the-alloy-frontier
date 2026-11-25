/** Merchant stock and quest grants (GDD 4.4 equipment-source balance). Atomic + idempotent. */
import { generateItem, hashHex, seedFrom, stableStringify, type ItemInstance, type MaterialId } from '@alloy/item-gen';
import { addMaterial, cloneInventory, fail, insertItem, nextItemId, type Fail, type InventoryState } from './inventory';

export interface StockEntry {
  id: string;
  kind: 'item' | 'material';
  name: string;
  price: number;
  blueprintId?: string;
  materialId?: MaterialId;
  quality?: number;
}

export const MERCHANT_ID = 'bram';
export const MERCHANT_STOCK: StockEntry[] = [
  { id: 'steel_longsword', kind: 'item', name: 'Shop Steel Longsword', price: 35, blueprintId: 'merchant_steel_longsword' },
  { id: 'binding_flux', kind: 'material', name: 'Binding Flux', price: 1, materialId: 'binding_flux', quality: 0.5 },
  { id: 'healing_salve', kind: 'material', name: 'Healing Salve', price: 8, materialId: 'healing_salve', quality: 0.4 },
];

const SUPPLIER = { id: 'npc-emberhold-supply', name: 'Emberhold Supply Co.', mastery: 0 };

/** A merchant item as it would be sold (fixed quality, Common, no customisation). */
export function merchantItem(itemId: string, seed: string, blueprintId: string, createdAt: number): ItemInstance {
  return generateItem({
    itemId,
    seed,
    blueprintId,
    source: 'merchant',
    mode: 'merchant',
    materials: [],
    bufferQuantity: 0,
    maker: SUPPLIER,
    fixedMaterialQuality: 0.5,
    createdAt,
  });
}

export function merchantPreview(entry: StockEntry): ItemInstance | null {
  if (entry.kind !== 'item' || !entry.blueprintId) return null;
  return merchantItem('preview', 'preview', entry.blueprintId, 0);
}

export interface BuyRequest {
  txId: string;
  stockId: string;
  quantity: number;
  createdAt: number;
}

export type BuyResult = { ok: true; inventory: InventoryState; item?: ItemInstance; duplicate: boolean } | Fail;

export function buy(inv: InventoryState, req: BuyRequest): BuyResult {
  if (!req || typeof req.txId !== 'string' || !req.txId) return fail('invalid_request', 'A transaction id is required');
  const { createdAt: _c, ...rest } = req;
  const hash = hashHex(stableStringify(rest));
  const prior = inv.journal.find((j) => j.txId === req.txId);
  if (prior) {
    if (prior.requestHash !== hash) return fail('tx_conflict', 'Transaction id reused with different contents');
    return { ok: true, inventory: inv, item: prior.itemId ? inv.items[prior.itemId] : undefined, duplicate: true };
  }
  const entry = MERCHANT_STOCK.find((s) => s.id === req.stockId);
  if (!entry) return fail('unknown_stock', 'The merchant does not sell that');
  const qty = req.quantity;
  if (!Number.isInteger(qty) || qty <= 0 || qty > (entry.kind === 'item' ? 1 : 999)) return fail('invalid_quantity', 'Invalid quantity');
  const cost = entry.price * qty;
  if (inv.coins < cost) return fail('insufficient_coins', `Costs ${cost} coins`);

  let draft = cloneInventory(inv);
  let item: ItemInstance | undefined;
  if (entry.kind === 'material' && entry.materialId) {
    const r = addMaterial(draft, { materialId: entry.materialId, quantity: qty, quality: entry.quality ?? 0.5, origin: `merchant:${MERCHANT_ID}` });
    if (!r.ok) return r;
    draft = r.inventory;
  } else if (entry.blueprintId) {
    const seed = seedFrom(inv.ownerId, 'buy', inv.seq.item + 1, entry.blueprintId);
    item = merchantItem(nextItemId(draft, seed), seed, entry.blueprintId, req.createdAt);
    insertItem(draft, item);
  }
  draft.coins -= cost;
  draft.journal.push({ txId: req.txId, kind: 'buy', requestHash: hash, at: req.createdAt, itemId: item?.itemId });
  return { ok: true, inventory: draft, item, duplicate: false };
}

/** Grant a quest/starting item exactly once per txId. */
export function grantItem(inv: InventoryState, txId: string, blueprintId: string, createdAt: number): BuyResult {
  const hash = hashHex(stableStringify({ txId, blueprintId }));
  const prior = inv.journal.find((j) => j.txId === txId);
  if (prior) return { ok: true, inventory: inv, item: prior.itemId ? inv.items[prior.itemId] : undefined, duplicate: true };
  const draft = cloneInventory(inv);
  const seed = seedFrom(inv.ownerId, 'grant', inv.seq.item + 1, blueprintId);
  const item = generateItem({
    itemId: nextItemId(draft, seed),
    seed,
    blueprintId,
    source: 'quest',
    mode: 'quest',
    materials: [],
    bufferQuantity: 0,
    maker: { id: 'npc-orla', name: 'Master Smith Orla', mastery: 0 },
    fixedMaterialQuality: 0.5,
    createdAt,
  });
  insertItem(draft, item);
  draft.journal.push({ txId, kind: 'grant', requestHash: hash, at: createdAt, itemId: item.itemId });
  return { ok: true, inventory: draft, item, duplicate: false };
}
