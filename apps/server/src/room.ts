/**
 * Phase C authoritative room (GDD 6.10, AF-007). Transport-agnostic: the server
 * wires it to WebSockets; tests can drive it directly. Clients send intents; the
 * room validates and owns all durable state (positions, enemy HP, inventories).
 */
import { addMaterial, createInventory, equipWeapon, executeForge, validateInventory, type InventoryState } from '@alloy/crafting';
import { ATTACKS, ENEMIES, mitigate, type AttackId } from '@alloy/game-rules';
import { hashHex } from '@alloy/item-gen';
import { PROTOCOL_VERSION, parseClientCommand, type ServerMessage, type WorldSnapshot } from '@alloy/protocol';

export const MAX_SPEED = 8.5; // m/s (sprint 7.6 + tolerance)
export const MOVE_TOLERANCE = 0.75; // m allowed for jitter/latency
export const ATTACK_MIN_INTERVAL = 0.25; // s

interface PlayerRecord {
  id: string;
  name: string;
  token: string;
  x: number;
  z: number;
  yaw: number;
  lastMoveAt: number;
  lastAttackAt: number;
  lastSeq: number;
  connected: boolean;
  inventory: InventoryState;
  send: ((m: ServerMessage) => void) | null;
}

export interface RoomStats {
  rejectedMoves: number;
  rejectedAttacks: number;
  rejectedForges: number;
  rejectedEquips: number;
  rejectedInjections: number;
  staleCommands: number;
  malformed: number;
}

export class Room {
  private players = new Map<string, PlayerRecord>();
  private byToken = new Map<string, string>();
  enemy = { id: 'sentinel-proof', x: 0, z: 5, health: ENEMIES.sentinel.maxHealth, maxHealth: ENEMIES.sentinel.maxHealth };
  tick = 0;
  stats: RoomStats = { rejectedMoves: 0, rejectedAttacks: 0, rejectedForges: 0, rejectedEquips: 0, rejectedInjections: 0, staleCommands: 0, malformed: 0 };
  private nextId = 1;

  constructor(private now: () => number = () => Date.now() / 1000) {}

  /** Handle a raw message from a connection. Returns the player id bound to the connection. */
  handle(connPlayerId: string | null, raw: unknown, send: (m: ServerMessage) => void): string | null {
    const cmd = parseClientCommand(raw);
    if (!cmd) {
      this.stats.malformed++;
      send({ t: 'error', error: 'malformed' });
      return connPlayerId;
    }
    if (cmd.t === 'join') return this.join(cmd.name, cmd.token, send);
    const p = connPlayerId ? this.players.get(connPlayerId) : undefined;
    if (!p) {
      send({ t: 'error', error: 'not_joined' });
      return connPlayerId;
    }
    if (cmd.seq <= p.lastSeq) {
      this.stats.staleCommands++;
      send({ t: 'ack', seq: cmd.seq, ok: false, error: 'stale_or_replayed_seq' });
      return p.id;
    }
    p.lastSeq = cmd.seq;
    switch (cmd.t) {
      case 'move':
        this.move(p, cmd.seq, cmd.x, cmd.z, cmd.yaw);
        break;
      case 'attack':
        this.attack(p, cmd.seq, cmd.targetId, cmd.attackId);
        break;
      case 'forge': {
        const r = executeForge(p.inventory, { ...cmd.request, maker: { id: p.id, name: p.name, mastery: 10 }, createdAt: Math.floor(this.now() * 1000) });
        if (!r.ok) {
          this.stats.rejectedForges++;
          send({ t: 'ack', seq: cmd.seq, ok: false, error: r.error });
        } else {
          p.inventory = r.inventory;
          send({ t: 'ack', seq: cmd.seq, ok: true, item: r.item, inventory: p.inventory });
        }
        break;
      }
      case 'equip': {
        const r = equipWeapon(p.inventory, cmd.itemId, Math.floor(this.now() * 1000));
        if (!r.ok) {
          this.stats.rejectedEquips++;
          send({ t: 'ack', seq: cmd.seq, ok: false, error: r.error });
        } else {
          p.inventory = r.inventory;
          send({ t: 'ack', seq: cmd.seq, ok: true });
        }
        break;
      }
      case 'inject_item':
        // Clients can never create items; only the forge transaction can.
        this.stats.rejectedInjections++;
        send({ t: 'ack', seq: cmd.seq, ok: false, error: 'client_items_not_accepted' });
        break;
    }
    return p.id;
  }

  private join(name: string, token: string | undefined, send: (m: ServerMessage) => void): string {
    if (token && this.byToken.has(token)) {
      const p = this.players.get(this.byToken.get(token)!)!;
      p.connected = true;
      p.send = send;
      send({ t: 'welcome', playerId: p.id, token: p.token, inventory: p.inventory, protocol: PROTOCOL_VERSION });
      return p.id;
    }
    const id = `p${this.nextId++}`;
    let inv = createInventory(id, 50);
    for (const [m, q] of [
      ['iron_ore', 9],
      ['ironwood', 3],
      ['binding_flux', 20],
    ] as const) {
      const r = addMaterial(inv, { materialId: m, quantity: q, quality: 0.6, origin: 'server-grant' });
      if (r.ok) inv = r.inventory;
    }
    const p: PlayerRecord = {
      id,
      name,
      token: hashHex(`${id}:${Math.random()}:${this.now()}`),
      x: this.nextId * 2,
      z: 0,
      yaw: 0,
      lastMoveAt: this.now(),
      lastAttackAt: 0,
      lastSeq: 0,
      connected: true,
      inventory: inv,
      send,
    };
    this.players.set(id, p);
    this.byToken.set(p.token, id);
    send({ t: 'welcome', playerId: id, token: p.token, inventory: inv, protocol: PROTOCOL_VERSION });
    return id;
  }

  disconnect(playerId: string | null): void {
    const p = playerId ? this.players.get(playerId) : undefined;
    if (!p) return;
    p.connected = false;
    p.send = null;
    // Reconnect restores the same record; seq resets because a new connection starts at 1.
    p.lastSeq = 0;
  }

  private move(p: PlayerRecord, seq: number, x: number, z: number, yaw: number): void {
    const t = this.now();
    const dt = Math.max(0.001, t - p.lastMoveAt);
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > MAX_SPEED * dt + MOVE_TOLERANCE) {
      this.stats.rejectedMoves++;
      p.send?.({ t: 'correction', seq, x: p.x, z: p.z });
      p.lastMoveAt = t;
      return;
    }
    p.x = x;
    p.z = z;
    p.yaw = yaw;
    p.lastMoveAt = t;
  }

  private attack(p: PlayerRecord, seq: number, targetId: string, attackId: string): void {
    const t = this.now();
    const def = (ATTACKS as Record<string, (typeof ATTACKS)[AttackId] | undefined>)[attackId];
    const weaponId = p.inventory.equipped.weapon;
    const weapon = weaponId ? p.inventory.items[weaponId] : null;
    const reach = (def?.range ?? 0) + 0.75 + 0.5;
    const ok =
      def && targetId === this.enemy.id && this.enemy.health > 0 && weapon && t - p.lastAttackAt >= ATTACK_MIN_INTERVAL && Math.hypot(this.enemy.x - p.x, this.enemy.z - p.z) <= reach;
    if (!ok) {
      this.stats.rejectedAttacks++;
      p.send?.({ t: 'ack', seq, ok: false, error: 'invalid_attack' });
      return;
    }
    p.lastAttackAt = t;
    const dmg = mitigate(weapon!.result.damage * def!.damageMult, ENEMIES.sentinel.defense);
    this.enemy.health = Math.max(0, this.enemy.health - dmg);
    p.send?.({ t: 'ack', seq, ok: true });
  }

  snapshot(): WorldSnapshot {
    this.tick++;
    return {
      t: 'snapshot',
      tick: this.tick,
      players: [...this.players.values()].map((p) => {
        const eq = p.inventory.equipped.weapon ? p.inventory.items[p.inventory.equipped.weapon] : null;
        return { id: p.id, name: p.name, x: p.x, z: p.z, yaw: p.yaw, connected: p.connected, equippedItemId: eq?.itemId ?? null, equippedRating: eq?.result.rating ?? null };
      }),
      enemies: [{ id: this.enemy.id, health: this.enemy.health, maxHealth: this.enemy.maxHealth, alive: this.enemy.health > 0 }],
    };
  }

  broadcast(): void {
    const s = this.snapshot();
    for (const p of this.players.values()) p.send?.(s);
  }

  /** Integrity audit of all authoritative inventories (used by tests). */
  audit(): boolean {
    return [...this.players.values()].every((p) => validateInventory(p.inventory).ok);
  }
}
