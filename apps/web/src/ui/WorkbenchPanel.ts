/**
 * The workbench in the forge (AF-021, the Crafting branch): rings, necklaces and capes. Every recipe is a
 * Quick craft; the authority (the server for accounts, this browser for guests) makes the item, at the
 * character's Crafting level, with their Crafting perks.
 */
import { learnedBlueprints, materialTotal, minBufferFor, planForge, slotOf, type ForgeRequest } from '@alloy/crafting';
import { BRANCH_INFO, branchLevel, chosenPerks, proficiencyXpToNext } from '@alloy/game-rules';
import { CRAFTABLE_BLUEPRINTS, RARITY_LABEL, materialName, type BlueprintDefinition, type ItemInstance } from '@alloy/item-gen';
import { RARITY_COLORS } from '../entities/Weapons';
import type { Session } from '../state/Session';
import { clear, h } from './dom';
import { icon } from './icons';
import { statTable } from './ItemView';
import { panelHead } from './Panels';

const SLOT_NAMES: Record<string, string> = { ring: 'Ring', neck: 'Neck', cape: 'Cape' };
const FAMILY_ICON: Record<string, string> = { ring: 'ring', necklace: 'neck', cape: 'cape' };

export class WorkbenchPanel {
  readonly el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Workbench' });
  private made: ItemInstance | null = null;
  private busy = false;

  constructor(
    private session: Session,
    private onClose: () => void,
    private onEquip: (itemId: string) => void,
    /** Asks the authority to craft (the same transaction as the forge). */
    private onCraft: (req: Omit<ForgeRequest, 'maker' | 'createdAt'>) => Promise<{ ok: boolean; item?: ItemInstance }>,
  ) {
    this.render();
  }

  /** Crafting recipes: the standard ones, then found ones the character has learned. */
  private recipes(): BlueprintDefinition[] {
    const inv = this.session.inventory;
    return [...CRAFTABLE_BLUEPRINTS, ...learnedBlueprints(inv).map((b) => b.piece)].filter((b) => b.branch === 'crafting');
  }

  private get level(): number {
    return branchLevel(this.session.data.progression, 'crafting');
  }

  /** What crafting it now would make (the authority makes the real one). */
  private preview(bp: BlueprintDefinition): ItemInstance | null {
    const perks = chosenPerks(this.session.data.progression);
    const r = planForge(this.session.inventory, { txId: 'preview', blueprintId: bp.id, mode: 'quick', bufferQuantity: minBufferFor(bp.buffer.min, perks), maker: { id: 'preview', name: 'You', mastery: this.level, perks }, createdAt: Date.now() });
    return r.ok ? r.plan.item : null;
  }

  private craft(bp: BlueprintDefinition): void {
    if (this.busy) return;
    this.busy = true;
    const perks = chosenPerks(this.session.data.progression);
    void this.onCraft({ txId: this.session.nextTxId('craft'), blueprintId: bp.id, mode: 'quick', bufferQuantity: minBufferFor(bp.buffer.min, perks) }).then((r) => {
      this.busy = false;
      this.made = r.ok && r.item ? r.item : null;
      this.render();
    });
  }

  render(): void {
    clear(this.el);
    const inv = this.session.inventory;
    const p = this.session.data.progression;
    const c = p.professions.crafting ?? { level: 1, xp: 0 };
    const body = h('div', { class: 'panel-body', style: 'display:grid;gap:10px' });
    body.append(
      h(
        'div',
        { class: 'small muted' },
        `${BRANCH_INFO.crafting.covers}. Crafting `,
        h('b', { class: 'ember', 'data-testid': 'crafting-level' }, `level ${c.level}`),
        ` (${Math.floor(c.xp)} / ${proficiencyXpToNext(c.level)} XP). Every piece trains it; better Crafting makes stronger pieces.`,
      ),
    );
    if (this.made) {
      const it = this.made;
      const equipped = slotOf(inv, it.itemId) !== null;
      body.append(
        h(
          'div',
          { class: 'card', 'data-testid': 'crafted', style: `border-color:${RARITY_COLORS[it.result.rarity]}` },
          h('div', { class: 'row' }, h('b', { style: `color:${RARITY_COLORS[it.result.rarity]}` }, `Made: ${it.displayName}`), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, RARITY_LABEL[it.result.rarity])),
          it.result.affixes.length ? h('div', { class: 'small' }, it.result.affixes.map((a) => `${a.name} (${a.description})`).join(' · ')) : null,
          h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', 'data-testid': 'equip-crafted', disabled: equipped, onclick: () => (this.onEquip(it.itemId), this.render()) }, equipped ? 'Equipped' : 'Equip now')),
        ),
      );
    }
    for (const bp of this.recipes()) {
      const locked = this.level < bp.masteryRequirement;
      const perks = chosenPerks(p);
      const flux = minBufferFor(bp.buffer.min, perks);
      const reqs = bp.materials.map((m) => {
        const have = materialTotal(inv, m.materialId);
        return h('span', { class: `req ${have >= m.quantity ? 'ok' : 'no'}` }, `${materialName(m.materialId)} ${have}/${m.quantity}`);
      });
      const fluxHave = materialTotal(inv, bp.buffer.materialId);
      if (flux > 0) reqs.push(h('span', { class: `req ${fluxHave >= flux ? 'ok' : 'no'}` }, `Flux ${fluxHave}/${flux}`));
      const afford = bp.materials.every((m) => materialTotal(inv, m.materialId) >= m.quantity) && fluxHave >= flux;
      const found = inv.learned?.[bp.id];
      const preview = locked ? null : this.preview(bp);
      const slot = bp.equip?.slot === 'ring' ? 'ring1' : (bp.equip?.slot ?? 'ring1');
      const current = inv.equipped[slot as keyof typeof inv.equipped];
      const compare = current ? (inv.items[current] ?? null) : null;
      body.append(
        h(
          'div',
          { class: 'card', 'data-recipe': bp.id, style: 'cursor:default' },
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'stat-ico' }, icon(FAMILY_ICON[bp.family] ?? 'ring')),
            h('b', { style: found ? `color:${RARITY_COLORS[found.rarity]}` : '' }, bp.name),
            found ? h('span', { class: 'tag', title: found.lore }, 'Found') : null,
            h('span', { class: 'spacer' }),
            h('span', { class: `tag ${locked ? 'bad' : afford ? 'good' : 'dim'}` }, locked ? `Crafting ${bp.masteryRequirement}` : afford ? 'Ready' : 'Missing'),
          ),
          h('div', { class: 'small muted' }, `${bp.tier} · ${SLOT_NAMES[bp.equip?.slot ?? ''] ?? ''} · ${bp.description}`),
          h('div', { class: 'small reqs', style: 'display:flex;flex-wrap:wrap;gap:2px 10px' }, ...reqs),
          preview ? statTable(preview, compare, compare ? 'vs worn' : '') : null,
          h(
            'div',
            { class: 'row', style: 'margin-top:6px' },
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn', 'data-testid': `craft-${bp.id}`, disabled: locked || !afford || this.busy, onclick: () => this.craft(bp) }, 'Craft'),
          ),
        ),
      );
    }
    this.el.append(h('div', { class: 'panel dialog', style: 'width:min(640px,94vw);max-height:88vh;overflow:auto' }, panelHead('Workbench', this.onClose), body));
  }
}

