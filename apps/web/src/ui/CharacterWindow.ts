/**
 * The character screens: one full-screen window with a top bar and four screens.
 * - Character: the live 3D model framed by the equipment slots, attributes, stats, records.
 * - Inventory: item grid, materials, and the selected item's details.
 * - Proficiencies: what improves by doing it (weapon masteries, blacksmithing, gathering).
 * - Skills: combat abilities (attacks and weapon abilities).
 * Everything shown comes from the session and the shared rules (no numbers of its own).
 */
import { averageQuality, equipInfo, materialTotal, slotOf, slotsFor, type EquipSlot } from '@alloy/crafting';
import {
  ADVENTURER_RANK_MAX,
  ALLOCATED_MAX,
  ATTACKS,
  ATTRIBUTES,
  ATTRIBUTE_IDS,
  ATTRIBUTE_MAX,
  DAMAGE_TYPE_NAMES,
  GATHERING_PROFICIENCIES,
  PROFICIENCY_MAX,
  PROFICIENCY_YIELD_BONUS,
  WEAPON_FAMILIES,
  WEAPON_MASTERY_MAX,
  SKILLS,
  isSkill,
  adventurerXpToNext,
  attributeXpToNext,
  proficiencyXpToNext,
  smithXpToNext,
  weaponXpToNext,
  type AttributeId,
  type GatheringProficiency,
} from '@alloy/game-rules';
import { RARITY_ORDER, getBlueprint, itemDisplayName, materialName, type ItemInstance, type WeaponFamily } from '@alloy/item-gen';
import { characterStats, weaponDamageType, type Session } from '../state/Session';
import { RARITY_COLORS } from '../entities/Weapons';
import type { PlayerCharacterId } from '../entities/models/Characters';
import { CharacterPreview } from './CharacterPreview';
import { clear, h } from './dom';
import { icon } from './icons';
import { drawSword, provenanceText, sourceLabel, statTable, traitsBlock } from './ItemView';

export type CharacterTab = 'character' | 'inventory' | 'proficiencies' | 'skills';
const TABS: Array<{ id: CharacterTab; label: string }> = [
  { id: 'character', label: 'Character' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'proficiencies', label: 'Proficiencies' },
  { id: 'skills', label: 'Skills' },
];
type SortKey = 'rating' | 'recent' | 'name' | 'rarity';

const SLOT_DEFS: Record<EquipSlot, { label: string; icon: string }> = {
  head: { label: 'Head', icon: 'head' },
  shoulders: { label: 'Shoulders', icon: 'shoulders' },
  neck: { label: 'Neck', icon: 'neck' },
  cape: { label: 'Cape', icon: 'cape' },
  chest: { label: 'Chest', icon: 'chest' },
  belt: { label: 'Belt', icon: 'belt' },
  hands: { label: 'Hands', icon: 'hands' },
  legs: { label: 'Legs', icon: 'legs' },
  feet: { label: 'Feet', icon: 'feet' },
  ring1: { label: 'Ring', icon: 'ring' },
  ring2: { label: 'Ring', icon: 'ring' },
  tool: { label: 'Tool', icon: 'tool' },
  weapon: { label: 'Main hand', icon: 'weapon' },
  offhand: { label: 'Off-hand', icon: 'offhand' },
};
export const SLOT_LABEL: Record<EquipSlot, string> = Object.fromEntries(Object.entries(SLOT_DEFS).map(([k, v]) => [k, v.label])) as Record<EquipSlot, string>;
/** The paper doll: a column each side of the model, hands below. */
const LEFT_SLOTS: EquipSlot[] = ['head', 'cape', 'chest', 'hands', 'ring1', 'ring2'];
const RIGHT_SLOTS: EquipSlot[] = ['shoulders', 'neck', 'belt', 'legs', 'feet', 'tool'];

const ATTACK_KEYS: Record<string, string> = { light1: 'LMB / J', light2: 'LMB / J', light3: 'LMB / J', heavy: 'F / K', guardbreaker: 'R', storm_arc: 'G' };
const ATTACK_INFO: Record<string, { icon: string; text: string }> = {
  light1: { icon: 'slash', text: 'A quick opening cut. Chains into Light II.' },
  light2: { icon: 'slash', text: 'A second cut, a little stronger. Chains into Light III.' },
  light3: { icon: 'slash', text: 'The finishing swing of the combo: more damage and stagger, a longer lunge.' },
  heavy: { icon: 'heavy', text: 'A slow, committed blow that staggers hard.' },
  guardbreaker: { icon: 'guard', text: "Breaks an enemy's guard and staggers them badly." },
  storm_arc: { icon: 'storm', text: 'Discharge the ironglass edge in a ring of lightning around you. Needs a weapon imbued with Storm Arc.' },
};
const PROF_INFO: Record<GatheringProficiency, { name: string; icon: string; grows: string }> = {
  mining: { name: 'Mining', icon: 'mining', grows: 'Grows from mining ore and ironglass.' },
  woodcutting: { name: 'Woodcutting', icon: 'woodcutting', grows: 'Grows from cutting ironwood.' },
  herbalism: { name: 'Herbalism', icon: 'herbalism', grows: 'Grows from gathering herbs (none grow in Emberhold yet).' },
};
const MIN_GRID_CELLS = 30;

const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
const bar = (cur: number, max: number, label: string, maxed = false) =>
  h(
    'div',
    { class: 'xpbar', title: maxed ? 'Maximum' : `${Math.floor(cur)} / ${max} XP` },
    h('div', { class: 'xpbar-fill', style: `width:${maxed ? 100 : Math.max(0, Math.min(100, (cur / max) * 100))}%` }),
    h('span', null, label),
  );
const playTime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
/** A titled panel with ornate corners. */
const panel = (title: string, ic: string, ...children: Array<Node | string | null>) =>
  h('section', { class: 'cs-panel' }, h('header', { class: 'cs-panel-head' }, icon(ic, 'cs-panel-ico'), h('h2', null, title)), h('div', { class: 'cs-panel-body' }, ...children));
const sub = (title: string) => h('h3', { class: 'cs-sub' }, h('span', { class: 'cs-diamond' }), title);
/** One "label ... value" stat line with an icon. */
const statRow = (ic: string, label: string, value: string, note = '', vClass = '') =>
  h('div', { class: 'cs-stat', title: note }, icon(ic), h('span', { class: 'cs-stat-label' }, label), h('span', { class: `cs-stat-val ${vClass}`, 'data-stat': label }, value));

/** Armor and bonus lines of an item (defense, max health/stamina, attributes), if it has any. */
function gearLine(item: ItemInstance): HTMLElement | null {
  const r = item.result;
  const parts: string[] = [];
  if (r.defense) parts.push(`+${r.defense} defense`);
  if (r.bonuses?.maxHealth) parts.push(`+${r.bonuses.maxHealth} max health`);
  if (r.bonuses?.maxStamina) parts.push(`+${r.bonuses.maxStamina} max stamina`);
  for (const [k, v] of Object.entries(r.bonuses?.attributes ?? {})) if (v) parts.push(`+${v} ${k}`);
  const tool = equipInfo(item).tool;
  if (tool) parts.push(`${tool.kind === 'mining' ? 'Mining' : 'Woodcutting'} tool, power ${tool.power}`);
  return parts.length ? h('div', { class: 'cs-gear-line', 'data-testid': 'gear-line' }, parts.join(' · ')) : null;
}

export class CharacterWindow {
  readonly el = h('div', { class: 'cs', role: 'dialog', 'aria-label': 'Character' });
  private selected: string | null;
  private sort: SortKey = 'rating';
  private confirmDiscard = false;
  /** True while a points request is with the authority (buttons are disabled meanwhile). */
  private busy = false;
  private preview: CharacterPreview | null = null;
  private previewWeapon: string | null | undefined = undefined;
  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const i = TABS.findIndex((t) => t.id === this.tab);
    if (e.code === 'KeyQ') this.show(TABS[(i + TABS.length - 1) % TABS.length].id);
    else if (e.code === 'KeyE') this.show(TABS[(i + 1) % TABS.length].id);
  };

  constructor(
    private session: Session,
    public tab: CharacterTab,
    private name: string,
    private character: PlayerCharacterId,
    private onClose: () => void,
    private onEquip: (id: string) => void,
    private onUnequip: (slot: EquipSlot) => void,
    /** Asks the authority (server for accounts, this browser for guests); true when done. */
    private onDiscard: (id: string) => Promise<boolean>,
    private onAllocate: (attr: AttributeId, n: number) => Promise<unknown>,
    private onRespec: () => Promise<unknown>,
    private onSkillBar: (slot: number, skill: string | null) => Promise<unknown>,
  ) {
    this.selected = session.inventory.equipped.weapon ?? session.inventory.itemOrder[0] ?? null;
    window.addEventListener('keydown', this.onKey);
    this.render();
  }

  /** Release the 3D view and key handler (the game calls this when the window closes). */
  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.preview?.dispose();
    this.preview = null;
  }

  show(tab: CharacterTab): void {
    this.tab = tab;
    this.confirmDiscard = false;
    this.render();
  }

  private spend(req: () => Promise<unknown>): void {
    if (this.busy) return;
    this.busy = true;
    this.render();
    void req().finally(() => {
      this.busy = false;
      this.render();
    });
  }

  render(): void {
    clear(this.el);
    const s = this.session;
    const tabs = h(
      'nav',
      { class: 'cs-tabs', role: 'tablist' },
      h('span', { class: 'cs-tab cs-tab-name' }, icon('emblem'), this.name),
      ...TABS.map((t) =>
        h(
          'button',
          { class: `cs-tab ${this.tab === t.id ? 'active' : ''}`, role: 'tab', 'aria-selected': String(this.tab === t.id), 'data-testid': `tab-${t.id}`, onclick: () => this.show(t.id) },
          icon(t.id),
          t.label,
        ),
      ),
    );
    const top = h(
      'div',
      { class: 'cs-top' },
      h('div', { class: 'cs-brand' }, icon('emblem', 'cs-brand-ico'), h('div', null, h('div', { class: 'cs-brand-name' }, 'Alloy Frontier'), h('div', { class: 'cs-brand-sub' }, 'Fantasy · Tech MMORPG'))),
      tabs,
      h(
        'div',
        { class: 'cs-top-right' },
        h('span', { class: 'cs-coins', title: 'Coins' }, icon('coin'), String(s.inventory.coins)),
        h('span', { class: 'cs-hint' }, 'Q / E switch · I or Esc close'),
        h('button', { class: 'cs-close', onclick: this.onClose, 'aria-label': 'Close', title: 'Close (I or Esc)' }, icon('close')),
      ),
    );
    const body = this.tab === 'character' ? this.characterScreen() : this.tab === 'inventory' ? this.inventoryScreen() : this.tab === 'proficiencies' ? this.proficienciesScreen() : this.skillsScreen();
    if (this.tab !== 'character' && this.preview) {
      this.preview.dispose();
      this.preview = null;
    }
    this.el.append(h('div', { class: 'cs-frame', 'data-testid': 'character-window', 'data-tab': this.tab }, top, h('main', { class: `cs-main cs-${this.tab}` }, body)));
  }

  // ---------------- Character ----------------
  private characterScreen(): HTMLElement {
    const s = this.session;
    const st = characterStats(s);
    const inv = s.inventory;
    const eq = s.equipped();
    const p = s.data.progression;
    const twoHanded = !!eq && equipInfo(eq).hands === 2;

    // The 3D model (kept across redraws; rebuilt when the weapon changes).
    const weaponId = inv.equipped.weapon ?? null;
    if (!this.preview || this.previewWeapon !== weaponId) {
      this.preview?.dispose();
      this.preview = new CharacterPreview(this.character, eq);
      this.previewWeapon = weaponId;
    }

    const slot = (id: EquipSlot, big = false) => {
      const itemId = inv.equipped[id];
      const item = itemId ? (inv.items[itemId] ?? null) : null;
      const blocked = id === 'offhand' && twoHanded;
      const d = SLOT_DEFS[id];
      const cell = h(
        'button',
        {
          class: `cs-slot ${big ? 'big' : ''} ${blocked ? 'locked' : ''} ${item ? 'filled' : ''}`,
          'data-slot': id,
          title: item ? `${itemDisplayName(item)} (click for details)` : blocked ? 'Your two-handed weapon uses both hands' : `${d.label}: empty. Equip from the Inventory.`,
          style: item ? `--rarity:${RARITY_COLORS[item.result.rarity]}` : '',
          onclick: () => {
            if (blocked) return;
            if (item) this.selected = item.itemId;
            this.show('inventory');
          },
        },
      );
      if (item) {
        const c = h('canvas', { class: 'cs-slot-art' });
        cell.append(c, h('span', { class: 'cs-slot-name' }, itemDisplayName(item)));
        requestAnimationFrame(() => drawSword(c, item));
      } else cell.append(icon(d.icon, 'cs-slot-ico'), h('span', { class: 'cs-slot-empty' }, blocked ? 'Two-handed' : 'Empty'));
      cell.append(h('span', { class: 'cs-slot-label' }, d.label));
      return cell;
    };
    const rank = p.adventurer.rank;
    const rankMax = rank >= ADVENTURER_RANK_MAX;
    const rankNext = adventurerXpToNext(rank);
    const header = h(
      'div',
      { class: 'cs-hero' },
      h('div', { class: 'cs-hero-badge' }, icon('emblem')),
      h(
        'div',
        { class: 'cs-hero-text' },
        h('div', { class: 'row' }, h('span', { class: 'cs-hero-name' }, this.name), h('span', { class: 'spacer' }), h('span', { class: 'cs-hero-level' }, `Lv. ${rank}`)),
        bar(p.adventurer.xp, rankNext, rankMax ? 'MAX' : `Adventurer rank ${rank} · ${Math.floor(p.adventurer.xp)} / ${rankNext}`, rankMax),
      ),
    );
    const doll = h(
      'div',
      { class: 'cs-doll' },
      h('div', { class: 'cs-doll-col' }, ...LEFT_SLOTS.map((x) => slot(x))),
      h('div', { class: 'cs-doll-model' }, this.preview.canvas, h('div', { class: 'cs-doll-hint' }, 'Drag to turn')),
      h('div', { class: 'cs-doll-col' }, ...RIGHT_SLOTS.map((x) => slot(x))),
      h('div', { class: 'cs-doll-hands' }, slot('weapon', true), slot('offhand', true)),
    );

    // Attributes
    const totals = s.attributeTotals();
    const gearAttr = s.gearAttributes();
    const unspent = s.unspentPoints;
    const spent = ATTRIBUTE_IDS.reduce((n, id) => n + s.allocated[id], 0);
    const attrs = h('div', { class: 'cs-attrs' });
    for (const id of ATTRIBUTE_IDS) {
      const a = s.attributes[id];
      const pts = s.allocated[id];
      const def = ATTRIBUTES[id];
      const maxed = a.level >= ATTRIBUTE_MAX;
      const next = attributeXpToNext(a.level);
      const canAdd = !this.busy && unspent > 0 && pts < ALLOCATED_MAX;
      attrs.append(
        h(
          'div',
          { class: 'cs-attr', 'data-attr': id, title: `Grows from: ${def.grows}.\n${def.effect}.` },
          icon(id, 'cs-attr-ico'),
          h(
            'div',
            { class: 'cs-attr-main' },
            h('div', { class: 'row' }, h('b', null, def.name), h('span', { class: 'spacer' }), h('span', { class: 'cs-attr-total', 'data-testid': `attr-${id}` }, String(totals[id]))),
            bar(a.xp, next, maxed ? 'TRAINED MAX' : `Training ${Math.floor(a.xp)} / ${next}`, maxed),
            h('div', { class: 'cs-attr-split', 'data-testid': `attr-split-${id}` }, `${a.level} trained + ${pts} allocated${gearAttr[id] ? ` + ${gearAttr[id]} gear` : ''} · ${def.effect}`),
          ),
          h(
            'button',
            {
              class: 'cs-plus',
              'data-testid': `add-${id}`,
              disabled: !canAdd,
              title: unspent === 0 ? 'No stat points to spend' : pts >= ALLOCATED_MAX ? `At most ${ALLOCATED_MAX} points per attribute` : `Spend a point on ${def.name} (Shift: 5)`,
              onclick: (ev: MouseEvent) => this.spend(() => this.onAllocate(id, Math.min(ev.shiftKey ? 5 : 1, unspent, ALLOCATED_MAX - pts))),
            },
            '+',
          ),
        ),
      );
    }
    const points = h(
      'div',
      { class: 'cs-points' },
      h('span', null, 'Stat points: ', h('b', { class: unspent > 0 ? 'ember' : '', 'data-testid': 'unspent-points' }, String(unspent))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'cs-btn small', 'data-testid': 'respec', disabled: this.busy || spent === 0, title: 'Refund every spent point (free for now)', onclick: () => this.spend(() => this.onRespec()) }, 'Reset'),
    );

    const w = st.weapon;
    const kills = Object.entries(s.data.stats.kills).filter(([k]) => k !== 'dummy');
    const stats = h(
      'div',
      { class: 'cs-stats' },
      statRow('health', 'Max health', String(st.maxHealth), 'Vitality + gear'),
      statRow('stamina', 'Max stamina', String(st.maxStamina), 'Endurance + gear'),
      statRow('defense', 'Defense', String(st.defense), `Gear: hits land ${Math.round((100 * 100) / (100 + st.defense))}% as hard`),
      statRow('damage', 'Weapon damage', w.damage.toFixed(1), eq ? 'Equipped weapon' : 'Unarmed'),
      statRow('slash', 'Damage type', DAMAGE_TYPE_NAMES[weaponDamageType(s)], s.weaponFamily ? WEAPON_FAMILIES[s.weaponFamily].name : 'Fists'),
      statRow('heavy', 'Damage bonus', `+${pct(st.damageBonus)}`, 'Mastery + Strength'),
      statRow('crit', 'Critical chance', pct(w.critChance, 1), 'Weapon + Dexterity'),
      statRow('speed', 'Attack speed', `${w.attackSpeed.toFixed(2)}×`),
      statRow('stagger', 'Stagger', w.stagger.toFixed(1)),
      statRow('stamina', 'Stamina cost', `${w.staminaCostMultiplier.toFixed(2)}×`),
    );
    const records = h(
      'div',
      { class: 'cs-stats' },
      statRow('enemies', 'Enemies defeated', String(kills.reduce((n, [, v]) => n + v, 0))),
      statRow('forge', 'Items forged', String(s.data.stats.crafted)),
      statRow('deaths', 'Deaths', String(s.data.stats.deaths)),
      statRow('time', 'Play time', playTime(s.data.playTime)),
      statRow('coin', 'Coins', String(inv.coins), '', 'ember'),
    );

    return h(
      'div',
      { class: 'cs-cols cs-cols-char' },
      panel('Character', 'character', header, doll),
      panel(
        'Attributes',
        'proficiencies',
        h('div', { class: 'cs-note' }, 'Each attribute is what you trained by use plus the points you spent. You earn 3 points per adventurer rank.'),
        points,
        attrs,
      ),
      panel('Stats', 'damage', stats, sub('Records'), records),
    );
  }

  // ---------------- Inventory ----------------
  private inventoryScreen(): HTMLElement {
    const inv = this.session.inventory;
    const items = inv.itemOrder.map((id) => inv.items[id]).filter(Boolean);
    const sorted = [...items].sort((a, b) => {
      if (this.sort === 'rating') return b.result.rating - a.result.rating;
      if (this.sort === 'name') return itemDisplayName(a).localeCompare(itemDisplayName(b));
      if (this.sort === 'rarity') return RARITY_ORDER.indexOf(b.result.rarity) - RARITY_ORDER.indexOf(a.result.rarity);
      return b.createdAt - a.createdAt;
    });
    const sortSel = h('select', { class: 'cs-select', 'aria-label': 'Sort items' }, ...(['rating', 'recent', 'name', 'rarity'] as SortKey[]).map((k) => h('option', { value: k, selected: k === this.sort }, `Sort: ${k}`))) as HTMLSelectElement;
    sortSel.addEventListener('change', () => ((this.sort = sortSel.value as SortKey), this.render()));

    const grid = h('div', { class: 'cs-grid' });
    for (const it of sorted) grid.append(this.tile(it));
    for (let i = sorted.length; i < Math.max(MIN_GRID_CELLS, Math.ceil(sorted.length / 6) * 6); i++) grid.append(h('div', { class: 'cs-tile empty', 'aria-hidden': 'true' }));

    const mats = h('div', { class: 'cs-stats' });
    for (const id of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux'] as const) {
      const q = averageQuality(inv, id);
      mats.append(
        h('div', { class: 'cs-stat' }, icon(id === 'ironwood' ? 'woodcutting' : id === 'binding_flux' ? 'storm' : 'mining'), h('span', { class: 'cs-stat-label' }, materialName(id)), h('span', { class: 'cs-stat-val' }, String(materialTotal(inv, id))), h('span', { class: 'cs-stat-q' }, q === null ? '—' : `q ${Math.round(q * 100)}%`)),
      );
    }
    const lots = inv.lots.map((l) => h('div', { class: 'cs-note' }, `${l.quantity}× ${materialName(l.materialId)} · quality ${Math.round(l.quality * 100)}% · from ${l.origin}`));
    return h(
      'div',
      { class: 'cs-cols cs-cols-inv' },
      panel(
        'Inventory',
        'inventory',
        h('div', { class: 'row cs-inv-bar' }, h('span', null, `Items (${items.length})`), h('span', { class: 'spacer' }), sortSel),
        items.length === 0 ? h('div', { class: 'cs-note' }, 'No equipment yet. Speak with Orla at the forge.') : null,
        grid,
        sub('Materials'),
        mats,
        h('details', { class: 'cs-lots' }, h('summary', null, `Material lots (${inv.lots.length})`), ...lots),
      ),
      this.detail(),
    );
  }

  private tile(it: ItemInstance): HTMLElement {
    const c = h('canvas', { class: 'cs-tile-art' });
    const inSlot = slotOf(this.session.inventory, it.itemId);
    const t = h(
      'button',
      {
        class: `cs-tile ${it.itemId === this.selected ? 'selected' : ''}`,
        'data-item': it.itemId,
        title: `${itemDisplayName(it)} · rating ${it.result.rating} · ${sourceLabel(it)}`,
        style: `--rarity:${RARITY_COLORS[it.result.rarity]}`,
        onclick: () => {
          this.selected = it.itemId;
          this.confirmDiscard = false;
          this.render();
        },
      },
      c,
      h('span', { class: 'cs-tile-rating' }, String(it.result.rating)),
      inSlot ? h('span', { class: 'cs-tile-eq', title: `Equipped (${SLOT_LABEL[inSlot]})` }, 'E') : null,
    );
    requestAnimationFrame(() => drawSword(c, it));
    return t;
  }

  private detail(): HTMLElement {
    const inv = this.session.inventory;
    const sel = this.selected ? inv.items[this.selected] : null;
    if (!sel) return panel('Item', 'inventory', h('div', { class: 'cs-note' }, 'Select an item to see its details.'));
    const canvas = h('canvas', { class: 'cs-item-art' });
    const inSlot = slotOf(inv, sel.itemId);
    const isEq = inSlot !== null;
    const target = slotsFor(sel)[0];
    const isWeapon = target === 'weapon';
    const otherId = target === 'ring1' ? (inv.equipped.ring1 ?? inv.equipped.ring2) : inv.equipped[target];
    const other = !isEq && otherId ? (inv.items[otherId] ?? null) : null;
    const discard = this.confirmDiscard
      ? h(
          'span',
          { class: 'row' },
          h('span', { class: 'bad small' }, 'Discard permanently?'),
          h(
            'button',
            {
              class: 'cs-btn small',
              onclick: () =>
                void this.onDiscard(sel.itemId).then((ok) => {
                  if (ok) this.selected = null;
                  this.confirmDiscard = false;
                  this.render();
                }),
            },
            'Yes, discard',
          ),
          h('button', { class: 'cs-btn small', onclick: () => ((this.confirmDiscard = false), this.render()) }, 'Keep'),
        )
      : h('button', { class: 'cs-btn', disabled: isEq, title: isEq ? 'Unequip it before discarding' : '', onclick: () => ((this.confirmDiscard = true), this.render()) }, 'Discard');
    const equipBtn = inSlot
      ? h('button', { class: 'cs-btn', 'data-testid': 'inv-unequip', title: `Take it off (${SLOT_LABEL[inSlot]})`, onclick: () => (this.onUnequip(inSlot), this.render()) }, `Unequip (${SLOT_LABEL[inSlot]})`)
      : h('button', { class: 'cs-btn primary', 'data-testid': 'inv-equip', onclick: () => (this.onEquip(sel.itemId), this.render()) }, `Equip (${SLOT_LABEL[target]})`);
    const fam = sel.family in WEAPON_FAMILIES ? WEAPON_FAMILIES[sel.family as WeaponFamily].name : 'Tool';
    const made = sel.forge.mode === 'quick' || sel.forge.mode === 'masterwork' ? ` · mastery ${sel.forge.mastery}` : '';
    requestAnimationFrame(() => drawSword(canvas, sel));
    return h(
      'section',
      { class: 'cs-panel cs-item', style: `--rarity:${RARITY_COLORS[sel.result.rarity]}` },
      h('header', { class: 'cs-panel-head' }, icon('inventory', 'cs-panel-ico'), h('h2', null, 'Item')),
      h(
        'div',
        { class: 'cs-panel-body' },
        h('span', { class: 'cs-rarity' }, sel.result.rarity.toUpperCase()),
        h('div', { class: 'cs-item-name' }, itemDisplayName(sel)),
        h('div', { class: 'cs-note' }, `${fam} · ${sourceLabel(sel)} · ${getBlueprint(sel.blueprintId)?.tier ?? ''}${made}`),
        h('div', { class: 'cs-item-stage' }, canvas),
        traitsBlock(sel),
        gearLine(sel),
        isWeapon ? sub(other ? `Compared with ${itemDisplayName(other)}` : 'Statistics') : null,
        isWeapon ? statTable(sel, other) : null,
        sub('Provenance'),
        h('div', { class: 'prov' }, provenanceText(sel)),
      ),
      h('footer', { class: 'cs-item-actions' }, equipBtn, discard),
    );
  }

  // ---------------- Proficiencies ----------------
  private proficienciesScreen(): HTMLElement {
    const s = this.session;
    const p = s.data.progression;
    const row = (testid: string, ic: string, name: string, level: string, b: HTMLElement, note: string, active = false) =>
      h(
        'div',
        { class: `cs-prof ${active ? 'active' : ''}`, 'data-testid': testid },
        h('div', { class: 'cs-prof-ico' }, icon(ic)),
        h('div', { class: 'cs-prof-main' }, h('div', { class: 'row' }, h('b', null, name), h('span', { class: 'spacer' }), h('span', { class: 'cs-prof-level' }, level)), b, h('div', { class: 'cs-note' }, note)),
      );

    // Combat: the family in hand plus any trained before; the rest by name.
    const families = Object.keys(WEAPON_FAMILIES) as WeaponFamily[];
    const trained = (f: WeaponFamily) => f === s.weaponFamily || f === 'longsword' || (p.weaponMastery[f]?.level ?? 1) > 1 || (p.weaponMastery[f]?.xp ?? 0) > 0;
    const combat = families.filter(trained).map((f) => {
      const m = p.weaponMastery[f] ?? { level: 1, xp: 0 };
      const max = m.level >= WEAPON_MASTERY_MAX;
      const next = weaponXpToNext(m.level);
      const held = s.weaponFamily === f;
      return row(
        `skill-${f}`,
        'weapon',
        `${WEAPON_FAMILIES[f].name} mastery${held ? ' (in hand)' : ''}`,
        `${m.level} / ${WEAPON_MASTERY_MAX}`,
        bar(m.xp, next, max ? 'MAX' : `${Math.floor(m.xp)} / ${next}`, max),
        `+${m.level - 1}% damage with ${WEAPON_FAMILIES[f].name.toLowerCase()}s (${DAMAGE_TYPE_NAMES[WEAPON_FAMILIES[f].damageType].toLowerCase()}). Grows from hits on real enemies.`,
        held,
      );
    });
    const untrained = families.filter((f) => !trained(f)).map((f) => WEAPON_FAMILIES[f].name);

    const sm = p.professions.blacksmithing;
    const sNext = smithXpToNext(sm.mastery);
    const crafting = [row('skill-smith', 'smithing', 'Blacksmithing', String(sm.mastery), bar(sm.xp, sNext, `${Math.floor(sm.xp)} / ${sNext}`), 'Grows from forging. Higher mastery makes better weapons.')];

    const gathering = GATHERING_PROFICIENCIES.map((id) => {
      const g = p.professions[id] ?? { level: 1, xp: 0 };
      const max = g.level >= PROFICIENCY_MAX;
      const next = proficiencyXpToNext(g.level);
      return row(
        `prof-${id}`,
        PROF_INFO[id].icon,
        PROF_INFO[id].name,
        `${g.level} / ${PROFICIENCY_MAX}`,
        bar(g.xp, next, max ? 'MAX' : `${Math.floor(g.xp)} / ${next}`, max),
        `${PROF_INFO[id].grows} +${Math.round(PROFICIENCY_YIELD_BONUS * 100 * (g.level - 1))}% chance of an extra unit.`,
      );
    });

    return h(
      'div',
      { class: 'cs-cols cs-cols-two' },
      panel('Combat proficiencies', 'weapon', h('div', { class: 'cs-list' }, ...combat), untrained.length ? h('div', { class: 'cs-note', style: 'margin-top:10px' }, `Not trained yet: ${untrained.join(', ')}.`) : null),
      panel('Crafting & gathering', 'smithing', sub('Crafting'), h('div', { class: 'cs-list' }, ...crafting), sub('Gathering'), h('div', { class: 'cs-list' }, ...gathering)),
    );
  }

  // ---------------- Skills ----------------
  private skillsScreen(): HTMLElement {
    const s = this.session;
    const st = characterStats(s);
    const imbued = s.equipped()?.result.imbuements ?? [];
    const type = DAMAGE_TYPE_NAMES[weaponDamageType(s)];
    const list = h('div', { class: 'cs-list' });
    for (const a of Object.values(ATTACKS)) {
      if (isSkill(a.id)) continue; // weapon skills have their own panel
      const known = a.id !== 'storm_arc' || imbued.includes('storm_arc');
      const info = ATTACK_INFO[a.id] ?? { icon: 'slash', text: '' };
      list.append(
        h(
          'div',
          { class: `cs-skill ${known ? '' : 'locked'}`, 'data-attack': a.id, title: known ? '' : 'Needs a weapon imbued with Storm Arc' },
          h('div', { class: 'cs-prof-ico' }, icon(known ? info.icon : 'lock')),
          h(
            'div',
            { class: 'cs-prof-main' },
            h('div', { class: 'row' }, h('kbd', null, ATTACK_KEYS[a.id] ?? ''), h('b', null, a.name), h('span', { class: 'spacer' }), h('span', { class: 'cs-skill-dmg' }, known ? `${Math.round(st.weapon.damage * a.damageMult * (1 + st.damageBonus))} dmg` : 'Locked'), h('span', { class: 'cs-skill-tag' }, a.cooldown ? `${a.cooldown}s CD` : a.heavy ? 'Heavy' : 'Light')),
            h('div', { class: 'cs-note' }, info.text),
          ),
        ),
      );
    }
    // Weapon skills: learned at mastery milestones, used from the skill bar (keys 1-4).
    const bar = s.skillBar;
    const learned = s.learnedSkills().map((x) => x.id);
    const usable = s.usableSkills();
    const skills = h('div', { class: 'cs-list' });
    for (const sk of Object.values(SKILLS)) {
      const a = ATTACKS[sk.id];
      const has = learned.includes(sk.id);
      const level = s.masteryOf(sk.family);
      const fam = WEAPON_FAMILIES[sk.family].name;
      const onKey = bar.indexOf(sk.id);
      const dmgType = DAMAGE_TYPE_NAMES[sk.damageType ?? WEAPON_FAMILIES[sk.family].damageType];
      const assign = has
        ? h(
            'div',
            { class: 'cs-assign', role: 'group', 'aria-label': `Put ${sk.name} on a key` },
            h('span', { class: 'cs-note' }, 'Key:'),
            ...[0, 1, 2, 3].map((i) =>
              h(
                'button',
                {
                  class: `cs-key ${onKey === i ? 'active' : ''}`,
                  'data-testid': `assign-${sk.id}-${i + 1}`,
                  title: onKey === i ? `Remove from key ${i + 1}` : `Put on key ${i + 1}${bar[i] ? ` (replaces ${ATTACKS[bar[i] as keyof typeof ATTACKS]?.name})` : ''}`,
                  onclick: () => void this.onSkillBar(i, onKey === i ? null : sk.id),
                },
                String(i + 1),
              ),
            ),
          )
        : null;
      skills.append(
        h(
          'div',
          { class: `cs-skill ${has ? '' : 'locked'}`, 'data-skill': sk.id },
          h('div', { class: 'cs-prof-ico' }, icon(has ? (sk.id === 'final_slash' ? 'heavy' : 'slash') : 'lock')),
          h(
            'div',
            { class: 'cs-prof-main' },
            h(
              'div',
              { class: 'row' },
              h('b', null, sk.name),
              h('span', { class: 'spacer' }),
              h('span', { class: 'cs-skill-dmg' }, has ? `${Math.round(st.weapon.damage * a.damageMult * (1 + st.damageBonus))} dmg` : `${fam} ${sk.unlockLevel}`),
              h('span', { class: 'cs-skill-tag' }, `${a.cooldown}s CD`),
            ),
            h('div', { class: 'cs-note' }, `${sk.description} ${dmgType} damage.${sk.finisher ? ` ×${sk.finisher.multiplier} on staggered enemies or below ${Math.round(sk.finisher.belowHealth * 100)}% health.` : ''}`),
            h(
              'div',
              { class: 'cs-note', 'data-testid': `skill-status-${sk.id}` },
              has ? (usable.includes(sk.id) ? 'Learned. Ready with your weapon in hand.' : `Learned. Needs a ${fam.toLowerCase()} in hand.`) : `Unlocks at ${fam} mastery ${sk.unlockLevel} (you: ${level}).`,
            ),
            assign,
          ),
        ),
      );
    }
    return h(
      'div',
      { class: 'cs-cols cs-cols-two' },
      panel('Weapon skills', 'skills', h('div', { class: 'cs-note', style: 'margin-bottom:10px' }, 'Learned as your weapon mastery grows. Put them on keys 1-4 and use them in combat.'), skills),
      panel('Attacks', 'weapon', h('div', { class: 'cs-note', style: 'margin-bottom:10px' }, `Damage shown is ${type.toLowerCase()} damage before the target's defense and resistances, without critical hits.`), list),
    );
  }
}
