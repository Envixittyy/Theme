import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Database } from '../db';
import { integrationAccounts, integrationSecrets, syncConflicts, syncRuns } from '../db/schema';
import { recordAudit } from '../domain/audit';
import { decryptSecret, encryptSecret, needsRotation } from '../security/crypto';
import { safeUrlHint } from '../security/redact';
import { assertServerOnly } from '../server-guard';

assertServerOnly('lib/connectors/integrations');

export type IntegrationAccountRow = typeof integrationAccounts.$inferSelect;
export type Provider = IntegrationAccountRow['provider'];

/**
 * Integration accounts and their secrets.
 *
 * The only path to a plaintext secret is `readSecret`, which is server-only and
 * returns the value to a caller that is expected to use it immediately and
 * never persist or log it. Client components receive `displayHint` instead —
 * a host plus a truncated tail, which is enough for a student to recognise
 * their own feed and useless to anyone else.
 */

export async function listAccounts(userId: string, provider?: Provider): Promise<IntegrationAccountRow[]> {
  const db = await getDb();
  const where = provider
    ? and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.provider, provider))
    : eq(integrationAccounts.userId, userId);
  return db.select().from(integrationAccounts).where(where).orderBy(desc(integrationAccounts.createdAt));
}

export async function getAccount(userId: string, accountId: string): Promise<IntegrationAccountRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(integrationAccounts)
    .where(and(eq(integrationAccounts.id, accountId), eq(integrationAccounts.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAccount(args: {
  userId: string;
  provider: Provider;
  label: string;
  externalAccountId?: string | null;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
  db?: Database;
}): Promise<IntegrationAccountRow> {
  const db = args.db ?? (await getDb());
  const [account] = await db
    .insert(integrationAccounts)
    .values({
      userId: args.userId,
      provider: args.provider,
      label: args.label,
      externalAccountId: args.externalAccountId ?? null,
      config: args.config ?? {},
      status: 'connected',
    })
    .returning();

  for (const [name, value] of Object.entries(args.secrets ?? {})) {
    await putSecret(account!.id, name, value, db);
  }
  await recordAudit(
    {
      userId: args.userId,
      actor: `user:${args.userId}`,
      action: 'integration.connected',
      entityType: 'integration_account',
      entityId: account!.id,
      // Deliberately no secret material — only the provider and a safe hint.
      detail: { provider: args.provider, label: args.label },
    },
    db,
  );
  return account!;
}

export async function putSecret(accountId: string, name: string, value: string, db?: Database): Promise<void> {
  const target = db ?? (await getDb());
  const { ciphertext, keyId } = encryptSecret(value);
  const hint = value.startsWith('http') ? safeUrlHint(value) : `…${value.slice(-4)}`;
  await target
    .insert(integrationSecrets)
    .values({ accountId, name, ciphertext, keyId, displayHint: hint })
    .onConflictDoUpdate({
      target: [integrationSecrets.accountId, integrationSecrets.name],
      set: { ciphertext, keyId, displayHint: hint, rotatedAt: new Date() },
    });
}

/** Server-only. Never return the result to a client component. */
export async function readSecret(accountId: string, name: string, db?: Database): Promise<string | null> {
  const target = db ?? (await getDb());
  const rows = await target
    .select()
    .from(integrationSecrets)
    .where(and(eq(integrationSecrets.accountId, accountId), eq(integrationSecrets.name, name)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const plaintext = decryptSecret(row.ciphertext);
  // Opportunistic re-encryption under the current key.
  if (needsRotation(row.ciphertext)) {
    const { ciphertext, keyId } = encryptSecret(plaintext);
    await target
      .update(integrationSecrets)
      .set({ ciphertext, keyId, rotatedAt: new Date() })
      .where(eq(integrationSecrets.id, row.id));
  }
  return plaintext;
}

export async function secretHints(accountId: string): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db
    .select({ name: integrationSecrets.name, hint: integrationSecrets.displayHint })
    .from(integrationSecrets)
    .where(eq(integrationSecrets.accountId, accountId));
  return Object.fromEntries(rows.map((r) => [r.name, r.hint]));
}

export async function disconnectAccount(userId: string, accountId: string): Promise<boolean> {
  const db = await getDb();
  const account = await getAccount(userId, accountId);
  if (!account) return false;
  // Secrets are destroyed; the external records stay so the student keeps their
  // tasks and their history. Reconnecting re-links by external id.
  await db.delete(integrationSecrets).where(eq(integrationSecrets.accountId, accountId));
  await db
    .update(integrationAccounts)
    .set({ status: 'disconnected', disconnectedAt: new Date(), config: {} })
    .where(eq(integrationAccounts.id, accountId));
  await recordAudit({
    userId,
    actor: `user:${userId}`,
    action: 'integration.disconnected',
    entityType: 'integration_account',
    entityId: accountId,
    detail: { provider: account.provider },
  });
  return true;
}

export async function setAccountStatus(
  accountId: string,
  status: 'connected' | 'error' | 'disconnected',
  lastError: string | null,
  db?: Database,
): Promise<void> {
  const target = db ?? (await getDb());
  await target
    .update(integrationAccounts)
    .set({ status, lastError, updatedAt: new Date() })
    .where(eq(integrationAccounts.id, accountId));
}

/** Everything the Sync health screen needs, in one round trip. */
export async function syncHealth(userId: string) {
  const db = await getDb();
  const accounts = await listAccounts(userId);
  const runs = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.userId, userId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(25);
  const conflicts = await db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')))
    .orderBy(desc(syncConflicts.createdAt))
    .limit(50);
  return { accounts, runs, conflicts };
}
