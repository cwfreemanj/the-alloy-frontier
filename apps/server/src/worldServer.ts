/**
 * Game server: serves the built game over HTTP and the shared world over a WebSocket at
 * /world on the same port. Players who open the page join the world automatically.
 * No secrets, no paid services; runs the same on a PC or a free cloud host.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { WORLD_LIMITS, WORLD_PROTOCOL, parseWorldClientMsg } from '@alloy/protocol';
import { WorldRoom } from './worldRoom';
import { handleApi } from './accounts/http';
import type { AccountService } from './accounts/service';
import { CharacterHost, accountCharacterStore, type CharacterStore } from './characters';

export interface WorldServerOptions {
  port?: number;
  host?: string;
  /** Directory with the built game; omit to serve only the world socket. */
  staticDir?: string | null;
  simHz?: number;
  netHz?: number;
  /** Browser origins allowed to open the world socket (besides this server itself). */
  allowedOrigins?: string[];
  /** Accounts and server-side saves (omit to run guest-only). */
  accounts?: AccountService | null;
  /** Trust X-Forwarded-For (set when running behind a known proxy, e.g. Render). */
  trustProxy?: boolean;
  /** Where signed-in characters live (defaults to the account saves). For tests. */
  characters?: CharacterStore;
}

export interface RunningWorldServer {
  port: number;
  room: WorldRoom;
  /** Live characters of signed-in players (null without accounts). */
  characters: CharacterHost | null;
  /** Stop, after writing every changed character. */
  close: () => Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
};

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = normalize(join(root, rel));
  // Never serve anything outside the build directory, and never source maps.
  if ((!file.startsWith(root + sep) && file !== root) || file.endsWith('.map')) {
    res.writeHead(404).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  // Hashed build output (/assets/) and content-versioned files (?v=<hash>, e.g. character models)
  // never change under the same URL; everything else is revalidated.
  const immutable = file.includes(`${sep}assets${sep}`) || url.searchParams.has('v');
  const cache = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  createReadStream(file).pipe(res);
}

export function startWorldServer(opts: WorldServerOptions = {}): Promise<RunningWorldServer> {
  const accounts = opts.accounts ?? null;
  const store = opts.characters ?? (accounts ? accountCharacterStore(accounts) : null);
  const characters = store ? new CharacterHost(store) : null;
  const room = new WorldRoom(undefined, characters);
  const root = opts.staticDir ? resolve(opts.staticDir) : null;
  const allowed = new Set(opts.allowedOrigins ?? []);
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/world-info' || path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, game: 'alloy-frontier', players: room.activeCount, accounts: accounts ? accounts.kv.kind : 'off' }));
      return;
    }
    if (path.startsWith('/api/')) {
      if (!accounts) {
        res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'accounts_off', message: 'Accounts are not enabled on this server.' }));
        return;
      }
      void handleApi(accounts, { allowedOrigins: allowed, trustProxy: !!opts.trustProxy }, req, res);
      return;
    }
    if (root) serveStatic(root, req, res);
    else res.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server: http,
    path: '/world',
    maxPayload: WORLD_LIMITS.maxMessageBytes,
    // Only pages served by this server, localhost, or configured origins may connect.
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => {
      if (!origin) return true; // non-browser clients (tests, tools)
      try {
        const o = new URL(origin);
        if (o.host === req.headers.host) return true;
        if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') return true;
        return allowed.has(o.origin);
      } catch {
        return false;
      }
    },
  });
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws: WebSocket) => {
    let id: string | null = null;
    alive.set(ws, true);
    const send = (m: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    ws.on('pong', () => alive.set(ws, true));
    // A signed-in hello needs an async account lookup; hold later messages until it's done.
    let joining: Promise<void> | null = null;
    const close = () => ws.close(4001, 'signed in elsewhere');
    ws.on('message', (data) => {
      const raw = data.toString();
      if (joining) {
        void joining.then(() => {
          id = room.handle(id, raw, send);
        });
        return;
      }
      const hello = id === null && raw.length < 1000 ? parseWorldClientMsg(raw) : null;
      if (hello?.t === 'hello' && hello.token && accounts) {
        if (hello.protocol !== WORLD_PROTOCOL) {
          send({ t: 'error', error: 'outdated_client' });
          return;
        }
        joining = accounts
          .accountFor(hello.token)
          .then(async (acct) => {
            if (!acct) {
              send({ t: 'error', error: 'signed_out' });
              return;
            }
            // The server loads and owns the character while the player is in the world.
            const char = characters ? await characters.open(acct.id) : null;
            if (ws.readyState !== ws.OPEN) {
              if (char) characters?.release(char);
              return;
            }
            id = room.join(acct.username, send, acct.id, close, char);
          })
          .catch((e: unknown) => {
            console.error(`Could not join a signed-in player: ${(e as Error).message}`);
            send({ t: 'error', error: 'server_error' });
          })
          .finally(() => {
            joining = null;
          });
        return;
      }
      id = room.handle(id, raw, send);
    });
    ws.on('close', () => room.leave(id));
    ws.on('error', () => ws.terminate());
  });
  // Drop silent connections (closed laptop lids, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) ws.terminate();
      else {
        alive.set(ws, false);
        ws.ping();
      }
    }
  }, 10_000);
  const simDt = 1 / (opts.simHz ?? 20);
  const sim = setInterval(() => room.step(simDt), simDt * 1000);
  const net = setInterval(() => room.publish(), 1000 / (opts.netHz ?? 15));
  const saves = setInterval(() => characters?.flushDue(), 1000);
  return new Promise((resolveStart) => {
    http.listen(opts.port ?? 2568, opts.host ?? '127.0.0.1', () => {
      const addr = http.address();
      resolveStart({
        port: typeof addr === 'object' && addr ? addr.port : (opts.port ?? 2568),
        room,
        characters,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(sim);
            clearInterval(net);
            clearInterval(heartbeat);
            clearInterval(saves);
            for (const c of wss.clients) c.terminate();
            wss.close(() => http.close(() => void (characters?.flushAll() ?? Promise.resolve()).then(() => r())));
          }),
      });
    });
  });
}
