/**
 * Shared-world glue between the network client and the Game. While online, the server
 * runs every enemy; this mirrors them, shows other players, sends our hits, and applies
 * the server's verdicts (hit results, enemy attacks on us, kill credit).
 */
import type * as THREE from 'three';
import type { AvatarState, HitVerdict, WorldServerMsg } from '@alloy/protocol';
import { RemotePlayer } from '../entities/RemotePlayer';
import type { Enemy } from '../entities/Enemy';
import { WorldClient, type WorldStatus } from '../net/WorldClient';

export interface OnlineGameHooks {
  scene: THREE.Scene;
  enemies: Enemy[];
  localAvatar(): AvatarState;
  showHitResult(e: Enemy, r: HitVerdict): void;
  hitLocalPlayer(e: Enemy, damage: number, heavy: boolean): void;
  creditKill(e: Enemy): void;
  remoteSlash(r: RemotePlayer, atk: string): void;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
  statusChanged(): void;
  /** The world became authoritative (or stopped being): reset local enemy state. */
  authorityChanged(online: boolean): void;
}

export class Online {
  client: WorldClient | null = null;
  readonly remotes = new Map<string, RemotePlayer>();
  status: WorldStatus = 'offline';
  message = 'Offline';
  private colorIndex = 0;
  private announced = false;

  constructor(private g: OnlineGameHooks) {}

  get online(): boolean {
    return this.status === 'online';
  }
  get myId(): string | null {
    return this.client?.myId ?? null;
  }

  connect(url: string, name: string): void {
    this.client?.stop();
    this.client = new WorldClient(url, name, {
      message: (m) => this.onMessage(m),
      status: (s, reason) => this.onStatus(s, reason),
    });
  }

  private onStatus(s: WorldStatus, reason?: string): void {
    const was = this.status;
    this.status = s;
    if (s === 'online') {
      this.message = 'Online';
      if (!this.announced) this.g.toast('Connected to the world. Other players online can see you.', 'good');
      else this.g.toast('Reconnected to the world.', 'good');
      this.announced = true;
    } else if (s === 'connecting') {
      this.message = was === 'online' ? 'Reconnecting…' : 'Connecting…';
    } else {
      this.message = reason ?? 'Offline';
      this.clearRemotes();
      if (was === 'online') this.g.toast(reason ?? 'Disconnected.', 'warn');
    }
    if ((was === 'online') !== (s === 'online')) this.g.authorityChanged(s === 'online');
    this.g.statusChanged();
  }

  private clearRemotes(): void {
    for (const r of this.remotes.values()) r.dispose(this.g.scene);
    this.remotes.clear();
  }

  private addRemote(id: string, name: string): RemotePlayer {
    let r = this.remotes.get(id);
    if (r) return r;
    r = new RemotePlayer(id, name, this.colorIndex++);
    r.onActive = (atk) => this.g.remoteSlash(r!, atk);
    this.remotes.set(id, r);
    this.g.scene.add(r.object);
    return r;
  }

  private enemy(id: string): Enemy | undefined {
    return this.g.enemies.find((e) => e.id === id && e.def.kind !== 'dummy');
  }

  private onMessage(m: WorldServerMsg): void {
    const me = this.myId;
    const now = performance.now();
    switch (m.t) {
      case 'welcome':
        this.clearRemotes();
        for (const p of m.players) if (p.id !== m.id) this.addRemote(p.id, p.name);
        for (const s of m.enemies) this.enemy(s.id)?.applyNet(s);
        {
          const others = m.players.filter((p) => p.id !== m.id).length;
          if (others) this.g.toast(`${others} other player${others > 1 ? 's' : ''} in the world.`, 'info');
        }
        this.g.statusChanged();
        break;
      case 'joined':
        this.addRemote(m.player.id, m.player.name).name = m.player.name;
        this.g.toast(`${m.player.name} entered the world.`, 'good');
        this.g.statusChanged();
        break;
      case 'left': {
        if (!this.remotes.has(m.id)) break;
        this.remotes.get(m.id)?.dispose(this.g.scene);
        this.remotes.delete(m.id);
        this.g.toast(`${m.name} left the world.`, 'info');
        this.g.statusChanged();
        break;
      }
      case 'players':
        for (const p of m.list) {
          if (p.id === me) continue;
          const r = this.remotes.get(p.id) ?? this.addRemote(p.id, this.client?.names.get(p.id) ?? 'Smith');
          r.push(p.s, now);
        }
        break;
      case 'enemies':
        for (const s of m.list) this.enemy(s.id)?.applyNet(s);
        break;
      case 'hitResult': {
        const e = this.enemy(m.enemyId);
        if (e) this.g.showHitResult(e, m);
        break;
      }
      case 'playerHit': {
        const e = this.enemy(m.enemyId);
        if (e) this.g.hitLocalPlayer(e, m.damage, m.heavy);
        break;
      }
      case 'kill': {
        const e = this.enemy(m.enemyId);
        if (e && me && m.contributors.includes(me)) this.g.creditKill(e);
        break;
      }
      case 'error':
        if (m.error === 'world_full') this.g.toast('The world is full right now; playing offline.', 'warn');
        break;
    }
  }

  sendHit(e: Enemy, attackId: string, damage: number, stagger: number, guardBreak: boolean, crit: boolean): void {
    this.client?.send({ t: 'hit', enemyId: e.id, attackId, damage: Math.min(200, damage), stagger, guardBreak, crit });
  }

  /** Per-frame: publish our avatar and animate other players. */
  update(dt: number): void {
    if (!this.online) return;
    const now = performance.now();
    this.client!.sendState(this.g.localAvatar(), now);
    for (const r of this.remotes.values()) r.update(dt, now);
  }
}
