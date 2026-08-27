import { closeDb, getDb } from '@/lib/db';
import { runMigrations } from '@/lib/db/migrate';
import { courses, integrationAccounts, integrationSecrets, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

let migrated = false;

export async function db() {
  const instance = await getDb();
  if (!migrated) {
    await runMigrations(instance);
    migrated = true;
  }
  return instance;
}

export async function resetDb(): Promise<void> {
  const instance = await db();
  const { sql } = await import('drizzle-orm');
  // Truncating users cascades through every user-owned table.
  await instance.execute(
    sql`truncate table users, jobs, rate_limits, magic_link_tokens restart identity cascade`,
  );
}

export async function createUser(email = 'student@example.edu', timeZone = 'Asia/Manila') {
  const instance = await db();
  const existing = await instance.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await instance
    .insert(users)
    .values({ email, displayName: 'Test Student', timeZone })
    .returning();
  return row!;
}

export async function createCourse(userId: string, code: string, title = `${code} course`) {
  const instance = await db();
  const [row] = await instance.insert(courses).values({ userId, code, title }).returning();
  return row!;
}

export async function createIcsAccount(userId: string, label = 'Test feed') {
  const instance = await db();
  const [row] = await instance
    .insert(integrationAccounts)
    .values({ userId, provider: 'blackboard_ics', label, config: { timeZone: 'Asia/Manila' } })
    .returning();
  return row!;
}

export async function setAccountSecret(accountId: string, name: string, value: string) {
  const { encryptSecret } = await import('@/lib/security/crypto');
  const instance = await db();
  const { ciphertext, keyId } = encryptSecret(value);
  await instance
    .insert(integrationSecrets)
    .values({ accountId, name, ciphertext, keyId, displayHint: 'hint' })
    .onConflictDoNothing();
}

export async function teardown(): Promise<void> {
  await closeDb();
  migrated = false;
}

/** Builds a minimal but realistic Blackboard-style ICS document. */
export function icsDocument(
  events: Array<{
    uid?: string;
    summary: string;
    description?: string;
    due?: string; // e.g. 20260901T155900Z
    url?: string;
    lastModified?: string;
    categories?: string;
  }>,
): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blackboard//Course Calendar//EN', 'X-WR-CALNAME:My Courses'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    if (e.uid) lines.push(`UID:${e.uid}`);
    lines.push(`SUMMARY:${e.summary}`);
    if (e.description) lines.push(`DESCRIPTION:${e.description}`);
    if (e.due) {
      lines.push(`DTSTART:${e.due}`);
      lines.push(`DUE:${e.due}`);
    }
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories) lines.push(`CATEGORIES:${e.categories}`);
    if (e.lastModified) lines.push(`LAST-MODIFIED:${e.lastModified}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
