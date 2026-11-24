/**
 * Forge interface (GDD 7.3, 7.5; AF-006).
 * Left: blueprints, materials, mastery. Centre: preview, buffer, forging interaction.
 * Right: projected stats, quality, rating, comparison with equipped gear.
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
import type { Session } from '../state/Session';
import { clear, h } from './dom';
import { drawSword, itemHeader, statTable, traitsBlock } from './ItemView';

type Stage = 'setup' | 'heat' | 'hammer' | 'temper' | 'done';

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

  constructor(
    private session: Session,
    private onClose: () => void,
    private onEquip: (itemId: string) => void,
    /** Asks the authority to forge (server for accounts, this browser for guests). */
    private onForge: (req: Omit<ForgeRequest, 'maker' | 'createdAt'>) => Promise<{ ok: boolean; item?: ItemInstance }>,
  ) {
    this.el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Forge' });
    this.txId = session.nextTxId('forge');
    const first = CRAFTABLE_BLUEPRINTS.find((b) => this.canAfford(b.id)) ?? CRAFTABLE_BLUEPRINTS[0];
    this.selectBlueprint(first.id);
    if (this.session.passed('quick_forge') && !this.session.passed('masterwork')) this.mode = 'masterwork';
    this.render();
  }

  private get mastery(): number {
    return this.session.smithMastery;
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
      { class: 'panel forge' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', null, 'Emberhold Forge'),
        h('span', { class: 'small muted' }, 'Craftsmanship transforms ordinary steel. Every projection below is computed by the same rules that make the item.'),
        h('button', { class: 'close-x', onclick: () => this.onClose(), 'aria-label': 'Close forge', title: 'Close (Esc)' }, '✕'),
      ),
      h('div', { class: 'forge-grid' }, this.renderLeft(), this.renderCenter(), this.renderRight()),
    );
    this.el.append(panel);
    const canvas = this.el.querySelector<HTMLCanvasElement>('canvas.sword');
    if (canvas) requestAnimationFrame(() => drawSword(canvas, this.result ?? (this.preview().ok ? (this.preview() as { ok: true; plan: { item: ItemInstance } }).plan.item : null), this.blueprintId));
  }

  private renderLeft(): HTMLElement {
    const inv = this.session.inventory;
    const b = this.session.data.progression.professions.blacksmithing;
    const col = h('div', { class: 'forge-col' });
    col.append(h('h3', null, 'Blueprints'));
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
      list.append(
        h(
          'button',
          {
            class: `card ${bp.id === this.blueprintId ? 'selected' : ''} ${locked ? 'disabled' : ''}`,
            'data-blueprint': bp.id,
            onclick: () => {
              if (locked || this.busy) return;
              this.selectBlueprint(bp.id);
              this.txId = this.session.nextTxId('forge');
              this.render();
            },
          },
          h('div', { class: 'row' }, h('span', { class: 'ttl' }, bp.name), h('span', { class: 'spacer' }), locked ? h('span', { class: 'tag bad' }, `Mastery ${bp.masteryRequirement}`) : afford ? h('span', { class: 'tag good' }, 'Ready') : h('span', { class: 'tag dim' }, 'Missing')),
          h('div', { class: 'sub' }, `${bp.tier} · base ${bp.baseDamage} dmg · ${bp.baseAttackSpeed.toFixed(2)}× speed`),
          h('div', { class: 'sub', style: 'display:flex;flex-wrap:wrap;gap:2px 10px' }, ...reqs),
          bp.potentialImbuements.length ? h('div', { class: 'sub cyan' }, `Potential: ${bp.potentialImbuements.map((i) => IMBUEMENTS[i]?.name).join(', ')}`) : null,
        ),
      );
    }
    col.append(list);
    col.append(h('h3', null, 'Materials'));
    const mats = h('table', { class: 'stat-table' });
    for (const id of ['iron_ore', 'ironwood', 'ironglass', 'binding_flux'] as const) {
      const q = averageQuality(inv, id);
      mats.append(h('tr', null, h('td', null, materialName(id)), h('td', null, String(materialTotal(inv, id))), h('td', { class: 'muted' }, q === null ? '—' : `q ${Math.round(q * 100)}%`)));
    }
    col.append(mats);
    col.append(h('div', { class: 'small dim', style: 'margin-top:4px' }, 'Best-quality lots are used first. Quality comes from each deposit\'s procedural traits.'));
    col.append(h('h3', null, 'Blacksmithing mastery'));
    const need = smithXpToNext(b.mastery);
    col.append(
      h('div', { class: 'row' }, h('b', { class: 'ember', style: 'font-size:22px' }, String(b.mastery)), h('span', { class: 'muted small' }, `Smith factor ×${smithFactor(b.mastery).toFixed(3)}`)),
      h('div', { class: 'meter', style: 'margin-top:4px' }, h('div', { style: `width:${Math.min(100, (b.xp / need) * 100)}%` })),
      h('div', { class: 'small muted' }, `${b.xp}/${need} XP to mastery ${b.mastery + 1}. Open-ended: no hard cap.`),
    );
    return col;
  }

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
      col.append(h('div', { class: 'forge-result' }, h('b', null, 'Orla: '), 'Before you strike iron, go see what Bram sells. Know what coin buys, then show me what your hands can do.'));
      return col;
    }
    col.append(h('div', { class: 'preview-wrap' }, h('canvas', { class: 'sword', 'aria-label': 'Weapon preview' })));

    const body = h('div', { style: 'display:grid;gap:10px;align-content:start' });
    if (this.result) {
      body.append(this.renderResult());
    } else if (this.mode === 'quick') {
      body.append(this.renderBuffer(), this.renderQuickConfirm());
    } else {
      body.append(this.renderMasterwork());
    }
    col.append(body);
    return col;
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
      { class: 'buffer-box' },
      h('div', { class: 'row' }, h('b', null, `Binding Flux (buffer): ${this.buffer}`), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `required ${bp.buffer.min} · owned ${owned} · batch ${bp.buffer.standardBatch}`)),
      input,
      h(
        'div',
        { class: 'small', style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px' },
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
      h('button', { class: 'btn primary', disabled: !!reason || this.busy, 'data-testid': 'quick-forge-confirm', onclick: () => this.commit() }, 'Forge'),
    );
  }

  private renderMasterwork(): HTMLElement {
    const wrap = h('div', { style: 'display:grid;gap:10px' });
    const steps: Array<[Stage, string]> = [
      ['setup', '1 · Prepare'],
      ['heat', '2 · Heat'],
      ['hammer', '3 · Hammer'],
      ['temper', '4 · Temper'],
    ];
    const order: Stage[] = ['setup', 'heat', 'hammer', 'temper', 'done'];
    wrap.append(h('div', { class: 'stepper' }, ...steps.map(([s, l]) => h('span', { class: s === this.stage ? 'on' : order.indexOf(s) < order.indexOf(this.stage) ? 'done' : '' }, l))));

    if (this.stage === 'setup') {
      wrap.append(this.renderBuffer());
      wrap.append(h('h3', { style: 'margin:0' }, 'Specialization'));
      const bp = getBlueprint(this.blueprintId)!;
      wrap.append(
        h(
          'div',
          { class: 'choices' },
          ...bp.allowedSpecializations.map((s) =>
            h('button', { class: `card ${this.spec === s ? 'selected' : ''}`, 'data-spec': s, onclick: () => ((this.spec = s), this.render()) }, h('div', { class: 'ttl' }, SPECIALIZATIONS[s].name), h('div', { class: 'sub' }, SPECIALIZATIONS[s].description)),
          ),
        ),
      );
      const reason = this.missingReason();
      wrap.append(
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'small muted' }, 'Materials are only consumed when you finish. Leaving midway costs nothing.'),
          h('span', { class: 'spacer' }),
          reason ? h('span', { class: 'small bad' }, reason) : null,
          h('button', { class: 'btn primary', disabled: !!reason, 'data-testid': 'mw-begin', onclick: () => ((this.stage = 'heat'), this.render()) }, 'Begin forging'),
        ),
      );
    } else if (this.stage === 'heat') {
      wrap.append(h('div', { class: 'small muted' }, 'Choose how hot to work the ingot. Hotter metal gives you more strikes to relieve stress, but mistakes hurt more: an overwork (striking metal already at 0) counts as extra stress left in the blade.'));
      wrap.append(
        h(
          'div',
          { class: 'choices' },
          ...(Object.keys(HEAT_LEVELS) as HeatLevel[]).map((k) =>
            h(
              'button',
              { class: `card ${this.heat === k ? 'selected' : ''}`, 'data-heat': k, onclick: () => ((this.heat = k), this.render()) },
              h('div', { class: 'ttl' }, HEAT_LEVELS[k].name),
              h('div', { class: 'sub' }, HEAT_LEVELS[k].description),
            ),
          ),
        ),
      );
      wrap.append(
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => ((this.stage = 'setup'), this.render()) }, 'Back'),
          h('span', { class: 'spacer' }),
          h(
            'button',
            {
              class: 'btn primary',
              'data-testid': 'mw-heat-confirm',
              onclick: () => {
                this.board = boardFor(this.session.inventory, this.blueprintId);
                this.hammer = startHammering(this.board, this.heat, this.mastery);
                this.stage = 'hammer';
                this.render();
              },
            },
            'Heat the ingot',
          ),
        ),
      );
    } else if (this.stage === 'hammer' && this.board && this.hammer) {
      wrap.append(this.renderHammer());
    } else if (this.stage === 'temper') {
      wrap.append(h('div', { class: 'small muted' }, 'Choose a cooling route: stability versus performance.'));
      wrap.append(
        h(
          'div',
          { class: 'choices' },
          ...(['oil', 'water', 'air'] as TemperStrategy[]).map((t) =>
            h('button', { class: `card ${this.temper === t ? 'selected' : ''}`, 'data-temper': t, onclick: () => ((this.temper = t), this.render()) }, h('div', { class: 'ttl' }, TEMPERS[t].name), h('div', { class: 'sub' }, TEMPERS[t].description)),
          ),
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
          h('button', { class: 'btn primary', disabled: !!reason || this.busy, 'data-testid': 'mw-finish', onclick: () => this.commit() }, 'Quench & finish'),
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
      { class: 'explain', open: true },
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
        h('li', null, 'Quality = 1 − (stress left + overwork penalty) ÷ starting stress. It sets the weapon’s damage multiplier and whether hidden powers awaken.'),
      ),
    );
  }

  /** What the current structure quality means for the finished weapon. */
  private qualityEffects(score: number): HTMLElement {
    const ff = 0.95 + 0.3 * score;
    const bp = getBlueprint(this.blueprintId);
    const lines: Array<HTMLElement> = [h('div', null, `Damage multiplier ×${ff.toFixed(3)} `, h('span', { class: 'dim' }, '(×0.950 at 0% → ×1.250 at 100%)'))];
    const imb = bp?.potentialImbuements[0];
    if (imb) {
      const catalyst = bp!.materials.some((r) => r.materialId === 'ironglass') ? averageQuality(this.session.inventory, 'ironglass') ?? 0 : 0;
      const resonance = score * 0.7 + catalyst * 0.3;
      const needed = Math.max(0, Math.min(1, (0.6 - catalyst * 0.3) / 0.7));
      const name = IMBUEMENTS[imb]?.name ?? imb;
      lines.push(
        h(
          'div',
          { class: resonance >= 0.6 ? 'good' : 'bad' },
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
    for (let y = 0; y < board.size; y++)
      for (let x = 0; x < board.size; x++) {
        const v = st.cells[y * board.size + x];
        const cell = h(
          'button',
          {
            class: `cell s${v}`,
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
        this.cells.push(cell);
        grid.append(cell);
      }
    const left = st.strikesAllowed - st.strikesUsed;
    const penalty = HEAT_LEVELS[this.heat].overworkPenalty;
    const side = h(
      'div',
      { style: 'display:grid;gap:8px' },
      this.hammerExplainer(),
      h(
        'div',
        { class: 'row' },
        h('button', { class: `btn small ${this.strikeKind === 'spread' ? 'primary' : ''}`, 'data-strike': 'spread', onclick: () => ((this.strikeKind = 'spread'), this.render()) }, 'Spread strike (−1 ✚)'),
        h('button', { class: `btn small ${this.strikeKind === 'focused' ? 'primary' : ''}`, 'data-strike': 'focused', onclick: () => ((this.strikeKind = 'focused'), this.render()) }, 'Focused strike (−2 ●)'),
      ),
      h('div', { class: 'mono small' }, `Strikes left: `, h('b', { class: 'ember' }, String(left)), ` / ${st.strikesAllowed}`),
      h('div', { class: 'mono small' }, `Stress left: ${remaining}/${initial}`),
      h(
        'div',
        { class: 'mono small' },
        `Overworks: ${st.overworks}`,
        penalty > 0 ? h('span', { class: st.overworks ? 'bad' : 'dim' }, ` (each counts as ${penalty} extra stress)`) : h('span', { class: 'dim' }, ' (free at Dull Red)'),
      ),
      h('div', null, h('div', { class: 'small dim' }, 'Structure quality'), h('div', { class: 'meter cyan' }, h('div', { style: `width:${score * 100}%` })), h('b', { class: 'mono' }, `${Math.round(score * 100)}%`)),
      this.qualityEffects(score),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small', title: 'Highlights the strike with the best immediate effect (accessibility aid).', onclick: () => this.hint() }, 'Hint'),
        h('button', { class: 'btn small', onclick: () => ((this.hammer = startHammering(board, this.heat, this.mastery)), this.render()) }, 'Restart'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary small', 'data-testid': 'mw-hammer-done', onclick: () => ((this.stage = 'temper'), this.render()) }, left > 0 ? 'Finish early' : 'Continue'),
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
    const r = applyStrike(this.hammer, this.board.size, { x, y, kind: this.strikeKind });
    if (!r) return;
    this.hammer = r.state;
    this.render();
    const c = this.cells[y * this.board.size + x];
    c?.focus();
    if (r.state.strikesUsed >= r.state.strikesAllowed) {
      // Out of strikes: move on automatically after a beat.
      setTimeout(() => {
        if (this.stage === 'hammer') {
          this.stage = 'temper';
          this.render();
        }
      }, 400);
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
      { class: 'forge-result', 'data-testid': 'forge-result' },
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

  private renderRight(): HTMLElement {
    const col = h('div', { class: 'forge-col' });
    const eq = this.session.equipped();
    if (this.result) {
      col.append(h('h3', null, 'Result vs. previously equipped'));
      col.append(statTable(this.result, eq && eq.itemId !== this.result.itemId ? eq : null));
      return col;
    }
    if (!this.quickAllowed()) return col;
    const r = this.preview();
    col.append(h('h3', null, this.mode === 'masterwork' ? `Projection ${this.currentScore() === null ? '(at 75% forge quality)' : '(current forge quality)'}` : 'Projected result'));
    if (!r.ok) {
      col.append(h('div', { class: 'small bad' }, r.message));
      return col;
    }
    const item = r.plan.item;
    col.append(
      h('div', { class: 'row' }, h('b', null, item.displayName), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `${RARITY_LABEL[item.result.rarity]} (projected)`)),
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
    col.append(
      h('h3', null, 'Quality breakdown (GDD 4.11)'),
      h(
        'table',
        { class: 'stat-table' },
        h('tr', null, h('td', null, 'Base material damage'), h('td', null, String(r.plan.blueprint.baseDamage)), h('td', null, '')),
        h('tr', null, h('td', null, `Smith (mastery ${f.mastery})`), h('td', null, `×${f.smithFactor.toFixed(3)}`), h('td', null, '')),
        h('tr', null, h('td', null, `Material (q ${Math.round(item.materialQuality * 100)}%)`), h('td', null, `×${f.materialFactor.toFixed(3)}`), h('td', null, '')),
        h('tr', null, h('td', null, `Buffer (${item.buffer.quantity} flux)`), h('td', null, `×${f.bufferFactor.toFixed(4)}`), h('td', null, '')),
        h('tr', null, h('td', null, `Forge (${this.mode === 'quick' ? 'Quick' : `${Math.round(f.forgeScore * 100)}%`})`), h('td', null, `×${f.forgeFactor.toFixed(3)}`), h('td', null, '')),
        h('tr', null, h('td', null, h('b', null, 'Formula damage')), h('td', null, h('b', null, String(f.formulaDamage))), h('td', null, '')),
      ),
      h('div', { class: 'small dim' }, 'Specialization, tempering and rarity affixes then modify the formula result.'),
    );
    // Novice vs master comparison with the same materials (GDD 5.6 required).
    const master = this.preview(100);
    const novice = this.preview(0);
    const shop = merchantPreview(MERCHANT_STOCK[0]);
    if (master.ok && novice.ok) {
      col.append(
        h('h3', null, 'Same steel, different hands'),
        h(
          'table',
          { class: 'stat-table' },
          h('tr', null, h('td', null, 'Novice (mastery 0)'), h('td', null, `${novice.plan.item.result.damage} dmg`), h('td', { class: 'muted' }, `R ${novice.plan.item.result.rating}`)),
          h('tr', null, h('td', null, h('b', null, `You (mastery ${this.mastery})`)), h('td', null, h('b', null, `${item.result.damage} dmg`)), h('td', { class: 'muted' }, `R ${item.result.rating}`)),
          h('tr', null, h('td', null, 'Master Orla (100)'), h('td', null, `${master.plan.item.result.damage} dmg`), h('td', { class: 'muted' }, `R ${master.plan.item.result.rating}`)),
          shop ? h('tr', null, h('td', null, "Bram's shop steel"), h('td', null, `${shop.result.damage} dmg`), h('td', { class: 'muted' }, `R ${shop.result.rating}`)) : null,
        ),
      );
    }
    col.append(h('h3', null, 'Consumes'));
    const use = [...r.plan.consumed, ...r.plan.bufferConsumed].reduce<Record<string, number>>((a, c) => ((a[c.materialId] = (a[c.materialId] ?? 0) + c.quantity), a), {});
    col.append(h('div', { class: 'small' }, Object.entries(use).map(([k, v]) => `${v}× ${materialName(k as never)}`).join(' · ')));
    return col;
  }
}
