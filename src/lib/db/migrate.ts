/**
 * Migration runner that works against either driver.
 * Run with: npm run db:migrate
 */
import { closeDb, getDb, isPostgresUrl } from './index';

export async function runMigrations(db?: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const target = db ?? (await getDb());
  const folder = 'drizzle';
  if (isPostgresUrl(process.env.DATABASE_URL)) {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(target as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(target as never, { migrationsFolder: folder });
  }
}

const isDirect = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isDirect) {
  runMigrations()
    .then(async () => {
      console.log('[db] migrations applied');
      await closeDb();
    })
    .catch(async (err) => {
      console.error('[db] migration failed:', err);
      await closeDb();
      process.exit(1);
    });
}
