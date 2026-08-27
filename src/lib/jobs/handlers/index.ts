import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { integrationAccounts, notificationEvents, reminders, tasks, userPreferences, users } from '../../db/schema';
import { syncBlackboardAccount } from '../../connectors/blackboard';
import { syncNotionAccount } from '../../connectors/notion/sync';
import { deliverNotification, emitNotification, groupBurst } from '../../notifications/engine';
import { pruneRateLimits } from '../../security/ratelimit';
import { formatDateTime, isoDateIn, minutesSinceMidnightIn, startOfDayIn } from '../../shared/time';
import { assertServerOnly } from '../../server-guard';
import { enqueue, type JobKind, type JobRow } from '../queue';

assertServerOnly('lib/jobs/handlers');

export type JobHandler = (job: JobRow) => Promise<void>;

/**
 * Job handlers.
 *
 * Each one is written to be safe to run twice: the sync engine dedups by
 * external id, notification delivery dedups by (event, channel, device), and
 * reminder firing is guarded by `last_fired_at`. That is what lets the queue
 * retry aggressively without a second thought.
 */
export const HANDLERS: Record<JobKind, JobHandler> = {
  'blackboard.sync': async (job) => {
    const { accountId } = job.payload as { accountId: string };
    if (!job.userId) return;
    await syncBlackboardAccount(job.userId, accountId, { trigger: 'schedule' });
    // Re-arm the next poll. The lock key keeps one account's syncs serialised.
    await enqueue(
      'blackboard.sync',
      { accountId },
      {
        userId: job.userId,
        runAt: new Date(Date.now() + pollIntervalMs()),
        lockKey: `bb:${accountId}`,
        idempotencyKey: `bb:poll:${accountId}:${Math.floor(Date.now() / pollIntervalMs()) + 1}`,
      },
    );
    await groupBurst(job.userId);
  },

  'blackboard.announcements': async (job) => {
    // Intake for announcements is provider-specific and inert until an
    // institution provisions API access; the job exists so the schedule and the
    // audit trail are already in place when it does.
    void job;
  },

  'notion.pull': async (job) => {
    const { accountId, pullOnly } = job.payload as { accountId: string; pullOnly?: boolean };
    if (!job.userId) return;
    await syncNotionAccount(job.userId, accountId, { trigger: 'schedule', pullOnly: pullOnly === true });
  },

  'notion.push': async (job) => {
    const { accountId } = job.payload as { accountId: string; taskId: string };
    if (!job.userId) return;
    await syncNotionAccount(job.userId, accountId, { trigger: 'manual' });
  },

  'notion.reconcile': async (job) => {
    const { accountId } = job.payload as { accountId: string };
    if (!job.userId) return;
    await syncNotionAccount(job.userId, accountId, { trigger: 'schedule' });
    await enqueue(
      'notion.reconcile',
      { accountId },
      {
        userId: job.userId,
        runAt: new Date(Date.now() + 15 * 60_000),
        lockKey: `notion:${accountId}`,
        idempotencyKey: `notion:poll:${accountId}:${Math.floor(Date.now() / (15 * 60_000)) + 1}`,
      },
    );
  },

  'notifications.deliver': async (job) => {
    const { eventId } = job.payload as { eventId: string };
    await deliverNotification(eventId);
  },

  /**
   * Fire due reminders.
   *
   * A reminder is due when its computed instant has passed and it has not fired
   * since. Snoozes are absolute (`fire_at`) and take precedence over the offset,
   * which is how snoozing avoids touching the academic deadline.
   */
  'notifications.scan_reminders': async () => {
    const db = await getDb();
    const now = new Date();

    const due = await db
      .select({
        reminder: reminders,
        task: tasks,
        timeZone: users.timeZone,
      })
      .from(reminders)
      .innerJoin(tasks, eq(tasks.id, reminders.taskId))
      .innerJoin(users, eq(users.id, reminders.userId))
      .where(
        and(
          eq(reminders.enabled, true),
          sql`${tasks.status} not in ('done','submitted','archived')`,
          or(
            and(sql`${reminders.fireAt} is not null`, lte(reminders.fireAt, now)),
            and(
              isNull(reminders.fireAt),
              sql`${tasks.dueAt} is not null`,
              sql`${tasks.dueAt} - make_interval(mins => ${reminders.offsetMinutes}) <= ${now}`,
              sql`${tasks.dueAt} > ${now}`,
            ),
          ),
          or(
            isNull(reminders.lastFiredAt),
            sql`${reminders.lastFiredAt} < ${tasks.updatedAt}`,
          ),
        ),
      )
      .limit(200);

    for (const row of due) {
      const emitted = await emitNotification({
        userId: row.reminder.userId,
        kind: 'reminder',
        // Keyed to the deadline instant: moving the deadline produces a new
        // reminder, re-running the scan does not.
        eventKey: `reminder:${row.reminder.id}:${row.task.dueAt?.toISOString() ?? 'none'}`,
        title: row.task.title,
        body: row.task.dueAt
          ? `Due ${formatDateTime(row.task.dueAt, { timeZone: row.timeZone })}`
          : 'Reminder',
        deepLink: `/tasks/${row.task.id}`,
        courseId: row.task.courseId,
        entityType: 'task',
        entityId: row.task.id,
      });
      if (emitted.created) {
        await db.update(reminders).set({ lastFiredAt: now }).where(eq(reminders.id, row.reminder.id));
      }
    }
  },

  /** One digest per user per local day, at their configured minute. */
  'notifications.digest': async () => {
    const db = await getDb();
    const now = new Date();

    const candidates = await db
      .select({
        userId: users.id,
        timeZone: users.timeZone,
        minute: userPreferences.dailyDigestMinute,
      })
      .from(userPreferences)
      .innerJoin(users, eq(users.id, userPreferences.userId))
      .where(eq(userPreferences.dailyDigestEnabled, true));

    for (const candidate of candidates) {
      const localMinute = minutesSinceMidnightIn(now, candidate.timeZone);
      // A 15-minute window: the scheduler runs every five minutes, so this
      // fires once and the event key prevents a second.
      if (localMinute < candidate.minute || localMinute > candidate.minute + 15) continue;

      const dayStart = startOfDayIn(now, candidate.timeZone);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const rows = await db
        .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, candidate.userId),
            sql`${tasks.dueAt} >= ${dayStart}`,
            sql`${tasks.dueAt} < ${dayEnd}`,
            sql`${tasks.status} not in ('done','submitted','archived')`,
          ),
        )
        .limit(10);

      if (!rows.length) continue;
      await emitNotification({
        userId: candidate.userId,
        kind: 'daily_digest',
        eventKey: `digest:${candidate.userId}:${isoDateIn(now, candidate.timeZone)}`,
        title: `${rows.length} due today`,
        body: rows.slice(0, 4).map((r) => r.title).join(' · '),
        deepLink: '/today',
      });
    }
  },

  'maintenance.prune': async () => {
    const db = await getDb();
    await pruneRateLimits();
    // Notification history is kept for 120 days: long enough to answer "did I
    // get told about this?", short enough not to grow without bound.
    await db
      .delete(notificationEvents)
      .where(sql`${notificationEvents.createdAt} < ${new Date(Date.now() - 120 * 86_400_000)}`);
  },

  'maintenance.rotate_secrets': async () => {
    // Re-encrypting under the active key happens lazily on read; this job is
    // the scheduled sweep that catches secrets nothing has read recently.
    const db = await getDb();
    const accounts = await db.select({ id: integrationAccounts.id }).from(integrationAccounts);
    const { readSecret } = await import('../../connectors/integrations');
    for (const account of accounts) {
      await readSecret(account.id, 'ics_url').catch(() => null);
      await readSecret(account.id, 'access_token').catch(() => null);
    }
  },
};

function pollIntervalMs(): number {
  return Number(process.env.BLACKBOARD_POLL_INTERVAL_MS ?? 15 * 60_000);
}
