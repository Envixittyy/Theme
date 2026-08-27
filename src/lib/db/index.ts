import { assertServerOnly } from '../server-guard';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import * as schema from './schema';

assertServerOnly('lib/db');

/**
 * One canonical database type. PGlite's drizzle instance exposes the same
 * query-builder surface, so it is presented under the same type rather than a
 * union — a union collapses the builder overloads (`.returning({...})`) and
 * would push driver awareness into every call site.
 */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Two drivers, one interface.
 *
 * - `DATABASE_URL=postgres://…` → node-postgres pool. This is what production runs.
 * - anything else (including unset) → PGlite, a real PostgreSQL compiled to WASM
 *   that stores to `.data/pglite`. It exists so `npm run dev` and the test suite
 *   need zero external services while still exercising genuine Postgres
 *   semantics (types, constraints, `ON CONFLICT`, transactions).
 *
 * Nothing above this module knows which one is in play.
 */

type GlobalCache = {
  db?: Database;
  closer?: () => Promise<void>;
};

const cache = globalThis as unknown as { __mapuaDb?: GlobalCache };
cache.__mapuaDb ??= {};

export function isPostgresUrl(url: string | undefined): boolean {
  return !!url && /^postgres(ql)?:\/\//.test(url);
}

async function create(): Promise<{ db: Database; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;

  if (isPostgresUrl(url)) {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url as string,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
    });
    return {
      db: drizzlePg(pool, { schema, casing: 'snake_case' }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const raw = url ?? '';
  const dataDir = raw.startsWith('pglite://')
    ? raw.slice('pglite://'.length)
    : (process.env.PGLITE_DATA_DIR ?? '.data/pglite');
  // `memory://` keeps a run fully ephemeral — used by the test suite.
  const client = await PGlite.create(dataDir === 'memory' ? undefined : dataDir);
  return {
    db: drizzlePglite(client, { schema, casing: 'snake_case' }) as unknown as Database,
    close: () => client.close(),
  };
}

export async function getDb(): Promise<Database> {
  if (!cache.__mapuaDb!.db) {
    const { db, close } = await create();
    cache.__mapuaDb!.db = db;
    cache.__mapuaDb!.closer = close;
  }
  return cache.__mapuaDb!.db!;
}

export async function closeDb(): Promise<void> {
  const closer = cache.__mapuaDb!.closer;
  cache.__mapuaDb!.db = undefined;
  cache.__mapuaDb!.closer = undefined;
  if (closer) await closer();
}

export { schema };
