import { describe, expect, it } from 'vitest';
import { ALCHEMY_QUALITY_PER_LEVEL, BRANCH_INFO, CRAFT_BRANCHES, addProficiencyXp, branchLevel, createProgression, nextMilestone } from '../src';

describe('proficiency tree: branches (docs/proficiency-tree.md)', () => {
  it('has Smithing, Crafting and Alchemy, rooted in mining, woodcutting and herbalism', () => {
    expect([...CRAFT_BRANCHES]).toEqual(['smithing', 'crafting', 'alchemy']);
    expect(Object.fromEntries(CRAFT_BRANCHES.map((b) => [b, BRANCH_INFO[b].root]))).toEqual({ smithing: 'mining', crafting: 'woodcutting', alchemy: 'herbalism' });
  });

  it('reads Smithing from blacksmithing mastery, and gives Crafting and Alchemy their own levels', () => {
    const p = createProgression();
    expect(branchLevel(p, 'smithing')).toBe(p.professions.blacksmithing.mastery);
    expect(branchLevel(p, 'alchemy')).toBe(1);
    expect(addProficiencyXp(p, 'alchemy', 500)).toBeGreaterThan(0);
    expect(branchLevel(p, 'alchemy')).toBeGreaterThan(1);
    expect(branchLevel(p, 'crafting')).toBe(1);
  });

  it('has a perk milestone every 10 levels, and Alchemy adds up to +0.4 potion quality', () => {
    expect([1, 9, 10, 11, 99].map(nextMilestone)).toEqual([10, 10, 20, 20, 100]);
    expect(ALCHEMY_QUALITY_PER_LEVEL * 99).toBeCloseTo(0.396, 3);
  });
});
