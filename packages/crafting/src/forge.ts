/**
 * Forge transactions (GDD 4.2, 6.4; AF-005, AF-006).
 *
 * 1. Validate recipe existence and requirements.
 * 2. Confirm ownership of sufficient materials.
 * 3. Compute a deterministic item result.
 * 4. Commit material consumption and item creation as one logical transaction.
 * 5. Record the item (journal) so progression/UI can update.
 * 6. Reject invalid or repeated requests without losing materials or duplicating items.
 */
import {
  LIMITS,
  SPECIALIZATIONS,
  TEMPERS,
  generateItem,
  hashHex,
  seedFrom,
  stableStringify,
  type BlueprintDefinition,
  type ConsumedMaterial,
  type ForgeMode,
  type ForgeStageResult,
  type HeatLevel,
  type ItemInstance,
  type Specialization,
  type TemperStrategy,
} from '@alloy/item-gen';
import {
  applyConsumption,
  cloneInventory,
  fail,
  insertItem,
  nextItemId,
  planConsumption,
  type Fail,
  type InventoryState,
  resolveBlueprint,
} from './inventory';
import { HEAT_LEVELS, createHammerBoard, evaluateHammerEvidence, type HammerBoard, type HammerEvaluation, type Strike } from './puzzle';

export interface ForgeRequest {
  /** Idempotency key. Repeating the same request returns the original result. */
  txId: string;
  blueprintId: string;
  mode: ForgeMode;
  bufferQuantity: number;
  specialization?: Specialization;
  temper?: TemperStrategy;
  /** Masterwork evidence: the authority replays this, it never trusts a client score. */
  evidence?: { heat: HeatLevel; strikes: Strike[] };
  maker: { id: string; name: string; mastery: number };
  createdAt: number;
}

export interface ForgePlan {
  blueprint: BlueprintDefinition;
  consumed: ConsumedMaterial[];
  bufferConsumed: ConsumedMaterial[];
  item: ItemInstance;
  hammer?: HammerEvaluation;
}

export type PlanResult = { ok: true; plan: ForgePlan } | Fail;
export type ForgeResult = { ok: true; inventory: InventoryState; item: ItemInstance; duplicate: boolean; plan?: ForgePlan } | Fail;

/** Puzzle board for the NEXT forge in this inventory. Derived from authority state, not client choice. */
export function boardFor(inv: InventoryState, blueprintId: string): HammerBoard {
  return createHammerBoard(seedFrom(inv.ownerId, 'board', inv.seq.item + 1, blueprintId));
}

export function itemSeedFor(inv: InventoryState, blueprintId: string): string {
  return seedFrom(inv.ownerId, 'item', inv.seq.item + 1, blueprintId);
}

export function requestHash(req: ForgeRequest): string {
  // Only client-specified content: createdAt and the maker snapshot are supplied by the authority.
  const { createdAt: _ignored, maker: _maker, ...rest } = req;
  return hashHex(stableStringify(rest));
}

/** Validate and compute a forge result WITHOUT mutating anything (used for previews too). */
export function planForge(inv: InventoryState, req: ForgeRequest, opts: { previewScore?: number } = {}): PlanResult {
  if (!req || typeof req !== 'object') return fail('invalid_request', 'Malformed request');
  const bp = resolveBlueprint(inv, req.blueprintId);
  if (!bp) return fail('unknown_blueprint', `Unknown blueprint "${String(req.blueprintId)}"`);
  if (!bp.craftable) return fail('not_craftable', `${bp.name} cannot be forged`);
  if (req.mode !== 'quick' && req.mode !== 'masterwork') return fail('invalid_mode', 'Unknown forge mode');
  if (!bp.modes.includes(req.mode)) return fail('mode_not_allowed', `${bp.name} cannot be made with this mode`);
  const mastery = req.maker?.mastery;
  if (!Number.isFinite(mastery) || mastery < 0 || mastery > LIMITS.maxMastery) return fail('invalid_mastery', 'Invalid mastery');
  if (mastery < bp.masteryRequirement) {
    return fail('mastery_too_low', `${bp.name} requires blacksmithing mastery ${bp.masteryRequirement}`);
  }
  const buffer = req.bufferQuantity;
  if (!Number.isInteger(buffer) || buffer < bp.buffer.min || buffer > LIMITS.maxBufferQuantity) {
    return fail('invalid_buffer', `Buffer must be a whole number between ${bp.buffer.min} and ${LIMITS.maxBufferQuantity}`);
  }
  const spec: Specialization = req.mode === 'masterwork' ? (req.specialization ?? 'balanced') : 'balanced';
  if (!Object.prototype.hasOwnProperty.call(SPECIALIZATIONS, spec) || !bp.allowedSpecializations.includes(spec)) {
    return fail('invalid_specialization', 'Specialization not allowed for this blueprint');
  }
  if (req.mode === 'quick' && req.specialization && req.specialization !== 'balanced') {
    return fail('invalid_specialization', 'Quick Forge produces the standard (Balanced) pattern only');
  }
  const temper: TemperStrategy = req.mode === 'masterwork' ? (req.temper ?? 'oil') : 'none';
  if (!Object.prototype.hasOwnProperty.call(TEMPERS, temper) || (req.mode === 'masterwork' && temper === 'none')) {
    return fail('invalid_temper', 'Choose a tempering strategy');
  }

  // Materials (best quality first).
  const consumed: ConsumedMaterial[] = [];
  for (const r of bp.materials) {
    const plan = planConsumption(inv, r.materialId, r.quantity);
    if (!plan) return fail('insufficient_materials', `Not enough ${r.materialId} (need ${r.quantity})`);
    consumed.push(...plan);
  }
  const bufferConsumed = planConsumption(inv, bp.buffer.materialId, buffer);
  if (!bufferConsumed) return fail('insufficient_buffer', `Not enough ${bp.buffer.materialId} (need ${buffer})`);

  const stages: ForgeStageResult[] = [];
  let score = 0.5;
  let hammer: HammerEvaluation | undefined;
  if (req.mode === 'masterwork') {
    if (opts.previewScore !== undefined) {
      score = Math.max(0, Math.min(1, opts.previewScore));
    } else {
      if (!req.evidence) return fail('missing_evidence', 'Masterwork forging requires completing the forge sequence');
      if (!Object.prototype.hasOwnProperty.call(HEAT_LEVELS, req.evidence.heat)) return fail('invalid_evidence', 'Unknown heat level');
      const board = boardFor(inv, bp.id);
      hammer = evaluateHammerEvidence(board, req.evidence.heat, req.evidence.strikes, mastery);
      if (!hammer.ok) return fail('invalid_evidence', 'Forge evidence could not be replayed');
      score = hammer.score;
      const heat = HEAT_LEVELS[req.evidence.heat];
      stages.push({ stage: 'heating', label: heat.name, detail: heat.description });
      stages.push({
        stage: 'hammering',
        label: `${Math.round(score * 100)}% structure`,
        quality: Math.round(score * 1000) / 1000,
        detail: `Relieved ${hammer.initialStress - hammer.remainingStress}/${hammer.initialStress} stress in ${hammer.strikesUsed}/${hammer.strikesAllowed} strikes, ${hammer.overworks} overwork(s).`,
      });
    }
    stages.push({ stage: 'tempering', label: TEMPERS[temper].name, detail: TEMPERS[temper].description });
  }

  const seed = itemSeedFor(inv, bp.id);
  let item: ItemInstance;
  try {
    item = generateItem({
      itemId: nextItemId(inv, seed),
      seed,
      blueprintId: bp.id,
      // A learned found blueprint isn't in the standard table: hand its definition over.
      blueprint: bp,
      source: req.mode === 'quick' ? 'quick_forge' : 'masterwork_forge',
      mode: req.mode,
      materials: consumed,
      bufferQuantity: buffer,
      maker: { id: req.maker.id, name: req.maker.name, mastery },
      forgeScore: score,
      specialization: spec,
      temper,
      stages,
      createdAt: Number.isFinite(req.createdAt) ? req.createdAt : 0,
    });
  } catch (e) {
    return fail('generation_failed', (e as Error).message);
  }
  return { ok: true, plan: { blueprint: bp, consumed, bufferConsumed, item, hammer } };
}

/** Execute a forge transaction atomically and idempotently. */
export function executeForge(inv: InventoryState, req: ForgeRequest): ForgeResult {
  if (!req || typeof req.txId !== 'string' || req.txId.length === 0 || req.txId.length > 128) {
    return fail('invalid_request', 'A transaction id is required');
  }
  const hash = requestHash(req);
  const prior = inv.journal.find((j) => j.txId === req.txId);
  if (prior) {
    if (prior.requestHash !== hash || prior.kind !== 'forge') return fail('tx_conflict', 'Transaction id reused with different contents');
    const item = prior.itemId ? inv.items[prior.itemId] : undefined;
    if (!item) return fail('tx_conflict', 'Original transaction result is no longer present');
    return { ok: true, inventory: inv, item, duplicate: true };
  }
  const planned = planForge(inv, req);
  if (!planned.ok) return planned;
  const { plan } = planned;
  const draft = cloneInventory(inv);
  try {
    applyConsumption(draft, [...plan.consumed, ...plan.bufferConsumed]);
    insertItem(draft, plan.item);
  } catch (e) {
    return fail('commit_failed', (e as Error).message);
  }
  draft.journal.push({ txId: req.txId, kind: 'forge', requestHash: hash, at: req.createdAt, itemId: plan.item.itemId });
  return { ok: true, inventory: draft, item: plan.item, duplicate: false, plan };
}

/**
 * Forecast for the forge UI: the result at the chosen buffer and the marginal effect of
 * adding one more standard batch (GDD 4.12, 7.3).
 */
export function forecastBuffer(inv: InventoryState, req: ForgeRequest, previewScore?: number) {
  const bp = resolveBlueprint(inv, req.blueprintId);
  if (!bp) return null;
  const opts = req.mode === 'masterwork' ? { previewScore: previewScore ?? 0.5 } : {};
  const at = (q: number) => {
    const r = planForge(inv, { ...req, bufferQuantity: q }, opts);
    return r.ok ? r.plan.item : null;
  };
  return {
    min: at(bp.buffer.min),
    chosen: at(req.bufferQuantity),
    plusBatch: at(req.bufferQuantity + bp.buffer.standardBatch),
  };
}
