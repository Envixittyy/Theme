/** Destructive: drops the local PGlite data directory. Refuses on real Postgres. */
import { rm } from 'node:fs/promises';
import { isPostgresUrl } from './index';

const url = process.env.DATABASE_URL ?? '';
if (isPostgresUrl(url)) {
  console.error('[db] refusing to reset a PostgreSQL server. Drop the database manually.');
  process.exit(1);
}
const dir = url.startsWith('pglite://') ? url.slice(9) : (process.env.PGLITE_DATA_DIR ?? '.data/pglite');
await rm(dir, { recursive: true, force: true });
console.log(`[db] removed ${dir}`);
