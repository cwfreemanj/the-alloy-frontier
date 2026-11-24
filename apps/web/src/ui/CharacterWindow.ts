/**
 * The character window: one panel with three tabs.
 * - Character: equipment slots, attributes, derived stats and records.
 * - Inventory: item grid with details, materials and coins.
 * - Skills: adventurer rank, weapon and blacksmithing mastery, and the attacks.
 * Everything shown comes from the session and the shared rules (no numbers of its own).
 */
import { averageQuality, materialTotal } from '@alloy/crafting';
import {
  ADVENTURER_RANK_MAX,
  ATTACKS,
  ATTRIBUTES,
  ATTRIBUTE_IDS,
  ATTRIBUTE_MAX,
  WEAPON_MASTERY_MAX,
  adventurerXpToNext,
  attributeXpToNext,
  smithXpToNext,
  weaponXpToNext,
} from '@alloy/game-rules';
import { RARITY_ORDER, itemDisplayName, materialName, type ItemInstance } from '@alloy/item-gen';
import { characterStats, type Session } from '../state/Session';
import { RARITY_COLORS } from '../entities/Weapons';
import { clear, h } from './dom';
import { drawSword, itemHeader, provenanceText, sourceLabel, statTable, traitsBlock } from './ItemView';

export type CharacterTab = 'character' | 'inventory' | 'skills';
type SortKey = 'rating' | 'recent' | 'name' | 'rarity';

/** Equipment slots, in paper-doll order. Only the main hand has items so far. */
const SLOTS: Array<{ id: string; label: string; live: boolean }> = [
  { id: 'head', label: 'Head', live: false },
  { id: 'trinket1', label: 'Trinket', live: false },
  { id: 'chest', label: 'Chest', live: false },
  { id: 'trinket2', label: 'Trinket', live: false },
  { id: 'hands', label: 'Hands', live: false },
  { id: 'legs', label: 'Legs', live: false },
  { id: 'main', label: 'Main hand', live: true },
  { id: 'feet', label: 'Feet', live: false },
  { id: 'off', label: 'Off-hand', live: false },
];

const ATTACK_KEYS: Record<string, string> = { light1: 'LMB / J', light2: 'LMB / J', light3: 'LMB / J', heavy: 'F / K', guardbreaker: 'R', storm_arc: 'G' };
const MIN_GRID_CELLS = 24;

const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
const bar = (cur: number, max: number, label: string, maxed = false) =>
  h(
    'div',
    { class: 'xpbar', title: maxed ? 'Maximum' : `${Math.floor(cur)} / ${max} XP` },
    h('div', { class: 'xpbar-fill', style: `width:${maxed ? 100 : Math.min(100, (cur / max) * 100)}%` }),
    h('span', null, label),
  );
const playTime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
const row3 = (k: string, v: string, note = '', vClass = '') => h('tr', { title: note }, h('td', null, k), h('td', { class: vClass, 'data-stat': k }, v), h('td', { class: 'muted' }, note));

export class CharacterWindow {
  readonly el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Character' });
  private selected: string | null;
  private sort: SortKey = 'rating';
  private confirmDiscard = false;

  constructor(
    private session: Session,
    public tab: CharacterTab,
    private name: string,
    private onClose: () => void,
    private onEquip: (id: string) => void,
    /** Asks the authority (server for accounts, this browser for guests); true when done. */
    private onDiscard: (id: string) => Promise<boolean>,
  ) {
    this.selected = session.inventory.equipped.weapon ?? session.inventory.itemOrder[0] ?? null;
    this.render();
  }

  show(tab: CharacterTab): void {
    this.tab = tab;
    this.render();
  }

  render(): void {
    clear(this.el);
    const defs: Array<[CharacterTab, string, string]> = [
      ['character', 'Character', 'O'],
      ['inventory', 'Inventory', 'I'],
      ['skills', 'Skills', 'U'],
    ];
    const tabs = h(
      'div',
      { class: 'tabs', role: 'tablist' },
      ...defs.map(([id, label, key]) =>
        h('button', { class: `tab ${this.tab === id ? 'active' : ''}`, role: 'tab', 'aria-selected': String(this.tab === id), 'data-testid': `tab-${id}`, title: `${label} (${key})`, onclick: () => this.show(id) }, label),
      ),
    );
    const head = h('div', { class: 'panel-head' }, h('h2', null, this.name), tabs, h('button', { class: 'close-x', onclick: this.onClose, 'aria-label': 'Close', title: 'Close (Esc)' }, '✕'));
    const body = this.tab === 'character' ? this.characterTab() : this.tab === 'inventory' ? this.inventoryTab() : this.skillsTab();
    this.el.append(h('div', { class: 'panel inv charwin', 'data-testid': 'character-window', 'data-tab': this.tab }, head, body));
  }

  // ---------------- Character ----------------
  private characterTab(): HTMLElement {
    const s = this.session;
    const st = characterStats(s);
    const eq = s.equipped();

    const doll = h('div', { class: 'doll' });
    for (const slot of SLOTS) {
      const item = slot.live ? eq : null;
      const cell = h(
        'button',
        {
          class: `slot ${slot.live ? '' : 'locked'} ${item ? 'filled' : ''}`,
          'data-slot': slot.id,
          title: slot.live ? (item ? itemDisplayName(item) : 'Empty: equip a weapon from the Inventory tab') : `${slot.label}: coming soon`,
          style: item ? `border-color:${RARITY_COLORS[item.result.rarity]}` : '',
          onclick: () => {
            if (!slot.live) return;
            if (item) this.selected = item.itemId;
            this.show('inventory');
          },
        },
        h('span', { class: 'slot-label' }, slot.label),
      );
      if (item) {
        const c = h('canvas', { class: 'slot-art' });
        cell.append(c, h('span', { class: 'slot-name', style: `color:${RARITY_COLORS[item.result.rarity]}` }, itemDisplayName(item)));
        requestAnimationFrame(() => drawSword(c, item));
      } else cell.append(h('span', { class: 'slot-empty' }, slot.live ? 'Empty' : 'Coming soon'));
      doll.append(cell);
    }

    const attrs = h('div', { class: 'attrs' });
    for (const id of ATTRIBUTE_IDS) {
      const a = s.attributes[id];
      const def = ATTRIBUTES[id];
      const maxed = a.level >= ATTRIBUTE_MAX;
      const next = attributeXpToNext(a.level);
      attrs.append(
        h(
          'div',
          { class: 'attr', 'data-attr': id, title: `Grows from: ${def.grows}.\n${def.effect}.` },
          h('div', { class: 'row' }, h('b', null, def.name), h('span', { class: 'spacer' }), h('span', { class: 'mono ember', 'data-testid': `attr-${id}` }, String(a.level))),
          bar(a.xp, next, maxed ? 'MAX' : `${Math.floor(a.xp)} / ${next}`, maxed),
          h('div', { class: 'small muted' }, def.effect),
        ),
      );
    }

    const w = st.weapon;
    const derived = h(
      'table',
      { class: 'stat-table' },
      row3('Max health', String(st.maxHealth), 'Vitality'),
      row3('Max stamina', String(st.maxStamina), 'Endurance'),
      row3('Weapon damage', w.damage.toFixed(1), eq ? 'Equipped weapon' : 'Unarmed'),
      row3('Damage bonus', `+${pct(st.damageBonus)}`, 'Mastery + Strength'),
      row3('Critical chance', pct(w.critChance, 1), 'Weapon + Dexterity'),
      row3('Attack speed', `${w.attackSpeed.toFixed(2)}×`),
      row3('Stagger', w.stagger.toFixed(1)),
      row3('Stamina cost', `${w.staminaCostMultiplier.toFixed(2)}×`),
    );

    const d = s.data;
    const kills = Object.entries(d.stats.kills).filter(([k]) => k !== 'dummy');
    const records = h(
      'table',
      { class: 'stat-table' },
      row3('Adventurer rank', String(d.progression.adventurer.rank)),
      row3('Enemies defeated', String(kills.reduce((n, [, v]) => n + v, 0))),
      row3('Items forged', String(d.stats.crafted)),
      row3('Deaths', String(d.stats.deaths)),
      row3('Play time', playTime(d.playTime)),
      row3('Coins', String(s.inventory.coins), '', 'ember'),
    );

    return h(
      'div',
      { class: 'panel-body char-grid' },
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Equipment'), doll),
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Attributes'), h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Attributes grow as you use them. Hover one to see how.'), attrs),
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Stats'), derived, h('h3', null, 'Records'), records),
    );
  }

  // ---------------- Inventory ----------------
  private inventoryTab(): HTMLElement {
    const inv = this.session.inventory;
    const eq = this.session.equipped();
    const items = inv.itemOrder.map((id) => inv.items[id]).filter(Boolean);
    const sorted = [...items].sort((a, b) => {
      if (this.sort === 'rating') return b.result.rating - a.result.rating;
      if (this.sort === 'name') return itemDisplayName(a).localeCompare(itemDisplayName(b));
      if (this.sort === 'rarity') return RARITY_ORDER.indexOf(b.result.rarity) - RARITY_ORDER.indexOf(a.result.rarity);
      return b.createdAt - a.createdAt;
    });
    const sortSel = h('select', { 'aria-label': 'Sort items' }, ...(['rating', 'recent', 'name', 'rarity'] as SortKey[]).map((k) => h('option', { value: k, selected: k === this.sort }, `Sort: ${k}`))) as HTMLSelectElement;
    sortSel.addEventListener('change', () => ((this.sort = sortSel.value as SortKey), this.render()));

    const grid = h('div', { class: 'item-grid' });
    for (const it of sorted) grid.append(this.tile(it, eq));
    for (let i = sorted.length; i < MIN_GRID_CELLS; i++) grid.append(h('div', { class: 'tile empty', 'aria-hidden': 'true' }));

    const mats = h('table', { class: 'stat-table' });
    for (const id of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux'] as const) {
      const q = averageQuality(inv, id);
      mats.append(h('tr', null, h('td', null, materialName(id)), h('td', null, String(materialTotal(inv, id))), h('td', { class: 'muted' }, q === null ? '—' : `q ${Math.round(q * 100)}%`)));
    }
    const lots = inv.lots.map((l) => h('div', { class: 'small muted' }, `${l.quantity}× ${materialName(l.materialId)} · quality ${Math.round(l.quality * 100)}% · from ${l.origin}`));
    const left = h(
      'div',
      { class: 'inv-col' },
      h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, `Items (${items.length})`), h('span', { class: 'spacer' }), sortSel),
      items.length === 0 ? h('div', { class: 'muted small', style: 'margin:6px 0' }, 'No equipment yet. Speak with Orla at the forge.') : null,
      grid,
      h('h3', null, 'Materials · ', h('span', { class: 'ember' }, `${inv.coins} coins`)),
      mats,
      h('details', null, h('summary', { class: 'small muted' }, `Material lots (${inv.lots.length})`), ...lots),
    );
    return h('div', { class: 'panel-body inv-grid' }, left, this.detail(eq));
  }

  private tile(it: ItemInstance, eq: ItemInstance | null): HTMLElement {
    const c = h('canvas', { class: 'tile-art' });
    const t = h(
      'button',
      {
        class: `tile ${it.itemId === this.selected ? 'selected' : ''}`,
        'data-item': it.itemId,
        title: `${itemDisplayName(it)} · rating ${it.result.rating} · ${sourceLabel(it)}`,
        style: `border-color:${RARITY_COLORS[it.result.rarity]}`,
        onclick: () => {
          this.selected = it.itemId;
          this.confirmDiscard = false;
          this.render();
        },
      },
      c,
      h('span', { class: 'tile-rating mono' }, String(it.result.rating)),
      eq?.itemId === it.itemId ? h('span', { class: 'tile-eq', title: 'Equipped' }, 'E') : null,
    );
    requestAnimationFrame(() => drawSword(c, it));
    return t;
  }

  private detail(eq: ItemInstance | null): HTMLElement {
    const inv = this.session.inventory;
    const sel = this.selected ? inv.items[this.selected] : null;
    const right = h('div', { class: 'inv-col' });
    if (!sel) {
      right.append(h('div', { class: 'muted small' }, 'Select an item to see its details.'));
      return right;
    }
    const canvas = h('canvas', { style: 'width:100%;height:110px' });
    const isEq = eq?.itemId === sel.itemId;
    const discard = this.confirmDiscard
      ? h(
          'span',
          { class: 'row' },
          h('span', { class: 'small bad' }, 'Discard permanently?'),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () =>
                void this.onDiscard(sel.itemId).then((ok) => {
                  if (ok) this.selected = null;
                  this.confirmDiscard = false;
                  this.render();
                }),
            },
            'Yes, discard',
          ),
          h('button', { class: 'btn small', onclick: () => ((this.confirmDiscard = false), this.render()) }, 'Keep'),
        )
      : h('button', { class: 'btn small', disabled: isEq, title: isEq ? 'Cannot discard the equipped weapon' : '', onclick: () => ((this.confirmDiscard = true), this.render()) }, 'Discard…');
    right.append(
      h('div', { class: 'preview-wrap', style: 'height:110px' }, canvas),
      h('div', { style: 'margin-top:8px' }, itemHeader(sel)),
      traitsBlock(sel),
      h('h3', null, eq && !isEq ? `Compared with ${itemDisplayName(eq)}` : 'Statistics'),
      statTable(sel, eq && !isEq ? eq : null),
      h(
        'div',
        { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', disabled: isEq, 'data-testid': 'inv-equip', onclick: () => (this.onEquip(sel.itemId), this.render()) }, isEq ? 'Equipped' : 'Equip'),
        h('span', { class: 'spacer' }),
        discard,
      ),
      h('h3', null, 'Provenance'),
      h('div', { class: 'prov' }, provenanceText(sel)),
    );
    requestAnimationFrame(() => drawSword(canvas, sel));
    return right;
  }

  // ---------------- Skills ----------------
  private skillsTab(): HTMLElement {
    const s = this.session;
    const p = s.data.progression;
    const wm = p.weaponMastery.longsword;
    const sm = p.professions.blacksmithing;
    const st = characterStats(s);
    const skill = (testid: string, name: string, level: string, b: HTMLElement, note: string) =>
      h('div', { class: 'attr', 'data-testid': testid }, h('div', { class: 'row' }, h('b', null, name), h('span', { class: 'spacer' }), h('span', { class: 'mono ember' }, level)), b, h('div', { class: 'small muted' }, note));
    const adv = p.adventurer.rank >= ADVENTURER_RANK_MAX;
    const wmax = wm.level >= WEAPON_MASTERY_MAX;
    const advNext = adventurerXpToNext(p.adventurer.rank);
    const wNext = weaponXpToNext(wm.level);
    const sNext = smithXpToNext(sm.mastery);
    const masteries = h(
      'div',
      { class: 'attrs' },
      skill('skill-adventurer', 'Adventurer rank', String(p.adventurer.rank), bar(p.adventurer.xp, advNext, adv ? 'MAX' : `${Math.floor(p.adventurer.xp)} / ${advNext}`, adv), 'Grows from defeating enemies and finishing quests.'),
      skill('skill-longsword', 'Longsword mastery', `${wm.level} / ${WEAPON_MASTERY_MAX}`, bar(wm.xp, wNext, wmax ? 'MAX' : `${Math.floor(wm.xp)} / ${wNext}`, wmax), `+${wm.level - 1}% longsword damage. Grows from hits on real enemies.`),
      skill('skill-smith', 'Blacksmithing', String(sm.mastery), bar(sm.xp, sNext, `${Math.floor(sm.xp)} / ${sNext}`), 'Grows from forging. Higher mastery makes better weapons.'),
    );
    const imbued = s.equipped()?.result.imbuements ?? [];
    const attacks = h('table', { class: 'stat-table attacks' });
    for (const a of Object.values(ATTACKS)) {
      const known = a.id !== 'storm_arc' || imbued.includes('storm_arc');
      attacks.append(
        h(
          'tr',
          { class: known ? '' : 'muted', 'data-attack': a.id, title: known ? '' : 'Needs a weapon imbued with Storm Arc' },
          h('td', null, h('kbd', null, ATTACK_KEYS[a.id] ?? ''), ' ', a.name),
          h('td', null, known ? `${Math.round(st.weapon.damage * a.damageMult * (1 + st.damageBonus))} dmg` : 'Locked'),
          h('td', { class: 'muted' }, a.cooldown ? `${a.cooldown}s cooldown` : a.heavy ? 'heavy' : 'light'),
        ),
      );
    }
    return h(
      'div',
      { class: 'panel-body char-grid two' },
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Masteries'), masteries),
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Attacks'), h('div', { class: 'small muted', style: 'margin-bottom:6px' }, "Damage before the target's defense, without critical hits."), attacks),
    );
  }
}
