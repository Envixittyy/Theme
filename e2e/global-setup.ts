import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

/**
 * Starts a mail catcher and prepares a dedicated database.
 *
 * The catcher is a real HTTP endpoint the app posts to through its ordinary
 * webhook mail transport, so the sign-in path under test is the one users get.
 */
export const MAIL_FILE = 'e2e/.last-mail.txt';

export default async function globalSetup(): Promise<() => Promise<void>> {
  await rm('.data/e2e', { recursive: true, force: true });
  await mkdir('.data', { recursive: true });
  await rm(MAIL_FILE, { force: true });

  const env = {
    ...process.env,
    DATABASE_URL: '',
    PGLITE_DATA_DIR: '.data/e2e',
    SECRET_ENCRYPTION_KEYS: `e2e:${Buffer.alloc(32, 9).toString('base64')}`,
    SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'e2e',
    DEMO_EMAIL: 'e2e@school.local',
  };

  spawnSync('npx', ['tsx', 'src/lib/db/migrate.ts'], { env, stdio: 'inherit' });
  spawnSync('npx', ['tsx', 'src/lib/db/seed.ts'], { env, stdio: 'inherit' });

  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body) as { text?: string };
        const link = /https?:\/\/\S*\/auth\/verify\?token=\S+/.exec(payload.text ?? '')?.[0];
        if (link) await writeFile(MAIL_FILE, link.trim(), 'utf8');
      } catch {
        /* a malformed body simply produces no link */
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  });

  // If a previous run left its catcher listening, reuse it rather than dying:
  // both write the link to the same file, which is all the tests need.
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(4599, '127.0.0.1', () => resolve(true));
  });

  return async () => {
    if (listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
