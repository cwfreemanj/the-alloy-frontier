/**
 * Tiny key-value storage behind accounts and saves. Three backends:
 *  - Postgres (production; DATABASE_URL), one table, JSON values
 *  - File (local development; ./data/alloy-kv.json)
 *  - Memory (tests)
 * The server is a single process, so per-key ordering is handled in AccountService.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export interface KV {
  readonly kind: 'postgres' | 'file' | 'memory';
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T): Promise<void>;
  /** Insert only if missing. Returns false when the key already existed. */
  putIfAbsent<T>(key: string, value: T): Promise<boolean>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryKV implements KV {
  readonly kind: 'memory' | 'file' = 'memory';
  protected m = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> {
    const v = this.m.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.m.set(key, JSON.stringify(value));
    this.changed();
  }
  async putIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.m.has(key)) return false;
    this.m.set(key, JSON.stringify(value));
    this.changed();
    return true;
  }
  async delete(key: string): Promise<void> {
    if (this.m.delete(key)) this.changed();
  }
  protected changed(): void {}
  async close(): Promise<void> {}
}

/** Development storage: everything in one JSON file, written atomically shortly after changes. */
export class FileKV extends MemoryKV {
  override readonly kind = 'file' as const;
  private timer: NodeJS.Timeout | null = null;
  constructor(private path: string) {
    super();
    if (existsSync(path)) {
      const obj = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) this.m.set(k, v);
    }
  }
  protected override changed(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.m)));
    renameSync(tmp, this.path);
  }
  override async close(): Promise<void> {
    this.flush();
  }
}

/** Minimal surface of pg.Pool we use (lets tests pass an in-memory Postgres). */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * Always verify the server certificate and hostname. node-postgres treats sslmode=require as
 * verify-full today but will weaken it to libpq semantics in its next major version.
 */
export function strictTls(url: string): string {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  if (!mode || mode === 'require' || mode === 'prefer' || mode === 'verify-ca') u.searchParams.set('sslmode', 'verify-full');
  return u.toString();
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS alloy_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export class PostgresKV implements KV {
  readonly kind = 'postgres' as const;
  private ready: Promise<void>;
  /**
   * @param db     pool for normal traffic (Neon: the pooled DATABASE_URL)
   * @param schema optional separate connection for creating the table; Neon advises the
   *               direct (unpooled) connection for schema changes. Defaults to `db`.
   */
  constructor(
    private db: PgLike,
    schema: PgLike | null = null,
  ) {
    const s = schema ?? db;
    this.ready = s
      .query(SCHEMA)
      .then(async () => {
        if (schema) await schema.end();
      })
      .then(() => undefined);
  }
  /** Production: node-postgres over TLS (the connection strings carry sslmode). */
  static fromUrls(pooledUrl: string, directUrl?: string): PostgresKV {
    const pool = new pg.Pool({ connectionString: strictTls(pooledUrl), max: 5, idleTimeoutMillis: 30_000 });
    const direct = directUrl ? new pg.Pool({ connectionString: strictTls(directUrl), max: 1 }) : null;
    return new PostgresKV(pool, direct);
  }
  async get<T>(key: string): Promise<T | null> {
    await this.ready;
    const r = await this.db.query('SELECT v FROM alloy_kv WHERE k = $1', [key]);
    return r.rows.length ? (JSON.parse(String(r.rows[0].v)) as T) : null;
  }
  async put<T>(key: string, value: T): Promise<void> {
    await this.ready;
    await this.db.query('INSERT INTO alloy_kv (k, v, updated_at) VALUES ($1, $2, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()', [key, JSON.stringify(value)]);
  }
  async putIfAbsent<T>(key: string, value: T): Promise<boolean> {
    await this.ready;
    try {
      await this.db.query('INSERT INTO alloy_kv (k, v) VALUES ($1, $2)', [key, JSON.stringify(value)]);
      return true;
    } catch (e) {
      // 23505 = unique_violation: the key already exists.
      const err = e as { code?: string; message?: string };
      if (err.code === '23505' || /duplicate key|unique/i.test(err.message ?? '')) return false;
      throw e;
    }
  }
  async delete(key: string): Promise<void> {
    await this.ready;
    await this.db.query('DELETE FROM alloy_kv WHERE k = $1', [key]);
  }
  async close(): Promise<void> {
    await this.db.end();
  }
}

/** Pick storage from the environment. */
export function kvFromEnv(env: NodeJS.ProcessEnv, defaultFile: string): KV {
  if (env.DATABASE_URL) return PostgresKV.fromUrls(env.DATABASE_URL, env.DATABASE_URL_UNPOOLED || undefined);
  return new FileKV(env.DATA_FILE ?? defaultFile);
}
