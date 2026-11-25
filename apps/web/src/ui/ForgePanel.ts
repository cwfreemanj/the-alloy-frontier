/**
 * Forge interface (GDD 7.3, 7.5; AF-006).
 * Left: blueprints, materials, mastery. Centre: the blade, the steps, Orla's guidance and the
 * forging interaction. Right: projected stats against your weapon, why the numbers are what
 * they are, and how the same steel fares in other hands.
 *
 * Everything shown is computed by the same rules that make the item (@alloy/crafting); the
 * exact maths sits in hover tooltips so the screen reads plainly first.
 */
import {
  HEAT_LEVELS,
  MERCHANT_STOCK,
  applyStrike,
  averageQuality,
  boardFor,
  materialTotal,
  merchantPreview,
  planForge,
  scoreState,
  startHammering,
  strikeTargets,
  suggestStrike,
  type ForgeRequest,
  type HammerBoard,
  type HammerState,
  type StrikeKind,
} from '@alloy/crafting';
import { smithXpToNext } from '@alloy/game-rules';
import {
  CRAFTABLE_BLUEPRINTS,
  IMBUEMENTS,
  RARITY_LABEL,
  SPECIALIZATIONS,
  TEMPERS,
  bufferFactor,
  getBlueprint,
  materialName,
  smithFactor,
  type HeatLevel,
  type ItemInstance,
  type Specialization,
  type TemperStrategy,
} from '@alloy/item-gen';
import { RARITY_COLORS } from '../entities/Weapons';
import type { Session } from '../state/Session';
import { clear, h } from './dom';
import { icon } from './icons';
import { drawSword, itemHeader, statTable, traitsBlock } from './ItemView';

type Stage = 'setup' | 'heat' | 'hammer' | 'temper' | 'done';
/** Feedback the game plays for the forge (sound). */
export type ForgeFx = 'strike' | 'overwork' | 'step';

const TIPS_KEY = 'alloy-frontier.forge-tips';
/** The screen is laid out at this size and scaled to fit the window, so nothing ever scrolls. */
const DESIGN_W = 1640;
const DESIGN_H = 900;
const SPEC_ICON: Record<Specialization, string> = { balanced: 'scales', keen: 'slash', heavy: 'guard', agile: 'feather' };
const HEAT_COLOR: Record<string, string> = { dull: '#b0442a', cherry: '#ff6a2a', bright: '#ffd36a' };
const TEMPER_ICON: Record<string, string> = { oil: 'quench', water: 'quench', air: 'feather' };
const MAT_ICON: Record<string, string> = { iron_ore: 'ore', ironwood: 'log', ironglass: 'crystal', binding_flux: 'flask' };

const section = (ico: string, title: string, extra?: HTMLElement | null) => h('h3', { class: 'fx-h' }, icon(ico), h('span', null, title), extra ?? null);

export class ForgePanel {
  readonly el: HTMLElement;
  private blueprintId = 'iron_longsword';
  private mode: 'quick' | 'masterwork' = 'quick';
  private buffer = 2;
  private spec: Specialization = 'balanced';
  private temper: TemperStrategy = 'oil';
  private heat: HeatLevel = 'cherry';
  private stage: Stage = 'setup';
  private board: HammerBoard | null = null;
  private hammer: HammerState | null = null;
  private strikeKind: StrikeKind = 'spread';
  private cells: HTMLElement[] = [];
  private result: ItemInstance | null = null;
  private txId: string;
  private busy = false;
  /** The cells the last strike hit (for the flash and sparks), and whether it overworked. */
  private flash: { cells: number[]; over: boolean } | null = null;
  private tips = true;

  constructor(
    private session: Session,
    private onClose: () => void,
    private onEquip: (itemId: string) => void,
    /** Asks the authority to forge (server for accounts, this browser for guests). */
    private onForge: (req: Omit<ForgeRequest, 'maker' | 'createdAt'>) => Promise<{ ok: boolean; item?: ItemInstance }>,
    private fx: (f: ForgeFx) => void = () => {},
  ) {
    this.el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Forge' });
    // Re-fit when the window changes size (stops with the overlay when it is removed).
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fit()).observe(this.el);
    this.txId = session.nextTxId('forge');
    try {
      this.tips = localStorage.getItem(TIPS_KEY) !== 'off';
    } catch {
      /* storage unavailable: keep tips on */
    }
    const first = CRAFTABLE_BLUEPRINTS.find((b) => this.canAfford(b.id)) ?? CRAFTABLE_BLUEPRINTS[0];
    this.selectBlueprint(first.id);
    if (this.session.passed('quick_forge') && !this.session.passed('masterwork')) this.mode = 'masterwork';
    this.render();
  }

  private get mastery(): number {
    return this.session.smithMastery;
  }
  /** New smiths (nothing forged yet) get the fuller explanations open. */
  private get novice(): boolean {
    return this.session.data.stats.crafted < 2;
  }

  private quickAllowed(): boolean {
    return this.session.passed('compare');
  }
  private masterworkAllowed(): boolean {
    return this.session.passed('quick_forge');
  }

  private canAfford(bpId: string): boolean {
    const bp = getBlueprint(bpId)!;
    return bp.materials.every((m) => materialTotal(this.session.inventory, m.materialId) >= m.quantity) && materialTotal(this.session.inventory, bp.buffer.materialId) >= bp.buffer.min;
  }

  private selectBlueprint(id: string): void {
    this.blueprintId = id;
    const bp = getBlueprint(id)!;
    // Default to the required minimum; extra buffer is an explicit, previewed choice.
    this.buffer = bp.buffer.min;
    this.resetMasterwork();
  }

  private resetMasterwork(): void {
    this.stage = 'setup';
    this.board = null;
    this.hammer = null;
    this.result = null;
    this.flash = null;
  }

  private go(stage: Stage): void {
    this.stage = stage;
    this.fx('step');
    this.render();
  }

  private request(): Omit<ForgeRequest, 'maker' | 'createdAt'> {
    return {
      txId: this.txId,
      blueprintId: this.blueprintId,
      mode: this.mode,
      bufferQuantity: this.buffer,
      specialization: this.mode === 'masterwork' ? this.spec : undefined,
      temper: this.mode === 'masterwork' ? this.temper : undefined,
      evidence: this.mode === 'masterwork' && this.hammer ? { heat: this.heat, strikes: this.hammer.log } : undefined,
    };
  }

  private currentScore(): number | null {
    if (!this.board || !this.hammer) return null;
    return scoreState(this.board, this.heat, this.hammer);
  }

  private preview(mastery = this.mastery, scoreOverride?: number, bufferOverride?: number) {
    const req: ForgeRequest = { ...this.request(), maker: { id: 'preview', name: 'You', mastery }, createdAt: Date.now() };
    if (bufferOverride !== undefined) req.bufferQuantity = bufferOverride;
    const score = scoreOverride ?? this.currentScore() ?? 0.75;
    return planForge(this.session.inventory, req, this.mode === 'masterwork' ? { previewScore: score } : {});
  }

  render(): void {
    clear(this.el);
    const panel = h(
      'div',
      { class: 'panel forge fx' },
      h(
        'div',
        { class: 'fx-head' },
        h('div', { class: 'fx-emblem' }, icon('forge')),
        h('h2', null, 'Emberhold Forge'),
        h('div', { class: 'fx-tagline' }, h('span', { class: 'orn' }, '◆'), 'Craftsmanship transforms ordinary steel. Every projection below is computed by the same rules that make the item.', h('span', { class: 'orn' }, '◆')),
        h('button', { class: 'close-x', onclick: () => this.onClose(), 'aria-label': 'Close forge', title: 'Close (Esc)' }, '✕'),
      ),
      h('div', { class: 'forge-grid' }, this.renderLeft(), this.renderCenter(), this.renderRight()),
    );
    this.el.append(panel);
    this.fit();
    const canvas = this.el.querySelector<HTMLCanvasElement>('canvas.sword');
    if (canvas) requestAnimationFrame(() => drawSword(canvas, this.result ?? (this.preview().ok ? (this.preview() as { ok: true; plan: { item: ItemInstance } }).plan.item : null), this.blueprintId));
  }

  /** Scale the screen to the window: everything visible at once, never a scrollbar. */
  private fit(): void {
    const panel = this.el.querySelector<HTMLElement>('.fx');
    if (!panel) return;
    const w = this.el.clientWidth || window.innerWidth;
    const hgt = this.el.clientHeight || window.innerHeight;
    const k = Math.min((w - 24) / DESIGN_W, (hgt - 24) / DESIGN_H, 1.35);
    panel.style.transform = `translate(-50%, -50%) scale(${Math.max(0.4, k)})`;
  }

  // ---------------- Left: blueprints, materials, mastery ----------------
  private renderLeft(): HTMLElement {
    const inv = this.session.inventory;
    const b = this.session.data.progression.professions.blacksmithing;
    const col = h('div', { class: 'forge-col' });
    col.append(section('scroll', 'Blueprints'));
    const list = h('div', { class: 'list' });
    for (const bp of CRAFTABLE_BLUEPRINTS) {
      const locked = this.mastery < bp.masteryRequirement;
      const afford = this.canAfford(bp.id);
      const reqs = bp.materials.map((m) => {
        const have = materialTotal(inv, m.materialId);
        return h('span', { class: `req ${have >= m.quantity ? 'ok' : 'no'}` }, `${materialName(m.materialId)} ${have}/${m.quantity}`);
      });
      const bufHave = materialTotal(inv, bp.buffer.materialId);
      reqs.push(h('span', { class: `req ${bufHave >= bp.buffer.min ? 'ok' : 'no'}` }, `Flux ≥${bp.buffer.min} (${bufHave})`));
      const glass = bp.materials.some((m) => m.materialId === 'ironglass');
      list.append(
        h(
          'button',
          {
            class: `card bp-card ${bp.id === this.blueprintId ? 'selected' : ''} ${locked ? 'disabled' : ''}`,
            'data-blueprint': bp.id,
            onclick: () => {
              if (locked || this.busy) return;
              this.selectBlueprint(bp.id);
              this.txId = this.session.nextTxId('forge');
              this.render();
            },
          },
          h('div', { class: `bp-thumb ${glass ? 'glass' : ''}` }, icon('weapon')),
          h(
            'div',
            { class: 'bp-body' },
            h('div', { class: 'row' }, h('span', { class: 'ttl' }, bp.name), h('span', { class: 'spacer' }), locked ? h('span', { class: 'tag bad' }, `Mastery ${bp.masteryRequirement}`) : afford ? h('span', { class: 'tag good' }, 'Ready') : h('span', { class: 'tag dim' }, 'Missing')),
            h('div', { class: 'sub' }, `${bp.tier} · base ${bp.baseDamage} dmg · ${bp.baseAttackSpeed.toFixed(2)}× speed`),
            h('div', { class: 'sub reqs' }, ...reqs),
            bp.potentialImbuements.length ? h('div', { class: 'sub cyan' }, icon('storm'), ` Potential: ${bp.potentialImbuements.map((i) => IMBUEMENTS[i]?.name).join(', ')}`) : null,
          ),
        ),
      );
    }
    col.append(list);
    col.append(section('box', 'Materials'));
    const mats = h('div', { class: 'fx-mats' });
    for (const id of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux'] as const) {
      const q = averageQuality(inv, id);
      mats.append(
        h(
          'div',
          { class: `fx-mat m-${id}`, title: 'Quality comes from where it was gathered. Better material makes stronger steel.' },
          h('span', { class: 'mi' }, icon(MAT_ICON[id])),
          h('span', null, materialName(id)),
          h('b', null, String(materialTotal(inv, id))),
          h('span', { class: 'q' }, q === null ? '—' : `q ${Math.round(q * 100)}%`),
        ),
      );
    }
    col.append(mats);
    col.append(h('div', { class: 'small dim', style: 'margin-top:4px' }, 'Best-quality lots are used first. Quality comes from each deposit\'s procedural traits.'));
    col.append(section('smithing', 'Blacksmithing mastery'));
    const need = smithXpToNext(b.mastery);
    col.append(
      h('div', { class: 'fx-mastery', title: `Every blade you forge trains this. Your smith factor multiplies the damage of everything you make (×${smithFactor(b.mastery).toFixed(3)} now).` }, h('b', null, String(b.mastery)), h('span', null, `Smith factor ×${smithFactor(b.mastery).toFixed(3)}`)),
      h('div', { class: 'meter ember-meter', style: 'margin-top:6px' }, h('div', { style: `width:${Math.min(100, (b.xp / need) * 100)}%` })),
      h('div', { class: 'small muted' }, `${b.xp}/${need} XP to mastery ${b.mastery + 1}. Open-ended: no hard cap.`),
    );
    return col;
  }

  // ---------------- Centre ----------------
  private renderCenter(): HTMLElement {
    const col = h('div', { class: 'forge-col forge-center' });
    const tabs = h(
      'div',
      { class: 'mode-tabs', role: 'tablist' },
      h('button', { class: this.mode === 'quick' ? 'active' : '', role: 'tab', 'data-mode': 'quick', disabled: !this.quickAllowed() || this.stage !== 'setup', onclick: () => this.setMode('quick') }, 'Quick Forge'),
      h(
        'button',
        { class: this.mode === 'masterwork' ? 'active' : '', role: 'tab', 'data-mode': 'masterwork', disabled: !this.masterworkAllowed() || this.stage !== 'setup', title: this.masterworkAllowed() ? '' : 'Complete a Quick Forge first', onclick: () => this.setMode('masterwork') },
        'Masterwork Forge',
      ),
    );
    col.append(tabs);
    if (!this.quickAllowed()) {
      col.append(this.orla('Before you strike iron, go see what Bram sells. Know what coin buys, then show me what your hands can do.', true));
      return col;
    }
    col.append(h('div', { class: 'fx-showcase' }, h('canvas', { class: 'sword', 'aria-label': 'Weapon preview' }), h('div', { class: 'fx-anvil' })));
    if (this.mode === 'masterwork' && !this.result) col.append(this.stepTrack());
    const tip = this.tipFor();
    if (tip) col.append(this.orla(tip));

    const body = h('div', { class: 'fx-body' });
    if (this.result) body.append(this.renderResult());
    else if (this.mode === 'quick') body.append(this.renderBuffer(), this.renderQuickConfirm());
    else body.append(this.renderMasterwork());
    col.append(body);
    return col;
  }

  /** What Orla would tell you right now, in plain words. */
  private tipFor(): string | null {
    if (this.result) return 'Look at what your hands made. Compare it with what you carry, then equip it or forge another.';
    if (this.mode === 'quick')
      return 'Quick Forge makes a solid blade with no fuss. Pick a blueprint you have the materials for, then press Forge. When you want a better blade, try the Masterwork Forge.';
    switch (this.stage) {
      case 'setup':
        return 'First, prepare. Choose how much Binding Flux to use (a little more is a little better, each extra batch helps less) and the fighting style of the blade. Nothing is used up until you finish.';
      case 'heat':
        return 'How hot do you work the ingot? Hotter metal gives you more hammer strikes, but every wasted strike costs you more. Cherry Red is a good start.';
      case 'hammer':
        return 'The numbers are stress trapped in the metal. Strike to bring them down to 0 before your strikes run out. Red outlines mean a wasted strike on metal already at 0. Stuck? Press Hint.';
      case 'temper':
        return 'Now cool the blade. Each route trades steadiness for performance; read the cards, then quench.';
      default:
        return null;
    }
  }

  private orla(text: string, always = false): HTMLElement {
    if (!this.tips && !always)
      return h('button', { class: 'linkish fx-tips-on', onclick: () => this.setTips(true) }, 'Show Orla’s guidance');
    return h(
      'div',
      { class: `fx-orla ${this.novice ? 'novice' : ''}`, 'data-testid': 'forge-guide' },
      h('div', { class: 'who' }, icon('smithing'), h('b', null, 'Orla')),
      h('div', { class: 'say' }, text),
      always ? null : h('button', { class: 'x', title: 'Hide guidance', 'aria-label': 'Hide guidance', onclick: () => this.setTips(false) }, '✕'),
    );
  }

  private setTips(on: boolean): void {
    this.tips = on;
    try {
      localStorage.setItem(TIPS_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    this.render();
  }

  private stepTrack(): HTMLElement {
    const steps: Array<[Stage, string, string]> = [
      ['setup', '1 · Prepare', 'ingot'],
      ['heat', '2 · Heat', 'flame'],
      ['hammer', '3 · Hammer', 'hammer'],
      ['temper', '4 · Temper', 'quench'],
    ];
    const order: Stage[] = ['setup', 'heat', 'hammer', 'temper', 'done'];
    const now = order.indexOf(this.stage);
    return h(
      'div',
      { class: 'fx-steps stepper' },
      ...steps.map(([s, l, ic]) => {
        const i = order.indexOf(s);
        return h('div', { class: `fx-step ${i === now ? 'on' : i < now ? 'done' : ''}` }, h('div', { class: 'node' }, icon(i < now ? 'guard' : ic)), h('span', null, l));
      }),
    );
  }

  private setMode(m: 'quick' | 'masterwork'): void {
    if (this.busy) return;
    this.mode = m;
    this.spec = m === 'quick' ? 'balanced' : this.spec;
    this.resetMasterwork();
    this.txId = this.session.nextTxId('forge');
    this.render();
  }

  private renderBuffer(): HTMLElement {
    const bp = getBlueprint(this.blueprintId)!;
    const owned = materialTotal(this.session.inventory, bp.buffer.materialId);
    const max = Math.max(bp.buffer.min, Math.min(owned, bp.buffer.min + 30));
    const bf = bufferFactor(this.buffer, bp.buffer.standardBatch);
    const bfMin = bufferFactor(bp.buffer.min, bp.buffer.standardBatch);
    const bfNext = bufferFactor(this.buffer + bp.buffer.standardBatch, bp.buffer.standardBatch);
    const at = (q: number) => {
      const r = this.preview(this.mastery, undefined, q);
      return r.ok ? r.plan.item.forge.formulaDamage : null;
    };
    const dmgNow = at(this.buffer);
    const dmgMin = at(bp.buffer.min);
    const input = h('input', {
      type: 'range',
      min: bp.buffer.min,
      max,
      step: 1,
      value: this.buffer,
      'aria-label': 'Buffer quantity',
      'data-testid': 'buffer-slider',
      disabled: this.stage !== 'setup' && this.stage !== 'temper',
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      this.buffer = Number(input.value);
      this.render();
    });
    return h(
      'div',
      { class: 'buffer-box', title: 'Binding Flux holds the alloy together. The minimum is required; more improves the steel a little, and each extra batch adds less than the one before.' },
      h('div', { class: 'row' }, h('span', { class: 'mi' }, icon('flask')), h('b', null, `Binding Flux (buffer): ${this.buffer}`), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `required ${bp.buffer.min} · owned ${owned} · batch ${bp.buffer.standardBatch}`)),
      input,
      h(
        'div',
        { class: 'small fx-buf-stats' },
        h('div', null, h('div', { class: 'dim' }, 'Buffer factor'), h('b', { class: 'mono' }, `×${bf.toFixed(4)}`)),
        h('div', null, h('div', { class: 'dim' }, `vs minimum (${bp.buffer.min})`), h('b', { class: 'mono good' }, `+${((bf / bfMin - 1) * 100).toFixed(2)}%`), dmgNow !== null && dmgMin !== null ? h('span', { class: 'muted mono' }, ` (${dmgMin}→${dmgNow} dmg)`) : null),
        h('div', null, h('div', { class: 'dim' }, `+1 batch (${bp.buffer.standardBatch} more)`), h('b', { class: 'mono cyan' }, `+${((bfNext / bf - 1) * 100).toFixed(2)}%`), h('span', { class: 'muted' }, ' (diminishing)')),
      ),
      h('div', { class: 'small dim', style: 'margin-top:4px' }, `Consumes ${this.buffer} flux. Extra flux never makes the result worse; each batch adds less than the last.`),
    );
  }

  private missingReason(): string | null {
    const r = this.preview();
    return r.ok ? null : r.message;
  }

  private renderQuickConfirm(): HTMLElement {
    const reason = this.missingReason();
    return h(
      'div',
      { class: 'row' },
      h('div', { class: 'small muted' }, 'Quick Forge: predictable, serviceable output in the standard Balanced pattern. Limited customisation (up to Uncommon).'),
      h('span', { class: 'spacer' }),
      reason ? h('span', { class: 'small bad' }, reason) : null,
      h('button', { class: 'btn primary fx-go', disabled: !!reason || this.busy, 'data-testid': 'quick-forge-confirm', onclick: () => this.commit() }, icon('hammer'), 'Forge'),
    );
  }

  private choiceCard(selected: boolean, ico: string, title: string, sub: string, attrs: Record<string, string>, onPick: () => void): HTMLElement {
    return h('button', { ...attrs, class: `card fx-choice ${attrs.class ?? ''} ${selected ? 'selected' : ''}`, onclick: onPick }, h('span', { class: 'ci' }, icon(ico)), h('div', null, h('div', { class: 'ttl' }, title), h('div', { class: 'sub' }, sub)));
  }

  private renderMasterwork(): HTMLElement {
    const wrap = h('div', { style: 'display:grid;gap:10px' });
    if (this.stage === 'setup') {
      wrap.append(this.renderBuffer());
      wrap.append(h('div', { class: 'fx-sub-h' }, '→ Specialization'));
      const bp = getBlueprint(this.blueprintId)!;
      wrap.append(
        h(
          'div',
          { class: 'choices' },
          ...bp.allowedSpecializations.map((s) => this.choiceCard(this.spec === s, SPEC_ICON[s] ?? 'weapon', SPECIALIZATIONS[s].name, SPECIALIZATIONS[s].description, { 'data-spec': s }, () => ((this.spec = s), this.render()))),
        ),
      );
      const reason = this.missingReason();
      wrap.append(
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'small muted' }, icon('info'), ' Materials are only consumed when you finish. Leaving midway costs nothing.'),
          h('span', { class: 'spacer' }),
          reason ? h('span', { class: 'small bad' }, reason) : null,
          h('button', { class: 'btn primary fx-go', disabled: !!reason, 'data-testid': 'mw-begin', onclick: () => this.go('heat') }, icon('forge'), 'Begin forging'),
        ),
      );
    } else if (this.stage === 'heat') {
      wrap.append(
        h(
          'div',
          { class: 'choices' },
          ...(Object.keys(HEAT_LEVELS) as HeatLevel[]).map((k) => {
            const lv = HEAT_LEVELS[k];
            return this.choiceCard(this.heat === k, 'flame', lv.name, lv.description, { 'data-heat': k, class: 'heat-card', style: `--heat:${HEAT_COLOR[k] ?? '#ff6a2a'}` }, () => ((this.heat = k), this.render()));
          }),
        ),
      );
      wrap.append(
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => this.go('setup') }, 'Back'),
          h('span', { class: 'spacer' }),
          h(
            'button',
            {
              class: 'btn primary fx-go',
              'data-testid': 'mw-heat-confirm',
              onclick: () => {
                this.board = boardFor(this.session.inventory, this.blueprintId);
                this.hammer = startHammering(this.board, this.heat, this.mastery);
                this.go('hammer');
              },
            },
            icon('flame'),
            'Heat the ingot',
          ),
        ),
      );
    } else if (this.stage === 'hammer' && this.board && this.hammer) {
      wrap.append(this.renderHammer());
    } else if (this.stage === 'temper') {
      wrap.append(
        h(
          'div',
          { class: 'choices' },
          ...(['oil', 'water', 'air'] as TemperStrategy[]).map((t) => this.choiceCard(this.temper === t, TEMPER_ICON[t] ?? 'quench', TEMPERS[t].name, TEMPERS[t].description, { 'data-temper': t }, () => ((this.temper = t), this.render()))),
        ),
      );
      const reason = this.missingReason();
      wrap.append(
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'small muted' }, `Hammering quality locked at ${Math.round((this.currentScore() ?? 0) * 100)}%.`),
          h('span', { class: 'spacer' }),
          reason ? h('span', { class: 'small bad' }, reason) : null,
          h('button', { class: 'btn primary fx-go', disabled: !!reason || this.busy, 'data-testid': 'mw-finish', onclick: () => this.commit() }, icon('quench'), 'Quench & finish'),
        ),
      );
    }
    return wrap;
  }

  /** Plain-language rules for the hammer stage: what stress and overwork actually do. */
  private hammerExplainer(): HTMLElement {
    const penalty = HEAT_LEVELS[this.heat].overworkPenalty;
    return h(
      'details',
      { class: 'explain', open: this.novice },
      h('summary', null, 'How hammering works'),
      h(
        'ul',
        null,
        h('li', null, h('b', null, 'Stress'), ' is tension trapped in the metal (the numbers). Every point you leave behind lowers ', h('b', null, 'structure quality'), '.'),
        h('li', null, h('b', null, 'Spread'), ' takes 1 from a cell and its 4 neighbours. ', h('b', null, 'Focused'), ' takes 2 from one cell.'),
        h(
          'li',
          null,
          h('b', null, 'Overworking'),
          ' means hitting metal that is already at 0 (including the 0-cells a spread strike touches, or a focused strike on a 1). ',
          penalty > 0 ? `At ${HEAT_LEVELS[this.heat].name}, each one counts as ${penalty} extra stress against your quality.` : `At ${HEAT_LEVELS[this.heat].name} it costs nothing, it just wastes the strike.`,
        ),
        h('li', null, 'Higher structure quality means more damage and can awaken hidden powers.'),
      ),
    );
  }

  /** What the current structure quality means for the finished weapon. */
  private qualityEffects(score: number): HTMLElement {
    const ff = 0.95 + 0.3 * score;
    const bp = getBlueprint(this.blueprintId);
    const lines: Array<HTMLElement> = [h('div', { title: 'Structure quality 0% gives ×0.950 damage, 100% gives ×1.250.' }, `Damage ×${ff.toFixed(3)} `, h('span', { class: 'dim' }, '(up to ×1.250 at 100%)'))];
    const imb = bp?.potentialImbuements[0];
    if (imb) {
      const catalyst = bp!.materials.some((r) => r.materialId === 'ironglass') ? averageQuality(this.session.inventory, 'ironglass') ?? 0 : 0;
      const resonance = score * 0.7 + catalyst * 0.3;
      const needed = Math.max(0, Math.min(1, (0.6 - catalyst * 0.3) / 0.7));
      const name = IMBUEMENTS[imb]?.name ?? imb;
      lines.push(
        h(
          'div',
          { class: resonance >= 0.6 ? 'good' : 'bad', title: 'Resonance = structure quality × 0.7 + ironglass quality × 0.3. It awakens at 60%.' },
          resonance >= 0.6 ? `⚡ ${name} will awaken (${Math.round(resonance * 100)}% resonance)` : `${name} dormant: reach about ${Math.ceil(needed * 100)}% quality to awaken it`,
        ),
      );
    }
    return h('div', { class: 'small', style: 'display:grid;gap:2px' }, ...lines);
  }

  private renderHammer(): HTMLElement {
    const board = this.board!;
    const st = this.hammer!;
    const score = scoreState(board, this.heat, st);
    const initial = board.cells.reduce((a, b) => a + b, 0);
    const remaining = st.cells.reduce((a, b) => a + b, 0);
    const grid = h('div', { class: 'board', style: `grid-template-columns:repeat(${board.size},54px)`, role: 'grid', 'aria-label': 'Ingot stress grid' });
    this.cells = [];
    const flash = this.flash;
    this.flash = null;
    for (let y = 0; y < board.size; y++)
      for (let x = 0; x < board.size; x++) {
        const i = y * board.size + x;
        const v = st.cells[i];
        const hit = flash?.cells.includes(i);
        const cell = h(
          'button',
          {
            class: `cell s${v} ${hit ? (flash!.over && v === 0 ? 'struck over-hit' : 'struck') : ''}`,
            'data-x': x,
            'data-y': y,
            'aria-label': `Row ${y + 1} column ${x + 1}, stress ${v}`,
            onclick: () => this.strike(x, y),
            onmouseenter: () => this.highlight(x, y),
            onfocus: () => this.highlight(x, y),
            onmouseleave: () => this.highlight(-1, -1),
          },
          String(v),
          h('span', { class: 'pips' }, '•'.repeat(v)),
        );
        if (hit) for (let k = 0; k < 5; k++) cell.append(h('span', { class: 'spark', style: `--dx:${Math.round((Math.random() - 0.5) * 60)}px;--dy:${Math.round(-10 - Math.random() * 30)}px;animation-delay:${k * 20}ms` }));
        this.cells.push(cell);
        grid.append(cell);
      }
    const left = st.strikesAllowed - st.strikesUsed;
    const penalty = HEAT_LEVELS[this.heat].overworkPenalty;
    const strikeBtn = (kind: StrikeKind, title: string, sub: string, glyph: string) =>
      h('button', { class: `fx-strike ${this.strikeKind === kind ? 'on' : ''}`, 'data-strike': kind, onclick: () => ((this.strikeKind = kind), this.render()) }, h('span', { class: 'g' }, glyph), h('span', null, h('b', null, title), h('span', { class: 'sub' }, sub)));
    const side = h(
      'div',
      { class: 'fx-hammer-side' },
      h('div', { class: 'fx-strikes' }, strikeBtn('spread', 'Spread strike', '−1 to a cell and its 4 neighbours', '✚'), strikeBtn('focused', 'Focused strike', '−2 to one cell', '●')),
      h(
        'div',
        { class: 'fx-gauges' },
        h('div', null, h('div', { class: 'small dim' }, 'Strikes left'), h('div', { class: 'fx-pips', 'aria-label': `${left} of ${st.strikesAllowed} strikes left` }, ...Array.from({ length: st.strikesAllowed }, (_, i) => h('span', { class: i < left ? 'on' : '' }))), h('b', { class: 'mono ember' }, `${left} / ${st.strikesAllowed}`)),
        h('div', null, h('div', { class: 'small dim' }, 'Stress left'), h('div', { class: 'meter ember-meter' }, h('div', { style: `width:${initial ? (remaining / initial) * 100 : 0}%` })), h('b', { class: 'mono' }, `${remaining}/${initial}`)),
      ),
      h('div', null, h('div', { class: 'small dim' }, 'Structure quality'), h('div', { class: 'meter cyan fx-quality' }, h('div', { style: `width:${score * 100}%` })), h('b', { class: 'mono fx-score' }, `${Math.round(score * 100)}%`)),
      h(
        'div',
        { class: 'mono small' },
        `Overworks: ${st.overworks}`,
        penalty > 0 ? h('span', { class: st.overworks ? 'bad' : 'dim' }, ` (each counts as ${penalty} extra stress)`) : h('span', { class: 'dim' }, ' (free at Dull Red)'),
      ),
      this.qualityEffects(score),
      this.hammerExplainer(),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small', title: 'Highlights the strike with the best immediate effect.', onclick: () => this.hint() }, 'Hint'),
        h('button', { class: 'btn small', onclick: () => ((this.hammer = startHammering(board, this.heat, this.mastery)), this.render()) }, 'Restart'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary small', 'data-testid': 'mw-hammer-done', onclick: () => this.go('temper') }, left > 0 ? 'Finish early' : 'Continue'),
      ),
      h('div', { class: 'small dim' }, 'Turn-based: take as long as you like. Keyboard: Tab to a cell, Enter to strike.'),
    );
    return h('div', { class: 'hammer' }, grid, side);
  }

  private highlight(x: number, y: number): void {
    if (!this.board || !this.hammer) return;
    for (const c of this.cells) c.classList.remove('hl', 'over');
    if (x < 0) return;
    for (const [tx, ty] of strikeTargets(this.board.size, { x, y, kind: this.strikeKind })) {
      const i = ty * this.board.size + tx;
      const c = this.cells[i];
      c?.classList.add('hl');
      const v = this.hammer.cells[i];
      if (v === 0 || (this.strikeKind === 'focused' && v === 1 && tx === x && ty === y)) c?.classList.add('over');
    }
  }

  private hint(): void {
    if (!this.board || !this.hammer) return;
    const s = suggestStrike(this.hammer, this.board.size, this.heat);
    if (!s) return;
    this.strikeKind = s.kind;
    this.render();
    this.highlight(s.x, s.y);
    this.cells[s.y * this.board.size + s.x]?.focus();
  }

  private strike(x: number, y: number): void {
    if (!this.board || !this.hammer) return;
    const before = this.hammer.overworks;
    const r = applyStrike(this.hammer, this.board.size, { x, y, kind: this.strikeKind });
    if (!r) return;
    this.hammer = r.state;
    const over = r.state.overworks > before;
    this.flash = { cells: strikeTargets(this.board.size, { x, y, kind: this.strikeKind }).map(([tx, ty]) => ty * this.board!.size + tx), over };
    this.fx(over ? 'overwork' : 'strike');
    this.render();
    const c = this.cells[y * this.board.size + x];
    c?.focus();
    if (r.state.strikesUsed >= r.state.strikesAllowed) {
      // Out of strikes: move on automatically after a beat.
      setTimeout(() => {
        if (this.stage === 'hammer') this.go('temper');
      }, 500);
    }
  }

  private commit(): void {
    if (this.busy) return;
    this.busy = true;
    void this.onForge(this.request()).then((r) => {
      this.busy = false;
      if (r.ok && r.item) {
        this.result = r.item;
        this.stage = 'done';
        this.txId = this.session.nextTxId('forge');
      }
      this.render();
    });
  }

  private renderResult(): HTMLElement {
    const item = this.result!;
    const eq = this.session.equipped();
    const isEquipped = eq?.itemId === item.itemId;
    return h(
      'div',
      { class: 'forge-result fx-result', 'data-testid': 'forge-result', style: `--rarity:${RARITY_COLORS[item.result.rarity]}` },
      h('div', { class: 'small ember', style: 'letter-spacing:.12em;text-transform:uppercase' }, 'Forged'),
      itemHeader(item),
      traitsBlock(item),
      h('div', { class: 'small', style: 'margin-top:6px;display:grid;gap:2px' }, ...item.forge.stages.map((s) => h('div', null, h('b', null, `${s.stage}: `), `${s.label} — `, h('span', { class: 'muted' }, s.detail)))),
      h(
        'div',
        { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', disabled: isEquipped, 'data-testid': 'equip-result', onclick: () => (this.onEquip(item.itemId), this.render()) }, isEquipped ? 'Equipped' : 'Equip now'),
        h('button', { class: 'btn', onclick: () => ((this.result = null), this.resetMasterwork(), this.render()) }, 'Forge another'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => this.onClose() }, 'Close'),
      ),
    );
  }

  // ---------------- Right: projection and why ----------------
  private renderRight(): HTMLElement {
    const col = h('div', { class: 'forge-col' });
    const eq = this.session.equipped();
    if (this.result) {
      col.append(section('target', 'Result vs. previously equipped'));
      col.append(statTable(this.result, eq && eq.itemId !== this.result.itemId ? eq : null));
      return col;
    }
    if (!this.quickAllowed()) return col;
    const r = this.preview();
    col.append(section('target', this.mode === 'masterwork' ? `Projection ${this.currentScore() === null ? '(at 75% forge quality)' : '(current forge quality)'}` : 'Projected result'));
    if (!r.ok) {
      col.append(h('div', { class: 'small bad' }, r.message));
      return col;
    }
    const item = r.plan.item;
    col.append(
      h(
        'div',
        { class: 'fx-proj-item' },
        h('div', { class: 'bp-thumb' }, icon('weapon')),
        h('div', null, h('b', null, item.displayName), h('div', { class: 'small', style: `color:${RARITY_COLORS[item.result.rarity]}` }, `${RARITY_LABEL[item.result.rarity]} (projected)`)),
      ),
      statTable(item, eq),
    );
    if (this.mode === 'masterwork') {
      const lo = this.preview(this.mastery, 0);
      const hi = this.preview(this.mastery, 1);
      if (lo.ok && hi.ok) col.append(h('div', { class: 'small muted', style: 'margin-top:4px' }, `Forge quality range: ${lo.plan.item.result.damage}–${hi.plan.item.result.damage} damage (0%–100%).`));
      if (item.potentialImbuements.length) {
        col.append(h('div', { class: item.result.imbuements.length ? 'small cyan' : 'small dim' }, item.result.imbuements.length ? '⚡ Storm Arc would awaken at this quality.' : '⚡ Storm Arc needs ≥60% resonance (forge quality × 0.7 + ironglass quality × 0.3).'));
      }
    }
    const f = item.forge;
    const row = (label: string, value: string, help: string, strong = false) => h('tr', { title: help, class: strong ? 'total' : '' }, h('td', null, strong ? h('b', null, label) : label), h('td', null, strong ? h('b', null, value) : value));
    col.append(
      section('gear', 'Quality breakdown'),
      h(
        'table',
        { class: 'stat-table fx-breakdown' },
        row('Base material damage', String(r.plan.blueprint.baseDamage), 'What the blueprint deals before any craftsmanship.'),
        row(`Smith (mastery ${f.mastery})`, `×${f.smithFactor.toFixed(3)}`, 'Your blacksmithing mastery. It grows with every blade you forge.'),
        row(`Material (q ${Math.round(item.materialQuality * 100)}%)`, `×${f.materialFactor.toFixed(3)}`, 'The average quality of the ore and wood used. Rich deposits make better steel.'),
        row(`Buffer (${item.buffer.quantity} flux)`, `×${f.bufferFactor.toFixed(4)}`, 'Binding Flux used. More helps a little, less each time.'),
        row(`Forge (${this.mode === 'quick' ? 'Quick' : `${Math.round(f.forgeScore * 100)}%`})`, `×${f.forgeFactor.toFixed(3)}`, 'How well the hammering went (Masterwork), or the fixed Quick Forge result.'),
        row('Formula damage', String(f.formulaDamage), 'All of the above multiplied together.', true),
      ),
      h('div', { class: 'small dim' }, 'Specialization, tempering and rarity affixes then modify the formula result.'),
    );
    // Novice vs master comparison with the same materials (GDD 5.6 required).
    const master = this.preview(100);
    const novice = this.preview(0);
    const shop = merchantPreview(MERCHANT_STOCK[0]);
    if (master.ok && novice.ok) {
      col.append(
        section('users', 'Same steel, different hands'),
        h(
          'table',
          { class: 'stat-table fx-hands' },
          h('tr', null, h('td', null, 'Novice (mastery 0)'), h('td', null, `${novice.plan.item.result.damage} dmg`), h('td', { class: 'muted' }, `R ${novice.plan.item.result.rating}`)),
          h('tr', { class: 'you' }, h('td', null, h('b', null, `You (mastery ${this.mastery})`)), h('td', null, h('b', null, `${item.result.damage} dmg`)), h('td', { class: 'muted' }, `R ${item.result.rating}`)),
          h('tr', null, h('td', null, 'Master Orla (100)'), h('td', null, `${master.plan.item.result.damage} dmg`), h('td', { class: 'muted' }, `R ${master.plan.item.result.rating}`)),
          shop ? h('tr', null, h('td', null, "Bram's shop steel"), h('td', null, `${shop.result.damage} dmg`), h('td', { class: 'muted' }, `R ${shop.result.rating}`)) : null,
        ),
      );
    }
    col.append(section('box', 'Consumes'));
    const use = [...r.plan.consumed, ...r.plan.bufferConsumed].reduce<Record<string, number>>((a, c) => ((a[c.materialId] = (a[c.materialId] ?? 0) + c.quantity), a), {});
    col.append(h('div', { class: 'small' }, Object.entries(use).map(([k, v]) => `${v}× ${materialName(k as never)}`).join(' · ')));
    return col;
  }
}
