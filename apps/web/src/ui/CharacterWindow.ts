/**
 * The character window: one panel with three tabs.
 * - Character: equipment slots, attributes, derived stats and records.
 * - Inventory: item grid with details, materials and coins.
 * - Skills: adventurer rank, weapon and blacksmithing mastery, and the attacks.
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
  WEAPON_MASTERY_MAX,
  adventurerXpToNext,
  attributeXpToNext,
  smithXpToNext,
  weaponXpToNext,
  DAMAGE_TYPE_NAMES,
  WEAPON_FAMILIES,
  type AttributeId,
} from '@alloy/game-rules';
import { RARITY_ORDER, itemDisplayName, materialName, type ItemInstance, type WeaponFamily } from '@alloy/item-gen';
import { characterStats, weaponDamageType, type Session } from '../state/Session';
import { RARITY_COLORS } from '../entities/Weapons';
import { clear, h } from './dom';
import { drawSword, itemHeader, provenanceText, sourceLabel, statTable, traitsBlock } from './ItemView';

export type CharacterTab = 'character' | 'inventory' | 'skills';
type SortKey = 'rating' | 'recent' | 'name' | 'rarity';

/** Equipment slots, in paper-doll order (3 per row). */
const SLOTS: Array<{ id: EquipSlot; label: string }> = [
  { id: 'head', label: 'Head' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'neck', label: 'Neck' },
  { id: 'cape', label: 'Cape' },
  { id: 'chest', label: 'Chest' },
  { id: 'belt', label: 'Belt' },
  { id: 'hands', label: 'Hands' },
  { id: 'legs', label: 'Legs' },
  { id: 'feet', label: 'Feet' },
  { id: 'ring1', label: 'Ring' },
  { id: 'ring2', label: 'Ring' },
  { id: 'tool', label: 'Tool' },
  { id: 'weapon', label: 'Main hand' },
  { id: 'offhand', label: 'Off-hand' },
];
export const SLOT_LABEL: Record<EquipSlot, string> = Object.fromEntries(SLOTS.map((x) => [x.id, x.label])) as Record<EquipSlot, string>;

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
  return parts.length ? h('div', { class: 'small ember', style: 'margin-top:6px', 'data-testid': 'gear-line' }, parts.join(' · ')) : null;
}
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
    private onUnequip: (slot: EquipSlot) => void,
    /** Asks the authority (server for accounts, this browser for guests); true when done. */
    private onDiscard: (id: string) => Promise<boolean>,
    private onAllocate: (attr: AttributeId, n: number) => Promise<unknown>,
    private onRespec: () => Promise<unknown>,
  ) {
    this.selected = session.inventory.equipped.weapon ?? session.inventory.itemOrder[0] ?? null;
    this.render();
  }

  /** True while a points request is with the authority (buttons are disabled meanwhile). */
  private busy = false;
  private spend(req: () => Promise<unknown>): void {
    if (this.busy) return;
    this.busy = true;
    this.render();
    void req().finally(() => {
      this.busy = false;
      this.render();
    });
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

    const inv = s.inventory;
    const twoHanded = !!eq && equipInfo(eq).hands === 2;
    const doll = h('div', { class: 'doll' });
    for (const slot of SLOTS) {
      const id = inv.equipped[slot.id];
      const item = id ? (inv.items[id] ?? null) : null;
      const blocked = slot.id === 'offhand' && twoHanded;
      const cell = h(
        'button',
        {
          class: `slot ${blocked ? 'locked' : ''} ${item ? 'filled' : ''}`,
          'data-slot': slot.id,
          title: item ? `${itemDisplayName(item)} (click for details)` : blocked ? 'Your two-handed weapon uses both hands' : `${slot.label}: empty. Equip from the Inventory tab.`,
          style: item ? `border-color:${RARITY_COLORS[item.result.rarity]}` : '',
          onclick: () => {
            if (blocked) return;
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
      } else cell.append(h('span', { class: 'slot-empty' }, blocked ? 'Two-handed' : 'Empty'));
      doll.append(cell);
    }

    const totals = s.attributeTotals();
    const gearAttr = s.gearAttributes();
    const unspent = s.unspentPoints;
    const attrs = h('div', { class: 'attrs' });
    for (const id of ATTRIBUTE_IDS) {
      const a = s.attributes[id];
      const pts = s.allocated[id];
      const def = ATTRIBUTES[id];
      const maxed = a.level >= ATTRIBUTE_MAX;
      const next = attributeXpToNext(a.level);
      const canAdd = !this.busy && unspent > 0 && pts < ALLOCATED_MAX;
      const add = h(
        'button',
        {
          class: 'btn small plus',
          'data-testid': `add-${id}`,
          disabled: !canAdd,
          title: unspent === 0 ? 'No stat points to spend' : pts >= ALLOCATED_MAX ? `At most ${ALLOCATED_MAX} points per attribute` : `Spend a point on ${def.name} (Shift: 5)`,
          onclick: (ev: MouseEvent) => this.spend(() => this.onAllocate(id, Math.min(ev.shiftKey ? 5 : 1, unspent, ALLOCATED_MAX - pts))),
        },
        '+',
      );
      attrs.append(
        h(
          'div',
          { class: 'attr', 'data-attr': id, title: `Grows from: ${def.grows}.\n${def.effect}.` },
          h('div', { class: 'row' }, h('b', null, def.name), h('span', { class: 'spacer' }), h('span', { class: 'mono ember attr-total', 'data-testid': `attr-${id}` }, String(totals[id])), add),
          h('div', { class: 'small muted', 'data-testid': `attr-split-${id}` }, `${a.level} trained + ${pts} allocated${gearAttr[id] ? ` + ${gearAttr[id]} gear` : ''}`),
          bar(a.xp, next, maxed ? 'TRAINED MAX' : `Training ${Math.floor(a.xp)} / ${next}`, maxed),
          h('div', { class: 'small muted' }, def.effect),
        ),
      );
    }
    const spent = ATTRIBUTE_IDS.reduce((n, id) => n + s.allocated[id], 0);
    const pointsBar = h(
      'div',
      { class: 'row points' },
      h('span', null, 'Stat points: ', h('b', { class: unspent > 0 ? 'ember' : 'muted', 'data-testid': 'unspent-points' }, String(unspent))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', 'data-testid': 'respec', disabled: this.busy || spent === 0, title: 'Refund every spent point (free for now)', onclick: () => this.spend(() => this.onRespec()) }, 'Reset'),
    );

    const w = st.weapon;
    const derived = h(
      'table',
      { class: 'stat-table' },
      row3('Max health', String(st.maxHealth), 'Vitality + gear'),
      row3('Max stamina', String(st.maxStamina), 'Endurance + gear'),
      row3('Defense', String(st.defense), `Gear: hits land ${Math.round((100 * 100) / (100 + st.defense))}% as hard`),
      row3('Weapon damage', w.damage.toFixed(1), eq ? 'Equipped weapon' : 'Unarmed'),
      row3('Damage type', DAMAGE_TYPE_NAMES[weaponDamageType(s)], s.weaponFamily ? WEAPON_FAMILIES[s.weaponFamily].name : 'Fists'),
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
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Attributes'), h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Each attribute is what you trained by use plus the points you spent. You earn 3 points per adventurer rank. Hover an attribute to see how it trains.'), pointsBar, attrs),
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Stats'), derived, h('h3', null, 'Records'), records),
    );
  }

  // ---------------- Inventory ----------------
  private inventoryTab(): HTMLElement {
    const inv = this.session.inventory;
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
    for (const it of sorted) grid.append(this.tile(it));
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
    return h('div', { class: 'panel-body inv-grid' }, left, this.detail());
  }

  private tile(it: ItemInstance): HTMLElement {
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
      slotOf(this.session.inventory, it.itemId) ? h('span', { class: 'tile-eq', title: `Equipped (${SLOT_LABEL[slotOf(this.session.inventory, it.itemId)!]})` }, 'E') : null,
    );
    requestAnimationFrame(() => drawSword(c, it));
    return t;
  }

  private detail(): HTMLElement {
    const inv = this.session.inventory;
    const sel = this.selected ? inv.items[this.selected] : null;
    const right = h('div', { class: 'inv-col' });
    if (!sel) {
      right.append(h('div', { class: 'muted small' }, 'Select an item to see its details.'));
      return right;
    }
    const canvas = h('canvas', { style: 'width:100%;height:110px' });
    const inSlot = slotOf(inv, sel.itemId);
    const isEq = inSlot !== null;
    const target = slotsFor(sel)[0];
    const isWeapon = target === 'weapon';
    // Compare with whatever is in the slot this item would go in.
    const otherId = target === 'ring1' ? (inv.equipped.ring1 ?? inv.equipped.ring2) : inv.equipped[target];
    const other = !isEq && otherId ? (inv.items[otherId] ?? null) : null;
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
      : h('button', { class: 'btn small', disabled: isEq, title: isEq ? 'Unequip it before discarding' : '', onclick: () => ((this.confirmDiscard = true), this.render()) }, 'Discard…');
    const equipBtn = inSlot
      ? h('button', { class: 'btn', 'data-testid': 'inv-unequip', title: `Take it off (${SLOT_LABEL[inSlot]})`, onclick: () => (this.onUnequip(inSlot), this.render()) }, `Unequip · ${SLOT_LABEL[inSlot]}`)
      : h('button', { class: 'btn primary', 'data-testid': 'inv-equip', onclick: () => (this.onEquip(sel.itemId), this.render()) }, `Equip · ${SLOT_LABEL[target]}`);
    right.append(
      h('div', { class: 'preview-wrap', style: 'height:110px' }, canvas),
      h('div', { style: 'margin-top:8px' }, itemHeader(sel)),
      traitsBlock(sel),
      // Weapon statistics only mean something for weapons; other gear shows its gear line.
      isWeapon ? h('h3', null, other ? `Compared with ${itemDisplayName(other)}` : 'Statistics') : '',
      isWeapon ? statTable(sel, other) : '',
      gearLine(sel) ?? '',
      h('div', { class: 'row', style: 'margin-top:10px' }, equipBtn, h('span', { class: 'spacer' }), discard),
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
    const sm = p.professions.blacksmithing;
    const st = characterStats(s);
    const skill = (testid: string, name: string, level: string, b: HTMLElement, note: string) =>
      h('div', { class: 'attr', 'data-testid': testid }, h('div', { class: 'row' }, h('b', null, name), h('span', { class: 'spacer' }), h('span', { class: 'mono ember' }, level)), b, h('div', { class: 'small muted' }, note));
    const adv = p.adventurer.rank >= ADVENTURER_RANK_MAX;
    const advNext = adventurerXpToNext(p.adventurer.rank);
    const sNext = smithXpToNext(sm.mastery);
    // Weapon families: the one in hand, plus any trained before. The rest are listed by name.
    const trained = (f: WeaponFamily) => f === s.weaponFamily || f === 'longsword' || (p.weaponMastery[f]?.level ?? 1) > 1 || (p.weaponMastery[f]?.xp ?? 0) > 0;
    const families = Object.keys(WEAPON_FAMILIES) as WeaponFamily[];
    const weaponSkills = families.filter(trained).map((f) => [f, p.weaponMastery[f] ?? { level: 1, xp: 0 }] as const);
    const untrained = families.filter((f) => !trained(f)).map((f) => WEAPON_FAMILIES[f].name);
    const masteries = h(
      'div',
      { class: 'attrs' },
      skill('skill-adventurer', 'Adventurer rank', String(p.adventurer.rank), bar(p.adventurer.xp, advNext, adv ? 'MAX' : `${Math.floor(p.adventurer.xp)} / ${advNext}`, adv), 'Grows from defeating enemies and finishing quests.'),
      ...weaponSkills.map(([f, m]) => {
        const max = m.level >= WEAPON_MASTERY_MAX;
        const next = weaponXpToNext(m.level);
        const held = s.weaponFamily === f ? ' (in hand)' : '';
        return skill(`skill-${f}`, `${WEAPON_FAMILIES[f].name} mastery${held}`, `${m.level} / ${WEAPON_MASTERY_MAX}`, bar(m.xp, next, max ? 'MAX' : `${Math.floor(m.xp)} / ${next}`, max), `+${m.level - 1}% damage with ${WEAPON_FAMILIES[f].name.toLowerCase()}s (${DAMAGE_TYPE_NAMES[WEAPON_FAMILIES[f].damageType].toLowerCase()}). Grows from hits on real enemies.`);
      }),
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
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Masteries'), masteries, untrained.length ? h('div', { class: 'small muted', style: 'margin-top:8px' }, `Not trained yet: ${untrained.join(', ')}.`) : ''),
      h('div', { class: 'inv-col' }, h('h3', { style: 'margin-top:0' }, 'Attacks'), h('div', { class: 'small muted', style: 'margin-bottom:6px' }, `${DAMAGE_TYPE_NAMES[weaponDamageType(s)]} damage, before the target's defense and resistances, without critical hits.`), attacks),
    );
  }
}
