import { describe, expect, it } from 'vitest';
import { characterNameKey, checkCharacterName } from '../src';

describe('character names', () => {
  it('accepts letters with single spaces, apostrophes and hyphens, tidied', () => {
    expect(checkCharacterName('Kael')).toEqual({ ok: true, name: 'Kael' });
    expect(checkCharacterName('  Ser   Bryn ')).toEqual({ ok: true, name: 'Ser Bryn' });
    expect(checkCharacterName("O'Hara")).toEqual({ ok: true, name: "O'Hara" });
    expect(checkCharacterName('Anne-Marie')).toEqual({ ok: true, name: 'Anne-Marie' });
  });

  it('refuses too short, too long, odd characters, doubled punctuation and reserved names', () => {
    for (const bad of ['Al', 'A'.repeat(17), 'Neal99', '-Neal', 'Ne--al', "Ne' al", 'Neal-', 'orla', 'ADMIN', '', 42, null]) {
      expect(checkCharacterName(bad).ok).toBe(false);
    }
  });

  it('treats names that differ only by case or spacing as the same', () => {
    expect(characterNameKey('Kael  Ashford')).toBe(characterNameKey('kael ashford'));
  });
});
