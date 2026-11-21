/** Minimal test client with optional simulated latency (GDD 6.10 adverse-condition testing). */
import WebSocket from 'ws';
import type { ServerMessage, WorldSnapshot } from '@alloy/protocol';
import { PROTOCOL_VERSION } from '@alloy/protocol';
import type { InventoryState } from '@alloy/crafting';

export class ProofClient {
  ws!: WebSocket;
  playerId = '';
  token = '';
  inventory: InventoryState | null = null;
  lastSnapshot: WorldSnapshot | null = null;
  seq = 0;
  private acks = new Map<number, (m: ServerMessage) => void>();
  corrections: Array<{ x: number; z: number }> = [];

  constructor(
    private url: string,
    private latencyMs: [number, number] = [0, 0],
  ) {}

  private delay(): number {
    const [a, b] = this.latencyMs;
    return a + Math.random() * (b - a);
  }

  connect(name: string, token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('error', reject);
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        setTimeout(() => {
          if (m.t === 'welcome') {
            this.playerId = m.playerId;
            this.token = m.token;
            this.inventory = m.inventory;
            this.seq = 0;
            resolve();
          } else if (m.t === 'snapshot') this.lastSnapshot = m;
          else if (m.t === 'correction') this.corrections.push({ x: m.x, z: m.z });
          else if (m.t === 'ack') {
            if (m.inventory) this.inventory = m.inventory;
            this.acks.get(m.seq)?.(m);
            this.acks.delete(m.seq);
          }
        }, this.delay());
      });
      this.ws.on('open', () => this.raw({ t: 'join', name, token, protocol: PROTOCOL_VERSION }));
    });
  }

  raw(msg: unknown): void {
    const s = JSON.stringify(msg);
    setTimeout(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(s), this.delay());
  }

  /** Send a sequenced command and await its ack (if the command produces one). */
  request(msg: Record<string, unknown>, seqOverride?: number): Promise<ServerMessage & { t: 'ack' }> {
    const seq = seqOverride ?? ++this.seq;
    return new Promise((resolve) => {
      this.acks.set(seq, resolve as (m: ServerMessage) => void);
      this.raw({ ...msg, seq });
    });
  }

  move(x: number, z: number): void {
    this.raw({ t: 'move', seq: ++this.seq, x, z, yaw: 0 });
  }

  close(): Promise<void> {
    return new Promise((r) => {
      this.ws.once('close', () => r());
      this.ws.close();
    });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
