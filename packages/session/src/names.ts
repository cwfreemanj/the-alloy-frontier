/**
 * Character names: what other players see above a character and what tells an account's
 * characters apart. Shared by the browser (to check while typing) and the server (which decides,
 * and keeps names unique across all accounts).
 *
 * Rules: 3–16 characters; letters, single spaces, apostrophes and hyphens; starts with a letter;
 * no two spaces or punctuation marks in a row; not an NPC's or a staff-like name.
 */
export const CHARACTER_NAME_MIN = 3;
export const CHARACTER_NAME_MAX = 16;

const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'gm', 'gamemaster', 'staff', 'support', 'system', 'server', 'guest',
  'orla', 'bram', 'warden', 'emberhold', 'alloy', 'alloy frontier', 'character', 'player', 'unnamed',
]);

/** Trim and collapse inner whitespace (what the player meant to type). */
export function tidyCharacterName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** The tidied name if it's allowed, or why not. */
export function checkCharacterName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Choose a name for your character.' };
  const name = tidyCharacterName(raw);
  if (name.length < CHARACTER_NAME_MIN) return { ok: false, message: `Names need at least ${CHARACTER_NAME_MIN} letters.` };
  if (name.length > CHARACTER_NAME_MAX) return { ok: false, message: `Names can be at most ${CHARACTER_NAME_MAX} characters.` };
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(name)) return { ok: false, message: 'Use letters, with spaces, apostrophes or hyphens between them.' };
  if (/[' -]{2}/.test(name) || /[' -]$/.test(name)) return { ok: false, message: "Spaces, apostrophes and hyphens can't be doubled or end the name." };
  if (RESERVED.has(name.toLowerCase())) return { ok: false, message: 'That name is reserved.' };
  return { ok: true, name };
}

/** The key two names share if they count as the same name (case-insensitive). */
export const characterNameKey = (name: string): string => tidyCharacterName(name).toLowerCase();
