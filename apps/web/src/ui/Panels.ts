/** Merchant, dialogue, pause/settings, title and summary panels. */
import { buildLabel } from '../buildInfo';
import { MERCHANT_STOCK, materialTotal, merchantPreview } from '@alloy/crafting';
import { itemDisplayName, type ItemInstance } from '@alloy/item-gen';
import { QUEST_EDGE_YOU_MAKE, smithXpToNext, weaponXpToNext } from '@alloy/game-rules';
import type { Session } from '../state/Session';
import type { CharacterSlot, CharacterSummary } from '../net/Accounts';
import { CHARACTER_NAME_MAX, CHARACTER_NAME_MIN, checkCharacterName } from '@alloy/session';
import { clear, h } from './dom';
import { drawSword, itemHeader, provenanceText, statTable, traitsBlock } from './ItemView';

const panelHead = (title: string, onClose: () => void, extra?: Node) =>
  h('div', { class: 'panel-head' }, h('h2', null, title), extra ?? null, h('button', { class: 'close-x', onclick: onClose, 'aria-label': 'Close', title: 'Close (Esc)' }, '✕'));

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
        const blurb = s.materialId === 'healing_salve' ? 'Restores health. Drink it with key 5.' : 'Buffer material for every forge recipe.';
        row.append(h('div', { class: 'small muted' }, `${blurb} Owned: ${materialTotal(this.session.inventory, s.materialId ?? 'binding_flux')}`));
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
  /** 0..1 */
  musicVolume: number;
  /** 0..1 */
  sfxVolume: number;
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
    ['I', 'Character, inventory, proficiencies, skills (Q / E switch)'],
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
  /** Text of a performance report for this machine (copied to the clipboard). */
  onPerfReport?: () => string;
  build?: string;
}): HTMLElement {
  const s = { ...opts.settings };
  // Performance report: copy to the clipboard; if the browser refuses, show it to copy by hand.
  const reportOut = h('textarea', { class: 'perf-report', readonly: true, rows: 11, 'aria-label': 'Performance report', 'data-testid': 'perf-report', style: 'display:none' }) as HTMLTextAreaElement;
  const reportNote = h('span', { class: 'small muted' }, 'Play for a minute first: the report covers the last ~10 seconds.');
  const reportBtn = h('button', { class: 'btn', 'data-testid': 'copy-perf-report' }, 'Copy performance report');
  reportBtn.addEventListener('click', () => {
    if (!opts.onPerfReport) return;
    const text = opts.onPerfReport();
    reportOut.value = text;
    reportOut.style.display = '';
    void navigator.clipboard
      ?.writeText(text)
      .then(() => (reportNote.textContent = 'Copied. Paste it into the playtest notes.'))
      .catch(() => (reportNote.textContent = 'Select the text below and copy it.'));
  });
  const quality = h('select', { 'aria-label': 'Graphics quality' }, ...(['low', 'medium', 'high'] as const).map((q) => h('option', { value: q, selected: q === s.quality }, q))) as HTMLSelectElement;
  const sens = h('input', { type: 'range', min: 0.3, max: 2.5, step: 0.1, value: s.sensitivity, 'aria-label': 'Mouse sensitivity' }) as HTMLInputElement;
  const inv = h('input', { type: 'checkbox', checked: s.invertY, 'aria-label': 'Invert Y' }) as HTMLInputElement;
  const perf = h('input', { type: 'checkbox', checked: s.showPerf, 'aria-label': 'Show performance' }) as HTMLInputElement;
  const shake = h('input', { type: 'checkbox', checked: s.reducedShake, 'aria-label': 'Reduce camera shake' }) as HTMLInputElement;
  const music = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.musicVolume, 'aria-label': 'Music volume', 'data-testid': 'music-volume' }) as HTMLInputElement;
  const sfx = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.sfxVolume, 'aria-label': 'Sound effects volume', 'data-testid': 'sfx-volume' }) as HTMLInputElement;
  const apply = () =>
    opts.onSettings({ quality: quality.value as Settings['quality'], sensitivity: Number(sens.value), invertY: inv.checked, showPerf: perf.checked, reducedShake: shake.checked, musicVolume: Number(music.value), sfxVolume: Number(sfx.value) });
  for (const el of [quality, sens, inv, perf, shake]) el.addEventListener('change', apply);
  // Volume applies while dragging.
  for (const el of [music, sfx]) el.addEventListener('input', apply);
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
        h('div', { class: 'controls-grid' }, h('span', null, 'Graphics'), quality, h('span', null, 'Mouse sensitivity'), sens, h('span', null, 'Invert camera Y'), inv, h('span', null, 'Reduce camera shake'), shake, h('span', null, 'Performance overlay'), perf, h('span', null, 'Music volume'), music, h('span', null, 'Sound effects volume'), sfx),
        h('div', { class: 'small dim' }, 'Graphics changes apply immediately (anti-aliasing applies after reload).'),
        opts.onPerfReport ? h('h3', null, 'Performance report') : null,
        opts.onPerfReport ? h('div', { class: 'row' }, reportBtn, reportNote) : null,
        opts.onPerfReport ? reportOut : null,
        h('h3', null, 'Controls'),
        controlsGrid(),
        opts.build ? h('div', { class: 'small dim', 'data-testid': 'build-label' }, `Build ${opts.build}`) : null,
      ),
    ),
  );
}

// ---------------- Title ----------------
export type AccountView =
  | { state: 'checking' }
  | { state: 'unavailable' }
  | { state: 'signed_out'; busy?: boolean; error?: string }
  /** slots: both character slots (null while loading); canImport: this browser has a guest character. */
  | { state: 'signed_in'; username: string; slots: CharacterSummary[] | null; canImport: boolean; busy?: boolean; error?: string; notice?: string };

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
  /** Character slots (signed in): play, start one in an empty slot, import the guest one, delete. */
  onPlaySlot: (slot: CharacterSlot) => void;
  onNewSlot: (slot: CharacterSlot, name: string) => void;
  onImportSlot: (slot: CharacterSlot, name: string) => void;
  /** Name a character made before names existed. */
  onNameSlot: (slot: CharacterSlot, name: string) => void;
  onDeleteSlot: (slot: CharacterSlot) => void;
  /** Character model (chosen per browser; others see it online). */
  characters?: Array<{ id: string; name: string; blurb: string }>;
  character?: string;
  onCharacter?: (id: string) => void;
}

const playTimeText = (s = 0) => {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`;
};

/**
 * One character slot on the title screen. Deleting is deliberately slow: the card turns red,
 * lists exactly what will be lost, and the delete button only works once DELETE is typed.
 */
/** A character-name box that checks the name as it's typed; `onValid` gets the tidied name or null. */
function nameField(slot: CharacterSlot, placeholder: string, onValid: (name: string | null) => void, initial = ''): HTMLElement {
  const input = h('input', { type: 'text', class: 'name-input', placeholder, maxlength: CHARACTER_NAME_MAX, autocomplete: 'off', spellcheck: 'false', value: initial, 'aria-label': 'Character name', 'data-testid': `slot-${slot}-name` }) as HTMLInputElement;
  const hint = h('div', { class: 'small dim name-hint', 'data-testid': `slot-${slot}-name-hint` }, `${CHARACTER_NAME_MIN}–${CHARACTER_NAME_MAX} letters; other players see it.`);
  const check = () => {
    const c = checkCharacterName(input.value);
    hint.textContent = input.value.trim() === '' ? `${CHARACTER_NAME_MIN}–${CHARACTER_NAME_MAX} letters; other players see it.` : c.ok ? `Other players will see “${c.name}”.` : c.message;
    hint.classList.toggle('bad', input.value.trim() !== '' && !c.ok);
    onValid(c.ok ? c.name : null);
  };
  input.addEventListener('input', check);
  queueMicrotask(check);
  return h('div', { class: 'name-field' }, input, hint);
}

function slotCard(s: CharacterSummary, a: Extract<AccountView, { state: 'signed_in' }>, opts: TitleOptions): HTMLElement {
  const label = `Character ${s.slot}`;
  const card = h('div', { class: `slot-card ${s.exists ? '' : 'empty'}`, 'data-testid': `slot-${s.slot}` });
  if (!s.exists) {
    let name: string | null = null;
    const create = h('button', { class: 'btn primary', 'data-testid': `slot-${s.slot}-new`, disabled: true, onclick: () => name && opts.onNewSlot(s.slot, name) }, 'Create character') as HTMLButtonElement;
    const imp = a.canImport ? (h('button', { class: 'btn', 'data-testid': `slot-${s.slot}-import`, disabled: true, onclick: () => name && opts.onImportSlot(s.slot, name) }, 'Bring this browser’s character here') as HTMLButtonElement) : null;
    card.append(
      h('div', { class: 'slot-head' }, h('b', null, label), h('span', { class: 'small muted' }, 'Empty slot')),
      nameField(s.slot, 'Name your new character', (n) => {
        name = n;
        create.disabled = !n || !!a.busy;
        if (imp) imp.disabled = !n || !!a.busy;
      }),
      h('div', { class: 'btns' }, create, imp),
    );
    return card;
  }
  if (!s.name) {
    // Made before names existed: it needs a name before it can play.
    let name: string | null = null;
    const save = h('button', { class: 'btn primary', 'data-testid': `slot-${s.slot}-save-name`, disabled: true, onclick: () => name && opts.onNameSlot(s.slot, name) }, 'Save name') as HTMLButtonElement;
    card.classList.add('unnamed');
    card.append(
      h('div', { class: 'slot-head' }, h('b', null, label), h('span', { class: 'small muted' }, `Rank ${s.rank ?? 1} · ${playTimeText(s.playTime)} played`)),
      h('div', { class: 'small' }, 'This character doesn’t have a name yet. Name it to play; other players will see it.'),
      nameField(s.slot, 'Name this character', (n) => {
        name = n;
        save.disabled = !n || !!a.busy;
      }),
      h('div', { class: 'btns' }, save),
    );
    return card;
  }
  const total = QUEST_EDGE_YOU_MAKE.steps.length;
  const quest = s.questDone ? 'Quest complete' : `Quest step ${(s.questStep ?? 0) + 1}/${total}`;
  const facts: Array<[string, string]> = [
    ['Rank', String(s.rank ?? 1)],
    ['Blacksmith', String(s.smithMastery ?? 1)],
    ['Weapon mastery', String(s.weaponLevel ?? 1)],
    ['Coins', String(s.coins ?? 0)],
    ['Played', playTimeText(s.playTime)],
  ];
  const summary = h('div', { class: 'slot-facts' }, ...facts.map(([k, v]) => h('span', null, h('span', { class: 'k' }, k), ' ', h('b', null, v))), h('span', { class: 'small muted' }, quest));
  const deleteBtn = h('button', { class: 'linkish danger-link', 'data-testid': `slot-${s.slot}-delete`, disabled: !!a.busy }, 'Delete…');
  const main = h(
    'div',
    null,
    h('div', { class: 'slot-head' }, h('b', { class: 'slot-name', 'data-testid': `slot-${s.slot}-title` }, s.name), h('span', { class: 'small muted' }, label), h('span', { class: 'spacer' }), deleteBtn),
    summary,
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-testid': `slot-${s.slot}-play`, disabled: !!a.busy, onclick: () => opts.onPlaySlot(s.slot) }, 'Play')),
  );
  card.append(main);
  deleteBtn.addEventListener('click', () => {
    // Confirmation: red card, what will be lost, typed DELETE, a separate red button.
    const typed = h('input', { type: 'text', class: 'name-input danger-input', placeholder: 'Type DELETE', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Type DELETE to delete ${s.name}`, 'data-testid': `slot-${s.slot}-confirm-text` }) as HTMLInputElement;
    const confirm = h('button', { class: 'btn danger', disabled: true, 'data-testid': `slot-${s.slot}-confirm-delete` }, `Delete ${s.name} forever`) as HTMLButtonElement;
    typed.addEventListener('input', () => (confirm.disabled = typed.value.trim() !== 'DELETE'));
    confirm.addEventListener('click', () => {
      if (typed.value.trim() !== 'DELETE') return;
      confirm.disabled = true;
      confirm.textContent = 'Deleting…';
      opts.onDeleteSlot(s.slot);
    });
    const cancel = h('button', { class: 'btn', 'data-testid': `slot-${s.slot}-cancel-delete` }, 'Cancel, keep it');
    const danger = h(
      'div',
      { class: 'slot-danger', role: 'alertdialog', 'aria-label': `Delete ${s.name}?` },
      h('div', { class: 'danger-title' }, `⚠ Delete ${s.name} (${label})?`),
      h('div', { class: 'small' }, 'You will lose this character for good:'),
      h('div', { class: 'slot-facts lost' }, ...facts.map(([k, v]) => h('span', null, h('span', { class: 'k' }, k), ' ', h('b', null, v))), h('span', null, h('b', null, quest))),
      h('div', { class: 'small' }, 'All of its items, materials, equipment and progress go with it. The game can’t bring it back.'),
      typed,
      h('div', { class: 'btns' }, cancel, confirm),
    );
    cancel.addEventListener('click', () => {
      danger.remove();
      card.classList.remove('deleting');
      main.style.display = '';
    });
    card.classList.add('deleting');
    main.style.display = 'none';
    card.append(danger);
    typed.focus();
  });
  return card;
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
    accountBlock = h(
      'div',
      { class: 'acct' },
      h('div', { class: 'acct-who' }, h('span', { class: 'small muted' }, 'Signed in as '), h('b', { 'data-testid': 'acct-name' }, a.username), h('button', { class: 'linkish', 'data-testid': 'acct-signout', onclick: opts.onSignOut }, 'Sign out')),
      a.slots === null
        ? h('div', { class: 'small muted' }, 'Loading your characters…')
        : h('div', { class: 'slots', 'data-testid': 'char-slots' }, ...a.slots.map((s) => slotCard(s, a, opts))),
      a.notice ? h('div', { class: 'small good', 'data-testid': 'acct-notice' }, a.notice) : null,
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
  // The live name box (a redraw may have moved the previous one in place of this one).
  const liveName = () => (nameInput.isConnected ? nameInput : ((document.querySelector('[data-testid="player-name"]') as HTMLInputElement | null) ?? nameInput));
  const commitName = () => opts.onName(liveName().value);
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
      h('div', { class: 'foot' }, `Prototype ${buildLabel()} · GDD v0.5 · Click the view to capture the mouse, Esc to release`),
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
