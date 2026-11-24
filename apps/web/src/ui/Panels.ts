/** Inventory, merchant, dialogue, pause/settings, title and summary panels. */
import { MERCHANT_STOCK, averageQuality, materialTotal, merchantPreview } from '@alloy/crafting';
import { RARITY_ORDER, itemDisplayName, materialName, type ItemInstance } from '@alloy/item-gen';
import { QUEST_EDGE_YOU_MAKE, smithXpToNext, weaponXpToNext } from '@alloy/game-rules';
import type { Session } from '../state/Session';
import { clear, h } from './dom';
import { drawSword, itemHeader, provenanceText, sourceLabel, statTable, traitsBlock } from './ItemView';
import { RARITY_COLORS } from '../entities/Weapons';

const panelHead = (title: string, onClose: () => void, extra?: Node) =>
  h('div', { class: 'panel-head' }, h('h2', null, title), extra ?? null, h('button', { class: 'close-x', onclick: onClose, 'aria-label': 'Close', title: 'Close (Esc)' }, '✕'));

// ---------------- Inventory ----------------
type SortKey = 'rating' | 'recent' | 'name' | 'rarity';
export class InventoryPanel {
  readonly el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Inventory' });
  private selected: string | null;
  private sort: SortKey = 'rating';
  private confirmDiscard = false;
  constructor(
    private session: Session,
    private onClose: () => void,
    private onEquip: (id: string) => void,
    /** Asks the authority (server for accounts, this browser for guests); true when done. */
    private onDiscard: (id: string) => Promise<boolean>,
  ) {
    this.selected = session.inventory.equipped.weapon ?? session.inventory.itemOrder[0] ?? null;
    this.render();
  }
  render(): void {
    clear(this.el);
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
    const list = h('div', { class: 'list' });
    for (const it of sorted) {
      list.append(
        h(
          'button',
          { class: `card ${it.itemId === this.selected ? 'selected' : ''}`, 'data-item': it.itemId, onclick: () => ((this.selected = it.itemId), (this.confirmDiscard = false), this.render()) },
          h('div', { class: 'row' }, h('span', { class: 'ttl', style: `color:${RARITY_COLORS[it.result.rarity]}` }, itemDisplayName(it)), h('span', { class: 'spacer' }), eq?.itemId === it.itemId ? h('span', { class: 'tag ember' }, 'Equipped') : null),
          h('div', { class: 'sub' }, `Rating ${it.result.rating} · ${it.result.damage} dmg · ${sourceLabel(it)}`),
        ),
      );
    }
    if (sorted.length === 0) list.append(h('div', { class: 'muted small' }, 'No equipment yet. Speak with Orla at the forge.'));
    const mats = h('table', { class: 'stat-table' });
    for (const id of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux'] as const) {
      const q = averageQuality(inv, id);
      mats.append(h('tr', null, h('td', null, materialName(id)), h('td', null, String(materialTotal(inv, id))), h('td', { class: 'muted' }, q === null ? '—' : `q ${Math.round(q * 100)}%`)));
    }
    const lots = inv.lots.map((l) => h('div', { class: 'small muted' }, `${l.quantity}× ${materialName(l.materialId)} · quality ${Math.round(l.quality * 100)}% · from ${l.origin}`));
    const left = h('div', { class: 'inv-col' }, h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, 'Weapons'), h('span', { class: 'spacer' }), sortSel), list, h('h3', null, `Materials · ${inv.coins} coins`), mats, h('details', null, h('summary', { class: 'small muted' }, `Material lots (${inv.lots.length})`), ...lots));
    const sel = this.selected ? inv.items[this.selected] : null;
    const right = h('div', { class: 'inv-col' });
    if (sel) {
      const canvas = h('canvas', { style: 'width:100%;height:110px' });
      right.append(
        h('div', { class: 'preview-wrap', style: 'height:110px' }, canvas),
        h('div', { style: 'margin-top:8px' }, itemHeader(sel)),
        traitsBlock(sel),
        h('h3', null, eq && eq.itemId !== sel.itemId ? `Compared with ${itemDisplayName(eq)}` : 'Statistics'),
        statTable(sel, eq && eq.itemId !== sel.itemId ? eq : null),
        h(
          'div',
          { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn primary', disabled: eq?.itemId === sel.itemId, 'data-testid': 'inv-equip', onclick: () => (this.onEquip(sel.itemId), this.render()) }, eq?.itemId === sel.itemId ? 'Equipped' : 'Equip'),
          h('span', { class: 'spacer' }),
          this.confirmDiscard
            ? h('span', { class: 'row' }, h('span', { class: 'small bad' }, 'Discard permanently?'), h('button', { class: 'btn small', onclick: () => void this.onDiscard(sel.itemId).then((ok) => (ok && (this.selected = null), (this.confirmDiscard = false), this.render())) }, 'Yes, discard'), h('button', { class: 'btn small', onclick: () => ((this.confirmDiscard = false), this.render()) }, 'Keep'))
            : h('button', { class: 'btn small', disabled: eq?.itemId === sel.itemId, title: eq?.itemId === sel.itemId ? 'Cannot discard the equipped weapon' : '', onclick: () => ((this.confirmDiscard = true), this.render()) }, 'Discard…'),
        ),
        h('h3', null, 'Provenance'),
        h('div', { class: 'prov' }, provenanceText(sel)),
      );
      requestAnimationFrame(() => drawSword(canvas, sel));
    }
    this.el.append(h('div', { class: 'panel inv' }, panelHead('Inventory', this.onClose), h('div', { class: 'panel-body inv-grid' }, left, right)));
  }
}

// ---------------- Merchant ----------------
export class MerchantPanel {
  readonly el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Merchant' });
  constructor(
    private session: Session,
    private onClose: () => void,
    /** Asks the authority to buy (server for accounts, this browser for guests). */
    private onBuy: (stockId: string, qty: number) => Promise<unknown>,
  ) {
    this.render();
  }
  render(): void {
    clear(this.el);
    const eq = this.session.equipped();
    const body = h('div', { class: 'panel-body', style: 'display:grid;gap:12px' });
    body.append(h('div', { class: 'small muted' }, `"Honest steel at an honest price. Same every time — no surprises, no flourishes." · You have `, h('b', { class: 'ember' }, `${this.session.inventory.coins} coins`)));
    for (const s of MERCHANT_STOCK) {
      const preview = merchantPreview(s);
      const row = h('div', { class: 'card', style: 'cursor:default' });
      row.append(h('div', { class: 'row' }, h('b', null, s.name), h('span', { class: 'spacer' }), h('span', { class: 'ember mono' }, `${s.price} c${s.kind === 'material' ? ' each' : ''}`)));
      if (preview) {
        row.append(h('div', { class: 'small muted' }, 'Fixed quality · Common · no specialization or imbuement. Equivalent to a mastery-0 Quick Forge.'));
        row.append(statTable(preview, eq, eq ? `vs ${itemDisplayName(eq).split(' ').slice(-1)[0]}` : ''));
        row.append(
          h(
            'div',
            { class: 'small cyan', style: 'margin-top:4px' },
            `Forge comparison: with your mastery (${this.session.smithMastery}) the same basic steel in an Iron Longsword already projects above this. Orla's mastery-100 hands would make ~42 damage.`,
          ),
        );
        row.append(h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', 'data-buy': s.id, disabled: this.session.inventory.coins < s.price, onclick: () => void this.onBuy(s.id, 1).then(() => this.render()) }, 'Buy')));
      } else {
        row.append(h('div', { class: 'small muted' }, `Buffer material for every forge recipe. Owned: ${materialTotal(this.session.inventory, 'binding_flux')}`));
        row.append(
          h(
            'div',
            { class: 'row', style: 'margin-top:6px' },
            h('span', { class: 'spacer' }),
            ...[1, 5, 10].map((n) => h('button', { class: 'btn small', 'data-buy': `${s.id}x${n}`, disabled: this.session.inventory.coins < s.price * n, onclick: () => void this.onBuy(s.id, n).then(() => this.render()) }, `Buy ${n}`)),
          ),
        );
      }
      body.append(row);
    }
    this.el.append(h('div', { class: 'panel dialog', style: 'width:min(620px,94vw)' }, panelHead("Bram's Frontier Goods", this.onClose), body));
  }
}

// ---------------- Dialogue ----------------
export interface DialogOption {
  label: string;
  action: () => void;
  primary?: boolean;
}
export function dialogPanel(speaker: string, role: string, lines: string[], options: DialogOption[]): HTMLElement {
  return h(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-label': speaker },
    h(
      'div',
      { class: 'panel dialog' },
      h(
        'div',
        { class: 'panel-body' },
        h('div', { class: 'speaker' }, speaker),
        h('div', { class: 'role' }, role),
        ...lines.map((l) => h('p', null, l)),
        h('div', { class: 'opts' }, ...options.map((o, i) => h('button', { class: `btn ${o.primary ? 'primary' : ''}`, 'data-option': i, onclick: o.action }, `${i + 1}. ${o.label}`))),
      ),
    ),
  );
}

// ---------------- Pause / settings ----------------
export interface Settings {
  quality: 'low' | 'medium' | 'high';
  sensitivity: number;
  invertY: boolean;
  showPerf: boolean;
  reducedShake: boolean;
}

export function controlsGrid(): HTMLElement {
  const rows: Array<[string, string]> = [
    ['W A S D', 'Move (camera-relative)'],
    ['Mouse / Arrow keys', 'Camera (click the view to capture the mouse)'],
    ['Shift', 'Sprint (slow endurance drain)'],
    ['Space', 'Jump'],
    ['LMB / J', 'Light attack (3-hit combo)'],
    ['F / K', 'Heavy attack'],
    ['RMB / L (hold)', 'Block'],
    ['Q / C', 'Dodge (brief invulnerability)'],
    ['R', 'Guardbreaker (breaks guards, big stagger)'],
    ['G', 'Weapon ability (Storm Arc, if imbued)'],
    ['Tab / MMB / T', 'Target lock'],
    ['E', 'Interact / gather'],
    ['I', 'Inventory'],
    ['Esc / P', 'Pause menu'],
    ['F3 / `', 'Performance overlay'],
    ['Mouse wheel', 'Camera zoom'],
  ];
  return h('div', { class: 'controls-grid' }, ...rows.flatMap(([k, v]) => [h('kbd', null, k), h('span', null, v)]));
}

export function pausePanel(opts: {
  settings: Settings;
  onResume: () => void;
  onSave: () => void;
  onLoad: () => void;
  onNewGame: () => void;
  onSettings: (s: Settings) => void;
  saveInfo: string;
}): HTMLElement {
  const s = { ...opts.settings };
  const quality = h('select', { 'aria-label': 'Graphics quality' }, ...(['low', 'medium', 'high'] as const).map((q) => h('option', { value: q, selected: q === s.quality }, q))) as HTMLSelectElement;
  const sens = h('input', { type: 'range', min: 0.3, max: 2.5, step: 0.1, value: s.sensitivity, 'aria-label': 'Mouse sensitivity' }) as HTMLInputElement;
  const inv = h('input', { type: 'checkbox', checked: s.invertY, 'aria-label': 'Invert Y' }) as HTMLInputElement;
  const perf = h('input', { type: 'checkbox', checked: s.showPerf, 'aria-label': 'Show performance' }) as HTMLInputElement;
  const shake = h('input', { type: 'checkbox', checked: s.reducedShake, 'aria-label': 'Reduce camera shake' }) as HTMLInputElement;
  const apply = () => opts.onSettings({ quality: quality.value as Settings['quality'], sensitivity: Number(sens.value), invertY: inv.checked, showPerf: perf.checked, reducedShake: shake.checked });
  for (const el of [quality, sens, inv, perf, shake]) el.addEventListener('change', apply);
  let confirmNew = false;
  const newBtn = h('button', { class: 'btn' }, 'New game…');
  newBtn.addEventListener('click', () => {
    if (!confirmNew) {
      confirmNew = true;
      newBtn.textContent = 'Click again: erase save and restart';
      return;
    }
    opts.onNewGame();
  });
  return h(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-label': 'Paused' },
    h(
      'div',
      { class: 'panel menu' },
      panelHead('Paused', opts.onResume),
      h(
        'div',
        { class: 'panel-body', style: 'display:grid;gap:10px' },
        h('div', { class: 'row' }, h('button', { class: 'btn primary', 'data-testid': 'resume', onclick: opts.onResume }, 'Resume'), h('button', { class: 'btn', 'data-testid': 'save', onclick: opts.onSave }, 'Save'), h('button', { class: 'btn', onclick: opts.onLoad }, 'Load last save'), h('span', { class: 'spacer' }), newBtn),
        h('div', { class: 'small muted' }, opts.saveInfo),
        h('h3', null, 'Settings'),
        h('div', { class: 'controls-grid' }, h('span', null, 'Graphics'), quality, h('span', null, 'Mouse sensitivity'), sens, h('span', null, 'Invert camera Y'), inv, h('span', null, 'Reduce camera shake'), shake, h('span', null, 'Performance overlay'), perf),
        h('div', { class: 'small dim' }, 'Graphics changes apply immediately (anti-aliasing applies after reload).'),
        h('h3', null, 'Controls'),
        controlsGrid(),
      ),
    ),
  );
}

// ---------------- Title ----------------
export type AccountView =
  | { state: 'checking' }
  | { state: 'unavailable' }
  | { state: 'signed_out'; busy?: boolean; error?: string }
  | { state: 'signed_in'; username: string; hasCloudSave: boolean; canImport: boolean; busy?: boolean; error?: string };

export interface TitleOptions {
  /** Guest play (saves only in this browser). */
  hasSave: boolean;
  loadError?: string;
  name: string;
  onName: (n: string) => void;
  onNew: () => void;
  onContinue: () => void;
  /** Accounts (character saved on the server). */
  account: AccountView;
  onSignIn: (username: string, password: string) => void;
  onRegister: (username: string, password: string) => void;
  onSignOut: () => void;
  onAccountContinue: () => void;
  onAccountNew: () => void;
  onImport: () => void;
  /** Character model (chosen per browser; others see it online). */
  characters?: Array<{ id: string; name: string; blurb: string }>;
  character?: string;
  onCharacter?: (id: string) => void;
}

export function titleScreen(opts: TitleOptions): HTMLElement {
  const a = opts.account;

  // ---- Character choice (applies to guest and account play) ----
  const chars = opts.characters ?? [];
  const cards: HTMLElement[] = [];
  const select = (id: string) => {
    for (const c of cards) {
      const on = c.dataset.id === id;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-checked', String(on));
    }
    opts.onCharacter?.(id);
  };
  for (const c of chars) {
    const on = c.id === opts.character;
    const card = h(
      'button',
      { class: `char-card${on ? ' selected' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(on), 'data-id': c.id, 'data-testid': `char-${c.id}`, onclick: () => select(c.id) },
      h('b', null, c.name),
      h('span', { class: 'small muted' }, c.blurb),
    );
    cards.push(card);
  }

  // ---- Account section ----
  let accountBlock: HTMLElement;
  if (a.state === 'signed_in') {
    let confirmNew = false;
    const newBtn = h('button', { class: `btn ${a.hasCloudSave || a.canImport ? '' : 'primary'}`, 'data-testid': 'acct-new', disabled: !!a.busy }, a.hasCloudSave ? 'New character…' : 'New character');
    newBtn.addEventListener('click', () => {
      if (a.hasCloudSave && !confirmNew) {
        confirmNew = true;
        newBtn.textContent = 'Click again: replace your saved character';
        return;
      }
      opts.onAccountNew();
    });
    accountBlock = h(
      'div',
      { class: 'acct' },
      h('div', { class: 'acct-who' }, h('span', { class: 'small muted' }, 'Signed in as '), h('b', { 'data-testid': 'acct-name' }, a.username), h('button', { class: 'linkish', 'data-testid': 'acct-signout', onclick: opts.onSignOut }, 'Sign out')),
      h(
        'div',
        { class: 'btns' },
        a.hasCloudSave ? h('button', { class: 'btn primary', 'data-testid': 'acct-continue', disabled: !!a.busy, onclick: opts.onAccountContinue }, 'Continue') : null,
        a.canImport ? h('button', { class: `btn ${a.hasCloudSave ? '' : 'primary'}`, 'data-testid': 'acct-import', disabled: !!a.busy, onclick: opts.onImport }, 'Bring this browser’s character into my account') : null,
        newBtn,
      ),
      a.canImport ? h('div', { class: 'small dim' }, 'This browser has a guest character. You can move it into your account.') : null,
      a.error ? h('div', { class: 'small bad', 'data-testid': 'acct-error' }, a.error) : null,
    );
  } else if (a.state === 'signed_out') {
    const user = h('input', { type: 'text', class: 'name-input', placeholder: 'Username', autocomplete: 'username', maxlength: 20, spellcheck: 'false', 'aria-label': 'Username', 'data-testid': 'acct-username' }) as HTMLInputElement;
    const pass = h('input', { type: 'password', class: 'name-input', placeholder: 'Password (8+ characters)', autocomplete: 'current-password', maxlength: 128, 'aria-label': 'Password', 'data-testid': 'acct-password' }) as HTMLInputElement;
    const form = h(
      'form',
      { class: 'acct-form' },
      user,
      pass,
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'acct-signin', disabled: !!a.busy }, a.busy ? 'Please wait…' : 'Sign in'),
        h('button', { class: 'btn', type: 'button', 'data-testid': 'acct-register', disabled: !!a.busy, onclick: () => opts.onRegister(user.value.trim(), pass.value) }, 'Create account'),
      ),
      a.error ? h('div', { class: 'small bad', 'data-testid': 'acct-error' }, a.error) : null,
      h('div', { class: 'small dim' }, 'An account keeps your character on the server, so you can play it from any computer.'),
    ) as HTMLFormElement;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      opts.onSignIn(user.value.trim(), pass.value);
    });
    accountBlock = h('div', { class: 'acct' }, form);
  } else if (a.state === 'checking') {
    accountBlock = h('div', { class: 'acct small muted' }, 'Connecting to the server…');
  } else {
    accountBlock = h('div', { class: 'acct small muted' }, 'Accounts are unavailable right now (offline). You can still play as a guest.');
  }

  // ---- Guest section ----
  const nameInput = h('input', { type: 'text', value: opts.name, maxlength: 20, 'aria-label': 'Guest name', 'data-testid': 'player-name', class: 'name-input', spellcheck: 'false' }) as HTMLInputElement;
  const commitName = () => opts.onName(nameInput.value);
  nameInput.addEventListener('change', commitName);
  // Keep the name as it's typed: the title redraws when the account check finishes.
  nameInput.addEventListener('input', () => nameInput.value.trim() && commitName());
  const go = (fn: () => void) => () => {
    commitName();
    fn();
  };
  const guestBlock =
    a.state === 'signed_in'
      ? null
      : h(
          'div',
          { class: 'guest' },
          h('div', { class: 'or' }, h('span', null, 'or play as a guest')),
          h('label', { class: 'name-row' }, h('span', { class: 'small muted' }, 'Guest name (shown to other players)'), nameInput),
          h(
            'div',
            { class: 'btns' },
            opts.hasSave ? h('button', { class: 'btn', 'data-testid': 'continue', onclick: go(opts.onContinue) }, 'Continue as guest') : null,
            h('button', { class: 'btn', 'data-testid': 'new-game', onclick: go(opts.onNew) }, opts.hasSave ? 'New guest game (overwrites)' : 'Play as guest'),
          ),
          h('div', { class: 'small dim' }, 'Guest progress is saved in this browser only.'),
          opts.loadError ? h('div', { class: 'small bad', style: 'margin-top:6px' }, opts.loadError) : null,
        );

  return h(
    'div',
    { class: 'title-screen' },
    h(
      'div',
      { class: 'title-card' },
      h('div', { class: 'logo' }, 'ALLOY ', h('span', null, 'FRONTIER')),
      h('div', { class: 'sub' }, 'The First Forge · vertical slice'),
      h('div', { class: 'rule' }),
      chars.length ? h('div', { class: 'char-row' }, h('span', { class: 'small muted' }, 'Choose your character'), h('div', { class: 'char-cards', role: 'radiogroup', 'aria-label': 'Character' }, ...cards)) : null,
      accountBlock,
      guestBlock,
      h('div', { class: 'foot' }, 'Prototype build · GDD v0.4 · Click the view to capture the mouse, Esc to release'),
    ),
  );
}

// ---------------- Quest summary ----------------
export function summaryPanel(session: Session, onClose: () => void): HTMLElement {
  const d = session.data;
  const item: ItemInstance | null = d.summary?.itemId ? (d.inventory.items[d.summary.itemId] ?? null) : null;
  const p = d.progression;
  const mins = d.stats.completedAt ? Math.round((d.stats.completedAt - d.stats.startedAt) / 60000) : null;
  const canvas = h('canvas', { style: 'width:100%;height:120px' });
  const body = h(
    'div',
    { class: 'panel-body', style: 'display:grid;gap:10px' },
    h('div', { class: 'muted' }, '"That edge is yours. Not bought, not found — made. Every adventurer who carries one of yours carries a piece of your name." — Master Smith Orla'),
    item ? h('div', { class: 'preview-wrap', style: 'height:120px' }, canvas) : null,
    item ? itemHeader(item) : h('div', { class: 'muted' }, 'No crafted weapon recorded.'),
    item ? traitsBlock(item) : null,
    item ? statTable(item, null) : null,
    h(
      'div',
      { class: 'controls-grid' },
      h('span', { class: 'muted' }, 'Blacksmithing mastery'),
      h('b', null, `${p.professions.blacksmithing.mastery} (started 10) · ${p.professions.blacksmithing.xp}/${smithXpToNext(p.professions.blacksmithing.mastery)} XP`),
      h('span', { class: 'muted' }, 'Longsword mastery'),
      h('b', null, `Level ${p.weaponMastery.longsword.level} · ${Math.round(p.weaponMastery.longsword.xp)}/${weaponXpToNext(p.weaponMastery.longsword.level)} XP`),
      h('span', { class: 'muted' }, 'Adventurer rank'),
      h('b', null, String(p.adventurer.rank)),
      h('span', { class: 'muted' }, 'Weapons forged'),
      h('b', null, String(d.stats.crafted)),
      h('span', { class: 'muted' }, 'Enemies defeated'),
      h('b', null, Object.entries(d.stats.kills).map(([k, v]) => `${v} ${k}`).join(', ') || '0'),
      h('span', { class: 'muted' }, 'Time'),
      h('b', null, mins !== null ? `${mins} min` : '—'),
    ),
    item ? h('details', null, h('summary', { class: 'small muted' }, 'Full item provenance record'), h('div', { class: 'prov' }, provenanceText(item))) : null,
    h('div', { class: 'row' }, h('span', { class: 'small dim' }, `${QUEST_EDGE_YOU_MAKE.name} complete. The forge stays open: try another recipe, specialization, or a hotter heat.`), h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: onClose }, 'Continue exploring')),
  );
  if (item) requestAnimationFrame(() => drawSword(canvas, item));
  return h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Quest complete' }, h('div', { class: 'panel summary' }, panelHead('Quest complete — The Edge You Made', onClose), body));
}
