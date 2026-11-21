/** Data-driven quest progression (GDD 5.3 "The Edge You Make"). */

export type QuestObjective =
  | { type: 'talk'; npc: string }
  | { type: 'kill'; enemy: string; count: number }
  | { type: 'have'; items: Record<string, number> }
  | { type: 'event'; event: string };

export interface QuestStepDef {
  id: string;
  title: string;
  description: string;
  objective: QuestObjective;
  /** World marker key for the objective tracker/minimap. */
  marker?: string;
}

export interface QuestDef {
  id: string;
  name: string;
  steps: QuestStepDef[];
}

export interface QuestState {
  questId: string;
  stepIndex: number;
  progress: Record<string, number>;
  completed: boolean;
  log: Array<{ stepId: string; at: number }>;
}

export type QuestEvent =
  | { type: 'talk'; npc: string }
  | { type: 'kill'; enemy: string }
  | { type: 'event'; event: string }
  | { type: 'inventory'; totals: Record<string, number> };

export const QUEST_EDGE_YOU_MAKE: QuestDef = {
  id: 'the_edge_you_make',
  name: 'The Edge You Make',
  steps: [
    { id: 'commission', title: 'A Smith\'s Commission', description: 'Speak with Master Smith Orla at the Emberhold forge.', objective: { type: 'talk', npc: 'orla' }, marker: 'orla' },
    { id: 'first_blood', title: 'Learn the Blade', description: 'Defeat an Ironwood Scavenger on the trail north of the village.', objective: { type: 'kill', enemy: 'scavenger', count: 1 }, marker: 'trail' },
    { id: 'gather', title: 'Raw Materials', description: 'Gather iron ore and ironwood on the trail, and ironglass in the quarry.', objective: { type: 'have', items: { iron_ore: 5, ironwood: 2, ironglass: 3 } }, marker: 'quarry' },
    { id: 'return', title: 'Back to the Anvil', description: 'Return to Orla at the forge.', objective: { type: 'talk', npc: 'orla' }, marker: 'orla' },
    { id: 'compare', title: 'Know the Market', description: 'Compare Bram\'s merchant stock with what you could forge.', objective: { type: 'event', event: 'open_merchant' }, marker: 'bram' },
    { id: 'quick_forge', title: 'Quick Forge', description: 'Forge a longsword at the anvil using Quick Forge.', objective: { type: 'event', event: 'craft_quick' }, marker: 'forge' },
    { id: 'masterwork', title: 'Masterwork', description: 'Forge a longsword in the Masterwork Forge (heat, hammer, temper).', objective: { type: 'event', event: 'craft_masterwork' }, marker: 'forge' },
    { id: 'equip', title: 'Your Own Edge', description: 'Equip a weapon you forged (Inventory: I).', objective: { type: 'event', event: 'equip_crafted' } },
    { id: 'foundry', title: 'The Dormant Foundry', description: 'Defeat the Foundry Warden in the ruins beyond the quarry.', objective: { type: 'kill', enemy: 'warden', count: 1 }, marker: 'foundry' },
    { id: 'report', title: 'The Edge You Made', description: 'Report to Orla.', objective: { type: 'talk', npc: 'orla' }, marker: 'orla' },
  ],
};

export const QUESTS: Record<string, QuestDef> = { [QUEST_EDGE_YOU_MAKE.id]: QUEST_EDGE_YOU_MAKE };

export function createQuestState(def: QuestDef): QuestState {
  return { questId: def.id, stepIndex: 0, progress: {}, completed: false, log: [] };
}

export function currentStep(def: QuestDef, s: QuestState): QuestStepDef | null {
  return s.completed ? null : (def.steps[s.stepIndex] ?? null);
}

function matches(obj: QuestObjective, ev: QuestEvent, progress: Record<string, number>): boolean {
  switch (obj.type) {
    case 'talk':
      return ev.type === 'talk' && ev.npc === obj.npc;
    case 'event':
      return ev.type === 'event' && ev.event === obj.event;
    case 'kill':
      if (ev.type !== 'kill' || ev.enemy !== obj.enemy) return false;
      progress[obj.enemy] = (progress[obj.enemy] ?? 0) + 1;
      return progress[obj.enemy] >= obj.count;
    case 'have':
      if (ev.type !== 'inventory') return false;
      for (const [k, n] of Object.entries(obj.items)) progress[k] = Math.min(n, ev.totals[k] ?? 0);
      return Object.entries(obj.items).every(([k, n]) => (ev.totals[k] ?? 0) >= n);
  }
}

export interface QuestUpdate {
  state: QuestState;
  completedSteps: QuestStepDef[];
  questCompleted: boolean;
}

/** Apply an event. Pure: returns a new state. Only the current step can advance. */
export function applyQuestEvent(def: QuestDef, s: QuestState, ev: QuestEvent, now: number): QuestUpdate {
  const state: QuestState = JSON.parse(JSON.stringify(s));
  const completedSteps: QuestStepDef[] = [];
  const step = currentStep(def, state);
  if (!step) return { state, completedSteps, questCompleted: false };
  if (matches(step.objective, ev, state.progress)) {
    completedSteps.push(step);
    state.log.push({ stepId: step.id, at: now });
    state.stepIndex++;
    state.progress = {};
    if (state.stepIndex >= def.steps.length) state.completed = true;
  }
  return { state, completedSteps, questCompleted: state.completed && completedSteps.length > 0 };
}

export function describeProgress(def: QuestDef, s: QuestState): string[] {
  const step = currentStep(def, s);
  if (!step) return [];
  const o = step.objective;
  if (o.type === 'kill') return [`${s.progress[o.enemy] ?? 0}/${o.count}`];
  if (o.type === 'have') return Object.entries(o.items).map(([k, n]) => `${k}:${s.progress[k] ?? 0}/${n}`);
  return [];
}
