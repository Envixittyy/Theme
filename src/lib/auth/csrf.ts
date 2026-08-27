import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { sessions } from '../db/schema';
import { constantTimeEqual, sha256 } from '../security/crypto';
import { SESSION_COOKIE } from './session';

/**
 * Double-submit CSRF with a session-bound secret.
 *
 * The token is HMAC-ish (`sha256(sessionSecret + ":" + sessionId)`) so it is
 * stable for the life of the session, cannot be forged without the secret, and
 * never needs its own cookie. State-changing routes call `assertCsrf()`;
 * `SameSite=Lax` on the session cookie is the second layer, not the only one.
 */

export class CsrfError extends Error {
  constructor() {
    super('CSRF token missing or invalid');
    this.name = 'CsrfError';
  }
}

export async function currentCsrfToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: sessions.id, csrfSecret: sessions.csrfSecret })
    .from(sessions)
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return sha256(`${row.csrfSecret}:${row.id}`);
}

export async function assertCsrf(): Promise<void> {
  const hdrs = await headers();
  const provided = hdrs.get('x-csrf-token');
  const expected = await currentCsrfToken();
  if (!provided || !expected || !constantTimeEqual(provided, expected)) throw new CsrfError();

  // Origin check: a browser always sends Origin on state-changing fetches.
  const origin = hdrs.get('origin');
  if (origin) {
    const appUrl = process.env.APP_URL;
    const host = hdrs.get('host');
    const allowed = new Set([appUrl, host ? `https://${host}` : null, host ? `http://${host}` : null].filter(Boolean));
    if (!allowed.has(origin)) throw new CsrfError();
  }
}
