/** Browser connection to the shared world. Plain JSON over WebSocket; no secrets. */
import { WORLD_PROTOCOL, type AvatarState, type WorldClientMsg, type WorldServerMsg } from '@alloy/protocol';

export type WorldStatus = 'connecting' | 'online' | 'offline';

/** Turn an http(s)/ws(s) address into the world socket URL. */
export function worldSocketUrl(base: string): string | null {
  try {
    const u = new URL(base);
    if (u.protocol === 'http:') u.protocol = 'ws:';
    else if (u.protocol === 'https:') u.protocol = 'wss:';
    else if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    if (u.pathname === '/' || u.pathname === '') u.pathname = '/world';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

async function probe(httpBase: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(new URL('/world-info', httpBase), { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = (await r.json()) as { game?: string };
    return j.game === 'alloy-frontier';
  } catch {
    return false;
  }
}

/**
 * Where is the world? In order: ?world=<address> (testing), the address baked into this
 * build (VITE_WORLD_URL), the server that served this page, and the local dev server.
 * Returns null when no world is reachable (the game then runs offline).
 */
export async function findWorld(): Promise<string | null> {
  const param = new URLSearchParams(location.search).get('world');
  if (param === 'off') return null;
  const candidates: string[] = [];
  if (param) candidates.push(param);
  const baked = (import.meta.env.VITE_WORLD_URL as string | undefined) ?? '';
  if (baked) candidates.push(baked);
  if (location.protocol.startsWith('http')) candidates.push(location.origin);
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') candidates.push('http://localhost:2568');
  for (const c of candidates) {
    const http = c.replace(/^ws/, 'http');
    if (await probe(http)) return worldSocketUrl(http);
  }
  return null;
}

export interface WorldHandlers {
  message: (m: WorldServerMsg) => void;
  status: (s: WorldStatus, reason?: string) => void;
}

export class WorldClient {
  private ws: WebSocket | null = null;
  status: WorldStatus = 'offline';
  myId: string | null = null;
  names = new Map<string, string>();
  private lastStateSent = 0;
  private retry = 0;
  private stopped = false;

  constructor(
    readonly url: string,
    readonly name: string,
    private handlers: WorldHandlers,
    private token: string | null = null,
    /** Which of the account's characters to play (sent with a signed-in hello). */
    private slot: 1 | 2 = 1,
  ) {
    this.open();
  }

  private open(): void {
    this.status = 'connecting';
    this.handlers.status('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => this.send({ t: 'hello', name: this.name, protocol: WORLD_PROTOCOL, ...(this.token ? { token: this.token, ...(this.slot === 2 ? { slot: 2 as const } : {}) } : {}) });
    ws.onmessage = (ev) => {
      let m: WorldServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as WorldServerMsg;
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.myId = m.id;
        this.retry = 0;
        for (const p of m.players) this.names.set(p.id, p.name);
        this.status = 'online';
        this.handlers.status('online');
      } else if (m.t === 'joined') this.names.set(m.player.id, m.player.name);
      this.handlers.message(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasOnline = this.status === 'online';
      this.status = 'offline';
      this.myId = null;
      this.handlers.status('offline', wasOnline ? 'Lost connection to the world. Reconnecting…' : 'Could not reach the world server.');
      if (this.stopped) return;
      // Reconnect with backoff (covers a free host waking up, Wi-Fi blips, server restarts).
      const delay = Math.min(30_000, 1500 * 2 ** this.retry++);
      setTimeout(() => !this.stopped && this.open(), delay);
    };
  }

  send(m: WorldClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Throttled avatar update (~15 Hz). */
  sendState(s: AvatarState, now: number): void {
    if (now - this.lastStateSent < 66) return;
    this.lastStateSent = now;
    this.send({ t: 'state', s });
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }
}
