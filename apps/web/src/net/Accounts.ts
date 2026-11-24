/**
 * Browser side of accounts. The sign-in token is kept in this browser's storage (never in
 * code or URLs) and sent as a bearer header. A signed-in character is owned and saved by
 * the world server; the browser only reads it, starts a new one, or imports a guest one.
 */
const AUTH_KEY = 'alloy-frontier.auth.v1';

export interface StoredAuth {
  token: string;
  username: string;
  base: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function readAuth(base: string): StoredAuth | null {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as StoredAuth | null;
    return a && a.base === base && typeof a.token === 'string' ? a : null;
  } catch {
    return null;
  }
}
function writeAuth(a: StoredAuth | null): void {
  try {
    if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage unavailable: sign-in lasts for this tab only */
  }
}

export class AccountClient {
  auth: StoredAuth | null;
  /** Revision of the save this device last loaded or wrote. */
  revision = 0;

  constructor(readonly base: string) {
    this.auth = readAuth(base);
  }

  get username(): string | null {
    return this.auth?.username ?? null;
  }
  get token(): string | null {
    return this.auth?.token ?? null;
  }

  private async call<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.base), {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.auth ? { authorization: `Bearer ${this.auth.token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        keepalive,
      });
    } catch {
      throw new ApiError(0, 'network', 'Could not reach the server.');
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401) {
        this.auth = null;
        writeAuth(null);
      }
      throw new ApiError(res.status, String(json.error ?? 'error'), String(json.message ?? `Server error (${res.status})`));
    }
    return json as T;
  }

  /** Is accounts support on, and is the saved sign-in still valid? */
  async check(): Promise<'signed_in' | 'signed_out' | 'unavailable'> {
    try {
      if (!this.auth) {
        // Probe that the API exists (a 401 means it does).
        await this.call('GET', '/api/me').catch((e: ApiError) => {
          if (e.status !== 401) throw e;
        });
        return 'signed_out';
      }
      await this.call('GET', '/api/me');
      return 'signed_in';
    } catch (e) {
      const s = (e as ApiError).status;
      return s === 401 ? 'signed_out' : 'unavailable';
    }
  }

  async register(username: string, password: string): Promise<void> {
    const r = await this.call<{ token: string; username: string }>('POST', '/api/register', { username, password });
    this.auth = { token: r.token, username: r.username, base: this.base };
    writeAuth(this.auth);
  }

  async login(username: string, password: string): Promise<void> {
    const r = await this.call<{ token: string; username: string }>('POST', '/api/login', { username, password });
    this.auth = { token: r.token, username: r.username, base: this.base };
    writeAuth(this.auth);
  }

  async logout(): Promise<void> {
    await this.call('POST', '/api/logout').catch(() => undefined);
    this.auth = null;
    this.revision = 0;
    writeAuth(null);
  }

  async loadSave(): Promise<string | null> {
    const r = await this.call<{ save: string | null; revision: number }>('GET', '/api/save');
    this.revision = r.revision;
    return r.save;
  }

  /** Start a fresh character on the server (replaces any existing one). */
  async newCharacter(): Promise<void> {
    const r = await this.call<{ revision: number }>('POST', '/api/character/new', {});
    this.revision = r.revision;
  }

  /** Bring this browser's guest character into the account (only when it has none). */
  async importCharacter(raw: string): Promise<void> {
    const r = await this.call<{ revision: number }>('POST', '/api/character/import', { save: raw });
    this.revision = r.revision;
  }
}
