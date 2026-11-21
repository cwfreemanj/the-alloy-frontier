/** Main HUD (GDD 7.2): vitals upper-left, minimap + objective upper-right, abilities bottom-centre. */
import * as THREE from 'three';
import { ATTACKS, QUEST_EDGE_YOU_MAKE, STAMINA_CONFIG, describeProgress, weaponXpToNext, type PlayerCombat } from '@alloy/game-rules';
import { IMBUEMENTS, itemDisplayName, materialName, type ItemInstance, type MaterialId } from '@alloy/item-gen';
import type { Session } from '../state/Session';
import { PATH, ZONES, type Zone } from '../world/Layout';
import { h } from './dom';
import { RARITY_COLORS } from '../entities/Weapons';

interface SlotRefs {
  el: HTMLElement;
  cd: HTMLElement;
  cdText: HTMLElement;
  cost: HTMLElement;
}

export interface WorldMarker {
  id: string;
  pos: THREE.Vector3;
  kind: 'enemy' | 'elite' | 'npc' | 'objective';
}

export class Hud {
  readonly root: HTMLElement;
  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private hpLabel: HTMLElement;
  private stFill: HTMLElement;
  private stLabel: HTMLElement;
  private stBar: HTMLElement;
  private mastery: HTMLElement;
  private objective: HTMLElement;
  private zoneLabel: HTMLElement;
  private weaponLine: HTMLElement;
  private slots: Record<string, SlotRefs> = {};
  private prompt: HTMLElement;
  private gatherBar: HTMLElement;
  private gatherFill: HTMLElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private labels: HTMLElement;
  private reticle: HTMLElement;
  readonly perf: HTMLElement;
  private death: HTMLElement;
  private vignette: HTMLElement;
  readonly minimap: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private bannerTimer = 0;
  private lastObjective = '';
  private labelPool = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    const bar = (cls: string) => {
      const fill = h('div', { class: 'fill' });
      const ghost = h('div', { class: 'ghost' });
      const label = h('div', { class: 'label' });
      return { el: h('div', { class: `bar ${cls}` }, ghost, fill, label), fill, ghost, label };
    };
    const hp = bar('hp');
    const st = bar('st');
    this.hpFill = hp.fill;
    this.hpGhost = hp.ghost;
    this.hpLabel = hp.label;
    this.stFill = st.fill;
    this.stLabel = st.label;
    this.stBar = st.el;
    this.mastery = h('div', { class: 'hud-mastery' });
    this.minimap = h('canvas', { class: 'minimap', width: 170, height: 170, 'aria-label': 'Minimap' });
    this.mapCtx = this.minimap.getContext('2d')!;
    this.zoneLabel = h('div', { class: 'zone-label' });
    this.objective = h('div', { class: 'objective', 'data-testid': 'objective' });
    this.weaponLine = h('div', { class: 'weapon-line', 'data-testid': 'weapon-line' });
    const abilities = h('div', { class: 'abilities' });
    const slotDefs: Array<[string, string, string]> = [
      ['light', 'LMB', 'Light combo'],
      ['heavy', 'F', 'Heavy'],
      ['block', 'RMB', 'Block'],
      ['dodge', 'Q', 'Dodge'],
      ['guardbreaker', 'R', 'Guard-\nbreaker'],
      ['storm_arc', 'G', 'Storm Arc'],
    ];
    for (const [id, key, name] of slotDefs) {
      const cd = h('div', { class: 'cd', style: 'height:0' });
      const cdText = h('div', { class: 'cdtext' });
      const cost = h('div', { class: 'cost' });
      const el = h('div', { class: 'slot', 'data-slot': id }, h('div', { class: 'key' }, key), h('div', { class: 'name', style: 'white-space:pre-line' }, name), cost, cd, cdText);
      this.slots[id] = { el, cd, cdText, cost };
      abilities.append(el);
    }
    this.prompt = h('div', { class: 'prompt', 'data-testid': 'prompt' });
    this.gatherFill = h('div', { style: 'width:0%' });
    this.gatherBar = h('div', { class: 'gather-bar meter cyan' }, this.gatherFill);
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.banner = h('div', { class: 'zone-banner' });
    this.labels = h('div', { class: 'world-labels' });
    this.reticle = h('div', { class: 'lock-reticle' });
    this.perf = h('div', { class: 'perf', 'data-testid': 'perf' });
    this.death = h('div', { class: 'death' }, 'YOU HAVE FALLEN');
    this.vignette = h('div', { class: 'vignette' });
    this.root = h(
      'div',
      { class: 'hud' },
      this.vignette,
      this.labels,
      this.reticle,
      h('div', { class: 'crosshair' }),
      h('div', { class: 'hud-vitals' }, hp.el, st.el, this.mastery),
      h('div', { class: 'hud-objective' }, this.minimap, this.zoneLabel, this.objective),
      h('div', { class: 'hud-bottom' }, this.weaponLine, abilities),
      this.prompt,
      this.gatherBar,
      this.toasts,
      this.banner,
      this.perf,
      this.death,
      h('div', { class: 'hint-line' }, 'Esc: menu · I: inventory · F3: performance'),
    );
    parent.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  toast(text: string, tone: 'info' | 'good' | 'warn' = 'info'): void {
    const t = h('div', { class: `toast ${tone}` }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 5) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 3300);
  }

  zoneBanner(z: Zone): void {
    this.banner.replaceChildren(h('div', { class: 'n' }, z.name), h('div', { class: 'rule' }), h('div', { class: 's' }, z.subtitle));
    this.banner.classList.add('show');
    this.bannerTimer = 3.5;
  }

  showDeath(v: boolean): void {
    this.death.style.display = v ? 'grid' : 'none';
  }

  setPrompt(text: string | null, key = 'E'): void {
    if (!text) {
      this.prompt.style.display = 'none';
      return;
    }
    this.prompt.style.display = 'block';
    this.prompt.replaceChildren(h('kbd', null, key), ` ${text}`);
  }

  setGather(progress: number | null): void {
    this.gatherBar.style.display = progress === null ? 'none' : 'block';
    if (progress !== null) this.gatherFill.style.width = `${Math.round(progress * 100)}%`;
  }

  update(dt: number, combat: PlayerCombat, session: Session, weapon: ItemInstance | null, zone: Zone, lowHpFlash: boolean): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    const hpPct = (combat.health / combat.maxHealth) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpGhost.style.width = `${hpPct}%`;
    this.hpLabel.innerHTML = `<span>HEALTH</span><span>${Math.ceil(combat.health)} / ${combat.maxHealth}</span>`;
    const st = combat.stamina;
    this.stFill.style.width = `${(st.current / st.max) * 100}%`;
    this.stBar.classList.toggle('low', st.current < st.max * STAMINA_CONFIG.lowThreshold);
    this.stLabel.innerHTML = `<span>STAMINA${st.regenDelayRemaining > 0 ? '' : st.current < st.max ? ' ↑' : ''}</span><span>${st.current.toFixed(1)} / ${st.max}</span>`;
    const p = session.data.progression;
    const wm = p.weaponMastery.longsword;
    this.mastery.innerHTML = `<span>Longsword <b>${wm.level}</b> <span style="opacity:.7">(${Math.floor(wm.xp)}/${weaponXpToNext(wm.level)})</span></span><span>Blacksmith <b>${p.professions.blacksmithing.mastery}</b></span><span>Rank <b>${p.adventurer.rank}</b></span><span><b>${session.inventory.coins}</b> c</span>`;
    this.vignette.style.boxShadow = lowHpFlash ? 'inset 0 0 160px rgba(160,20,10,0.55)' : 'inset 0 0 160px rgba(160,20,10,0)';

    // Objective tracker
    const step = session.step();
    let objHtml: string;
    if (!step) {
      objHtml = `<div class="q">${QUEST_EDGE_YOU_MAKE.name}</div><div class="t">Complete</div><div class="d">The forge remains open. Experiment with recipes and specializations.</div>`;
    } else {
      const prog = describeProgress(QUEST_EDGE_YOU_MAKE, session.data.quest)
        .map((s) => {
          const [k, v] = s.includes(':') ? s.split(':') : ['', s];
          return k ? `${materialName(k as MaterialId)} ${v}` : v;
        })
        .join(' · ');
      const idx = session.data.quest.stepIndex + 1;
      objHtml = `<div class="q">${QUEST_EDGE_YOU_MAKE.name} · ${idx}/${QUEST_EDGE_YOU_MAKE.steps.length}</div><div class="t">${step.title}</div><div class="d">${step.description}</div>${prog ? `<div class="p">${prog}</div>` : ''}`;
    }
    if (objHtml !== this.lastObjective) {
      this.objective.innerHTML = objHtml;
      this.lastObjective = objHtml;
    }
    this.zoneLabel.textContent = zone.name;

    // Weapon + abilities
    if (weapon) {
      this.weaponLine.innerHTML = `<b style="color:${RARITY_COLORS[weapon.result.rarity]}">${itemDisplayName(weapon)}</b> · ${weapon.result.damage} dmg · rating ${weapon.result.rating}${weapon.result.imbuements.length ? ` · <span class="cyan">⚡ ${weapon.result.imbuements.map((i) => IMBUEMENTS[i]?.name).join(', ')}</span>` : ''}`;
    } else this.weaponLine.textContent = 'Unarmed — speak with Orla';
    const mult = weapon?.result.staminaCostMultiplier ?? 1;
    const costs: Record<string, number> = {
      light: STAMINA_CONFIG.costs.light * mult,
      heavy: STAMINA_CONFIG.costs.heavy * mult,
      dodge: STAMINA_CONFIG.costs.dodge,
      guardbreaker: STAMINA_CONFIG.costs.guardbreaker * mult,
      storm_arc: STAMINA_CONFIG.costs.storm_arc * mult,
      block: STAMINA_CONFIG.blockHoldDrainPerSec,
    };
    for (const [id, s] of Object.entries(this.slots)) {
      s.cost.textContent = id === 'block' ? `${costs.block}/s` : costs[id].toFixed(1);
      const total = id === 'guardbreaker' ? (ATTACKS.guardbreaker.cooldown ?? 8) : id === 'storm_arc' ? (IMBUEMENTS.storm_arc.cooldown ?? 12) : 0;
      const remaining = combat.cooldowns[id] ?? 0;
      s.cd.style.height = total > 0 ? `${(remaining / total) * 100}%` : '0';
      s.cdText.textContent = remaining > 0 ? remaining.toFixed(1) : '';
      if (id === 'storm_arc') {
        const has = weapon?.result.imbuements.includes('storm_arc') ?? false;
        s.el.classList.toggle('locked', !has);
        s.el.classList.toggle('imbued', has);
        s.el.title = has ? IMBUEMENTS.storm_arc.description : 'Requires a weapon imbued with Storm Arc';
      }
      const active = combat.attack && (combat.attack.id.startsWith(id) || (id === 'light' && combat.attack.id.startsWith('light')));
      s.el.style.borderColor = active ? 'var(--ember)' : '';
      if (id === 'block') s.el.style.borderColor = combat.blocking ? 'var(--cyan)' : '';
      if (id === 'dodge') s.el.style.borderColor = combat.phase === 'dodge' ? 'var(--cyan)' : '';
    }
  }

  flashSlot(id: string): void {
    const s = this.slots[id];
    if (!s) return;
    s.el.classList.add('flash');
    setTimeout(() => s.el.classList.remove('flash'), 250);
  }

  /** Screen-space labels: enemy bars, NPC names, damage numbers, lock reticle. */
  project(camera: THREE.Camera, pos: THREE.Vector3, yOffset: number, w: number, hgt: number): { x: number; y: number; visible: boolean } {
    const v = pos.clone();
    v.y += yOffset;
    v.project(camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * hgt, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  label(id: string, build: () => HTMLElement): HTMLElement {
    let el = this.labelPool.get(id);
    if (!el) {
      el = build();
      this.labelPool.set(id, el);
      this.labels.append(el);
    }
    return el;
  }

  hideLabel(id: string): void {
    const el = this.labelPool.get(id);
    if (el) el.style.display = 'none';
  }

  damageNumber(x: number, y: number, text: string, cls: string): void {
    const el = h('div', { class: `dmg ${cls}`, style: `left:${x}px;top:${y}px` }, text);
    this.labels.append(el);
    setTimeout(() => el.remove(), 800);
  }

  setReticle(p: { x: number; y: number; visible: boolean } | null): void {
    if (!p || !p.visible) {
      this.reticle.style.display = 'none';
      return;
    }
    this.reticle.style.display = 'block';
    this.reticle.style.left = `${p.x}px`;
    this.reticle.style.top = `${p.y}px`;
  }

  drawMinimap(player: { x: number; z: number; yaw: number }, camYaw: number, markers: Array<{ x: number; z: number; color: string; r?: number }>, objective: { x: number; z: number } | null): void {
    const c = this.mapCtx;
    const W = 170;
    const scale = 1.2; // px per metre
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath();
    c.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#121410';
    c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    // Rotate so that the camera's forward is up.
    c.rotate(camYaw);
    c.scale(-1, -1);
    const tx = (x: number) => (x - player.x) * scale;
    const tz = (z: number) => (z - player.z) * scale;
    for (const z of ZONES) {
      c.fillStyle = z.id === 'village' ? 'rgba(120,90,60,0.35)' : z.id === 'quarry' ? 'rgba(90,150,180,0.25)' : z.id === 'foundry' ? 'rgba(200,90,40,0.22)' : 'rgba(70,90,50,0.3)';
      c.beginPath();
      c.arc(tx(z.center.x), tz(z.center.z), z.radius * scale, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = 'rgba(160,130,90,0.7)';
    c.lineWidth = 3;
    c.beginPath();
    PATH.forEach((p, i) => (i === 0 ? c.moveTo(tx(p.x), tz(p.z)) : c.lineTo(tx(p.x), tz(p.z))));
    c.stroke();
    for (const m of markers) {
      c.fillStyle = m.color;
      c.beginPath();
      c.arc(tx(m.x), tz(m.z), m.r ?? 2.5, 0, Math.PI * 2);
      c.fill();
    }
    if (objective) {
      const ox = tx(objective.x);
      const oz = tz(objective.z);
      const d = Math.hypot(ox, oz);
      const max = W / 2 - 8;
      const k = d > max ? max / d : 1;
      c.fillStyle = '#ff8a3d';
      c.strokeStyle = '#000';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(ox * k, oz * k, 5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    c.restore();
    // Player arrow (fixed at centre, pointing by relative yaw)
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(-(player.yaw - camYaw));
    c.fillStyle = '#4fe3ff';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 5);
    c.lineTo(0, 2);
    c.lineTo(-5, 5);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = '#3b4048';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2);
    c.stroke();
  }
}
