/**
 * Player accounts and server-side character saves.
 *
 * - Usernames: 3-20 letters, digits, _ or -, unique ignoring case; shown to other players.
 * - Passwords: 8-128 characters, stored only as scrypt(salt, password).
 * - Sessions: random 256-bit bearer tokens; only their SHA-256 is stored; 30-day expiry.
 * - Saves: validated with the game's own save validation before storing; a revision
 *   number rejects stale writes from an older device.
 * - Abuse limits: attempts per IP per window, and a short lock after repeated failures.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { MAX_SAVE_BYTES, deserialize } from '@alloy/save';
import type { KV } from './kv';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'system', 'server', 'guest', 'orla', 'bram']);

export interface Account {
  id: string;
  username: string;
  salt: string;
  hash: string;
  createdAt: number;
  failedLogins: number;
  lockedUntil: number;
}
interface SessionRec {
  accountId: string;
  createdAt: number;
  expiresAt: number;
}
export interface SaveRec {
  raw: string;
  revision: number;
  savedAt: number;
  updatedAt: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; message: string };
const err = (status: number, error: string, message: string): Result<never> => ({ ok: false, status, error, message });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function validateUsername(u: unknown): string | null {
  if (typeof u !== 'string' || !USERNAME_RE.test(u)) return 'Username must be 3–20 letters, numbers, _ or -.';
  if (RESERVED.has(u.toLowerCase())) return 'That username is reserved.';
  return null;
}
export function validatePassword(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password must be at most 128 characters.';
  return null;
}

/** Fixed-window attempt counter per key (e.g. client IP). */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}
  allow(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start > this.windowMs) {
      this.hits.set(key, { start: t, n: 1 });
      if (this.hits.size > 10_000) this.prune(t);
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
  private prune(t: number): void {
    for (const [k, h] of this.hits) if (t - h.start > this.windowMs) this.hits.delete(k);
  }
}

export class AccountService {
  private authLimiter: RateLimiter;
  /** Serialise writes per account so revision checks are race-free. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    readonly kv: KV,
    private now: () => number = Date.now,
  ) {
    this.authLimiter = new RateLimiter(20, 10 * 60_000, now);
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  private async newSession(accountId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    await this.kv.put<SessionRec>(`sess:${sha256(token)}`, { accountId, createdAt: t, expiresAt: t + SESSION_DAYS * 86_400_000 });
    return token;
  }

  async register(username: unknown, password: unknown, ip: string): Promise<Result<{ token: string; username: string }>> {
    if (!this.authLimiter.allow(ip)) return err(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const ue = validateUsername(username);
    if (ue) return err(400, 'bad_username', ue);
    const pe = validatePassword(password);
    if (pe) return err(400, 'bad_password', pe);
    const u = username as string;
    const id = `a_${randomBytes(9).toString('base64url')}`;
    const claimed = await this.kv.putIfAbsent(`name:${u.toLowerCase()}`, { id });
    if (!claimed) return err(409, 'username_taken', 'That username is taken.');
    const salt = randomBytes(16);
    const hash = await scrypt(password as string, salt, 32, SCRYPT);
    await this.kv.put<Account>(`acct:${id}`, { id, username: u, salt: salt.toString('base64'), hash: hash.toString('base64'), createdAt: this.now(), failedLogins: 0, lockedUntil: 0 });
    return { ok: true, value: { token: await this.newSession(id), username: u } };
  }

  async login(username: unknown, password: unknown, ip: string): Promise<Result<{ token: string; username: string }>> {
    if (!this.authLimiter.allow(ip)) return err(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const generic = err(401, 'bad_credentials', 'Wrong username or password.');
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128 || username.length > 20) return generic;
    const ref = await this.kv.get<{ id: string }>(`name:${username.toLowerCase()}`);
    // Always spend the hashing time so response timing doesn't reveal which usernames exist.
    const acct = ref ? await this.kv.get<Account>(`acct:${ref.id}`) : null;
    const salt = acct ? Buffer.from(acct.salt, 'base64') : randomBytes(16);
    const hash = await scrypt(password, salt, 32, SCRYPT);
    if (!acct) return generic;
    return this.withLock(acct.id, async () => {
      const a = (await this.kv.get<Account>(`acct:${acct.id}`))!;
      if (a.lockedUntil > this.now()) return err(429, 'locked', 'Too many wrong passwords. Try again in a minute.');
      if (!timingSafeEqual(hash, Buffer.from(a.hash, 'base64'))) {
        a.failedLogins++;
        if (a.failedLogins >= 5) {
          a.failedLogins = 0;
          a.lockedUntil = this.now() + 60_000;
        }
        await this.kv.put(`acct:${a.id}`, a);
        return generic;
      }
      if (a.failedLogins) {
        a.failedLogins = 0;
        await this.kv.put(`acct:${a.id}`, a);
      }
      return { ok: true as const, value: { token: await this.newSession(a.id), username: a.username } };
    });
  }

  async logout(token: string): Promise<void> {
    await this.kv.delete(`sess:${sha256(token)}`);
  }

  /** The account behind a bearer token, or null if missing/expired. */
  async accountFor(token: string | null | undefined): Promise<Account | null> {
    if (!token || token.length > 100) return null;
    const s = await this.kv.get<SessionRec>(`sess:${sha256(token)}`);
    if (!s) return null;
    if (s.expiresAt < this.now()) {
      await this.kv.delete(`sess:${sha256(token)}`);
      return null;
    }
    return this.kv.get<Account>(`acct:${s.accountId}`);
  }

  async getSave(accountId: string): Promise<SaveRec | null> {
    return this.kv.get<SaveRec>(`save:${accountId}`);
  }

  /**
   * Store a character save. `baseRevision` is the revision the client last loaded or saved;
   * a mismatch means another device saved in between, and the write is refused.
   */
  async putSave(accountId: string, raw: unknown, baseRevision: unknown, savedAt: number): Promise<Result<{ revision: number }>> {
    if (typeof raw !== 'string' || raw.length > MAX_SAVE_BYTES) return err(413, 'too_large', 'Save is too large.');
    if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 0) return err(400, 'bad_revision', 'Missing save revision.');
    const check = deserialize(raw);
    if (!check.ok) return err(422, 'invalid_save', `Save rejected: ${check.reason}`);
    return this.withLock(accountId, async () => {
      const cur = await this.kv.get<SaveRec>(`save:${accountId}`);
      const curRev = cur?.revision ?? 0;
      if (baseRevision !== curRev) return err(409, 'conflict', 'This character was saved from another device. Reload to get the latest.');
      const rec: SaveRec = { raw, revision: curRev + 1, savedAt, updatedAt: this.now() };
      await this.kv.put(`save:${accountId}`, rec);
      return { ok: true as const, value: { revision: rec.revision } };
    });
  }
}
