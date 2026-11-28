/**
 * Perk choices (docs/proficiency-tree.md, step 2): at every 10th level of a branch the player picks one
 * of two perks. Shared by the server and the browser; the server records choices and applies effects.
 *
 * The list is the creative director's call (STARTER values). A perk whose effect isn't built yet is
 * `ready: false`: shown as "coming soon", and its milestone isn't offered until both perks are ready.
 */
import { BRANCH_INFO, CRAFT_BRANCHES, branchLevel, type CraftBranch, type ProgressionState } from './progression';

export interface PerkDef {
  id: string;
  branch: CraftBranch;
  /** The milestone level that offers it. */
  level: number;
  name: string;
  description: string;
  ready: boolean;
}

export const PERKS: PerkDef[] = [
  { id: 'weaponsmith', branch: 'smithing', level: 10, name: 'Weaponsmith', description: 'Weapons you forge deal +5% damage.', ready: true },
  { id: 'armorsmith', branch: 'smithing', level: 10, name: 'Armorsmith', description: 'Armor and shields you forge have +8% defense.', ready: true },
  { id: 'flux_saver', branch: 'smithing', level: 20, name: 'Flux Saver', description: 'Every recipe needs 1 less Binding Flux.', ready: true },
  { id: 'masterwork_eye', branch: 'smithing', level: 20, name: 'Masterwork Eye', description: 'A better chance of a rarer result.', ready: true },
  { id: 'ironglass_adept', branch: 'smithing', level: 30, name: 'Ironglass Adept', description: 'Ironglass recipes need 3 fewer mastery levels.', ready: true },
  { id: 'steady_hands', branch: 'smithing', level: 30, name: 'Steady Hands', description: 'Masterwork forge quality +5%.', ready: true },
  { id: 'brewer', branch: 'alchemy', level: 10, name: 'Brewer', description: 'Potions you drink are 15% stronger.', ready: true },
  { id: 'distiller', branch: 'alchemy', level: 10, name: 'Distiller', description: 'Each brew makes one extra potion.', ready: true },
  { id: 'quick_hands', branch: 'alchemy', level: 20, name: 'Quick Hands', description: 'Potion cooldown 2 s shorter.', ready: true },
  { id: 'herbal_lore', branch: 'alchemy', level: 20, name: 'Herbal Lore', description: '+1 herb each time you pick.', ready: true },
  { id: 'cook', branch: 'alchemy', level: 30, name: 'Cook', description: 'Food lasts 50% longer.', ready: false },
  { id: 'enchanter', branch: 'alchemy', level: 30, name: 'Enchanter', description: 'May add a minor imbuement to forged gear.', ready: false },
  { id: 'jeweler', branch: 'crafting', level: 10, name: 'Jeweler', description: 'Rings and necklaces you craft roll one extra affix.', ready: true },
  { id: 'tailor', branch: 'crafting', level: 10, name: 'Tailor', description: 'Capes you craft gain +5 max stamina.', ready: true },
  { id: 'setwright', branch: 'crafting', level: 20, name: 'Setwright', description: 'Set bonuses need one fewer piece.', ready: false },
  { id: 'engraver', branch: 'crafting', level: 20, name: 'Engraver', description: 'Name and inscribe your gear.', ready: false },
  { id: 'dyer', branch: 'crafting', level: 30, name: 'Dyer', description: 'Recolour gear.', ready: false },
  { id: 'salvager', branch: 'crafting', level: 30, name: 'Salvager', description: 'Break down gear for some materials back.', ready: false },
];

/** The numbers behind the perks (applied where the thing happens: forge, brewing, potions, gathering). */
export const PERK_EFFECTS = {
  weaponsmithDamage: 1.05,
  armorsmithDefense: 1.08,
  fluxSaved: 1,
  masterworkEyeRarity: 0.05,
  ironglassLevels: 3,
  steadyHandsScore: 0.05,
  brewerStrength: 1.15,
  distillerExtra: 1,
  quickHandsSeconds: 2,
  herbalLoreExtra: 1,
  jewelerAffixes: 1,
  tailorStamina: 5,
} as const;

export const perkById = (id: string): PerkDef | undefined => PERKS.find((p) => p.id === id);
const key = (branch: CraftBranch, level: number) => `${branch}:${level}`;

/** A branch's milestones, in order, with their two perks. */
export function milestones(branch: CraftBranch): Array<{ level: number; perks: PerkDef[]; ready: boolean }> {
  const levels = [...new Set(PERKS.filter((p) => p.branch === branch).map((p) => p.level))].sort((a, b) => a - b);
  return levels.map((level) => {
    const perks = PERKS.filter((p) => p.branch === branch && p.level === level);
    return { level, perks, ready: perks.every((p) => p.ready) };
  });
}

/** The perk chosen at a milestone (undefined: not chosen). */
export function chosenAt(p: ProgressionState, branch: CraftBranch, level: number): string | undefined {
  return p.perks?.[key(branch, level)];
}

/** Every perk the character has chosen. */
export function chosenPerks(p: ProgressionState): string[] {
  return Object.values(p.perks ?? {});
}

export const hasPerk = (p: ProgressionState, id: string): boolean => chosenPerks(p).includes(id);

/** Milestones reached, ready and not chosen yet: choices waiting. */
export function pendingChoices(p: ProgressionState): Array<{ branch: CraftBranch; level: number }> {
  const out: Array<{ branch: CraftBranch; level: number }> = [];
  for (const b of CRAFT_BRANCHES) for (const m of milestones(b)) if (m.ready && branchLevel(p, b) >= m.level && !chosenAt(p, b, m.level)) out.push({ branch: b, level: m.level });
  return out;
}

/** Choose a perk (in place). */
export function choosePerk(p: ProgressionState, id: string): { ok: true; perk: PerkDef } | { ok: false; error: string; message: string } {
  const perk = typeof id === 'string' ? perkById(id) : undefined;
  if (!perk) return { ok: false, error: 'unknown_perk', message: 'There is no such perk.' };
  if (!perk.ready) return { ok: false, error: 'not_ready', message: `${perk.name} is coming soon.` };
  if (branchLevel(p, perk.branch) < perk.level) return { ok: false, error: 'level_too_low', message: `${perk.name} needs ${BRANCH_INFO[perk.branch].name} ${perk.level}.` };
  if (chosenAt(p, perk.branch, perk.level)) return { ok: false, error: 'already_chosen', message: `You've already chosen your ${BRANCH_INFO[perk.branch].name} ${perk.level} perk. Re-pick at Orla's.` };
  (p.perks ??= {})[key(perk.branch, perk.level)] = perk.id;
  return { ok: true, perk };
}

/** Coins to re-pick a branch's perks: 50, doubling each time (at most 6400). */
export function respecFee(p: ProgressionState, branch: CraftBranch): number {
  return 50 * 2 ** Math.min(7, p.perkRespecs?.[branch] ?? 0);
}

/** Clear a branch's choices (in place; the caller takes the fee). Returns how many were cleared. */
export function clearPerks(p: ProgressionState, branch: CraftBranch): number {
  let n = 0;
  for (const k of Object.keys(p.perks ?? {})) {
    if (!k.startsWith(`${branch}:`)) continue;
    delete p.perks![k];
    n++;
  }
  if (n) (p.perkRespecs ??= {})[branch] = (p.perkRespecs?.[branch] ?? 0) + 1;
  return n;
}
