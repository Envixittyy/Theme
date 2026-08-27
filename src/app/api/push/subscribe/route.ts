import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { devices, pushSubscriptions } from '@/lib/db/schema';
import { getPushProvider } from '@/lib/connectors/push';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
  deviceLabel: z.string().max(80).optional(),
  isStandalone: z.boolean().optional(),
});

/** The public key the browser needs, plus whether push works here at all. */
export const GET = withUser(async ({ user }) => {
  const provider = getPushProvider();
  const db = await getDb();
  const subs = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
      expiredAt: pushSubscriptions.expiredAt,
      userAgent: pushSubscriptions.userAgent,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id));

  return {
    available: provider.available,
    publicKey: provider.publicKey,
    provider: provider.name,
    // Endpoints are truncated: the full URL is a bearer capability for that
    // device's push channel.
    subscriptions: subs.map((s) => ({
      id: s.id,
      origin: safeOrigin(s.endpoint),
      createdAt: s.createdAt,
      lastSuccessAt: s.lastSuccessAt,
      expired: !!s.expiredAt,
      userAgent: s.userAgent,
    })),
  };
});

export const POST = withUser(async ({ request, user }) => {
  const body = schema.parse(await readJson(request));
  const db = await getDb();

  const [device] = await db
    .insert(devices)
    .values({
      userId: user.id,
      label: body.deviceLabel?.slice(0, 80) ?? 'This device',
      platform: request.headers.get('user-agent')?.slice(0, 120) ?? 'unknown',
      isStandalonePwa: !!body.isStandalone,
    })
    .returning();

  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      userId: user.id,
      deviceId: device!.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: user.id,
        deviceId: device!.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        expiredAt: null,
        failureCount: 0,
      },
    })
    .returning({ id: pushSubscriptions.id });

  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'push.subscribed',
    entityType: 'push_subscription',
    entityId: row!.id,
    detail: { origin: safeOrigin(body.endpoint), standalone: !!body.isStandalone },
  });
  return { id: row!.id };
});

export const DELETE = withUser(async ({ request, user }) => {
  const body = z.object({ id: z.uuid().optional(), endpoint: z.url().optional() }).parse(await readJson(request));
  const db = await getDb();
  if (body.id) {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.id, body.id), eq(pushSubscriptions.userId, user.id)));
  } else if (body.endpoint) {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, user.id)));
  }
  await recordAudit({ userId: user.id, actor: `user:${user.id}`, action: 'push.unsubscribed' });
  return null;
});

function safeOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}
