import { describe, expect, it } from 'vitest';
import {
  QUEST_EDGE_YOU_MAKE,
  addSmithXp,
  addWeaponXp,
  applyQuestEvent,
  craftXp,
  createProgression,
  createQuestState,
  currentStep,
  weaponXpForHit,
  type QuestEvent,
} from '../src';

describe('progression', () => {
  it('weapon and blacksmith mastery are separate', () => {
    const p = createProgression();
    const w = addWeaponXp(p, 'longsword', 1000).state;
    expect(w.weaponMastery.longsword.level).toBeGreaterThan(1);
    expect(w.professions.blacksmithing.mastery).toBe(p.professions.blacksmithing.mastery);
    const s = addSmithXp(p, 200).state;
    expect(s.professions.blacksmithing.mastery).toBeGreaterThan(10);
    expect(s.weaponMastery.longsword.level).toBe(1);
  });
  it('weapon mastery caps at 30; blacksmithing is open-ended', () => {
    expect(addWeaponXp(createProgression(), 'longsword', 1e9).state.weaponMastery.longsword.level).toBe(30);
    expect(addSmithXp(createProgression(), 1e6).state.professions.blacksmithing.mastery).toBeGreaterThan(100);
  });
  it('training dummies grant no weapon mastery (exploit guard)', () => {
    expect(weaponXpForHit('dummy', 50)).toBe(0);
    expect(weaponXpForHit('melee', 20)).toBeGreaterThan(0);
  });
  it('masterwork XP rewards forging quality', () => {
    expect(craftXp(60, 'masterwork', 1)).toBeGreaterThan(craftXp(60, 'masterwork', 0.2));
    expect(craftXp(60, 'quick', 1)).toBe(60);
  });
});

describe('quest: The Edge You Make', () => {
  const walkthrough: QuestEvent[] = [
    { type: 'talk', npc: 'orla' },
    { type: 'kill', enemy: 'scavenger' },
    { type: 'inventory', totals: { iron_ore: 5, ironwood: 2, ironglass: 3 } },
    { type: 'talk', npc: 'orla' },
    { type: 'event', event: 'open_merchant' },
    { type: 'event', event: 'craft_quick' },
    { type: 'event', event: 'craft_masterwork' },
    { type: 'event', event: 'equip_crafted' },
    { type: 'kill', enemy: 'warden' },
    { type: 'talk', npc: 'orla' },
  ];

  it('completes start to finish', () => {
    let s = createQuestState(QUEST_EDGE_YOU_MAKE);
    let done = false;
    walkthrough.forEach((ev, i) => {
      const u = applyQuestEvent(QUEST_EDGE_YOU_MAKE, s, ev, i);
      expect(u.completedSteps.length).toBe(1);
      s = u.state;
      done = u.questCompleted;
    });
    expect(done).toBe(true);
    expect(s.completed).toBe(true);
    expect(currentStep(QUEST_EDGE_YOU_MAKE, s)).toBeNull();
    expect(s.log).toHaveLength(QUEST_EDGE_YOU_MAKE.steps.length);
  });

  it('ignores out-of-order events', () => {
    let s = createQuestState(QUEST_EDGE_YOU_MAKE);
    s = applyQuestEvent(QUEST_EDGE_YOU_MAKE, s, { type: 'kill', enemy: 'warden' }, 0).state;
    s = applyQuestEvent(QUEST_EDGE_YOU_MAKE, s, { type: 'event', event: 'craft_quick' }, 0).state;
    expect(s.stepIndex).toBe(0);
  });

  it('tracks partial material progress', () => {
    let s = createQuestState(QUEST_EDGE_YOU_MAKE);
    s.stepIndex = 2;
    s = applyQuestEvent(QUEST_EDGE_YOU_MAKE, s, { type: 'inventory', totals: { iron_ore: 2, ironwood: 2, ironglass: 0 } }, 0).state;
    expect(s.stepIndex).toBe(2);
    expect(s.progress).toEqual({ iron_ore: 2, ironwood: 2, ironglass: 0 });
  });
});
