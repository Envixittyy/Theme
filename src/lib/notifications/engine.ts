import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db';
import {
  courses,
  notificationDeliveries,
  notificationEvents,
  pushSubscriptions,
  userPreferences,
  users,
} from '../db/schema';
import { getPushProvider } from '../connectors/push';
import { enqueue } from '../jobs/queue';
import { isWithinQuietHours, quietHoursEndAt } from '../shared/time';
import { redactError } from '../security/redact';
import { assertServerOnly } from '../server-guard';

assertServerOnly('lib/notifications/engine');

export type NotificationKind = typeof notificationEvents.$inferSelect['kind'];
export type NotificationEventRow = typeof notificationEvents.$inferSelect;

export type EmitInput = {
  userId: string;
  kind: NotificationKind;
  /**
   * Stable across retries and re-syncs. This is the single mechanism that stops
   * a re-run of a sync from notifying twice: the unique index on
   * (user_id, event_key) rejects the second insert.
   */
  eventKey: string;
  title: string;
  body?: string;
  deepLink: string;
  courseId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

export type EmitResult =
  | { created: true; eventId: string; suppressed: false; deferredUntil: Date | null }
  | { created: true; eventId: string; suppressed: true; reason: 'preference' | 'course_opt_out' }
  | { created: false; eventId: string; reason: 'duplicate' };

/**
 * Records a notification event and decides whether it may be delivered.
 *
 * Ordering matters: the event row is written *first* and unconditionally (so it
 * always appears in the in-app notification centre, and so dedup is enforced by
 * the database), and only then do preferences and quiet hours decide about
 * push. A muted course still produces an in-app record; it just does not buzz.
 */
export async function emitNotification(input: EmitInput, db?: Database): Promise<EmitResult> {
  const target = db ?? (await getDb());

  const inserted = await target
    .insert(notificationEvents)
    .values({
      userId: input.userId,
      kind: input.kind,
      eventKey: input.eventKey,
      title: input.title.slice(0, 300),
      body: (input.body ?? '').slice(0, 1000),
      deepLink: input.deepLink,
      courseId: input.courseId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })
    .onConflictDoNothing({ target: [notificationEvents.userId, notificationEvents.eventKey] })
    .returning({ id: notificationEvents.id });

  if (!inserted[0]) {
    const existing = await target
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(and(eq(notificationEvents.userId, input.userId), eq(notificationEvents.eventKey, input.eventKey)))
      .limit(1);
    return { created: false, eventId: existing[0]?.id ?? '', reason: 'duplicate' };
  }

  const eventId = inserted[0].id;
  const prefs = await loadPreferences(target, input.userId);

  if (prefs.kinds[input.kind] === false) {
    await target
      .insert(notificationDeliveries)
      .values({
        eventId,
        userId: input.userId,
        channel: 'in_app',
        state: 'suppressed_preference',
        detail: `${input.kind} notifications are turned off`,
      })
      .onConflictDoNothing();
    return { created: true, eventId, suppressed: true, reason: 'preference' };
  }

  if (input.courseId && prefs.courseOptOut[input.courseId]) {
    await target
      .insert(notificationDeliveries)
      .values({
        eventId,
        userId: input.userId,
        channel: 'in_app',
        state: 'suppressed_preference',
        detail: 'notifications are muted for this course',
      })
      .onConflictDoNothing();
    return { created: true, eventId, suppressed: true, reason: 'course_opt_out' };
  }

  let deliverAfter: Date | null = null;
  const now = new Date();
  if (
    prefs.quietHoursEnabled &&
    isWithinQuietHours(now, prefs.timeZone, prefs.quietHoursStartMinute, prefs.quietHoursEndMinute)
  ) {
    deliverAfter = quietHoursEndAt(now, prefs.timeZone, prefs.quietHoursStartMinute, prefs.quietHoursEndMinute);
    await target.update(notificationEvents).set({ deliverAfter }).where(eq(notificationEvents.id, eventId));
  }

  await enqueue(
    'notifications.deliver',
    { eventId },
    {
      userId: input.userId,
      runAt: deliverAfter ?? now,
      idempotencyKey: `deliver:${eventId}`,
      lockKey: `push:${input.userId}`,
    },
    target,
  );

  return { created: true, eventId, suppressed: false, deferredUntil: deliverAfter };
}

type ResolvedPreferences = {
  timeZone: string;
  quietHoursEnabled: boolean;
  quietHoursStartMinute: number;
  quietHoursEndMinute: number;
  kinds: Record<string, boolean>;
  courseOptOut: Record<string, boolean>;
  dailyDigestEnabled: boolean;
  dailyDigestMinute: number;
};

export async function loadPreferences(db: Database, userId: string): Promise<ResolvedPreferences> {
  const rows = await db
    .select({
      timeZone: users.timeZone,
      quietHoursEnabled: userPreferences.quietHoursEnabled,
      quietHoursStartMinute: userPreferences.quietHoursStartMinute,
      quietHoursEndMinute: userPreferences.quietHoursEndMinute,
      notificationKinds: userPreferences.notificationKinds,
      courseNotificationOptOut: userPreferences.courseNotificationOptOut,
      dailyDigestEnabled: userPreferences.dailyDigestEnabled,
      dailyDigestMinute: userPreferences.dailyDigestMinute,
    })
    .from(users)
    .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  return {
    timeZone: row?.timeZone ?? 'Asia/Manila',
    quietHoursEnabled: row?.quietHoursEnabled ?? true,
    quietHoursStartMinute: row?.quietHoursStartMinute ?? 22 * 60,
    quietHoursEndMinute: row?.quietHoursEndMinute ?? 7 * 60,
    kinds: (row?.notificationKinds as Record<string, boolean>) ?? {},
    courseOptOut: (row?.courseNotificationOptOut as Record<string, boolean>) ?? {},
    dailyDigestEnabled: row?.dailyDigestEnabled ?? false,
    dailyDigestMinute: row?.dailyDigestMinute ?? 7 * 60,
  };
}

/**
 * Fan a single event out to every registered device.
 *
 * The unique index on (event, channel, subscription) makes this safe to run
 * twice: a retried job cannot double-send to the same device.
 */
export async function deliverNotification(eventId: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const db = await getDb();
  const rows = await db.select().from(notificationEvents).where(eq(notificationEvents.id, eventId)).limit(1);
  const event = rows[0];
  if (!event) return { sent: 0, failed: 0, skipped: 0 };

  if (event.deliverAfter && event.deliverAfter.getTime() > Date.now()) {
    return { sent: 0, failed: 0, skipped: 1 };
  }

  // The in-app record is the always-available channel: it is what makes push
  // optional rather than load-bearing.
  await db
    .insert(notificationDeliveries)
    .values({ eventId, userId: event.userId, channel: 'in_app', state: 'sent', attemptedAt: new Date() })
    // Untargeted ON CONFLICT DO NOTHING: it needs no index inference, and the
    // partial unique index on (event, channel) WHERE subscription_id IS NULL is
    // what actually keeps a retried job from adding a second in-app record.
    .onConflictDoNothing();

  const provider = getPushProvider();
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, event.userId), isNull(pushSubscriptions.expiredAt)));

  if (!provider.available) {
    for (const sub of subs) {
      await db
        .insert(notificationDeliveries)
        .values({
          eventId,
          userId: event.userId,
          channel: 'web_push',
          subscriptionId: sub.id,
          state: 'failed',
          detail: 'Web Push is not configured on this server',
          attemptedAt: new Date(),
        })
        .onConflictDoNothing();
    }
    return { sent: 0, failed: subs.length, skipped: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    const already = await db
      .select({ id: notificationDeliveries.id, state: notificationDeliveries.state })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.eventId, eventId),
          eq(notificationDeliveries.channel, 'web_push'),
          eq(notificationDeliveries.subscriptionId, sub.id),
        ),
      )
      .limit(1);
    if (already[0]?.state === 'sent') continue;

    const result = await provider.send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title: event.title,
        // Payloads carry no credentials and no confidential body text beyond
        // what the student already sees in-app.
        body: event.body.slice(0, 200),
        url: event.deepLink,
        tag: event.eventKey,
        eventId: event.id,
      },
    );

    await db
      .insert(notificationDeliveries)
      .values({
        eventId,
        userId: event.userId,
        channel: 'web_push',
        subscriptionId: sub.id,
        state: result.ok ? 'sent' : result.gone ? 'expired' : 'failed',
        detail: result.ok ? null : result.detail,
        attemptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [notificationDeliveries.eventId, notificationDeliveries.channel, notificationDeliveries.subscriptionId],
        set: {
          state: result.ok ? 'sent' : result.gone ? 'expired' : 'failed',
          detail: result.ok ? null : result.detail,
          attemptedAt: new Date(),
        },
      });

    if (result.ok) {
      sent += 1;
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failureCount: 0 })
        .where(eq(pushSubscriptions.id, sub.id));
    } else {
      failed += 1;
      await db
        .update(pushSubscriptions)
        .set({
          failureCount: sql`${pushSubscriptions.failureCount} + 1`,
          expiredAt: result.gone ? new Date() : null,
        })
        .where(eq(pushSubscriptions.id, sub.id));
    }
  }
  return { sent, failed, skipped: 0 };
}

/* --------------------------- notification centre --------------------------- */

export async function listNotifications(userId: string, limit = 50) {
  const db = await getDb();
  return db
    .select({
      id: notificationEvents.id,
      kind: notificationEvents.kind,
      title: notificationEvents.title,
      body: notificationEvents.body,
      deepLink: notificationEvents.deepLink,
      createdAt: notificationEvents.createdAt,
      readAt: notificationEvents.readAt,
      deliverAfter: notificationEvents.deliverAfter,
      courseId: notificationEvents.courseId,
      courseCode: courses.code,
      courseColor: courses.color,
    })
    .from(notificationEvents)
    .leftJoin(courses, eq(courses.id, notificationEvents.courseId))
    .where(eq(notificationEvents.userId, userId))
    .orderBy(desc(notificationEvents.createdAt))
    .limit(limit);
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationEvents)
    .where(and(eq(notificationEvents.userId, userId), isNull(notificationEvents.readAt)));
  return rows[0]?.count ?? 0;
}

export async function markNotificationRead(userId: string, ids: string[] | 'all'): Promise<number> {
  const db = await getDb();
  const where =
    ids === 'all'
      ? and(eq(notificationEvents.userId, userId), isNull(notificationEvents.readAt))
      : and(eq(notificationEvents.userId, userId), inArray(notificationEvents.id, ids));
  const rows = await db.update(notificationEvents).set({ readAt: new Date() }).where(where).returning({ id: notificationEvents.id });
  return rows.length;
}

/**
 * Burst grouping. When several events for one user land inside a short window,
 * they are replaced by a single digest event so a five-item Blackboard drop is
 * one buzz, not five.
 */
export async function groupBurst(userId: string, windowMs = 5 * 60_000, threshold = 4): Promise<string | null> {
  const db = await getDb();
  const since = new Date(Date.now() - windowMs);
  const pending = await db
    .select({ id: notificationEvents.id, title: notificationEvents.title })
    .from(notificationEvents)
    .innerJoin(notificationDeliveries, eq(notificationDeliveries.eventId, notificationEvents.id))
    .where(
      and(
        eq(notificationEvents.userId, userId),
        isNull(notificationEvents.digestedIntoId),
        eq(notificationDeliveries.state, 'pending'),
        sql`${notificationEvents.createdAt} >= ${since}`,
      ),
    )
    .orderBy(asc(notificationEvents.createdAt));

  if (pending.length < threshold) return null;

  const emitted = await emitNotification({
    userId,
    kind: 'daily_digest',
    eventKey: `digest:burst:${Math.floor(Date.now() / windowMs)}`,
    title: `${pending.length} new items`,
    body: pending.slice(0, 3).map((p) => p.title).join(' · '),
    deepLink: '/notifications',
  });
  if (!emitted.created) return null;

  await db
    .update(notificationEvents)
    .set({ digestedIntoId: emitted.eventId })
    .where(inArray(notificationEvents.id, pending.map((p) => p.id)));
  return emitted.eventId;
}

/** Deliverable events whose quiet-hours deferral has expired. */
export async function dueDeferredEvents(limit = 100): Promise<NotificationEventRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(notificationEvents)
    .where(or(isNull(notificationEvents.deliverAfter), lte(notificationEvents.deliverAfter, new Date()))!)
    .orderBy(asc(notificationEvents.createdAt))
    .limit(limit);
}

export function describeDeliveryFailure(err: unknown): string {
  return redactError(err);
}
