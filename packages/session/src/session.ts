/**
 * Character session: durable state (inventory, progression, quest, world flags) and the
 * methods that change it. No Three.js / DOM dependencies, so the server can run it too.
 */
import {
  BREWS,
  POTION_COOLDOWN,
  brew as brewInventory,
  consume as consumeInventory,
  addMaterial,
  buy,
  createInventory,
  discardItem,
  addScroll,
  discardScroll,
  learnScroll,
  resolveBlueprint,
  equipItem,
  equipWeapon,
  equippedItems,
  equippedWeapon,
  normalizeEquipped,
  toolPower,
  unequip,
  type EquipSlot,
  executeForge,
  grantItem,
  materialTotals,
  type ForgeRequest,
  type InventoryState,
} from '@alloy/crafting';
import {
  QUEST_EDGE_YOU_MAKE,
  ATTRIBUTE_XP,
  ALLOCATED_MAX,
  addAttributeXp,
  SKILL_BAR_SIZE,
  learnedSkills,
  normalizeSkillBar,
  type SkillDef,
  addProficiencyXp,
  type ProficiencyId,
  ALCHEMY_QUALITY_PER_LEVEL,
  ALCHEMY_XP_PER_POTION,
  BRANCH_INFO,
  PERK_EFFECTS,
  branchLevel,
  choosePerk,
  chosenPerks,
  clearPerks,
  hasPerk,
  pendingChoices,
  perkById,
  respecFee,
  type CraftBranch,
  isWeaponFamily,
  attributeBonuses,
  attributeTotals,
  earnedStatPoints,
  normalizeAllocated,
  normalizeAttributes,
  spentStatPoints,
  type AttributeBonuses,
  type AttributeId,
  type AttributeLevels,
  type AttributeState,
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
import { RARITY_LABEL, materialName, type GeneratedBlueprint, type ItemInstance, type MaterialId, type ToolKind, type WeaponFamily } from '@alloy/item-gen';

export const PLAYER_ID = 'player-01';
export const PLAYER_NAME = 'You';

export type { NodeState, SessionData } from '@alloy/save';
import type { SessionData } from '@alloy/save';

export type SessionEvent =
  | { type: 'inventory' }
  /** Stat points were spent or refunded. */
  | { type: 'stats' }
  /** A combat skill was learned (it was put on the skill bar if there was room). */
  | { type: 'skill_learned'; skill: string }
  /** The skill bar changed. */
  | { type: 'skillbar' }
  /** A potion was used: the browser applies the heal / stamina (health is client-owned). */
  | { type: 'consumed'; item: string; heal: number; stamina: number }
  | { type: 'progress'; kind: 'weapon' | 'smith' | 'adventurer' | 'attribute' | 'proficiency'; levels: number; attr?: AttributeId; family?: WeaponFamily; proficiency?: ProficiencyId }
  | { type: 'quest_step'; title: string; next: string | null }
  | { type: 'quest_complete' }
  | { type: 'toast'; text: string; tone?: 'info' | 'good' | 'warn' }
  /** A container was searched (the browser opens its lid / plays a sound). */
  | { type: 'searched'; id: string; found: boolean }
  /** The main-hand weapon changed (null: empty hand). */
  | { type: 'equip'; item: ItemInstance | null };

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
    data.progression.attributes = normalizeAttributes(data.progression.attributes);
    data.progression.allocated = normalizeAllocated(data.progression.allocated);
    normalizeEquipped(data.inventory);
    this.ensureStarterTools();
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
  /** The equipped weapon's family (null: unarmed or not a weapon family). */
  get weaponFamily(): WeaponFamily | null {
    const f = this.equipped()?.family;
    return f && isWeaponFamily(f) ? f : null;
  }
  /** Mastery level of a weapon family (1 if never used). */
  masteryOf(family: WeaponFamily): number {
    return this.data.progression.weaponMastery[family]?.level ?? 1;
  }
  /** Mastery level of the equipped weapon's family (1 unarmed). */
  get weaponLevel(): number {
    const f = this.weaponFamily;
    return f ? this.masteryOf(f) : 1;
  }
  get attributes(): AttributeState {
    return (this.data.progression.attributes ??= normalizeAttributes(undefined));
  }
  /** Stat points spent per attribute. */
  get allocated(): AttributeLevels {
    return (this.data.progression.allocated ??= normalizeAllocated(undefined));
  }
  /** Attribute bonuses from equipped gear. */
  gearAttributes(): AttributeLevels {
    const out = normalizeAllocated(undefined);
    for (const { item } of equippedItems(this.data.inventory)) {
      for (const [k, v] of Object.entries(item.result.bonuses?.attributes ?? {})) {
        if (k in out && Number.isFinite(v) && v > 0) out[k as AttributeId] += Math.floor(v);
      }
    }
    return out;
  }
  /** One total per attribute: trained level + allocated points + gear. */
  attributeTotals(): AttributeLevels {
    const t = attributeTotals(this.attributes, this.allocated);
    const g = this.gearAttributes();
    for (const id of Object.keys(t) as AttributeId[]) t[id] += g[id];
    return t;
  }
  /** Every equipped item with its slot. */
  gear() {
    return equippedItems(this.data.inventory);
  }
  /** Power of the equipped tool for a kind of gathering (0 = none). */
  toolPower(kind: ToolKind): number {
    const id = this.data.inventory.equipped.tool;
    return toolPower(id ? this.data.inventory.items[id] : null, kind);
  }
  /**
   * Gathering needs tools: every character owns at least a basic pickaxe and hatchet
   * (granted once if missing, e.g. characters made before tools existed).
   */
  private ensureStarterTools(): void {
    const at = this.data.createdAt || Date.now();
    for (const [kind, bp] of [['mining', 'worn_pickaxe'], ['woodcutting', 'worn_hatchet']] as const) {
      const inv = this.data.inventory;
      if (Object.values(inv.items).some((i) => toolPower(i, kind) > 0)) continue;
      const r = grantItem(inv, `grant-starter-${bp}`, bp, at);
      if (r.ok) this.data.inventory = r.inventory;
    }
    const inv = this.data.inventory;
    if (!inv.equipped.tool) {
      const pick = Object.values(inv.items).find((i) => toolPower(i, 'mining') > 0);
      if (pick) {
        const e = equipItem(inv, pick.itemId, at, 'tool');
        if (e.ok) this.data.inventory = e.inventory;
      }
    }
  }
  /** Stat points earned (3 per adventurer rank) and not yet spent. */
  get unspentPoints(): number {
    return Math.max(0, earnedStatPoints(this.data.progression.adventurer.rank) - spentStatPoints(this.allocated));
  }
  /** What the character's attributes add (damage, crit, max health, max stamina). */
  bonuses(): AttributeBonuses {
    return attributeBonuses(this.attributeTotals());
  }
  /** Spend stat points on one attribute. */
  allocate(id: AttributeId, n: number): { ok: true } | { ok: false; error: string; message: string } {
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'invalid_quantity', message: 'Invalid number of points.' };
    if (n > this.unspentPoints) return { ok: false, error: 'no_points', message: 'Not enough stat points.' };
    if (this.allocated[id] + n > ALLOCATED_MAX) return { ok: false, error: 'attribute_cap', message: `At most ${ALLOCATED_MAX} points can go into one attribute.` };
    this.allocated[id] += n;
    this.emit({ type: 'stats' });
    return { ok: true };
  }
  /** Refund every spent stat point (free for now). */
  respec(): number {
    const n = spentStatPoints(this.allocated);
    this.data.progression.allocated = normalizeAllocated(undefined);
    if (n > 0) this.emit({ type: 'stats' });
    return n;
  }
  /** Grow attributes by use; announces each level-up. */
  gainAttributes(gains: Array<[AttributeId, number]>): void {
    for (const [id, xp] of gains) {
      const levels = addAttributeXp(this.attributes, id, xp);
      if (levels > 0) this.emit({ type: 'progress', kind: 'attribute', attr: id, levels });
    }
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
    // The maker, perks included, comes from this character, never from the request.
    const full: ForgeRequest = { ...req, maker: { id: PLAYER_ID, name: PLAYER_NAME, mastery: this.smithMastery, perks: chosenPerks(this.data.progression) }, createdAt: Date.now() };
    const r = executeForge(this.data.inventory, full);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return r;
    }
    if (r.duplicate) return r;
    this.data.inventory = r.inventory;
    this.data.stats.crafted++;
    const bp = resolveBlueprint(this.data.inventory, req.blueprintId)!;
    const xp = craftXp(req.mode === 'quick' ? bp.masteryXp.quick : bp.masteryXp.masterwork, req.mode, r.item.forge.forgeScore);
    const g = addSmithXp(this.data.progression, xp);
    this.data.progression = g.state;
    if (g.levelsGained > 0) this.emit({ type: 'progress', kind: 'smith', levels: g.levelsGained });
    if (g.levelsGained > 0) this.announcePerkChoices('smithing');
    this.gainAttributes(ATTRIBUTE_XP.forge());
    this.emit({ type: 'toast', text: `+${xp} blacksmithing XP`, tone: 'good' });
    this.emit({ type: 'inventory' });
    // The quest asks for a forged weapon: armor and shields don't count.
    if (isWeaponFamily(bp.family)) this.quest({ type: 'event', event: req.mode === 'quick' ? 'craft_quick' : 'craft_masterwork' });
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

  /** Equip an item into its slot (rings: ring1/ring2 may be chosen). */
  equip(itemId: string, slot?: EquipSlot): boolean {
    const before = this.data.inventory.equipped.weapon;
    const r = equipItem(this.data.inventory, itemId, Date.now(), slot);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return false;
    }
    this.data.inventory = r.inventory;
    const item = r.inventory.items[itemId];
    this.emit({ type: 'inventory' });
    if (r.inventory.equipped.weapon !== before) this.emit({ type: 'equip', item: this.equipped() });
    if (r.slot === 'weapon' && (item.source === 'quick_forge' || item.source === 'masterwork_forge')) this.quest({ type: 'event', event: 'equip_crafted' });
    return true;
  }

  /** Empty a slot; the item stays in the inventory. */
  unequip(slot: EquipSlot): boolean {
    const r = unequip(this.data.inventory, slot);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return false;
    }
    this.data.inventory = r.inventory;
    this.emit({ type: 'inventory' });
    if (slot === 'weapon') this.emit({ type: 'equip', item: null });
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

  /** A found blueprint goes in the bag (docs/blueprint-contract.md). Returns the scroll id, or null. */
  addBlueprint(bp: GeneratedBlueprint): string | null {
    const r = addScroll(this.data.inventory, bp);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return null;
    }
    this.setInventory(r.inventory);
    const known = this.data.inventory.learned?.[bp.id] ? ' (already learned)' : '';
    this.emit({ type: 'toast', text: `Found a blueprint: ${bp.name} (${RARITY_LABEL[bp.rarity]})${known}. Learn it in your inventory (I).`, tone: 'good' });
    return r.scrollId;
  }

  /** Learn a scroll's blueprint; the scroll stays. */
  learnScroll(scrollId: string): boolean {
    const r = learnScroll(this.data.inventory, scrollId);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: r.error === 'already_learned' ? 'info' : 'warn' });
      return false;
    }
    this.setInventory(r.inventory);
    this.emit({ type: 'toast', text: `Learned ${r.blueprint.name}. It is in the forge now.`, tone: 'good' });
    return true;
  }

  /** Throw a scroll away (a learned blueprint stays learned). */
  discardScroll(scrollId: string): boolean {
    const r = discardScroll(this.data.inventory, scrollId);
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

  /** Weapon mastery XP goes to the equipped weapon's family (none unarmed). */
  gainWeaponXp(xp: number): void {
    const family = this.weaponFamily;
    if (!(xp > 0) || !family) return;
    const before = this.learnedSkills().map((x) => x.id);
    const g = addWeaponXp(this.data.progression, family, xp);
    this.data.progression = g.state;
    if (g.levelsGained > 0) this.emit({ type: 'progress', kind: 'weapon', levels: g.levelsGained, family });
    // New skills from a mastery milestone go on the bar's first free slot.
    for (const sk of this.learnedSkills()) {
      if (before.includes(sk.id)) continue;
      const bar = this.skillBar;
      const free = bar.indexOf(null);
      if (free >= 0) {
        bar[free] = sk.id;
        this.data.progression.skillBar = bar;
      }
      this.emit({ type: 'skill_learned', skill: sk.id });
    }
  }

  /** Skills learned at weapon mastery milestones. */
  learnedSkills(): SkillDef[] {
    return learnedSkills(this.data.progression.weaponMastery);
  }
  /** Learned skills usable now (they need their weapon family in hand). */
  usableSkills(): string[] {
    const f = this.weaponFamily;
    return this.learnedSkills()
      .filter((x) => x.family === f)
      .map((x) => x.id);
  }
  /** The skill bar (keys 1-4), cleaned against what is learned. */
  get skillBar(): Array<string | null> {
    return normalizeSkillBar(this.data.progression.skillBar, this.learnedSkills().map((x) => x.id));
  }
  /** Put a learned skill in a skill bar slot (or empty it); a skill moves if it was elsewhere. */
  setSkillBar(slot: number, skill: string | null): { ok: true } | { ok: false; error: string; message: string } {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SKILL_BAR_SIZE) return { ok: false, error: 'invalid_slot', message: 'Invalid skill slot.' };
    if (skill !== null && !this.learnedSkills().some((x) => x.id === skill)) return { ok: false, error: 'not_learned', message: 'You have not learned that skill.' };
    const bar = this.skillBar.map((x) => (x === skill ? null : x));
    bar[slot] = skill;
    this.data.progression.skillBar = bar;
    this.emit({ type: 'skillbar' });
    return { ok: true };
  }

  /** Brew herbs into potions (trains Herbalism). */
  brew(recipe: string, qty: number): { ok: true } | { ok: false; error: string; message: string } {
    // Alchemy (docs/proficiency-tree.md): each level above 1 makes stronger potions; brewing trains it.
    const level = branchLevel(this.data.progression, 'alchemy');
    const extra = hasPerk(this.data.progression, 'distiller') ? PERK_EFFECTS.distillerExtra : 0;
    const r = brewInventory(this.data.inventory, recipe, qty, ALCHEMY_QUALITY_PER_LEVEL * (level - 1), extra);
    if (!r.ok) return r;
    this.setInventory(r.inventory);
    this.gainProficiency('alchemy', ALCHEMY_XP_PER_POTION * qty);
    this.emit({ type: 'toast', text: `Brewed ${r.made} ${BREWS[recipe as keyof typeof BREWS].name}${r.made > 1 ? 's' : ''} (quality ${Math.round(r.quality * 100)}%)${extra ? ' · Distiller +1' : ''} · +${ALCHEMY_XP_PER_POTION * qty} Alchemy XP`, tone: 'good' });
    return { ok: true };
  }

  /** Seconds until the next potion may be used (0 = ready). */
  get potionCooldown(): number {
    return Math.max(0, (this.data.player.potionReadyAt ?? 0) - this.data.playTime);
  }

  /** Use a potion: one at a time, POTION_COOLDOWN seconds apart. */
  consume(id: string): { ok: true } | { ok: false; error: string; message: string } {
    if (this.potionCooldown > 0) return { ok: false, error: 'cooldown', message: `Wait ${Math.ceil(this.potionCooldown)}s before the next potion.` };
    const r = consumeInventory(this.data.inventory, id);
    if (!r.ok) return r;
    this.setInventory(r.inventory);
    // Quick Hands: a shorter cooldown. Brewer: stronger potions.
    const p = this.data.progression;
    this.data.player.potionReadyAt = this.data.playTime + POTION_COOLDOWN - (hasPerk(p, 'quick_hands') ? PERK_EFFECTS.quickHandsSeconds : 0);
    const k = hasPerk(p, 'brewer') ? PERK_EFFECTS.brewerStrength : 1;
    this.emit({ type: 'consumed', item: id, heal: Math.round(r.effect.heal * k), stamina: Math.round(r.effect.stamina * k) });
    return { ok: true };
  }

  /** Proficiency XP: gathering (mining, woodcutting, herbalism) or a leveled branch (crafting, alchemy). */
  gainProficiency(id: ProficiencyId, xp: number): void {
    const levels = addProficiencyXp(this.data.progression, id, xp);
    if (levels > 0) this.emit({ type: 'progress', kind: 'proficiency', proficiency: id, levels });
    if (levels > 0 && (id === 'alchemy' || id === 'crafting')) this.announcePerkChoices(id);
  }

  /** Tell the player a perk choice is waiting in a branch (after a level-up). */
  private announcePerkChoices(branch: CraftBranch): void {
    const waiting = pendingChoices(this.data.progression).filter((c) => c.branch === branch);
    if (waiting.length) this.emit({ type: 'toast', text: `A ${BRANCH_INFO[branch].name} perk choice is waiting (I → Proficiencies).`, tone: 'good' });
  }

  /** Choose a perk at a reached milestone. */
  choosePerk(id: string): boolean {
    const r = choosePerk(this.data.progression, id);
    if (!r.ok) {
      this.emit({ type: 'toast', text: r.message, tone: 'warn' });
      return false;
    }
    this.emit({ type: 'stats' });
    this.emit({ type: 'toast', text: `Perk chosen: ${r.perk.name}. ${r.perk.description}`, tone: 'good' });
    return true;
  }

  /** Re-pick a branch's perks: costs coins (doubling each time); the choices open again. */
  respecPerks(branch: CraftBranch): boolean {
    const p = this.data.progression;
    if (!chosenPerks(p).some((id) => perkById(id)?.branch === branch)) {
      this.emit({ type: 'toast', text: `No ${BRANCH_INFO[branch].name} perks to re-pick.`, tone: 'warn' });
      return false;
    }
    const fee = respecFee(p, branch);
    if (this.data.inventory.coins < fee) {
      this.emit({ type: 'toast', text: `Re-picking ${BRANCH_INFO[branch].name} perks costs ${fee} coins.`, tone: 'warn' });
      return false;
    }
    this.data.inventory = { ...this.data.inventory, coins: this.data.inventory.coins - fee };
    clearPerks(p, branch);
    this.emit({ type: 'inventory' });
    this.emit({ type: 'stats' });
    this.emit({ type: 'toast', text: `Orla resets your ${BRANCH_INFO[branch].name} perks for ${fee} coins. Choose again.`, tone: 'good' });
    return true;
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
