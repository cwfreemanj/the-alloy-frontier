/**
 * Account HTTP API (JSON). Bearer tokens in the Authorization header, never cookies,
 * so other websites can't act on a player's behalf.
 *
 *   POST /api/register {username, password}        -> {token, username}
 *   POST /api/login    {username, password}        -> {token, username}
 *   POST /api/logout                               -> {ok}
 *   GET  /api/me                                   -> {username}
 *   GET  /api/save                                 -> {save: string|null, revision}
 *   PUT  /api/save     {save, revision}            -> {revision}
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_SAVE_BYTES, savedAtOf } from '@alloy/save';
import type { AccountService } from './service';

const MAX_BODY = MAX_SAVE_BYTES + 4096;

export interface ApiOptions {
  /** Origins (besides this server) allowed to call the API from a browser. */
  allowedOrigins: Set<string>;
  /** Trust X-Forwarded-For (only behind a known proxy such as Render's). */
  trustProxy: boolean;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const f = req.headers['x-forwarded-for'];
    const first = (Array.isArray(f) ? f[0] : f)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/** Returns true when the request was an API request (handled), false otherwise. */
export async function handleApi(svc: AccountService, opts: ApiOptions, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith('/api/')) return false;

  const origin = req.headers.origin;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) {
    let sameHost = false;
    try {
      const o = new URL(origin);
      sameHost = o.host === req.headers.host || o.hostname === 'localhost' || o.hostname === '127.0.0.1';
    } catch {
      /* bad origin */
    }
    if (!sameHost && !opts.allowedOrigins.has(origin)) {
      res.writeHead(403, headers).end(JSON.stringify({ error: 'origin_not_allowed' }));
      return true;
    }
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  if (req.method === 'OPTIONS') {
    res
      .writeHead(204, { ...headers, 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' })
      .end();
    return true;
  }
  const send = (status: number, body: unknown) => res.writeHead(status, headers).end(JSON.stringify(body));
  const fail = (r: { status: number; error: string; message: string }) => send(r.status, { error: r.error, message: r.message });
  const ip = clientIp(req, opts.trustProxy);

  try {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'POST /api/register' || route === 'POST /api/login') {
      const body = await readJson(req);
      if (!body) return send(400, { error: 'bad_request', message: 'Invalid request.' }), true;
      const r = route.endsWith('register') ? await svc.register(body.username, body.password, ip) : await svc.login(body.username, body.password, ip);
      if (r.ok) send(200, r.value);
      else fail(r);
      return true;
    }
    const token = bearer(req);
    const acct = await svc.accountFor(token);
    if (route === 'POST /api/logout') {
      if (token) await svc.logout(token);
      send(200, { ok: true });
      return true;
    }
    if (!acct) {
      send(401, { error: 'signed_out', message: 'Please sign in again.' });
      return true;
    }
    if (route === 'GET /api/me') {
      send(200, { username: acct.username });
    } else if (route === 'GET /api/save') {
      const s = await svc.getSave(acct.id);
      send(200, { save: s?.raw ?? null, revision: s?.revision ?? 0 });
    } else if (route === 'PUT /api/save') {
      const body = await readJson(req);
      if (!body) return send(413, { error: 'too_large', message: 'Save is too large or invalid.' }), true;
      const raw = body.save;
      const r = await svc.putSave(acct.id, raw, body.revision, typeof raw === 'string' ? savedAtOf(raw) : 0);
      if (r.ok) send(200, r.value);
      else fail(r);
    } else {
      send(404, { error: 'not_found' });
    }
  } catch (e) {
    console.error('API error', e);
    send(500, { error: 'server_error', message: 'Something went wrong on the server.' });
  }
  return true;
}
