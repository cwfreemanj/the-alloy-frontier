/**
 * Character session: durable state (inventory, progression, quest, world flags) and the
 * methods that change it. No Three.js / DOM dependencies, so the server can run it too.
 */
import {
  addMaterial,
  buy,
  createInventory,
  discardItem,
  equipWeapon,
  equippedWeapon,
  executeForge,
  grantItem,
  materialTotals,
  type ForgeRequest,
  type InventoryState,
} from '@alloy/crafting';
import {
  QUEST_EDGE_YOU_MAKE,
  addAdventurerXp,
  addSmithXp,
  addWeaponXp,
  applyQuestEvent,
  craftXp,
  createProgression,
  createQuestState,
  currentStep,
  type QuestEvent,
} from '@alloy/game-rules';
import { getBlueprint, materialName, type ItemInstance, type MaterialId } from '@alloy/item-gen';

export const PLAYER_ID = 'player-01';
export const PLAYER_NAME = 'You';

export type { NodeState, SessionData } from '@alloy/save';
import type { SessionData } from '@alloy/save';

export type SessionEvent =
  | { type: 'inventory' }
  | { type: 'progress'; kind: 'weapon' | 'smith' | 'adventurer'; levels: number }
  | { type: 'quest_step'; title: string; next: string | null }
  | { type: 'quest_complete' }
  | { type: 'toast'; text: string; tone?: 'info' | 'good' | 'warn' }
  | { type: 'equip'; item: ItemInstance };

export function newSessionData(now: number): SessionData {
  let inventory = createInventory(PLAYER_ID, 40);
  const flux = addMaterial(inventory, { materialId: 'binding_flux', quantity: 12, quality: 0.5, origin: 'starting-kit' });
  if (flux.ok) inventory = flux.inventory;
  return {
    version: 1,
    createdAt: now,
    playTime: 0,
    player: { x: 0, z: -4, yaw: 0, health: 200 },
    inventory,
    progression: createProgression(),
    quest: createQuestState(QUEST_EDGE_YOU_MAKE),
    world: { wardenDefeated: false, nodes: {}, introSeen: false },
    stats: { kills: {}, crafted: 0, deaths: 0, startedAt: now, completedAt: null },
    summary: null,
  };
}

export class Session {
  data: SessionData;
  private listeners: Array<(e: SessionEvent) => void> = [];
  private txCounter = 0;

  constructor(data: SessionData) {
    this.data = data;
    this.txCounter = data.inventory.journal.length + 1;
  }

  on(fn: (e: SessionEvent) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Announce an event to listeners (used to replay events the server reports). */
  notify(e: SessionEvent): void {
    this.emit(e);
  }

  nextTxId(kind: string): string {
    return `${kind}-${this.data.inventory.ownerId}-${Date.now().toString(36)}-${this.txCounter++}`;
  }

  get inventory(): InventoryState {
    return this.data.inventory;
  }
  get smithMastery(): number {
    return this.data.progression.professions.blacksmithing.mastery;
  }
  get weaponLevel(): number {
    return this.data.progression.weaponMastery.longsword.level;
  }
  equipped(): ItemInstance | null {
    return equippedWeapon(this.data.inventory);
  }
  totals(): Record<string, number> {
    return materialTotals(this.data.inventory);
  }
  step() {
    return currentStep(QUEST_EDGE_YOU_MAKE, this.data.quest);
  }

  private setInventory(inv: InventoryState): void {
    this.data.inventory = inv;
    this.emit({ type: 'inventory' });
    this.quest({ type: 'inventory', totals: this.totals() });
  }

  quest(ev: QuestEvent): void {
    const u = applyQuestEvent(QUEST_EDGE_YOU_MAKE, this.data.quest, ev, Date.now());
    if (u.completedSteps.length === 0) {
      // Partial progress (e.g. 3/5 iron ore) must be kept so the tracker can show it.
      const prev = this.data.quest.progress;
      const next = u.state.progress;
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      const changed = [...keys].some((k) => prev[k] !== next[k]);
      if (changed) {
        this.data.quest = u.state;
        if (ev.type === 'inventory') {
          const step = this.step();
          if (step?.objective.type === 'have') {
            const parts = Object.entries(step.objective.items)
              .filter(([k]) => (prev[k] ?? 0) !== (next[k] ?? 0))
              .map(([k, n]) => `${materialName(k as MaterialId)} ${next[k] ?? 0}/${n}`);
            if (parts.length) this.emit({ type: 'toast', text: `Quest: ${parts.join(', ')}`, tone: 'info' });
          }
        }
      }
      return;
    }
    this.data.quest = u.state;
    for (const s of u.completedSteps) {
      const next = this.step();
      this.emit({ type: 'quest_step', title: s.title, next: next?.title ?? null });
      this.gainAdventurer(40);
    }
    if (u.questCompleted) {
      this.data.stats.completedAt = Date.now();
      this.emit({ type: 'quest_complete' });
    }
    // A newly current step may already be satisfied by existing state.
    const s = this.step();
    if (s?.objective.type === 'have') this.quest({ type: 'inventory', totals: this.totals() });
    if (s?.id === 'equip') {
      const eq = this.equipped();
      if (eq && (eq.source === 'quick_forge' || eq.source === 'masterwork_forge')) this.quest({ type: 'event', event: 'equip_crafted' });
    }
  }

  /** Index of a step id in the main quest (for gating), or -1. */
  stepIndexOf(id: string): number {
    return QUEST_EDGE_YOU_MAKE.steps.findIndex((s) => s.id === id);
  }

  /** True once the quest has progressed past the given step. */
  passed(id: string): boolean {
    return this.data.quest.completed || this.data.quest.stepIndex > this.stepIndexOf(id);
  }

  gather(nodeId: string, material: MaterialId, quantity: number, quality: number, traits: Record<string, number>): boolean {
    const r = addMaterial(this.data.inventory, { materialId: material, quantity, quality, origin: nodeId, traits });
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return false;
    }
    this.setInventory(r.inventory);
    return true;
  }

  grantStarterWeapon(): void {
    const r = grantItem(this.data.inventory, 'grant-worn-longsword', 'worn_longsword', Date.now());
    if (!r.ok || !r.item) return;
    let inv = r.inventory;
    if (!inv.equipped.weapon) {
      const e = equipWeapon(inv, r.item.itemId, Date.now());
      if (e.ok) inv = e.inventory;
    }
    this.setInventory(inv);
    if (!r.duplicate) this.emit({ type: 'toast', text: `Received ${r.item.displayName}`, tone: 'good' });
    const eq = this.equipped();
    if (eq) this.emit({ type: 'equip', item: eq });
  }

  forge(req: Omit<ForgeRequest, 'maker' | 'createdAt'>): ReturnType<typeof executeForge> {
    const full: ForgeRequest = { ...req, maker: { id: PLAYER_ID, name: PLAYER_NAME, mastery: this.smithMastery }, createdAt: Date.now() };
    const r = executeForge(this.data.inventory, full);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return r;
    }
    if (r.duplicate) return r;
    this.data.inventory = r.inventory;
    this.data.stats.crafted++;
    const bp = getBlueprint(req.blueprintId)!;
    const xp = craftXp(req.mode === 'quick' ? bp.masteryXp.quick : bp.masteryXp.masterwork, req.mode, r.item.forge.forgeScore);
    const g = addSmithXp(this.data.progression, xp);
    this.data.progression = g.state;
    if (g.levelsGained > 0) this.emit({ type: 'progress', kind: 'smith', levels: g.levelsGained });
    this.emit({ type: 'toast', text: `+${xp} blacksmithing XP`, tone: 'good' });
    this.emit({ type: 'inventory' });
    this.quest({ type: 'event', event: req.mode === 'quick' ? 'craft_quick' : 'craft_masterwork' });
    return r;
  }

  buy(stockId: string, quantity: number) {
    const r = buy(this.data.inventory, { txId: this.nextTxId('buy'), stockId, quantity, createdAt: Date.now() });
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return r;
    }
    this.setInventory(r.inventory);
    return r;
  }

  equip(itemId: string): boolean {
    const r = equipWeapon(this.data.inventory, itemId, Date.now());
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return false;
    }
    this.data.inventory = r.inventory;
    const item = r.inventory.items[itemId];
    this.emit({ type: 'inventory' });
    this.emit({ type: 'equip', item });
    if (item.source === 'quick_forge' || item.source === 'masterwork_forge') this.quest({ type: 'event', event: 'equip_crafted' });
    return true;
  }

  discard(itemId: string): boolean {
    const r = discardItem(this.data.inventory, itemId);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return false;
    }
    this.setInventory(r.inventory);
    return true;
  }

  addCoins(n: number): void {
    if (!(n > 0)) return;
    this.data.inventory = { ...this.data.inventory, coins: this.data.inventory.coins + Math.floor(n) };
    this.emit({ type: 'inventory' });
  }

  gainWeaponXp(xp: number): void {
    if (!(xp > 0)) return;
    const g = addWeaponXp(this.data.progression, 'longsword', xp);
    this.data.progression = g.state;
    if (g.levelsGained > 0) this.emit({ type: 'progress', kind: 'weapon', levels: g.levelsGained });
  }

  gainAdventurer(xp: number): void {
    const g = addAdventurerXp(this.data.progression, xp);
    this.data.progression = g.state;
    if (g.levelsGained > 0) this.emit({ type: 'progress', kind: 'adventurer', levels: g.levelsGained });
  }

  recordKill(type: string): void {
    this.data.stats.kills[type] = (this.data.stats.kills[type] ?? 0) + 1;
    if (type === 'warden') this.data.world.wardenDefeated = true;
    this.quest({ type: 'kill', enemy: type });
  }

  talk(npc: string): void {
    const step = this.step();
    if (npc === 'orla' && step?.id === 'commission') this.grantStarterWeapon();
    if (npc === 'orla' && step?.id === 'report') {
      // Snapshot the best crafted weapon for the summary.
      const crafted = Object.values(this.data.inventory.items).filter((i) => i.source === 'masterwork_forge' || i.source === 'quick_forge');
      crafted.sort((a, b) => b.result.rating - a.result.rating);
      const eq = this.equipped();
      const best = eq && (eq.source === 'masterwork_forge' || eq.source === 'quick_forge') ? eq : crafted[0];
      this.data.summary = { itemId: best?.itemId ?? null, masteryAtStart: 10, weaponLevelAtStart: 1 };
      this.addCoins(25);
    }
    this.quest({ type: 'talk', npc });
  }
}
