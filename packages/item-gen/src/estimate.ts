/**
 * Estimated stats for a blueprint (the creative director said yes on 2026-11-28): the range of its main
 * stat when made at a given skill level, from the worst craft (poorest materials, worst forge result) to the
 * best (finest materials, a perfect masterwork with the strongest specialization and temper). It uses the same
 * formulas as generate.ts. It leaves out what only the roll or the maker adds: rarity affixes and perks.
 */
import type { BlueprintDefinition } from './blueprints';
import { SPECIALIZATIONS, TEMPERS, bufferFactor, forgeFactor, materialFactor, sanitize, LIMITS, smithFactor } from './formulas';

export interface StatEstimate {
  stat: 'damage' | 'defense';
  low: number;
  high: number;
  /** The skill level the range is for. */
  level: number;
}

/** The range of a blueprint's damage (weapons) or defense (armor) at `level`; null for bonus-only pieces. */
export function estimateStats(bp: BlueprintDefinition, level: number = bp.masteryRequirement): StatEstimate | null {
  const armor = bp.baseDefense !== undefined;
  const base = armor ? bp.baseDefense! : bp.baseBonuses !== undefined ? 0 : bp.baseDamage;
  if (!(base > 0)) return null;
  const sf = smithFactor(level);
  const bf = bufferFactor(bp.buffer.min, bp.buffer.standardBatch);
  const masterwork = bp.modes.includes('masterwork');
  const quick = bp.modes.includes('quick') || !masterwork;
  // The forge result: Quick is always 1; a Masterwork runs from a failed puzzle to a perfect one.
  const ffLow = Math.min(quick ? 1 : Infinity, masterwork ? forgeFactor('masterwork', 0) : Infinity);
  const ffHigh = masterwork ? forgeFactor('masterwork', 1) : 1;
  // Weapons only: a Masterwork's specialization and temper change damage too.
  let modLow = 1;
  let modHigh = 1;
  if (!armor && masterwork) {
    const specs = bp.allowedSpecializations.length ? bp.allowedSpecializations.map((s) => SPECIALIZATIONS[s].mod.damage ?? 1) : [1];
    const tempers = Object.values(TEMPERS).map((t) => t.mod.damage ?? 1);
    modHigh = Math.max(...specs) * Math.max(...tempers);
    modLow = Math.min(quick ? 1 : Infinity, Math.min(...specs) * Math.min(...tempers));
  }
  const at = (mf: number, ff: number, mod: number) => Math.max(1, Math.round(Math.min(LIMITS.maxStat, sanitize(base, LIMITS.maxStat) * sf * mf * bf * ff * mod)));
  return { stat: armor ? 'defense' : 'damage', low: at(materialFactor(0), ffLow, modLow), high: at(materialFactor(1), ffHigh, modHigh), level };
}
