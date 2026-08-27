/**
 * Test environment.
 *
 * Every suite runs against a real PostgreSQL (PGlite in-process), so
 * constraints, transactions and `ON CONFLICT` behave exactly as they do in
 * production. Nothing is stubbed at the database boundary.
 */
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.TZ = 'UTC';
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory';
process.env.APP_URL = 'http://localhost:3000';
process.env.SECRET_ENCRYPTION_KEYS ??= 'test:' + Buffer.alloc(32, 7).toString('base64');
process.env.SECRET_ENCRYPTION_ACTIVE_KEY_ID ??= 'test';
