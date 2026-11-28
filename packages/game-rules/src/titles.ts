/**
 * Titles (AF-027, docs/proficiency-tree.md): earned at a branch's levels, one shown above the name to
 * other players. STARTER names and levels for the creative director to change.
 */
import { branchLevel, type CraftBranch, type ProgressionState } from './progression';

export interface TitleDef {
  id: string;
  name: string;
  branch: CraftBranch;
  level: number;
}

export const TITLES: TitleDef[] = [
  { id: 'journeyman_smith', name: 'Journeyman Smith', branch: 'smithing', level: 25 },
  { id: 'forgewright', name: 'Forgewright', branch: 'smithing', level: 50 },
  { id: 'master_smith', name: 'Master Smith', branch: 'smithing', level: 100 },
  { id: 'artisan', name: 'Artisan', branch: 'crafting', level: 25 },
  { id: 'artificer', name: 'Artificer', branch: 'crafting', level: 50 },
  { id: 'master_crafter', name: 'Master Crafter', branch: 'crafting', level: 100 },
  { id: 'apothecary', name: 'Apothecary', branch: 'alchemy', level: 25 },
  { id: 'alchemist', name: 'Alchemist', branch: 'alchemy', level: 50 },
  { id: 'master_alchemist', name: 'Master Alchemist', branch: 'alchemy', level: 100 },
];

export const titleById = (id: string | null | undefined): TitleDef | undefined => (id ? TITLES.find((t) => t.id === id) : undefined);

/** Titles this character has earned (the branch level reached). */
export function earnedTitles(p: ProgressionState): TitleDef[] {
  return TITLES.filter((t) => branchLevel(p, t.branch) >= t.level);
}

/** The title shown above the name: the chosen one, if still earned. */
export function shownTitle(p: ProgressionState): TitleDef | undefined {
  const t = titleById(p.title);
  return t && branchLevel(p, t.branch) >= t.level ? t : undefined;
}

/** Show a title (null: none). In place. */
export function chooseTitle(p: ProgressionState, id: string | null): { ok: true; title: TitleDef | null } | { ok: false; error: string; message: string } {
  if (id === null) {
    p.title = null;
    return { ok: true, title: null };
  }
  const t = titleById(id);
  if (!t) return { ok: false, error: 'unknown_title', message: 'There is no such title.' };
  if (branchLevel(p, t.branch) < t.level) return { ok: false, error: 'not_earned', message: `${t.name} is earned at ${t.branch[0].toUpperCase()}${t.branch.slice(1)} ${t.level}.` };
  p.title = t.id;
  return { ok: true, title: t };
}
