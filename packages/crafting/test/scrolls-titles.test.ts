/** Selling scrolls (AF-022) and titles (AF-027). */
import { describe, expect, it } from 'vitest';
import { TITLES, chooseTitle, createProgression, earnedTitles, shownTitle } from '@alloy/game-rules';
import { generateBlueprint } from '@alloy/item-gen';
import { addScroll, createInventory, learnScroll, sellScroll } from '../src';

describe('selling scrolls', () => {
  it('pays the scroll’s worth, removes it, and keeps what was learned', () => {
    const bp = generateBlueprint('sell-1', { area: 'trail', source: 'enemy', sourceId: 'scavenger', level: 3 });
    const add = addScroll(createInventory('p1', 10), bp);
    if (!add.ok) throw new Error(add.message);
    const learned = learnScroll(add.inventory, add.scrollId);
    if (!learned.ok) throw new Error(learned.message);
    const sold = sellScroll(learned.inventory, add.scrollId);
    if (!sold.ok) throw new Error(sold.message);
    expect(sold.coins).toBe(bp.worth);
    expect(sold.inventory.coins).toBe(10 + bp.worth);
    expect(sold.inventory.scrolls?.[add.scrollId]).toBeUndefined();
    expect(sold.inventory.learned?.[bp.id]).toBeTruthy();
    expect(sellScroll(sold.inventory, add.scrollId)).toMatchObject({ ok: false, error: 'unknown_scroll' });
  });
});

describe('titles', () => {
  it('are earned at branch levels 25, 50 and 100, and only an earned one can be shown', () => {
    const p = createProgression(); // Smithing 10
    expect(earnedTitles(p)).toEqual([]);
    expect(chooseTitle(p, 'journeyman_smith')).toMatchObject({ ok: false, error: 'not_earned' });
    expect(chooseTitle(p, 'emperor')).toMatchObject({ ok: false, error: 'unknown_title' });
    p.professions.blacksmithing.mastery = 50;
    expect(earnedTitles(p).map((t) => t.id)).toEqual(['journeyman_smith', 'forgewright']);
    expect(chooseTitle(p, 'forgewright')).toMatchObject({ ok: true });
    expect(shownTitle(p)?.name).toBe('Forgewright');
    expect(chooseTitle(p, null)).toMatchObject({ ok: true, title: null });
    expect(shownTitle(p)).toBeUndefined();
    expect(TITLES.filter((t) => t.level === 100).map((t) => t.name)).toEqual(['Master Smith', 'Master Crafter', 'Master Alchemist']);
  });
});
