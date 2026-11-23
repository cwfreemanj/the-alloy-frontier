import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Raw packs (never committed). Override with SOURCE_ASSETS=/path/to/packs. */
export const SOURCE = process.env.SOURCE_ASSETS ?? resolve(here, '../../source-assets');
/** Where the game loads models from. */
export const OUT = resolve(here, '../../apps/web/public/models');
