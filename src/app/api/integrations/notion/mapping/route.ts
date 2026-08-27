import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { integrationAccounts } from '@/lib/db/schema';
import { getAccount, readSecret } from '@/lib/connectors/integrations';
import { HttpNotionClient } from '@/lib/connectors/notion/client';
import { DEFAULT_MAPPING, proposeMapping } from '@/lib/connectors/notion/mapping';
import { NotFoundError } from '@/lib/domain/tasks';
import { enqueue } from '@/lib/jobs/queue';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

/** Inspect a database and propose a mapping the student can adjust. */
export const GET = withUser(async ({ request, user }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId');
  const databaseId = url.searchParams.get('databaseId');
  if (!accountId) throw new NotFoundError('Account');

  const account = await getAccount(user.id, accountId);
  if (!account) throw new NotFoundError('Account');
  const config = account.config as Record<string, unknown>;

  if (!databaseId) {
    return { databases: (config.databases as unknown[]) ?? [], mapping: config.mapping ?? DEFAULT_MAPPING };
  }

  const token = await readSecret(accountId, 'access_token');
  if (!token) throw new NotFoundError('Credential');
  const client = new HttpNotionClient(token);
  const database = await client.getDatabase(databaseId);

  const properties = Object.fromEntries(
    Object.entries(database.properties).map(([key, value]) => [key, { name: value.name, type: value.type }]),
  );
  const proposal = proposeMapping(properties);
  return {
    databaseTitle: database.title?.map((t) => t.plain_text).join('') ?? 'Untitled',
    properties: Object.values(properties),
    ...proposal,
  };
});

const saveSchema = z.object({
  accountId: z.uuid(),
  databaseId: z.string().min(1).max(120),
  mapping: z.record(z.string(), z.unknown()),
});

export const POST = withUser(async ({ request, user }) => {
  const body = saveSchema.parse(await readJson(request));
  const account = await getAccount(user.id, body.accountId);
  if (!account) throw new NotFoundError('Account');

  const db = await getDb();
  await db
    .update(integrationAccounts)
    .set({
      config: {
        ...(account.config as Record<string, unknown>),
        databaseId: body.databaseId,
        mapping: { ...DEFAULT_MAPPING, ...body.mapping },
      },
      updatedAt: new Date(),
    })
    .where(eq(integrationAccounts.id, body.accountId));

  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'integration.mapping_saved',
    entityType: 'integration_account',
    entityId: body.accountId,
    detail: { databaseId: body.databaseId },
  });

  // First run pulls only: nothing is written to Notion until the student has
  // seen what comes back.
  await enqueue(
    'notion.pull',
    { accountId: body.accountId, pullOnly: true },
    { userId: user.id, lockKey: `notion:${body.accountId}`, idempotencyKey: `notion:first:${body.accountId}` },
  );
  return { ok: true };
});
