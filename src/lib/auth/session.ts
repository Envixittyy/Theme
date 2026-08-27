import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { getDb } from '../db';
import { sessions, userPreferences, users } from '../db/schema';
import { randomToken, sha256 } from '../security/crypto';
import { assertServerOnly } from '../server-guard';

assertServerOnly('lib/auth/session');

export const SESSION_COOKIE = 'mos_session';
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const ROLL_AFTER_MS = 24 * 3600_000;

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  timeZone: string;
  sessionId: string;
};

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function hashIp(ip: string | null): string | null {
  return ip ? sha256(`ip:${ip}`).slice(0, 32) : null;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const token = randomToken(32);
  const csrfSecret = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const hdrs = await headers();

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      csrfSecret,
      userAgent: hdrs.get('user-agent')?.slice(0, 300) ?? null,
      ipHash: hashIp(hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
      expiresAt,
    })
    .returning({ id: sessions.id });

  if (!row) throw new Error('failed to create session');

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return { token, expiresAt };
}

/** Returns the current user, or null. Never throws for anonymous visitors. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSessionToken(token);
}

export async function resolveSessionToken(token: string): Promise<AuthenticatedUser | null> {
  const db = await getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      timeZone: users.timeZone,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.deletedAt) return null;

  if (Date.now() - row.lastSeenAt.getTime() > ROLL_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
  }

  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    timeZone: row.timeZone,
    sessionId: row.sessionId,
  };
}

/** Use in every server action / route handler that touches user data. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  }
  store.delete(SESSION_COOKIE);
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function listSessions(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.lastSeenAt} desc`);
}

/** Preferences are created lazily so a user row is always sufficient to log in. */
export async function getPreferences(userId: string) {
  const db = await getDb();
  const existing = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db.insert(userPreferences).values({ userId }).returning();
  return created!;
}
