/** Shared item presentation: stat tables with comparison, provenance, sword preview drawing. */
import { IMBUEMENTS, RARITY_LABEL, SPECIALIZATIONS, TEMPERS, getBlueprint, itemDisplayName, type ItemInstance } from '@alloy/item-gen';
import { RARITY_COLORS } from '../entities/Weapons';
import { h } from './dom';
import { icon } from './icons';

interface StatDef {
  label: string;
  /** Icon name (icons.ts) and a plain-language explanation shown on hover. */
  icon: string;
  help: string;
  get: (i: ItemInstance) => number;
  fmt: (v: number) => string;
  /** true if lower is better */
  lowerBetter?: boolean;
  dp: number;
}

export const STATS: StatDef[] = [
  { label: 'Damage', icon: 'damage', help: 'How hard each hit lands before the enemy’s defense.', get: (i) => i.result.damage, fmt: (v) => v.toFixed(0), dp: 0 },
  { label: 'Attack speed', icon: 'speed', help: 'How quickly you swing. 1.10× is 10% faster than a standard blade.', get: (i) => i.result.attackSpeed, fmt: (v) => `${v.toFixed(2)}×`, dp: 2 },
  { label: 'Stagger', icon: 'stagger', help: 'How much each hit breaks an enemy’s poise. Enough stagger interrupts their attack.', get: (i) => i.result.stagger, fmt: (v) => v.toFixed(1), dp: 1 },
  { label: 'Stamina cost', icon: 'stamina', help: 'Stamina each swing costs, against a standard blade. Lower is better.', get: (i) => i.result.staminaCostMultiplier, fmt: (v) => `${(v * 100).toFixed(0)}%`, lowerBetter: true, dp: 2 },
  { label: 'Critical chance', icon: 'crit', help: 'Chance a hit lands as a critical for extra damage.', get: (i) => i.result.critChance, fmt: (v) => `${(v * 100).toFixed(1)}%`, dp: 3 },
  { label: 'Equipment rating', icon: 'rating', help: 'One number for the whole weapon: higher is better overall.', get: (i) => i.result.rating, fmt: (v) => v.toFixed(0), dp: 0 },
];

/** Armor and shields: what they protect and give (forge expansion). */
export const ARMOR_STATS: StatDef[] = [
  { label: 'Defense', icon: 'defense', help: 'Armor while worn: all equipped defense adds up, and 100 defense halves a hit.', get: (i) => i.result.defense ?? 0, fmt: (v) => v.toFixed(0), dp: 0 },
  { label: 'Max health', icon: 'health', help: 'Extra maximum health while worn.', get: (i) => i.result.bonuses?.maxHealth ?? 0, fmt: (v) => (v ? `+${v.toFixed(0)}` : '—'), dp: 0 },
  { label: 'Max stamina', icon: 'stamina', help: 'Extra maximum stamina while worn.', get: (i) => i.result.bonuses?.maxStamina ?? 0, fmt: (v) => (v ? `+${v.toFixed(0)}` : '—'), dp: 0 },
  { label: 'Attributes', icon: 'vitality', help: 'Attribute points this piece adds while worn.', get: (i) => Object.values(i.result.bonuses?.attributes ?? {}).reduce((a, b) => a + b, 0), fmt: (v) => (v ? `+${v.toFixed(0)}` : '—'), dp: 0 },
  { label: 'Equipment rating', icon: 'rating', help: 'One number for the whole piece: higher is better overall.', get: (i) => i.result.rating, fmt: (v) => v.toFixed(0), dp: 0 },
];

/** Whether an item is armor or a shield (it has defense instead of damage). */
export const isArmorItem = (i: ItemInstance): boolean => i.result.defense !== undefined;

export function deltaCell(cur: number, base: number | null, lowerBetter = false, dp = 0): HTMLElement {
  if (base === null) return h('td', { class: 'dim' }, '—');
  const d = cur - base;
  const eps = 0.5 * 10 ** -dp;
  if (Math.abs(d) < eps) return h('td', { class: 'dim' }, '=');
  const better = lowerBetter ? d < 0 : d > 0;
  const shown = lowerBetter && Math.abs(base) > 0 && dp >= 2 ? `${(d * 100).toFixed(0)}%` : d.toFixed(dp);
  return h('td', { class: `${better ? 'good' : 'bad'} ${d > 0 ? 'delta-up' : 'delta-down'}`, title: better ? 'better' : 'worse' }, h('span', { class: 'arrow' }, better ? '▲' : '▼'), d > 0 ? `+${shown}` : shown.replace('-', '−'));
}

export function statTable(item: ItemInstance, compare: ItemInstance | null, compareLabel = 'vs equipped'): HTMLElement {
  const defs = isArmorItem(item) ? ARMOR_STATS : STATS;
  // Compare like with like: armor with the piece in its slot, a weapon with a weapon.
  if (compare && isArmorItem(compare) !== isArmorItem(item)) compare = null;
  const rows = defs.map((s) =>
    h('tr', { title: s.help }, h('td', null, h('span', { class: 'stat-ico' }, icon(s.icon)), s.label), h('td', null, s.fmt(s.get(item))), deltaCell(s.get(item), compare ? s.get(compare) : null, s.lowerBetter, s.dp)),
  );
  return h(
    'table',
    { class: 'stat-table' },
    h('thead', null, h('tr', null, h('td', { class: 'dim small' }, ''), h('td', { class: 'dim small' }, 'value'), h('td', { class: 'dim small' }, compare ? compareLabel : ''))),
    h('tbody', null, ...rows),
  );
}

export function rarityTag(item: ItemInstance): HTMLElement {
  return h('span', { class: 'tag', style: `color:${RARITY_COLORS[item.result.rarity]}` }, RARITY_LABEL[item.result.rarity]);
}

export function sourceLabel(item: ItemInstance): string {
  switch (item.source) {
    case 'merchant':
      return 'Merchant stock';
    case 'quick_forge':
      return 'Quick Forge';
    case 'masterwork_forge':
      return 'Masterwork Forge';
    case 'quest':
      return 'Quest reward';
    default:
      return 'Found';
  }
}

export function itemHeader(item: ItemInstance): HTMLElement {
  return h(
    'div',
    null,
    h('div', { class: 'row' }, h('b', { style: `color:${RARITY_COLORS[item.result.rarity]}` }, itemDisplayName(item)), h('span', { class: 'spacer' }), rarityTag(item)),
    h('div', { class: 'small muted' }, `${getBlueprint(item.blueprintId)?.tier ?? ''} · ${sourceLabel(item)} · made by ${item.forge.makerName}${item.forge.mode === 'quick' || item.forge.mode === 'masterwork' ? ` (mastery ${item.forge.mastery})` : ''}`),
  );
}

export function traitsBlock(item: ItemInstance): HTMLElement {
  const parts: HTMLElement[] = [];
  if (item.forge.mode === 'masterwork') {
    parts.push(h('div', { class: 'small' }, `Specialization: `, h('b', null, SPECIALIZATIONS[item.forge.specialization].name), h('span', { class: 'muted' }, ` — ${SPECIALIZATIONS[item.forge.specialization].description}`)));
    parts.push(h('div', { class: 'small' }, `Tempering: `, h('b', null, TEMPERS[item.forge.temper].name)));
  }
  for (const a of item.result.affixes) parts.push(h('div', { class: 'small' }, h('span', { class: 'ember' }, '◆ '), h('b', null, a.name), h('span', { class: 'muted' }, ` ${a.description}`)));
  for (const id of item.result.imbuements) {
    const d = IMBUEMENTS[id];
    parts.push(h('div', { class: 'small cyan' }, '⚡ ', h('b', null, d?.name ?? id), h('span', { class: 'muted' }, ` — ${d?.description ?? ''} [G] · ${d?.staminaCost} stamina · ${d?.cooldown}s`)));
  }
  if (item.potentialImbuements.length > 0 && item.result.imbuements.length === 0) {
    parts.push(h('div', { class: 'small dim' }, `Dormant potential: ${item.potentialImbuements.map((i) => IMBUEMENTS[i]?.name ?? i).join(', ')} (needs a strong masterwork)`));
  }
  return h('div', { style: 'display:grid;gap:3px;margin-top:6px' }, ...parts);
}

export function provenanceText(item: ItemInstance): string {
  const mats = item.materials.map((m) => `${m.quantity}× ${m.materialId} (q ${Math.round(m.quality * 100)}%, ${m.lotId})`).join('\n  ');
  const f = item.forge;
  return [
    `itemId: ${item.itemId}`,
    `seed: ${item.seed} · ${item.generatorVersion} · ${item.balanceVersion}`,
    `blueprint: ${item.blueprintId}`,
    `maker: ${f.makerName} (${f.makerId}) · mastery ${f.mastery}`,
    `factors: smith ×${f.smithFactor} · material ×${f.materialFactor} · buffer ×${f.bufferFactor} (${item.buffer.quantity} flux) · forge ×${f.forgeFactor}`,
    `formula damage: ${f.formulaDamage} → final ${item.result.damage}`,
    `materials:\n  ${mats || '(merchant/quest stock)'}`,
    ...f.stages.map((s) => `${s.stage}: ${s.label} — ${s.detail}`),
    `integrity: ${item.integrity}`,
    `created: ${new Date(item.createdAt).toISOString()}`,
  ].join('\n');
}

/** Draw a sword silhouette that reflects blueprint, specialization, rarity and imbuement. */
export function drawSword(canvas: HTMLCanvasElement, item: ItemInstance | null, blueprintId?: string): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 500;
  const hgt = canvas.clientHeight || 150;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  const bp = getBlueprint(item?.blueprintId ?? blueprintId ?? 'iron_longsword');
  if (!bp) return;
  const v = bp.visual;
  if (bp.family !== 'longsword' && GEAR_DRAWINGS[bp.family]) {
    GEAR_DRAWINGS[bp.family](ctx, w, hgt, v, item);
    return;
  }
  const spec = item?.forge.specialization ?? 'balanced';
  const cy = hgt / 2;
  const len = Math.min(w * 0.62, 380) * v.length;
  const x0 = (w - len - 90) / 2 + 70;
  const bw = spec === 'heavy' ? 20 : spec === 'agile' ? 11 : spec === 'keen' ? 13 : 15;
  const rarity = item?.result.rarity ?? 'common';
  const glowCol = item?.result.imbuements.includes('storm_arc') ? '#4fe3ff' : RARITY_COLORS[rarity];
  if (item && rarity !== 'common') {
    ctx.shadowColor = glowCol;
    ctx.shadowBlur = 18;
  }
  // Blade
  const grad = ctx.createLinearGradient(0, cy - bw / 2, 0, cy + bw / 2);
  grad.addColorStop(0, v.edge);
  grad.addColorStop(0.5, v.blade);
  grad.addColorStop(1, v.edge);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x0, cy - bw / 2);
  ctx.lineTo(x0 + len - 26, cy - bw / 2);
  ctx.lineTo(x0 + len, cy);
  ctx.lineTo(x0 + len - 26, cy + bw / 2);
  ctx.lineTo(x0, cy + bw / 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // Fuller
  ctx.fillStyle = v.glow ?? 'rgba(0,0,0,0.25)';
  if (v.glow || item?.result.imbuements.length) {
    ctx.shadowColor = v.glow ?? '#4fe3ff';
    ctx.shadowBlur = item?.result.imbuements.length ? 14 : 4;
  }
  ctx.fillRect(x0 + 8, cy - 1.5, len * 0.7, 3);
  ctx.shadowBlur = 0;
  // Guard, grip, pommel
  ctx.fillStyle = v.guard;
  ctx.fillRect(x0 - 8, cy - (spec === 'heavy' ? 30 : 24), 9, spec === 'heavy' ? 60 : 48);
  ctx.fillStyle = v.grip;
  ctx.fillRect(x0 - 58, cy - 5, 50, 10);
  ctx.fillStyle = v.guard;
  ctx.beginPath();
  ctx.arc(x0 - 62, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  if (item && rarity !== 'common') {
    ctx.fillStyle = RARITY_COLORS[rarity];
    ctx.beginPath();
    ctx.moveTo(x0 - 4, cy - 6);
    ctx.lineTo(x0 + 2, cy);
    ctx.lineTo(x0 - 4, cy + 6);
    ctx.lineTo(x0 - 10, cy);
    ctx.fill();
  }
}

// ---------------- Previews for the forge expansion (maces, shields, helmets, chest and leg armor) ----------------
type Visual = NonNullable<ReturnType<typeof getBlueprint>>['visual'];
type Draw = (ctx: CanvasRenderingContext2D, w: number, hgt: number, v: Visual, item: ItemInstance | null) => void;

function metal(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, v: Visual): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, v.edge);
  g.addColorStop(0.5, v.blade);
  g.addColorStop(1, v.edge);
  return g;
}

/** Rarity glow (and the ironglass shimmer) around a drawing. */
function aura(ctx: CanvasRenderingContext2D, v: Visual, item: ItemInstance | null): void {
  const rarity = item?.result.rarity ?? 'common';
  if (item && rarity !== 'common') {
    ctx.shadowColor = RARITY_COLORS[rarity];
    ctx.shadowBlur = 18;
  } else if (v.glow) {
    ctx.shadowColor = v.glow;
    ctx.shadowBlur = 6;
  }
}

function trim(ctx: CanvasRenderingContext2D, v: Visual): void {
  ctx.shadowBlur = 0;
  ctx.strokeStyle = v.glow ?? v.guard;
  ctx.lineWidth = 3;
  ctx.stroke();
}

const GEAR_DRAWINGS: Record<string, Draw> = {
  mace(ctx, w, hgt, v, item) {
    const cy = hgt / 2;
    const len = Math.min(w * 0.5, 300);
    const x0 = (w - len) / 2;
    ctx.fillStyle = v.grip;
    ctx.fillRect(x0, cy - 5, len * 0.72, 10);
    ctx.fillStyle = v.guard;
    ctx.beginPath();
    ctx.arc(x0 - 4, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    aura(ctx, v, item);
    const hx = x0 + len * 0.82;
    ctx.fillStyle = metal(ctx, hx, cy - 34, hx, cy + 34, v);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(hx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 20, 7, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(hx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    trim(ctx, v);
  },
  shield(ctx, w, hgt, v, item) {
    const cx = w / 2;
    const top = hgt * 0.08;
    const s = hgt * 0.84;
    aura(ctx, v, item);
    ctx.fillStyle = metal(ctx, cx - s * 0.4, top, cx + s * 0.4, top + s, v);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.38, top);
    ctx.lineTo(cx + s * 0.38, top);
    ctx.quadraticCurveTo(cx + s * 0.4, top + s * 0.62, cx, top + s);
    ctx.quadraticCurveTo(cx - s * 0.4, top + s * 0.62, cx - s * 0.38, top);
    ctx.closePath();
    ctx.fill();
    trim(ctx, v);
    ctx.fillStyle = v.guard;
    ctx.beginPath();
    ctx.arc(cx, top + s * 0.4, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
  },
  helmet(ctx, w, hgt, v, item) {
    const cx = w / 2;
    const cy = hgt * 0.58;
    const r = hgt * 0.34;
    aura(ctx, v, item);
    ctx.fillStyle = metal(ctx, cx - r, cy - r, cx + r, cy, v);
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.55, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    trim(ctx, v);
    ctx.fillStyle = v.glow ?? v.guard;
    ctx.fillRect(cx - 3, cy - r - 6, 6, r * 0.8);
  },
  chest(ctx, w, hgt, v, item) {
    const cx = w / 2;
    const top = hgt * 0.1;
    const s = hgt * 0.8;
    aura(ctx, v, item);
    ctx.fillStyle = metal(ctx, cx - s * 0.5, top, cx + s * 0.5, top + s, v);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.18, top);
    ctx.lineTo(cx - s * 0.5, top + s * 0.12);
    ctx.lineTo(cx - s * 0.42, top + s * 0.55);
    ctx.lineTo(cx - s * 0.32, top + s);
    ctx.lineTo(cx + s * 0.32, top + s);
    ctx.lineTo(cx + s * 0.42, top + s * 0.55);
    ctx.lineTo(cx + s * 0.5, top + s * 0.12);
    ctx.lineTo(cx + s * 0.18, top);
    ctx.quadraticCurveTo(cx, top + s * 0.16, cx - s * 0.18, top);
    ctx.closePath();
    ctx.fill();
    trim(ctx, v);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, top + s * 0.2);
    ctx.lineTo(cx, top + s * 0.95);
    ctx.stroke();
  },
  legs(ctx, w, hgt, v, item) {
    const cx = w / 2;
    const top = hgt * 0.08;
    const s = hgt * 0.86;
    aura(ctx, v, item);
    ctx.fillStyle = metal(ctx, cx - s * 0.4, top, cx + s * 0.4, top + s, v);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * s * 0.03, top + s * 0.12);
      ctx.lineTo(cx + side * s * 0.36, top + s * 0.12);
      ctx.lineTo(cx + side * s * 0.3, top + s);
      ctx.lineTo(cx + side * s * 0.1, top + s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(cx - s * 0.36, top, s * 0.72, s * 0.14);
    ctx.shadowBlur = 0;
    ctx.fillStyle = v.guard;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * s * 0.2, top + s * 0.55, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
