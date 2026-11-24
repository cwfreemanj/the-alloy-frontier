/**
 * The First Forge: integrates rendering, input, rules modules, UI and persistence.
 * Gameplay decisions are delegated to @alloy/* packages; this file wires them together.
 */
import * as THREE from 'three';
import {
  ATTRIBUTES,
  STAT_POINTS_PER_RANK,
  incomingContest,
  resistanceMultiplier,
  WEAPON_FAMILIES,
  ATTACKS,
  DODGE,
  dist2,
  forwardPoint,
  inArc,
  inCircle,
  mitigate,
  yawTo,
  type CombatContext,
  type CombatEvent,
  type Vec2,
} from '@alloy/game-rules';
import { cleanName, type AvatarState, type HitVerdict } from '@alloy/protocol';
import { toolPower } from '@alloy/crafting';
import { IMBUEMENTS, type ItemInstance } from '@alloy/item-gen';
import { CameraRig } from '../core/CameraRig';
import { Input } from '../core/Input';
import { PerfMonitor } from '../core/Perf';
import { Enemy } from '../entities/Enemy';
import { PLAYER_RADIUS, Player } from '../entities/Player';
import { Npc, ResourceNode } from '../entities/WorldObjects';
import { Effects } from '../fx/Effects';
import { SaveSystem } from '../state/Save';
import { Session, applyAction, characterStats, ensureNodes, newSessionData, regrowNodes, damageAgainst, hitAgainst, weaponDamageType, rewardHit, rewardHitTaken, rewardKill, toolFor, type CharAction, type SessionData, type SessionEvent } from '../state/Session';
import { CharacterWindow, type CharacterTab } from '../ui/CharacterWindow';
import { ForgePanel } from '../ui/ForgePanel';
import { Hud } from '../ui/Hud';
import { MerchantPanel, dialogPanel, pausePanel, summaryPanel, titleScreen, type Settings } from '../ui/Panels';
import { h } from '../ui/dom';
import { ALL_RESOURCE_NODES, ENEMY_SPAWNS, FORGE_ANVIL, NPCS, RESPAWN_POINT, ZONES, zoneAt, type Zone } from '@alloy/world';
import { terrainHeight } from '@alloy/world';
import { EmberholdWorld } from '../world/EmberholdWorld';
import { orlaDialogue } from './Dialogue';
import type { RemotePlayer } from '../entities/RemotePlayer';
import { findWorld } from '../net/WorldClient';
import { AccountClient, type ApiError } from '../net/Accounts';
import { deserialize as parseSave, serialize as encodeSave } from '@alloy/save';
import type { AccountView } from '../ui/Panels';
import { Online, type ActReply } from './Online';
import { DEFAULT_PLAYER_CHARACTER, PLAYER_CHARACTERS, charactersReady, isPlayerCharacter, type PlayerCharacterId } from '../entities/models/Characters';

const NAME_KEY = 'alloy-frontier.name.v1';
function loadName(): string {
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) return cleanName(n);
  } catch {
    /* storage unavailable */
  }
  return `Smith-${Math.floor(1000 + Math.random() * 9000)}`;
}

const CHARACTER_KEY = 'alloy-frontier.character.v1';
function loadCharacter(): PlayerCharacterId {
  try {
    const c = localStorage.getItem(CHARACTER_KEY);
    if (isPlayerCharacter(c)) return c;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_PLAYER_CHARACTER;
}

type Modal = null | 'title' | 'pause' | 'forge' | 'inventory' | 'merchant' | 'dialog' | 'summary';

const SETTINGS_KEY = 'alloy-frontier.settings.v1';
const DEFAULT_SETTINGS: Settings = { quality: 'medium', sensitivity: 1, invertY: false, showPerf: false, reducedShake: false };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly cam: CameraRig;
  readonly perf: PerfMonitor;
  readonly effects: Effects;
  readonly hud: Hud;
  readonly saves = new SaveSystem(window.localStorage);
  world!: EmberholdWorld;
  session!: Session;
  player!: Player;
  enemies: Enemy[] = [];
  npcs: Npc[] = [];
  nodes: ResourceNode[] = [];
  private sun!: THREE.DirectionalLight;
  private clock = new THREE.Clock();
  private modal: Modal = 'title';
  private modalEl: HTMLElement | null = null;
  private forgePanel: ForgePanel | null = null;
  private lockTarget: Enemy | null = null;
  private hitstop = 0;
  private zone: Zone = ZONES[0];
  private time = 0;
  private sinceDamage = 99;
  private deathTimer = 0;
  private autosaveTimer = 0;
  private gatherTarget: ResourceNode | null = null;
  private deadAt = new Map<string, number>();
  private pauseOpenedAt = 0;
  private lockUnavailable = false;
  private lastSave = 'Not saved yet this session.';
  settings: Settings = loadSettings();
  private readonly ui: HTMLElement;
  /** Debug/cheat hooks: only with ?debug AND on a local machine, never on a hosted build. */
  readonly debug = new URLSearchParams(location.search).has('debug') && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  private started = false;
  /** Time spent constructing the scene (ms). */
  constructMs = 0;
  /** Shared-world connection (offline when no world server is reachable). */
  online!: Online;
  playerName = loadName();
  character: PlayerCharacterId = loadCharacter();
  private worldStatusEl!: HTMLElement;
  private lastAvatarPos: Vec2 = { x: 0, z: 0 };
  private avatarSpeed = 0;
  /** World server address (null when playing offline). */
  private worldUrl: string | null = null;
  private accounts: AccountClient | null = null;
  /** The open inventory/merchant panel, re-rendered when the server's character changes. */
  private panel: { render(): void } | null = null;
  /** 'account' = character owned and saved by the server; 'guest' = saved in this browser. */
  mode: 'guest' | 'account' = 'guest';
  private accountView: AccountView = { state: 'checking' };
  private cloudRaw: string | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const t0 = performance.now();
    this.ui = uiRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 600);
    // The Emberhold first area (Model Workshop scene): terrain, buildings, scatter, sky, light, fog, fx.
    this.world = new EmberholdWorld(this.renderer, this.scene, this.camera, this.settings.quality);
    this.sun = this.world.sun;
    this.input = new Input(canvas);
    this.cam = new CameraRig(this.camera, this.world.colliders);
    this.effects = new Effects(this.scene);
    this.perf = new PerfMonitor(this.renderer);
    this.hud = new Hud(uiRoot);
    this.applySettings();

    this.player = new Player(this.world.colliders, null, this.character);
    this.scene.add(this.player.object);
    for (const s of ENEMY_SPAWNS) this.enemies.push(new Enemy(s, this.world.colliders, this.scene));
    this.npcs.push(new Npc(NPCS.orla.id, NPCS.orla.name, NPCS.orla.pos, NPCS.orla.yaw, { kind: 'organic', skin: '#b98468', body: '#5a3a2a', armor: '#3a3430', legs: '#2a2420', boots: '#1e1812', accent: '#ff8a3d', scale: 1.02 }));
    this.npcs.push(new Npc(NPCS.bram.id, NPCS.bram.name, NPCS.bram.pos, NPCS.bram.yaw, { kind: 'organic', skin: '#d0a888', body: '#3a5a4a', armor: '#5a4a3a', legs: '#3a3026', boots: '#241c16', accent: '#45e0ff', scale: 0.98, bulk: 1.15 }));
    for (const n of this.npcs) this.scene.add(n.object);
    for (const d of ALL_RESOURCE_NODES) {
      const n = new ResourceNode(d);
      this.nodes.push(n);
      this.scene.add(n.object);
    }

    this.online = new Online({
      scene: this.scene,
      enemies: this.enemies,
      localAvatar: () => this.localAvatar(),
      showHitResult: (e, r) => this.showHitResult(e, r),
      hitLocalPlayer: (e, dmg, heavy) => this.hitLocalPlayer(e, dmg, heavy),
      creditKill: (e) => this.onEnemyKilled(e),
      remoteSlash: (r, atk) => this.remoteSlash(r, atk),
      toast: (t, tone) => this.hud.toast(t, tone),
      statusChanged: () => this.updateWorldStatus(),
      authorityChanged: (online) => {
        // Going offline: the browser takes the enemies back, fresh.
        if (!online) for (const e of this.enemies) e.respawn();
        this.lockTarget = null;
      },
      kicked: (reason) => this.endSession(reason),
      character: (data, events) => this.characterUpdate(data, events),
      correctPosition: (x, z) => {
        this.player.spawn(x, z, this.player.yaw);
        this.gatherTarget = null;
        this.player.gathering = 0;
      },
    });
    this.worldStatusEl = h('div', { class: 'world-status', 'data-testid': 'world-status' });
    uiRoot.append(this.worldStatusEl);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('mousedown', () => {
      if (this.modal === null && !this.input.pointerLocked && !this.lockUnavailable) {
        this.input.consume('Mouse0');
        this.input.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockerror', () => (this.lockUnavailable = true));
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.modal === null && this.started) this.openPause();
    });
    window.addEventListener('beforeunload', () => {
      if (this.started && this.session) this.save('exit');
    });

    // Bootstrap with a fresh session behind the title screen.
    this.loadSession(newSessionData(Date.now()));
    this.showTitle();
    this.constructMs = performance.now() - t0;
    this.renderer.setAnimationLoop(() => this.frame());
    this.exposeDebug();
    this.updateWorldStatus();
    void this.joinWorld();
  }

  // ---------------- Shared world ----------------
  /** Find the world server and join it automatically (no codes or addresses). */
  private async joinWorld(): Promise<void> {
    this.online.message = 'Looking for the world…';
    this.updateWorldStatus();
    const url = await findWorld();
    this.worldUrl = url;
    if (!url) {
      this.online.message = 'Offline: no world server reachable';
      this.updateWorldStatus();
      this.setAccountView({ state: 'unavailable' });
      return;
    }
    this.online.message = 'Ready to join the world';
    this.updateWorldStatus();
    this.accounts = new AccountClient(url.replace(/^ws/, 'http').replace(/\/world$/, '/'));
    const st = await this.accounts.check();
    if (st === 'signed_in') await this.afterSignIn();
    else this.setAccountView({ state: st });
    // Already playing (e.g. a guest who started before the check finished): join now.
    if (this.started && !this.online.client) this.connectWorld();
  }

  /** Join the shared world as the current account or guest. */
  private connectWorld(): void {
    if (!this.worldUrl) return;
    if (this.mode === 'account' && this.accounts?.username) this.online.connect(this.worldUrl, this.accounts.username, this.accounts.token);
    else this.online.connect(this.worldUrl, this.playerName);
  }

  private setAccountView(v: AccountView): void {
    this.accountView = v;
    if (this.modal === 'title') this.showTitle();
  }

  private async afterSignIn(): Promise<void> {
    try {
      this.cloudRaw = await this.accounts!.loadSave();
    } catch (e) {
      this.setAccountView({ state: 'signed_out', error: (e as ApiError).message });
      return;
    }
    const guestSave = this.saves.hasSave() && this.saves.load().ok;
    this.setAccountView({ state: 'signed_in', username: this.accounts!.username!, hasCloudSave: !!this.cloudRaw, canImport: guestSave && !this.cloudRaw });
  }

  private async accountAction(kind: 'login' | 'register', username: string, password: string): Promise<void> {
    if (!this.accounts) return;
    this.setAccountView({ state: 'signed_out', busy: true });
    try {
      if (kind === 'login') await this.accounts.login(username, password);
      else await this.accounts.register(username, password);
      await this.afterSignIn();
    } catch (e) {
      this.setAccountView({ state: 'signed_out', error: (e as ApiError).message });
    }
  }

  private async signOut(): Promise<void> {
    await this.accounts?.logout();
    this.cloudRaw = null;
    this.setAccountView({ state: 'signed_out' });
  }

  /** Start playing a character (from the title screen). */
  private startPlaying(data: SessionData, mode: 'guest' | 'account', banner: 'new' | 'continue'): void {
    this.mode = mode;
    this.loadSession(data);
    this.started = true;
    this.closeModal();
    this.hud.zoneBanner(banner === 'new' ? ZONES[0] : this.zone);
    if (banner === 'new') {
      this.hud.toast('Find Master Smith Orla at the forge (orange marker on the minimap).', 'info');
      this.hud.toast('Click the view to capture the mouse. Esc for menu and controls.', 'info');
    }
    this.connectWorld();
  }

  // ---------------- Character changes ----------------
  /**
   * Every change to the character goes through here. Signed in: the server decides and
   * sends back the character. Guest: the same rules run in this browser.
   */
  async act(a: CharAction): Promise<ActReply> {
    if (this.mode === 'account') {
      const r = await this.online.act(a);
      if (!r.ok && r.message) this.hud.toast(r.message, 'warn');
      return r;
    }
    const r = applyAction(this.session, a, { pos: this.player.pos2 });
    // Refusals from the rules themselves were already shown as toasts by the session.
    if (!r.ok && !r.events.some((e) => e.type === 'toast' && e.tone === 'warn')) this.hud.toast(r.message, 'warn');
    return r.ok ? { ok: true, item: r.item } : { ok: false, error: r.error, message: r.message };
  }

  /** The server's copy of our character (signed in): adopt it and show what happened. */
  private characterUpdate(data: SessionData, events: SessionEvent[]): void {
    if (this.mode !== 'account') return;
    ensureNodes(data);
    const before = this.session.equipped()?.itemId ?? null;
    this.session.data = data;
    for (const e of events) this.session.notify(e);
    if ((this.session.equipped()?.itemId ?? null) !== before) this.player.setWeapon(this.session.equipped());
    this.applyCharacterStats();
    this.forgePanel?.render();
    this.panel?.render();
  }

  /** Leave play and return to the title screen with a reason (no further saves from here). */
  private endSession(reason: string): void {
    this.online.disconnect();
    this.started = false;
    this.modal = null;
    if (this.accounts?.username) {
      this.cloudRaw = null;
      void this.afterSignIn().then(() => {
        if (this.accountView.state === 'signed_in') this.setAccountView({ ...this.accountView, error: reason });
      });
    } else this.setAccountView({ state: 'signed_out', error: reason });
    this.showTitle();
  }

  setPlayerName(raw: string): void {
    const n = cleanName(raw);
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* storage unavailable */
    }
    if (n === this.playerName) return;
    this.playerName = n;
    // Re-introduce ourselves under the new name (guests only; accounts use their username).
    if (this.mode === 'guest' && this.started && this.online.client) this.online.connect(this.online.client.url, n);
  }

  /** Pick the player character (title screen). Persists per browser; others see it online. */
  setCharacter(id: PlayerCharacterId): void {
    this.character = id;
    try {
      localStorage.setItem(CHARACTER_KEY, id);
    } catch {
      /* storage unavailable */
    }
    this.player.setCharacter(id);
  }

  private updateWorldStatus(): void {
    const o = this.online;
    const others = [...o.remotes.values()].map((r) => r.name);
    let text: string;
    let cls: string;
    if (o.online) {
      cls = 'on';
      text = others.length ? `Online · ${others.length + 1} players: you, ${others.slice(0, 4).join(', ')}${others.length > 4 ? '…' : ''}` : 'Online · no one else here right now';
    } else if (o.status === 'connecting') {
      cls = 'wait';
      text = o.message;
    } else {
      cls = 'off';
      text = o.message;
    }
    this.worldStatusEl.className = `world-status ${cls}`;
    this.worldStatusEl.textContent = text;
    this.worldStatusEl.title = o.online ? `Playing as ${this.playerName}` : '';
  }

  private localAvatar(): AvatarState {
    const c = this.player.combat;
    const p = this.player;
    const ph = !c.alive ? 'dead' : p.gathering > 0 ? 'gather' : c.phase !== 'idle' ? c.phase : c.blocking ? 'block' : !p.grounded ? 'air' : 'idle';
    const dur = c.phase === 'windup' ? c.durations.windup : c.phase === 'active' ? c.durations.active : c.phase === 'recovery' ? c.durations.recovery : c.phase === 'dodge' ? DODGE.duration : 1;
    const w = this.weapon();
    const r = (v: number, k = 100) => Math.round(v * k) / k;
    return {
      x: r(p.position.x),
      y: r(p.position.y),
      z: r(p.position.z),
      yaw: r(p.yaw, 1000),
      spd: r(this.avatarSpeed, 10),
      ph,
      atk: c.attack?.id ?? null,
      pr: r(Math.min(1, c.t / Math.max(0.01, dur))),
      hp: Math.round(c.health),
      mhp: c.maxHealth,
      wpn: w ? { bp: w.blueprintId, spec: w.forge.specialization, imb: w.result.imbuements.includes('storm_arc'), rar: w.result.rarity } : null,
      mdl: this.character,
    };
  }

  private remoteSlash(r: RemotePlayer, atk: string): void {
    const a = (ATTACKS as Record<string, (typeof ATTACKS)[keyof typeof ATTACKS] | undefined>)[atk];
    if (!a || dist2(r.pos2, this.player.pos2) > 60) return;
    if (a.id === 'storm_arc') {
      this.effects.lightning(r.position, a.range);
      return;
    }
    const tilt = a.id === 'light1' ? 0.25 : a.id === 'light2' ? -0.25 : a.id === 'light3' || a.id === 'heavy' ? 1.35 : 0.1;
    this.effects.slash(r.position, r.yaw, { radius: a.range, arcDeg: Math.min(160, a.arcDeg), tilt, color: a.id === 'guardbreaker' ? '#ff9a4a' : r.state?.wpn?.imb ? '#7ff0ff' : '#ffe6c8' });
  }

  /** The server's verdict on one of our hits. */
  private showHitResult(e: Enemy, r: HitVerdict): void {
    if (r.ignored) return;
    const sp = this.hud.project(this.camera, e.position, 2 * e.def.scale, window.innerWidth, window.innerHeight);
    if (sp.visible) {
      this.hud.damageNumber(sp.x + (Math.random() - 0.5) * 30, sp.y, `${Math.round(r.damage)}${r.crit ? '!' : ''}`, r.crit ? 'crit' : '');
      if (r.guardBroken) this.hud.damageNumber(sp.x, sp.y - 24, 'GUARD BROKEN', 'info');
      else if (r.guarded) this.hud.damageNumber(sp.x, sp.y - 24, 'GUARDED — use Guardbreaker (R)', 'info');
      else if (r.staggered) this.hud.damageNumber(sp.x, sp.y - 24, 'STAGGERED', 'info');
      else this.typeHint(sp, resistanceMultiplier(e.def.resist, weaponDamageType(this.session)));
    }
    // Signed in, the server grants weapon and attribute XP for the hits it accepts.
    if (this.mode !== 'account') rewardHit(this.session, e.spawn.type, r.damage, this.player.combat.attack?.id ?? 'light1', r.crit);
  }

  // ---------------- Setup ----------------
  applySettings(): void {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.75 : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.world?.setQuality(q);
    this.camera.far = q === 'low' ? 200 : 600;
    this.camera.updateProjectionMatrix();
    this.cam.settings = { sensitivity: this.settings.sensitivity, invertY: this.settings.invertY };
    this.hud.perf.style.display = this.settings.showPerf ? 'block' : 'none';
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    this.world?.setSize(w, hgt);
  }

  // ---------------- Session ----------------
  loadSession(data: SessionData): void {
    this.session = new Session(data);
    this.session.on((e) => {
      switch (e.type) {
        case 'toast':
          this.hud.toast(e.text, e.tone);
          break;
        case 'equip':
          this.player.setWeapon(e.item);
          break;
        case 'progress':
          if (e.kind === 'weapon') this.hud.toast(`${WEAPON_FAMILIES[e.family ?? 'longsword'].name} mastery ${this.session.masteryOf(e.family ?? 'longsword')} (+${e.levels})`, 'good');
          if (e.kind === 'smith') this.hud.toast(`Blacksmithing mastery ${this.session.smithMastery}`, 'good');
          if (e.kind === 'adventurer') this.hud.toast(`Adventurer rank ${this.session.data.progression.adventurer.rank} · +${STAT_POINTS_PER_RANK * e.levels} stat points (O)`, 'good');
          if (e.kind === 'attribute' && e.attr) {
            this.hud.toast(`${ATTRIBUTES[e.attr].name} ${this.session.attributes[e.attr].level}`, 'good');
            this.applyCharacterStats();
          }
          break;
        case 'quest_step':
          this.hud.toast(`✓ ${e.title}${e.next ? ` → ${e.next}` : ''}`, 'good');
          this.save('quest');
          break;
        case 'quest_complete':
          this.save('quest-complete');
          break;
        case 'inventory':
          this.forgePanel?.render();
          break;
        case 'stats':
          this.applyCharacterStats();
          this.panel?.render();
          break;
      }
    });
    const p = data.player;
    this.player.spawn(p.x, p.z, p.yaw);
    this.applyCharacterStats();
    this.player.combat.revive();
    this.player.combat.health = Math.max(1, Math.min(this.player.combat.maxHealth, p.health));
    this.player.setWeapon(this.session.equipped());
    this.cam.snapBehind(p.yaw);
    this.deadAt.clear();
    // Online, enemies belong to the shared world; only offline play restores them from the save.
    for (const e of this.online?.online ? [] : this.enemies) {
      e.respawn();
      if (e.def.kind === 'elite' && data.world.wardenDefeated) {
        e.brain.receiveHit({ damage: 1e9, stagger: 0, guardBreak: false });
        e.object.visible = false;
        e.deadTime = 99;
      }
    }
    ensureNodes(data);
    this.lockTarget = null;
    this.zone = zoneAt(this.player.pos2);
  }

  save(reason: string): void {
    if (!this.started) return;
    const d = this.session.data;
    d.player = { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw, health: this.player.combat.alive ? this.player.combat.health : this.player.combat.maxHealth };
    if (this.mode === 'account') {
      this.lastSave = this.online.online ? 'Your character is saved by the server as you play.' : 'Not connected: changes are paused until you reconnect.';
      return;
    }
    const r = this.saves.save(d);
    this.lastSave = r.ok ? `Saved in this browser (${reason}) at ${new Date().toLocaleTimeString()} · ${(r.bytes / 1024).toFixed(1)} KB` : `Save failed: ${r.error}`;
    if (!r.ok) this.hud.toast(this.lastSave, 'warn');
  }

  // ---------------- Modals ----------------
  private setModal(m: Modal, el: HTMLElement | null): void {
    this.modalEl?.remove();
    this.modal = m;
    this.modalEl = el;
    if (m !== 'forge') this.forgePanel = null;
    this.panel = null;
    if (el) this.ui.append(el);
    this.input.enabled = m === null;
    if (m !== null) {
      this.input.clear();
      this.input.exitPointerLock();
    }
    this.hud.setVisible(m !== 'title');
  }

  closeModal(): void {
    this.setModal(null, null);
    if (!this.lockUnavailable) this.input.requestPointerLock();
  }

  private showTitle(): void {
    const has = this.saves.hasSave();
    let loadError: string | undefined;
    if (has) {
      const r = this.saves.load();
      if (!r.ok) loadError = `Saved game could not be loaded: ${r.reason}`;
    }
    this.setModal(
      'title',
      titleScreen({
        hasSave: has && !loadError,
        loadError,
        onNew: () => this.newGame(),
        onContinue: () => this.continueGame(),
        name: this.playerName,
        onName: (n) => this.setPlayerName(n),
        characters: charactersReady() ? PLAYER_CHARACTERS : [],
        character: this.character,
        onCharacter: (id) => this.setCharacter(id as PlayerCharacterId),
        account: this.accountView,
        onSignIn: (u, p) => void this.accountAction('login', u, p),
        onRegister: (u, p) => void this.accountAction('register', u, p),
        onSignOut: () => void this.signOut(),
        onAccountContinue: () => {
          const r = this.cloudRaw ? parseSave(this.cloudRaw) : null;
          if (!r || !r.ok) {
            this.setAccountView({ ...(this.accountView as Extract<AccountView, { state: 'signed_in' }>), error: `Your saved character could not be loaded${r && !r.ok ? `: ${r.reason}` : ''}.` });
            return;
          }
          this.startPlaying(r.data, 'account', 'continue');
        },
        onAccountNew: () => void this.accountCharacter('new'),
        onImport: () => void this.accountCharacter('import'),
      }),
    );
  }

  /** Start a new account character, or bring this browser's guest character in (server-side). */
  private async accountCharacter(kind: 'new' | 'import'): Promise<void> {
    if (!this.accounts || this.accountView.state !== 'signed_in') return;
    const view = this.accountView;
    const local = kind === 'import' ? this.saves.load() : null;
    if (local && !local.ok) return;
    this.setAccountView({ ...view, busy: true, error: undefined });
    try {
      if (kind === 'new') await this.accounts.newCharacter();
      else await this.accounts.importCharacter(encodeSave(local!.ok ? local!.data : newSessionData(Date.now()), Date.now()));
    } catch (e) {
      this.setAccountView({ ...view, busy: false, error: (e as ApiError).message });
      return;
    }
    this.cloudRaw = await this.accounts.loadSave().catch(() => null);
    const r = this.cloudRaw ? parseSave(this.cloudRaw) : null;
    this.startPlaying(r?.ok ? r.data : newSessionData(Date.now()), 'account', kind === 'new' ? 'new' : 'continue');
    if (kind === 'import') this.hud.toast('Your browser character now lives in your account.', 'good');
  }

  /** New guest game (saved in this browser). */
  newGame(): void {
    this.saves.clear();
    this.startPlaying(newSessionData(Date.now()), 'guest', 'new');
    this.save('new');
  }

  /** Continue: the guest save in this browser, or (signed in) the latest save from the server. */
  continueGame(): void {
    if (this.mode === 'account' && this.started && this.accounts) {
      void this.accounts
        .loadSave()
        .then((raw) => {
          const r = raw ? parseSave(raw) : null;
          if (r?.ok) this.startPlaying(r.data, 'account', 'continue');
          else this.hud.toast('No saved character on the server yet.', 'warn');
        })
        .catch((e: ApiError) => this.hud.toast(e.message, 'warn'));
      return;
    }
    const r = this.saves.load();
    if (!r.ok) {
      this.hud.toast(r.reason, 'warn');
      return;
    }
    this.startPlaying(r.data, 'guest', 'continue');
    if (r.source === 'backup') this.hud.toast('Primary save was invalid; restored the backup save.', 'warn');
  }

  openPause(): void {
    if (this.modal !== null) return;
    this.pauseOpenedAt = performance.now();
    this.save('pause');
    this.setModal(
      'pause',
      pausePanel({
        settings: this.settings,
        saveInfo: this.lastSave,
        onResume: () => this.closeModal(),
        onSave: () => {
          this.save('manual');
          this.hud.toast(this.lastSave, 'good');
        },
        onLoad: () => this.continueGame(),
        onNewGame: () => this.newGame(),
        onSettings: (s) => {
          this.settings = s;
          this.applySettings();
        },
      }),
    );
  }

  openInventory(tab: CharacterTab = 'inventory'): void {
    const name = this.mode === 'account' ? (this.accounts?.username ?? 'Character') : this.playerName || 'Character';
    const p = new CharacterWindow(
      this.session,
      tab,
      name,
      () => this.closeModal(),
      (id) => void this.act({ k: 'equip', item: id }),
      (slot) => void this.act({ k: 'unequip', slot }),
      async (id) => (await this.act({ k: 'discard', item: id })).ok,
      (attr, n) => this.act({ k: 'allocate', attr, n }),
      () => this.act({ k: 'respec' }),
    );
    this.setModal('inventory', p.el);
    this.panel = p;
  }

  openForge(): void {
    if (!this.session.passed('commission')) {
      this.hud.toast('Speak with Master Smith Orla first.', 'warn');
      return;
    }
    const p = new ForgePanel(
      this.session,
      () => this.closeModal(),
      (id) => void this.act({ k: 'equip', item: id }),
      (req) => this.act({ k: 'forge', req }),
    );
    this.setModal('forge', p.el);
    this.forgePanel = p;
  }

  openMerchant(): void {
    const p = new MerchantPanel(this.session, () => this.closeModal(), (stock, qty) => this.act({ k: 'buy', stock, qty }));
    this.setModal('merchant', p.el);
    this.panel = p;
    void this.act({ k: 'event', ev: 'open_merchant' });
  }

  openOrla(): void {
    const spec = orlaDialogue(this.session);
    const el = dialogPanel(
      NPCS.orla.name,
      NPCS.orla.role,
      spec.lines,
      spec.options.map((o) => ({
        label: o.label,
        primary: o.primary,
        action: () => {
          if (o.kind === 'talk') {
            void this.talkToOrla();
          } else if (o.kind === 'forge') {
            this.openForge();
          } else this.closeModal();
        },
      })),
    );
    this.setModal('dialog', el);
  }

  private async talkToOrla(): Promise<void> {
    const wasReport = this.session.step()?.id === 'report';
    const r = await this.act({ k: 'talk', npc: 'orla' });
    if (!r.ok) return;
    if (wasReport && this.session.data.quest.completed) {
      this.setModal('summary', summaryPanel(this.session, () => this.closeModal()));
      return;
    }
    this.closeModal();
    if (this.session.step()?.id === 'first_blood') {
      this.hud.toast('Light: LMB/J · Heavy: F · Block: RMB/L · Dodge: Q · Guardbreaker: R · Lock: Tab', 'info');
    }
  }

  // ---------------- Frame ----------------
  private frame(): void {
    const frameStart = performance.now();
    const rawDt = Math.min(0.05, this.clock.getDelta());
    this.time += rawDt;
    this.handleGlobalKeys();
    if (this.modal === null && this.started) {
      this.session.data.playTime += rawDt;
      const dt = this.hitstop > 0 ? rawDt * 0.12 : rawDt;
      this.hitstop = Math.max(0, this.hitstop - rawDt);
      this.simulate(dt, rawDt);
      this.autosaveTimer += rawDt;
      if (this.autosaveTimer > 30) {
        this.autosaveTimer = 0;
        this.save('auto');
      }
    } else {
      // Keep the world alive behind menus (no simulation), and orbit slowly on the title.
      if (this.modal === 'title') this.cam.yaw += rawDt * 0.05;
      if (!this.started) {
        // Nothing is simulated behind the title screen; keep the characters breathing.
        this.player.presentIdle(rawDt);
        for (const n of this.npcs) n.update(rawDt, null);
        for (const e of this.enemies) e.presentIdle(rawDt);
      }
      this.cam.update(rawDt, this.player.position, null);
    }
    if (this.started) {
      // Online, the world never pauses: keep mirroring it behind menus.
      if (this.modal !== null && this.online.online) this.updateEnemies(rawDt);
      this.online.update(rawDt);
    }
    this.world.update(this.time, this.player.position);
    this.effects.update(rawDt);
    this.world.render(this.time);
    this.updateLabels();
    if (this.settings.showPerf) this.hud.perf.textContent = this.perf.text();
    this.input.endFrame();
    this.perf.frame(performance.now() - frameStart);
    this.perfFrames.push(rawDt * 1000);
    if (this.perfFrames.length > 600) this.perfFrames.shift();
  }

  /** Wall-clock frame intervals (true FPS), separate from CPU frame cost. */
  readonly perfFrames: number[] = [];

  private handleGlobalKeys(): void {
    if (this.input.pressed('perf')) {
      this.settings.showPerf = !this.settings.showPerf;
      this.applySettings();
    }
    if (this.input.pressed('pause')) {
      if (this.modal === 'title') return;
      if (this.modal === 'pause' && performance.now() - this.pauseOpenedAt < 250) return;
      if (this.modal !== null) this.closeModal();
      else this.openPause();
    }
    // I / O / U open the character window on its Inventory / Character / Skills tab;
    // the same key again closes it.
    const tabKeys: Array<['inventory' | 'character' | 'skills', CharacterTab]> = [
      ['inventory', 'inventory'],
      ['character', 'character'],
      ['skills', 'skills'],
    ];
    for (const [action, tab] of tabKeys) {
      if (!this.input.pressed(action) || !this.started) continue;
      const w = this.panel instanceof CharacterWindow ? this.panel : null;
      if (this.modal === 'inventory' && w?.tab === tab) this.closeModal();
      else if (this.modal === 'inventory' && w) w.show(tab);
      else if (this.modal === null) this.openInventory(tab);
    }
  }

  private weapon(): ItemInstance | null {
    return this.session.equipped();
  }

  /** Max health and stamina come from the character's attributes (shared rules). */
  private applyCharacterStats(): void {
    const st = characterStats(this.session);
    const c = this.player.combat;
    c.maxHealth = st.maxHealth;
    c.health = Math.min(c.health, c.maxHealth);
    c.stamina.max = st.maxStamina;
    c.stamina.current = Math.min(c.stamina.current, c.stamina.max);
  }

  private combatContext(): CombatContext {
    const w = this.weapon();
    return {
      weapon: characterStats(this.session).weapon,
      abilities: w?.result.imbuements ?? [],
      abilityCooldowns: { storm_arc: IMBUEMENTS.storm_arc.cooldown },
    };
  }

  private moveDir(): THREE.Vector2 {
    const f = this.cam.forward();
    // Screen-right in XZ (x, z): forward x up, i.e. (-f.z, f.x). Looking down +Z it is -X.
    const r = new THREE.Vector2(-f.y, f.x);
    const v = new THREE.Vector2();
    if (this.input.held('forward')) v.add(f);
    if (this.input.held('back')) v.sub(f);
    if (this.input.held('right')) v.add(r); // D strafes right
    if (this.input.held('left')) v.sub(r); // A strafes left
    return v.lengthSq() > 0 ? v.normalize() : v;
  }

  private simulate(dt: number, rawDt: number): void {
    const inp = this.input;
    const c = this.player.combat;
    const ctx = this.combatContext();

    // Camera input
    this.cam.rotate(inp.mouseDX, inp.mouseDY);
    const camKeys = (inp.held('camLeft') ? 1 : 0) - (inp.held('camRight') ? 1 : 0);
    const camKeysY = (inp.held('camDown') ? 1 : 0) - (inp.held('camUp') ? 1 : 0);
    if (camKeys || camKeysY) this.cam.rotate(-camKeys * 900 * rawDt, camKeysY * 500 * rawDt);
    if (inp.wheel) this.cam.zoom(inp.wheel);

    // Target lock
    if (inp.pressed('lock')) this.toggleLock();
    if (this.lockTarget && (!this.lockTarget.brain.alive || dist2(this.lockTarget.pos2, this.player.pos2) > 26)) this.lockTarget = null;

    // Combat requests
    const dir = this.moveDir();
    if (c.alive && this.player.gathering <= 0) {
      const tryAct = (kind: 'light' | 'heavy' | 'guardbreaker' | 'dodge' | 'storm_arc', slot: string) => {
        const r = c.request(kind, ctx);
        if (r === 'no_stamina' || r === 'cooldown' || r === 'unavailable') {
          this.hud.flashSlot(slot);
          if (r === 'unavailable') this.hud.toast('This weapon has no active ability. A strong ironglass masterwork may awaken Storm Arc.', 'info');
        }
      };
      if (this.player.grounded) {
        if (inp.pressed('light')) tryAct('light', 'light');
        if (inp.pressed('heavy')) tryAct('heavy', 'heavy');
        if (inp.pressed('guardbreaker')) tryAct('guardbreaker', 'guardbreaker');
        if (inp.pressed('ability')) tryAct('storm_arc', 'storm_arc');
      }
      if (inp.pressed('dodge')) tryAct('dodge', 'dodge');
      c.setBlock(inp.held('block'));
    } else c.setBlock(false);

    const events = c.update(dt, ctx, { sprinting: this.player.sprinting });
    for (const e of events) this.onCombatEvent(e, dir);

    // Movement
    const face = this.lockTarget ? this.lockTarget.position : null;
    const lungeRoom = this.lungeRoom();
    this.player.update(dt, { dir, sprint: inp.held('sprint'), jump: inp.pressed('jump') }, face, lungeRoom);
    const moved = Math.hypot(this.player.position.x - this.lastAvatarPos.x, this.player.position.z - this.lastAvatarPos.z);
    this.avatarSpeed += (moved / Math.max(dt, 1e-3) - this.avatarSpeed) * Math.min(1, dt * 12);
    this.lastAvatarPos = this.player.pos2;

    this.updateEnemies(dt);
    this.resolvePlayerHits();
    this.resolveEnemyHits();

    // NPCs look at the player when near
    for (const n of this.npcs) n.update(dt, dist2(n.pos2, this.player.pos2) < 6 ? this.player.position : null);

    // Nodes (regrowth is a rule; signed in, the server's copy is what counts)
    regrowNodes(this.session.data);
    for (const n of this.nodes) n.setState(this.session.data.world.nodes[n.def.id], this.time);

    this.updateGathering(dt);
    this.updateInteraction();
    this.updateHealthRegen(dt);
    this.updateDeath(rawDt);

    // Zone transitions (continuous world; banner only)
    const z = zoneAt(this.player.pos2);
    if (z.id !== this.zone.id) {
      this.zone = z;
      this.hud.zoneBanner(z);
    }

    this.cam.update(rawDt, this.player.position, this.lockTarget ? this.lockTarget.position : null);
    this.hud.update(rawDt, c, this.session, this.weapon(), this.zone, c.alive && c.health < c.maxHealth * 0.25);
    this.drawMinimap();
  }

  /** Offline: run enemy AI here. Online: the server runs it; mirror (training post stays local). */
  private updateEnemies(dt: number): void {
    const online = this.online.online;
    const target = { pos: this.player.pos2, alive: this.player.combat.alive };
    for (const e of this.enemies) {
      if (online && e.def.kind !== 'dummy') e.puppetUpdate(dt);
      else {
        e.update(dt, target);
        this.respawnCheck(e);
      }
    }
  }

  private onCombatEvent(e: CombatEvent, dir: THREE.Vector2): void {
    if (e.type === 'attack_start') {
      this.aimAttack(dir, e.attack.range + 2);
      this.player.beginLunge(e.attack.lunge);
    } else if (e.type === 'active_start') {
      const a = e.attack;
      const w = this.weapon();
      const col = w?.result.imbuements.length ? '#7ff0ff' : '#ffe6c8';
      if (a.id === 'storm_arc') {
        this.effects.lightning(this.player.position, a.range);
        this.cam.addShake(this.settings.reducedShake ? 0.05 : 0.25);
      } else {
        const tilt = a.id === 'light1' ? 0.25 : a.id === 'light2' ? -0.25 : a.id === 'light3' || a.id === 'heavy' ? 1.35 : 0.1;
        this.effects.slash(this.player.position, this.player.yaw, { radius: a.range, arcDeg: Math.min(160, a.arcDeg), tilt, color: a.id === 'guardbreaker' ? '#ff9a4a' : col });
      }
    } else if (e.type === 'dodge_start') {
      this.player.beginDodge(dir);
    }
  }

  /** Soft-aim: face the locked target, or the best enemy near the intended direction. */
  private aimAttack(dir: THREE.Vector2, range: number): void {
    if (this.lockTarget) {
      this.player.yaw = yawTo(this.player.pos2, this.lockTarget.pos2);
      return;
    }
    const intended = dir.lengthSq() > 0.01 ? Math.atan2(dir.x, dir.y) : this.player.yaw;
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.brain.alive || (e.def.kind === 'dummy' && dist2(e.pos2, this.player.pos2) > 4)) continue;
      const d = dist2(e.pos2, this.player.pos2);
      if (d > range + e.def.radius) continue;
      const ang = Math.abs(Math.atan2(Math.sin(yawTo(this.player.pos2, e.pos2) - intended), Math.cos(yawTo(this.player.pos2, e.pos2) - intended)));
      if (ang > 1.3) continue;
      const score = d + ang * 3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) this.player.yaw = yawTo(this.player.pos2, best.pos2);
    else this.player.yaw = intended;
  }

  private lungeRoom(): number {
    let room = 99;
    const f = forwardPoint(this.player.pos2, this.player.yaw, 0);
    for (const e of this.enemies) {
      if (!e.brain.alive) continue;
      const d = dist2(e.pos2, f) - e.def.radius - PLAYER_RADIUS;
      if (d < 3 && inArc(this.player.pos2, this.player.yaw, e.pos2, 3 + e.def.radius, 90)) room = Math.min(room, d - 0.25);
    }
    return room;
  }

  private toggleLock(): void {
    if (this.lockTarget) {
      this.lockTarget = null;
      return;
    }
    const f = this.cam.forward();
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.brain.alive || e.def.kind === 'dummy') continue;
      const d = dist2(e.pos2, this.player.pos2);
      if (d > 20) continue;
      const to = new THREE.Vector2(e.position.x - this.player.position.x, e.position.z - this.player.position.z).normalize();
      const dot = to.dot(f);
      const score = d * (1.6 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) {
      // Allow locking the training post when nothing else is around.
      best = this.enemies.find((e) => e.def.kind === 'dummy' && dist2(e.pos2, this.player.pos2) < 10) ?? null;
    }
    this.lockTarget = best;
  }

  private resolvePlayerHits(): void {
    const c = this.player.combat;
    if (!c.hitWindowOpen() || !c.attack) return;
    const a = c.attack;
    for (const e of this.enemies) {
      if (!e.brain.alive) continue;
      if (Math.abs(e.position.y - this.player.position.y) > 2.5) continue;
      if (!inArc(this.player.pos2, this.player.yaw, e.pos2, a.range, a.arcDeg, e.def.radius)) continue;
      if (!c.tryRegisterHit(e.id)) continue;
      const out = hitAgainst(this.session, a, Math.random(), e.def.attributes);
      const landed = damageAgainst(this.session, out.damage, e.def);
      const dmg = landed.damage;
      if (this.online.online && e.def.kind !== 'dummy') {
        // The server decides the outcome; show impact now, numbers when it answers.
        this.online.sendHit(e, a.id, dmg, out.stagger, a.guardBreak, out.crit);
        e.hitFlash = 0.12;
        const hp = e.position.clone();
        hp.y += 1.2 * e.def.scale;
        this.effects.sparks(hp, out.crit ? '#ffb03a' : '#ffd8a8', 12);
        this.hitstop = a.heavy ? 0.085 : 0.05;
        this.cam.addShake(this.settings.reducedShake ? 0.02 : a.heavy ? 0.18 : 0.08);
        continue;
      }
      const res = e.brain.receiveHit({ damage: dmg, stagger: out.stagger, guardBreak: a.guardBreak });
      if (res.ignored) continue;
      e.hitFlash = 0.12;
      const hitPos = e.position.clone();
      hitPos.y += 1.2 * e.def.scale;
      this.effects.sparks(hitPos, res.guarded ? '#7fdcff' : out.crit ? '#ffb03a' : '#ffd8a8', res.guarded ? 8 : 14);
      this.hitstop = a.heavy || res.staggered ? 0.085 : 0.05;
      this.cam.addShake(this.settings.reducedShake ? 0.02 : a.heavy ? 0.18 : 0.08);
      const sp = this.hud.project(this.camera, e.position, 2 * e.def.scale, window.innerWidth, window.innerHeight);
      if (sp.visible) {
        this.hud.damageNumber(sp.x + (Math.random() - 0.5) * 30, sp.y, `${Math.round(res.damage)}${out.crit ? '!' : ''}`, out.crit ? 'crit' : '');
        if (res.guardBroken) this.hud.damageNumber(sp.x, sp.y - 24, 'GUARD BROKEN', 'info');
        else if (res.guarded) this.hud.damageNumber(sp.x, sp.y - 24, 'GUARDED — use Guardbreaker (R)', 'info');
        else if (res.staggered) this.hud.damageNumber(sp.x, sp.y - 24, 'STAGGERED', 'info');
        else this.typeHint(sp, landed.multiplier);
      }
      if (this.mode !== 'account') rewardHit(this.session, e.spawn.type, res.damage, a.id, out.crit);
      if (res.killed) this.onEnemyKilled(e);
    }
  }

  /** A short hint when the damage type matters against this enemy. */
  private typeHint(sp: { x: number; y: number }, multiplier: number): void {
    if (multiplier >= 1.15) this.hud.damageNumber(sp.x, sp.y - 24, 'WEAK SPOT', 'info');
    else if (multiplier <= 0.85) this.hud.damageNumber(sp.x, sp.y - 24, 'RESISTED', 'info');
  }

  private onEnemyKilled(e: Enemy): void {
    const d = e.def;
    // Signed in, the server rolls the rewards and sends them with the character.
    if (this.mode !== 'account') {
      const r = rewardKill(this.session, e.spawn.type, e.id, Math.random);
      if (r.flux) this.hud.toast('Scavenger dropped Binding Flux', 'info');
      this.hud.toast(`${d.name} defeated · +${r.coins} coins`, 'good');
    }
    if (this.lockTarget === e) this.lockTarget = null;
    if (d.kind === 'elite') {
      this.effects.ring(e.position, '#ff8a3d', 10, 1.2);
      this.hud.toast('The Foundry Warden falls silent. Return to Orla.', 'good');
    }
  }

  private resolveEnemyHits(): void {
    if (!this.player.combat.alive) return;
    const online = this.online.online;
    for (const e of this.enemies) {
      if (online && e.def.kind !== 'dummy') continue; // the server resolves these
      const b = e.brain;
      if (!b.hitWindowOpen() || !b.attack) continue;
      const a = b.attack;
      let inside: boolean;
      if (a.shape === 'circle') {
        const center = e.attackCenter ?? forwardPoint(e.pos2, e.yaw, a.circleOffset ?? 0);
        inside = inCircle(center, a.circleRadius ?? 3, this.player.pos2, PLAYER_RADIUS);
      } else inside = inArc(e.pos2, e.yaw, this.player.pos2, a.range, a.arcDeg ?? 90, PLAYER_RADIUS);
      if (!inside) continue;
      if (Math.abs(e.position.y - this.player.position.y) > 1.6 && a.shape === 'circle') continue; // jumped over a quake
      if (!b.tryHitPlayer()) continue;
      this.hitLocalPlayer(e, a.damage, !!a.heavy);
    }
  }

  /** An enemy attack reached the local player (decided locally offline, by the server online). */
  private hitLocalPlayer(e: Enemy, damage: number, heavy: boolean): void {
    const c = this.player.combat;
    if (!c.alive) return;
    const toEnemy = new THREE.Vector2(e.position.x - this.player.position.x, e.position.z - this.player.position.z).normalize();
    const facingDot = toEnemy.dot(this.player.forward());
    // The enemy's Strength against your Vitality: how hard the hit lands.
    // Then armor: mitigate(damage, total defense of equipped gear).
    const landed = mitigate(damage * incomingContest(e.def.attributes.strength, this.session.attributeTotals().vitality), characterStats(this.session).defense);
    const out = c.receiveHit({ rawDamage: landed, facingDot, heavy });
    // Signed in, the server grants Vitality XP when it sends the attack.
    if (this.mode !== 'account' && e.def.kind !== 'dummy') rewardHitTaken(this.session, damage);
    const sp = this.hud.project(this.camera, this.player.position, 2, window.innerWidth, window.innerHeight);
    if (out.dodged) {
      if (sp.visible) this.hud.damageNumber(sp.x, sp.y, 'DODGED', 'info');
      return;
    }
    this.sinceDamage = 0;
    this.player.gathering = 0;
    this.gatherTarget = null;
    this.player.hitFlash = 0.15;
    this.cam.addShake(this.settings.reducedShake ? 0.03 : out.blocked ? 0.08 : 0.25);
    const p = this.player.position.clone();
    p.y += 1.2;
    this.effects.sparks(p, out.blocked ? '#7fdcff' : '#ff5a3a', out.blocked ? 10 : 8);
    if (sp.visible) this.hud.damageNumber(sp.x, sp.y, out.blocked ? `BLOCKED ${Math.round(out.damage)}` : out.guardBroken ? 'GUARD BROKEN' : `-${Math.round(out.damage)}`, 'player');
    if (out.killed) {
      this.deathTimer = 3.5;
      if (this.mode !== 'account') this.session.data.stats.deaths++; // the server counts these for accounts
      this.lockTarget = null;
    }
  }

  private respawnCheck(e: Enemy): void {
    if (e.brain.alive) return;
    const r = e.def.respawnSeconds;
    if (r === null) return;
    const at = this.deadAt.get(e.id);
    if (at === undefined) {
      this.deadAt.set(e.id, this.session.data.playTime);
      return;
    }
    if (this.session.data.playTime - at > r && dist2(e.home, this.player.pos2) > 35) {
      e.respawn();
      this.deadAt.delete(e.id);
    }
  }

  private updateHealthRegen(dt: number): void {
    const c = this.player.combat;
    this.sinceDamage += dt;
    // PROTOTYPE DECISION: no potions in the slice (alchemy deferred), so health recovers out of combat.
    const inVillage = dist2(this.player.pos2, ZONES[0].center) < ZONES[0].radius;
    if (c.alive && this.sinceDamage > 6) c.heal((inVillage ? 12 : 4) * dt);
  }

  private updateDeath(rawDt: number): void {
    const c = this.player.combat;
    this.hud.showDeath(!c.alive);
    if (c.alive) return;
    this.deathTimer -= rawDt;
    if (this.deathTimer <= 0) {
      this.player.spawn(RESPAWN_POINT.x, RESPAWN_POINT.z, 0);
      c.revive();
      if (!this.online.online) for (const e of this.enemies) if (e.brain.alive) e.respawn();
      this.cam.snapBehind(0);
      this.hud.toast('You wake by the forge. Nothing was lost.', 'info');
    }
  }

  // ---------------- Interaction ----------------
  private nearestInteractable(): { kind: 'npc' | 'anvil' | 'node'; id: string; label: string; node?: ResourceNode } | null {
    const p = this.player.pos2;
    let best: { kind: 'npc' | 'anvil' | 'node'; id: string; label: string; node?: ResourceNode; d: number } | null = null;
    const consider = (kind: 'npc' | 'anvil' | 'node', id: string, label: string, d: number, node?: ResourceNode) => {
      if (!best || d < best.d) best = { kind, id, label, d, node };
    };
    for (const n of this.npcs) {
      const d = dist2(n.pos2, p);
      if (d < 3) consider('npc', n.id, n.id === 'orla' ? `Talk to ${n.name}` : `Trade with ${n.name}`, d);
    }
    const da = dist2(FORGE_ANVIL, p);
    if (da < 2.8) consider('anvil', 'anvil', 'Use the forge', da);
    for (const n of this.nodes) {
      const d = dist2(n.pos2, p);
      if (d < 2.6) {
        const rt = this.session.data.world.nodes[n.def.id];
        const label = rt.charges > 0 ? `Gather · ${n.traits.label}` : `Depleted · regrows in ${Math.max(0, Math.ceil(rt.respawnAt - this.session.data.playTime))}s`;
        consider('node', n.def.id, label, d, n);
      }
    }
    return best;
  }

  private updateInteraction(): void {
    const c = this.player.combat;
    if (!c.alive || this.player.gathering > 0) {
      this.hud.setPrompt(null);
      return;
    }
    const it = this.nearestInteractable();
    this.hud.setPrompt(it?.label ?? null);
    if (!it || !this.input.pressed('interact') || c.phase !== 'idle') return;
    if (it.kind === 'npc') {
      if (it.id === 'orla') this.openOrla();
      else this.openMerchant();
    } else if (it.kind === 'anvil') {
      this.openForge();
    } else if (it.kind === 'node' && it.node) {
      const rt = this.session.data.world.nodes[it.id];
      if (rt.charges <= 0) {
        this.hud.toast('This deposit is depleted. It will replenish.', 'info');
        return;
      }
      this.player.gathering = 1.0;
      this.gatherTarget = it.node;
      this.player.yaw = yawTo(this.player.pos2, it.node.pos2);
    }
  }

  private updateGathering(_dt: number): void {
    if (!this.gatherTarget) {
      this.hud.setGather(null);
      return;
    }
    if (this.player.gathering > 0) {
      this.hud.setGather(1 - this.player.gathering / 1.0);
      return;
    }
    const n = this.gatherTarget;
    this.gatherTarget = null;
    this.hud.setGather(null);
    if (this.session.data.world.nodes[n.def.id].charges <= 0) return;
    // The quantity, quality and toast come from the rules (on the server when signed in).
    void this.readyTool(n.def.material)
      .then((ready) => (ready ? this.act({ k: 'gather', node: n.def.id }) : null))
      .then((r) => {
      if (!r?.ok) return;
      const p = n.object.position.clone();
      p.y += 0.8;
      this.effects.sparks(p, n.def.material === 'ironglass' ? '#7fdcff' : '#ffb06a', 10, 2.5);
    });
  }

  /**
   * Gathering needs the right tool in the tool slot. If it's in the bag instead, equip the
   * best one first (an ordinary equip action), so players don't have to swap tools by hand.
   */
  private async readyTool(material: string): Promise<boolean> {
    const kind = toolFor(material);
    if (this.session.toolPower(kind) > 0) return true;
    const best = Object.values(this.session.inventory.items)
      .filter((i) => toolPower(i, kind) > 0)
      .sort((a, b) => toolPower(b, kind) - toolPower(a, kind))[0];
    if (!best) {
      this.hud.toast(kind === 'mining' ? 'You need a pickaxe to mine this.' : 'You need a hatchet to cut this.', 'warn');
      return false;
    }
    return (await this.act({ k: 'equip', item: best.itemId, slot: 'tool' })).ok;
  }

  // ---------------- Presentation helpers ----------------
  private objectivePos(): { x: number; z: number } | null {
    const step = this.session.step();
    if (!step) return null;
    switch (step.marker) {
      case 'orla':
        return NPCS.orla.pos;
      case 'bram':
        return NPCS.bram.pos;
      case 'forge':
        return FORGE_ANVIL;
      case 'trail':
        return this.enemies.find((e) => e.spawn.type === 'scavenger' && e.brain.alive)?.pos2 ?? { x: 8, z: 58 };
      case 'foundry':
        return ENEMY_SPAWNS.find((s) => s.type === 'warden')!.pos;
      case 'quarry': {
        if (step.objective.type !== 'have') return null;
        const totals = this.session.totals();
        const need = Object.entries(step.objective.items).filter(([k, v]) => (totals[k] ?? 0) < v).map(([k]) => k);
        let best: { x: number; z: number } | null = null;
        let bd = Infinity;
        for (const n of this.nodes) {
          if (!need.includes(n.def.material)) continue;
          if (this.session.data.world.nodes[n.def.id].charges <= 0) continue;
          const d = dist2(n.pos2, this.player.pos2);
          if (d < bd) {
            bd = d;
            best = n.pos2;
          }
        }
        return best;
      }
      default:
        return null;
    }
  }

  private drawMinimap(): void {
    const markers: Array<{ x: number; z: number; color: string; r?: number }> = [];
    for (const e of this.enemies) if (e.brain.alive && e.def.kind !== 'dummy' && dist2(e.pos2, this.player.pos2) < 80) markers.push({ x: e.position.x, z: e.position.z, color: e.def.kind === 'elite' ? '#ff5a3a' : '#d24a3a', r: e.def.kind === 'elite' ? 4 : 2.5 });
    for (const n of this.npcs) markers.push({ x: n.pos2.x, z: n.pos2.z, color: '#e6e1d8', r: 3 });
    for (const n of this.nodes) if (this.session.data.world.nodes[n.def.id].charges > 0) markers.push({ x: n.pos2.x, z: n.pos2.z, color: n.def.material === 'ironglass' ? '#4fe3ff' : n.def.material === 'iron_ore' ? '#b0702e' : '#8a5a2a', r: 1.6 });
    markers.push({ x: FORGE_ANVIL.x, z: FORGE_ANVIL.z, color: '#ff8a3d', r: 2 });
    for (const r of this.online.remotes.values()) if (r.state) markers.push({ x: r.position.x, z: r.position.z, color: '#5ad1ff', r: 3 });
    this.hud.drawMinimap({ x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw }, this.cam.yaw, markers, this.objectivePos());
  }

  private updateLabels(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const show = this.modal === null && this.started;
    for (const e of this.enemies) {
      const id = `e:${e.id}`;
      const d = dist2(e.pos2, this.player.pos2);
      const engaged = e.brain.alive && (d < 16 || this.lockTarget === e) && (e.brain.state !== 'idle' && e.brain.state !== 'patrol' || d < 9 || this.lockTarget === e || e.brain.health < e.def.maxHealth);
      if (!show || !engaged) {
        this.hud.hideLabel(id);
        continue;
      }
      const el = this.hud.label(id, () => {
        const fill = h('div', { class: 'fill', style: 'background:linear-gradient(90deg,#8e2a1e,#d24a3a)' });
        const st = h('div', { class: 'state' });
        return h('div', { class: `enemy-bar ${e.def.kind === 'elite' ? 'elite' : ''}` }, h('div', { class: 'nm' }, e.def.name), h('div', { class: 'bar' }, fill), st);
      });
      const sp = this.hud.project(this.camera, e.position, 2.15 * e.def.scale + 0.2, w, hgt);
      el.style.display = sp.visible ? '' : 'none';
      el.style.left = `${sp.x}px`;
      el.style.top = `${sp.y}px`;
      (el.querySelector('.fill') as HTMLElement).style.width = `${(e.brain.health / e.def.maxHealth) * 100}%`;
      const b = e.brain;
      const state =
        e.def.kind === 'dummy'
          ? 'TRAINING (no mastery XP)'
          : b.state === 'stagger'
            ? 'STAGGERED'
            : b.state === 'guard'
              ? 'GUARDING'
              : b.state === 'telegraph' && b.attack
                ? b.attack.name.toUpperCase()
                : b.phase2
                  ? 'OVERHEATED'
                  : '';
      (el.querySelector('.state') as HTMLElement).textContent = state;
    }
    for (const n of this.npcs) {
      const id = `n:${n.id}`;
      const d = dist2(n.pos2, this.player.pos2);
      if (!show || d > 22) {
        this.hud.hideLabel(id);
        continue;
      }
      const npc = NPCS[n.id as 'orla' | 'bram'];
      const el = this.hud.label(id, () => h('div', { class: 'npc-label' }, h('div', { class: 'mk' }), h('div', { class: 'nm' }, npc.name), h('div', { class: 'rl' }, npc.role)));
      const sp = this.hud.project(this.camera, n.object.position, n.labelHeight, w, hgt);
      el.style.display = sp.visible ? '' : 'none';
      el.style.left = `${sp.x}px`;
      el.style.top = `${sp.y}px`;
      const marker = this.session.step()?.marker;
      (el.querySelector('.mk') as HTMLElement).textContent = marker === n.id ? '!' : '';
    }
    for (const r of this.online.remotes.values()) {
      const id = `p:${r.id}`;
      const d = dist2(r.pos2, this.player.pos2);
      if (!show || !r.state || d > 45) {
        this.hud.hideLabel(id);
        continue;
      }
      const el = this.hud.label(id, () => h('div', { class: 'player-label' }, h('div', { class: 'nm' }, r.name), h('div', { class: 'bar' }, h('div', { class: 'fill' }))));
      const sp = this.hud.project(this.camera, r.position, 2.2, w, hgt);
      el.style.display = sp.visible ? '' : 'none';
      el.style.left = `${sp.x}px`;
      el.style.top = `${sp.y}px`;
      (el.querySelector('.fill') as HTMLElement).style.width = `${Math.max(0, (r.state.hp / Math.max(1, r.state.mhp)) * 100)}%`;
      el.classList.toggle('down', !r.alive);
    }
    this.hud.setReticle(show && this.lockTarget ? this.hud.project(this.camera, this.lockTarget.position, 1.2 * this.lockTarget.def.scale, w, hgt) : null);
  }

  // ---------------- Debug / automation hooks ----------------
  private exposeDebug(): void {
    const api = {
      state: () => {
        const c = this.player.combat;
        return {
          modal: this.modal,
          started: this.started,
          pos: { x: +this.player.position.x.toFixed(2), y: +this.player.position.y.toFixed(2), z: +this.player.position.z.toFixed(2) },
          yaw: this.player.yaw,
          phase: c.phase,
          attack: c.attack?.id ?? null,
          health: c.health,
          maxHealth: c.maxHealth,
          maxStamina: c.stamina.max,
          attributes: JSON.parse(JSON.stringify(this.session.attributes)) as Record<string, { level: number; xp: number }>,
          stamina: +c.stamina.current.toFixed(3),
          quest: { step: this.session.step()?.id ?? 'complete', index: this.session.data.quest.stepIndex },
          totals: this.session.totals(),
          coins: this.session.inventory.coins,
          equipped: this.weapon() ? { id: this.weapon()!.itemId, name: this.weapon()!.displayName, damage: this.weapon()!.result.damage, source: this.weapon()!.source, imbuements: this.weapon()!.result.imbuements } : null,
          items: this.session.inventory.itemOrder.length,
          mastery: { smith: this.session.smithMastery, longsword: this.session.weaponLevel },
          zone: this.zone.id,
          lock: this.lockTarget?.id ?? null,
          world: { status: this.online.status, id: this.online.myId, name: this.mode === 'account' ? (this.accounts?.username ?? '') : this.playerName, mode: this.mode, others: [...this.online.remotes.values()].map((r) => ({ id: r.id, name: r.name, x: +r.position.x.toFixed(1), z: +r.position.z.toFixed(1), hp: r.state?.hp ?? null })) },
          enemies: this.enemies.map((e) => ({ id: e.id, type: e.spawn.type, state: e.brain.state, hp: +e.brain.health.toFixed(1), x: +e.position.x.toFixed(1), z: +e.position.z.toFixed(1) })),
        };
      },
      perf: () => {
        const s = this.perf.snapshot();
        const f = this.perfFrames.slice(-300);
        const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
        const sorted = [...f].sort((a, b) => b - a);
        const worst = sorted.slice(0, Math.max(1, Math.floor(f.length * 0.01)));
        const worstAvg = worst.reduce((a, b) => a + b, 0) / Math.max(1, worst.length);
        return { ...s, wallFps: 1000 / avg, wallLow1: 1000 / worstAvg, wallSamples: f.length };
      },
      key: (code: string, down: boolean) => this.input.simulate(code, down),
      save: () => (this.save('debug'), this.lastSave),
      settings: (s: Partial<Settings>) => {
        this.settings = { ...this.settings, ...s };
        this.applySettings();
      },
    };
    const dev = {
      teleport: (x: number, z: number) => {
        this.player.spawn(x, z, this.player.yaw);
        return terrainHeight(x, z);
      },
      // Grants only work on guest characters: an account character belongs to the server.
      give: (material: 'iron_ore' | 'ironwood' | 'ironglass' | 'binding_flux', qty: number, quality = 0.6) => this.mode !== 'account' && this.session.gather('debug', material, qty, quality, {}),
      coins: (n: number) => (this.mode !== 'account' ? (this.session.addCoins(n), true) : false),
      act: (a: CharAction) => this.act(a),
      heal: () => this.player.combat.revive(),
      face: (yaw: number) => {
        this.player.yaw = yaw;
        this.cam.snapBehind(yaw);
      },
      session: () => this.session,
      game: this,
    };
    (window as unknown as { __alloy: unknown }).__alloy = this.debug ? { ...api, ...dev } : api;
  }
}
