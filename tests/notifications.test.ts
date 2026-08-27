import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createCourse, createUser, db, resetDb } from './helpers';
import {
  deliverNotification,
  emitNotification,
  markNotificationRead,
  unreadNotificationCount,
} from '@/lib/notifications/engine';
import { notificationDeliveries, notificationEvents, pushSubscriptions, userPreferences } from '@/lib/db/schema';
import { __setPushProvider, type PushProvider, type PushResult } from '@/lib/connectors/push';
import { zonedToUtc } from '@/lib/shared/time';

const MNL = 'Asia/Manila';

let userId: string;
let courseId: string;

function recordingProvider(behaviour: (endpoint: string) => PushResult = () => ({ ok: true })) {
  const sent: Array<{ endpoint: string; title: string; url: string; tag: string }> = [];
  const provider: PushProvider = {
    name: 'test',
    available: true,
    publicKey: 'test-key',
    async send(target, payload) {
      sent.push({ endpoint: target.endpoint, title: payload.title, url: payload.url, tag: payload.tag });
      return behaviour(target.endpoint);
    },
  };
  __setPushProvider(provider);
  return sent;
}

beforeAll(async () => {
  await db();
});

beforeEach(async () => {
  await resetDb();
  const user = await createUser();
  userId = user.id;
  courseId = (await createCourse(userId, 'CHM031')).id;
  const instance = await db();
  await instance.insert(userPreferences).values({ userId, quietHoursEnabled: false });
  __setPushProvider(null);
});

async function addDevice(endpoint: string) {
  const instance = await db();
  const [row] = await instance
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh: 'p', auth: 'a' })
    .returning();
  return row!;
}

describe('notification deduplication', () => {
  it('records an event once per event key, no matter how often it is emitted', async () => {
    const input = {
      userId,
      kind: 'blackboard_new_item' as const,
      eventKey: 'bb:new:acct:item-1',
      title: 'Problem Set 3',
      deepLink: '/tasks/abc',
    };
    const first = await emitNotification(input);
    const second = await emitNotification(input);
    const third = await emitNotification(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second).toMatchObject({ reason: 'duplicate', eventId: first.eventId });

    const instance = await db();
    const rows = await instance.select().from(notificationEvents).where(eq(notificationEvents.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('delivers to each device exactly once even if the job is retried', async () => {
    const sent = recordingProvider();
    await addDevice('https://push.example.com/a');
    await addDevice('https://push.example.com/b');

    const emitted = await emitNotification({
      userId,
      kind: 'announcement',
      eventKey: 'ann:1',
      title: 'Quiz coverage',
      deepLink: '/announcements/1',
      courseId,
    });

    await deliverNotification(emitted.eventId);
    await deliverNotification(emitted.eventId); // retry
    await deliverNotification(emitted.eventId); // and again

    expect(sent).toHaveLength(2);
    const instance = await db();
    const deliveries = await instance
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.eventId, emitted.eventId));
    expect(deliveries.filter((d) => d.channel === 'web_push')).toHaveLength(2);
    expect(deliveries.filter((d) => d.channel === 'in_app')).toHaveLength(1);
  });

  it('deep-links to the exact record', async () => {
    const sent = recordingProvider();
    await addDevice('https://push.example.com/a');
    const emitted = await emitNotification({
      userId,
      kind: 'blackboard_due_changed',
      eventKey: 'bb:due:acct:item-1:2026-09-05',
      title: 'Deadline moved',
      deepLink: '/tasks/task-123',
      entityType: 'task',
      entityId: null,
    });
    await deliverNotification(emitted.eventId);
    expect(sent[0]?.url).toBe('/tasks/task-123');
    expect(sent[0]?.tag).toBe('bb:due:acct:item-1:2026-09-05');
  });
});

describe('preferences', () => {
  it('suppresses a kind the user turned off, but still records it in-app', async () => {
    const instance = await db();
    await instance
      .update(userPreferences)
      .set({ notificationKinds: { announcement: false } })
      .where(eq(userPreferences.userId, userId));

    const result = await emitNotification({
      userId,
      kind: 'announcement',
      eventKey: 'ann:2',
      title: 'Muted kind',
      deepLink: '/announcements/2',
    });

    expect(result).toMatchObject({ created: true, suppressed: true, reason: 'preference' });
    expect(await unreadNotificationCount(userId)).toBe(1);
    const deliveries = await instance
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.eventId, result.eventId));
    expect(deliveries[0]?.state).toBe('suppressed_preference');
  });

  it('respects a per-course mute', async () => {
    const instance = await db();
    await instance
      .update(userPreferences)
      .set({ courseNotificationOptOut: { [courseId]: true } })
      .where(eq(userPreferences.userId, userId));

    const muted = await emitNotification({
      userId,
      kind: 'blackboard_new_item',
      eventKey: 'bb:new:muted',
      title: 'From a muted course',
      deepLink: '/tasks/x',
      courseId,
    });
    expect(muted).toMatchObject({ suppressed: true, reason: 'course_opt_out' });

    const other = await emitNotification({
      userId,
      kind: 'blackboard_new_item',
      eventKey: 'bb:new:unmuted',
      title: 'From another course',
      deepLink: '/tasks/y',
      courseId: null,
    });
    expect(other).toMatchObject({ suppressed: false });
  });
});

describe('quiet hours', () => {
  it('defers delivery to the end of the window instead of dropping it', async () => {
    const instance = await db();
    await instance
      .update(userPreferences)
      .set({ quietHoursEnabled: true, quietHoursStartMinute: 22 * 60, quietHoursEndMinute: 7 * 60 })
      .where(eq(userPreferences.userId, userId));

    // 23:30 Manila.
    const lateNight = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 23, minute: 30 }, MNL);
    vi.setSystemTime(lateNight);

    const sent = recordingProvider();
    await addDevice('https://push.example.com/a');

    const emitted = await emitNotification({
      userId,
      kind: 'blackboard_new_item',
      eventKey: 'bb:new:quiet',
      title: 'Late arrival',
      deepLink: '/tasks/z',
    });
    expect(emitted.created).toBe(true);
    if (emitted.created && !emitted.suppressed) {
      expect(emitted.deferredUntil?.toISOString()).toBe(
        zonedToUtc({ year: 2026, month: 8, day: 27, hour: 7 }, MNL).toISOString(),
      );
    }

    // Delivering during the window does nothing.
    const held = await deliverNotification(emitted.eventId);
    expect(held).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);

    // After the window it goes out.
    vi.setSystemTime(zonedToUtc({ year: 2026, month: 8, day: 27, hour: 7, minute: 5 }, MNL));
    const delivered = await deliverNotification(emitted.eventId);
    expect(delivered.sent).toBe(1);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it('does not defer outside the window', async () => {
    const instance = await db();
    await instance
      .update(userPreferences)
      .set({ quietHoursEnabled: true, quietHoursStartMinute: 22 * 60, quietHoursEndMinute: 7 * 60 })
      .where(eq(userPreferences.userId, userId));
    vi.setSystemTime(zonedToUtc({ year: 2026, month: 8, day: 26, hour: 14 }, MNL));

    const emitted = await emitNotification({
      userId,
      kind: 'reminder',
      eventKey: 'rem:1',
      title: 'Afternoon',
      deepLink: '/tasks/a',
    });
    expect(emitted.created && !emitted.suppressed && emitted.deferredUntil).toBeNull();
    vi.useRealTimers();
  });
});

describe('push availability', () => {
  it('reports failure honestly when push is not configured', async () => {
    __setPushProvider(null); // falls back to the unconfigured provider
    await addDevice('https://push.example.com/a');
    const emitted = await emitNotification({
      userId,
      kind: 'announcement',
      eventKey: 'ann:3',
      title: 'No push here',
      deepLink: '/announcements/3',
    });
    const result = await deliverNotification(emitted.eventId);
    expect(result).toMatchObject({ sent: 0, failed: 1 });

    const instance = await db();
    const deliveries = await instance
      .select()
      .from(notificationDeliveries)
      .where(
        and(eq(notificationDeliveries.eventId, emitted.eventId), eq(notificationDeliveries.channel, 'web_push')),
      );
    expect(deliveries[0]?.state).toBe('failed');
    expect(deliveries[0]?.detail).toMatch(/not configured/i);
    // The in-app record still exists, so nothing is silently lost.
    expect(await unreadNotificationCount(userId)).toBe(1);
  });

  it('prunes a subscription the push service says is gone', async () => {
    recordingProvider((endpoint) =>
      endpoint.endsWith('/dead') ? { ok: false, gone: true, detail: 'gone' } : { ok: true },
    );
    const dead = await addDevice('https://push.example.com/dead');
    await addDevice('https://push.example.com/live');

    const emitted = await emitNotification({
      userId,
      kind: 'reminder',
      eventKey: 'rem:2',
      title: 'Ping',
      deepLink: '/tasks/b',
    });
    const result = await deliverNotification(emitted.eventId);
    expect(result).toMatchObject({ sent: 1, failed: 1 });

    const instance = await db();
    const rows = await instance.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, dead.id));
    expect(rows[0]?.expiredAt).not.toBeNull();
  });
});

describe('notification centre', () => {
  it('marks everything read', async () => {
    for (let i = 0; i < 3; i += 1) {
      await emitNotification({
        userId,
        kind: 'announcement',
        eventKey: `ann:bulk:${i}`,
        title: `Item ${i}`,
        deepLink: '/announcements',
      });
    }
    expect(await unreadNotificationCount(userId)).toBe(3);
    expect(await markNotificationRead(userId, 'all')).toBe(3);
    expect(await unreadNotificationCount(userId)).toBe(0);
  });
});
