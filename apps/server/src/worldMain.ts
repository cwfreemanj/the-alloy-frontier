/**
 * `npm run world` — run the shared-world game server.
 *
 * Locally: http://localhost:2568 (add --lan for other devices on your network).
 * On a cloud host: the platform sets PORT; the server listens on all interfaces.
 * ALLOWED_ORIGINS (comma-separated) lets a separately hosted copy of the game connect.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorldServer } from './worldServer';
import { AccountService } from './accounts/service';
import { kvFromEnv } from './accounts/kv';

const here = dirname(fileURLToPath(import.meta.url));

// Local secrets (e.g. DATABASE_URL) live in .env.local at the project root, which git ignores.
// On Render they come from the dashboard instead, so the file is simply absent there.
const localEnv = resolve(here, '../../../.env.local');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const dist = resolve(here, '../../web/dist');
const cloud = process.env.PORT !== undefined;
const lan = process.argv.includes('--lan');
const port = Number(process.env.PORT ?? 2568);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const staticDir = dist;
const kv = kvFromEnv(process.env, resolve(here, '../../../data/alloy-kv.json'));
const accounts = new AccountService(kv);
if (kv.kind === 'file' && cloud) {
  console.warn('WARNING: no DATABASE_URL set. Accounts and saves are stored in a local file, which this host may wipe on every deploy or restart.');
}
const trustProxy = process.env.RENDER === 'true' || process.env.TRUST_PROXY === '1';
if (!existsSync(resolve(dist, 'index.html'))) console.warn('No game build found yet (run "npm run build"); the page will 404 until it exists.');

startWorldServer({ port, host: cloud || lan ? '0.0.0.0' : '127.0.0.1', staticDir, allowedOrigins, accounts, trustProxy }).then((s) => {
  console.log(`Alloy Frontier world server listening on port ${s.port} (serving the game too). Account storage: ${kv.kind}.`);
  if (!cloud) console.log(`Play: http://localhost:${s.port}`);
  // Hosts stop the old server on every deploy (SIGTERM): write characters before exiting.
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      console.log(`${sig}: saving characters and stopping.`);
      const force = setTimeout(() => process.exit(1), 10_000);
      void s.close().then(() => {
        clearTimeout(force);
        process.exit(0);
      });
    });
  }
  let last = -1;
  setInterval(() => {
    if (s.room.playerCount !== last) {
      last = s.room.playerCount;
      console.log(`[${new Date().toISOString()}] connections: ${last}${last ? ` (${s.room.playerNames().join(', ')})` : ''}`);
    }
  }, 2000);
});
