import { and, eq } from 'drizzle-orm';
import { getDb, type Database } from '../../db';
import { announcements, courses, externalRecords, syncCursors } from '../../db/schema';
import { emitNotification } from '../../notifications/engine';
import { contentHash } from '../../security/crypto';
import { redactError, safeUrlHint } from '../../security/redact';
import { safeFetch, UnsafeUrlError, type SafeFetchResult } from '../../security/ssrf';
import { parseIcs, type IcsEvent } from '../../shared/ics';
import { DEFAULT_TIME_ZONE, formatDateTime } from '../../shared/time';
import { assertServerOnly } from '../../server-guard';
import {
  applyIncomingTask,
  finishRun,
  markMissing,
  startRun,
  type SyncContext,
} from '../../sync/engine';
import { canonicalCode, extractCourseCode } from '../../sync/normalize';
import type { NormalizedItem, SyncSummary } from '../../sync/types';
import { getAccount, readSecret, setAccountStatus } from '../integrations';

assertServerOnly('lib/connectors/blackboard');

/**
 * Blackboard ingestion.
 *
 * Three intake shapes, in order of preference:
 *   1. the student's private iCalendar feed (implemented here — works at every
 *      institution that exposes one, needs no administrator);
 *   2. the official Blackboard REST APIs (adapter defined in `api.ts`, inert
 *      until an institution provisions credentials);
 *   3. authorised email ingestion for announcements (adapter in `email.ts`).
 *
 * There is deliberately no HTML scraping path: it breaks on every theme change
 * and would need the student's password.
 */

export type BlackboardFetcher = (url: string, opts: { etag?: string | null; lastModified?: string | null }) => Promise<SafeFetchResult>;

const defaultFetcher: BlackboardFetcher = (url, opts) =>
  safeFetch(url, { etag: opts.etag ?? null, lastModified: opts.lastModified ?? null });

/* -------------------------------------------------------------------------- */
/* Normalization                                                               */
/* -------------------------------------------------------------------------- */

export function normalizeIcsEvent(event: IcsEvent, accountId: string): NormalizedItem {
  const { code, title } = extractCourseCode(event.summary, event.categories);
  // A feed without UIDs still needs a stable identity, so derive one from the
  // content that does not change between polls. The fallback matcher in the
  // engine handles the case where even that shifts.
  const externalId =
    event.uid ??
    `derived:${contentHash({ accountId, title, code, due: event.dueAt?.toISOString() ?? null }).slice(0, 32)}`;

  return {
    externalId,
    entityType: 'task',
    title: title || event.summary || 'Untitled item',
    description: event.description,
    courseCode: code ? canonicalCode(code) : null,
    dueAt: event.dueAt,
    allDay: event.allDay,
    timeZone: event.timeZone,
    sourceUrl: event.url,
    sourceUpdatedAt: event.lastModified ?? event.created ?? null,
    payload: {
      summary: event.summary,
      location: event.location,
      categories: event.categories,
      sequence: event.sequence,
      status: event.status,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

export type SyncOptions = {
  trigger?: 'schedule' | 'manual' | 'connect' | 'import';
  fetcher?: BlackboardFetcher;
  now?: Date;
  /** Bypasses the network: used by `importIcsText` and by the demo feed. */
  icsText?: string;
  notify?: boolean;
};

export async function syncBlackboardAccount(
  userId: string,
  accountId: string,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const db = await getDb();
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? 'schedule';
  const account = await getAccount(userId, accountId);
  if (!account) throw new Error('Integration account not found');

  const timeZone = ((account.config as Record<string, unknown>).timeZone as string) ?? DEFAULT_TIME_ZONE;

  // The idempotency key pins a run to one polling window, so a retry after a
  // crash resumes the same run instead of creating a second one.
  const windowMs = trigger === 'schedule' ? 15 * 60_000 : 1;
  const idempotencyKey = `bb:${accountId}:${trigger}:${Math.floor(now.getTime() / windowMs)}`;
  const { runId, alreadyRan } = await startRun({
    db,
    userId,
    accountId,
    direction: 'pull',
    trigger,
    idempotencyKey,
  });

  const summary: SyncSummary = {
    runId,
    seen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    missing: 0,
    warnings: alreadyRan ? ['a run with this idempotency key already exists; results were reused'] : [],
  };

  let feedUrl: string | null = null;
  try {
    let text = options.icsText ?? null;
    let etag: string | null = null;
    let lastModified: string | null = null;

    if (text === null) {
      feedUrl = await readSecret(accountId, 'ics_url', db);
      if (!feedUrl) throw new Error('No feed is configured for this account');

      const cursor = await db
        .select()
        .from(syncCursors)
        .where(and(eq(syncCursors.accountId, accountId), eq(syncCursors.name, 'ics')))
        .limit(1);

      const fetcher = options.fetcher ?? defaultFetcher;
      const response = await fetcher(feedUrl, {
        etag: cursor[0]?.etag ?? null,
        lastModified: cursor[0]?.lastModified ?? null,
      });

      if (response.status === 304) {
        await finishRun(db, runId, 'succeeded', { seen: 0, created: 0, updated: 0, skipped: 0, conflicts: 0 });
        await setAccountStatus(accountId, 'connected', null, db);
        summary.warnings.push('feed unchanged since the last sync');
        return summary;
      }
      if (response.status !== 200) throw new Error(`Feed responded with HTTP ${response.status}`);

      text = response.body;
      etag = response.headers['etag'] ?? null;
      lastModified = response.headers['last-modified'] ?? null;
    }

    const parsed = parseIcs(text);
    summary.warnings.push(...parsed.warnings);

    // Work out up-front which stored records this payload does not mention, so
    // an item whose UID was regenerated can be re-matched inside the same run
    // rather than surfacing as a duplicate plus an orphan.
    const incomingIds = new Set(parsed.events.map((event) => normalizeIcsEvent(event, accountId).externalId));
    const stored = await db
      .select({ id: externalRecords.id, externalId: externalRecords.externalId })
      .from(externalRecords)
      .where(and(eq(externalRecords.accountId, accountId), eq(externalRecords.entityType, 'task')));
    const orphanRecordIds = new Set(
      stored.filter((row) => !incomingIds.has(row.externalId)).map((row) => row.id),
    );

    const ctx: SyncContext = {
      db,
      userId,
      accountId,
      provider: 'blackboard_ics',
      runId,
      timeZone,
      now,
      orphanRecordIds,
    };

    const seenIds: string[] = [];
    for (const event of parsed.events) {
      const item = normalizeIcsEvent(event, accountId);
      seenIds.push(item.externalId);
      summary.seen += 1;

      const outcome = await applyIncomingTask(ctx, item);
      if (outcome.action === 'created' || outcome.action === 'needs_review') summary.created += 1;
      else if (outcome.action === 'updated') summary.updated += 1;
      else if (outcome.action === 'conflict') summary.conflicts += outcome.conflicts.length;
      else summary.skipped += 1;

      if (options.notify !== false && outcome.notify && outcome.entityId) {
        await notifyForOutcome(userId, outcome, item, accountId, timeZone, db);
      }
    }

    summary.missing = await markMissing(ctx, seenIds);

    if (etag || lastModified) {
      await db
        .insert(syncCursors)
        .values({ accountId, name: 'ics', etag, lastModified, value: null })
        .onConflictDoUpdate({
          target: [syncCursors.accountId, syncCursors.name],
          set: { etag, lastModified, updatedAt: new Date() },
        });
    }

    await finishRun(db, runId, summary.conflicts ? 'partial' : 'succeeded', summary);
    await setAccountStatus(accountId, 'connected', null, db);
    return summary;
  } catch (err) {
    // The feed URL is a credential. It must not reach the run record, the
    // account error, the logs or the notification.
    const message = redactError(err, feedUrl ? [feedUrl] : []);
    await finishRun(db, runId, 'failed', summary, message);
    await setAccountStatus(accountId, 'error', message, db);

    if (options.notify !== false) {
      await emitNotification(
        {
          userId,
          kind: 'sync_failure',
          // Rate-limited by construction: one event per account per hour.
          eventKey: `sync:fail:${accountId}:${Math.floor(now.getTime() / 3_600_000)}`,
          title: 'Blackboard sync needs attention',
          body: message.slice(0, 200),
          deepLink: '/settings/integrations',
        },
        db,
      );
    }
    if (err instanceof UnsafeUrlError) throw err;
    throw new Error(message);
  }
}

async function notifyForOutcome(
  userId: string,
  outcome: Awaited<ReturnType<typeof applyIncomingTask>>,
  item: NormalizedItem,
  accountId: string,
  timeZone: string,
  db: Database,
): Promise<void> {
  if (!outcome.notify || !outcome.entityId) return;
  const courseId = await courseIdForCode(db, userId, item.courseCode);

  if (outcome.notify.kind === 'new') {
    await emitNotification(
      {
        userId,
        kind: 'blackboard_new_item',
        eventKey: `bb:new:${accountId}:${item.externalId}`,
        title: item.courseCode ? `${item.courseCode}: ${item.title}` : item.title,
        body: item.dueAt ? `Due ${formatDateTime(item.dueAt, { timeZone })}` : 'No deadline given',
        deepLink: `/tasks/${outcome.entityId}`,
        courseId,
        entityType: 'task',
        entityId: outcome.entityId,
      },
      db,
    );
    return;
  }

  const to = outcome.notify.to ?? null;
  await emitNotification(
    {
      userId,
      kind: 'blackboard_due_changed',
      // Keyed by the *new* deadline: one notification per distinct change, and a
      // repeated sync of the same change cannot notify twice.
      eventKey: `bb:due:${accountId}:${item.externalId}:${to?.toISOString() ?? 'none'}`,
      title: `Deadline moved: ${item.title}`,
      body: to ? `Now due ${formatDateTime(to, { timeZone })}` : 'The deadline was removed',
      deepLink: `/tasks/${outcome.entityId}`,
      courseId,
      entityType: 'task',
      entityId: outcome.entityId,
    },
    db,
  );
}

async function courseIdForCode(db: Database, userId: string, code: string | null): Promise<string | null> {
  if (!code) return null;
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.userId, userId), eq(courses.code, code)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Manual import                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Import a `.ics` file the student uploaded. Runs the identical pipeline, so an
 * imported file dedups against the same external records a live feed produces.
 */
export async function importIcsText(
  userId: string,
  accountId: string,
  text: string,
  options: { now?: Date; notify?: boolean } = {},
): Promise<SyncSummary> {
  return syncBlackboardAccount(userId, accountId, {
    trigger: 'import',
    icsText: text,
    now: options.now,
    notify: options.notify ?? false,
  });
}

/* -------------------------------------------------------------------------- */
/* Announcements                                                               */
/* -------------------------------------------------------------------------- */

export type NormalizedAnnouncement = {
  externalId: string;
  title: string;
  body: string;
  courseCode: string | null;
  author: string | null;
  publishedAt: Date;
  sourceUrl: string | null;
};

/**
 * Announcement intake is provider-shaped: ICS feeds do not carry announcements,
 * so this is called by the API and email adapters. It is written once here so
 * every intake path gets the same dedup and notification behaviour.
 */
export async function ingestAnnouncements(
  userId: string,
  accountId: string,
  items: NormalizedAnnouncement[],
  options: { now?: Date; notify?: boolean } = {},
): Promise<{ created: number; updated: number; skipped: number }> {
  const db = await getDb();
  const now = options.now ?? new Date();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const hash = contentHash({ title: item.title, body: item.body, publishedAt: item.publishedAt.toISOString() });
    const existing = await db
      .select()
      .from(externalRecords)
      .where(and(eq(externalRecords.accountId, accountId), eq(externalRecords.externalId, item.externalId)))
      .limit(1);

    const courseId = await courseIdForCode(db, userId, item.courseCode);
    const excerpt = item.body.replace(/\s+/g, ' ').trim().slice(0, 280);

    if (!existing[0]) {
      const [row] = await db
        .insert(announcements)
        .values({
          userId,
          courseId,
          title: item.title,
          bodyExcerpt: excerpt,
          bodyFull: item.body.slice(0, 50_000),
          author: item.author,
          publishedAt: item.publishedAt,
          sourceUrl: item.sourceUrl,
          source: 'blackboard',
          contentHash: hash,
        })
        .returning();
      await db.insert(externalRecords).values({
        userId,
        accountId,
        provider: 'blackboard_api',
        externalId: item.externalId,
        entityType: 'announcement',
        entityId: row!.id,
        courseCode: item.courseCode,
        normalizedTitle: item.title.toLowerCase(),
        sourceUrl: item.sourceUrl,
        contentHash: hash,
        syncedFieldHash: hash,
        lastSeenAt: now,
        payload: {},
      });
      created += 1;
      if (options.notify !== false) {
        await emitNotification(
          {
            userId,
            kind: 'announcement',
            eventKey: `bb:ann:${accountId}:${item.externalId}`,
            title: item.courseCode ? `${item.courseCode}: ${item.title}` : item.title,
            body: excerpt.slice(0, 160),
            deepLink: `/announcements/${row!.id}`,
            courseId,
            entityType: 'announcement',
            entityId: row!.id,
          },
          db,
        );
      }
      continue;
    }

    if (existing[0].contentHash === hash) {
      await db
        .update(externalRecords)
        .set({ lastSeenAt: now, missingSinceAt: null })
        .where(eq(externalRecords.id, existing[0].id));
      skipped += 1;
      continue;
    }

    if (existing[0].entityId) {
      await db
        .update(announcements)
        .set({
          title: item.title,
          bodyExcerpt: excerpt,
          bodyFull: item.body.slice(0, 50_000),
          publishedAt: item.publishedAt,
          contentHash: hash,
          updatedAt: now,
        })
        .where(eq(announcements.id, existing[0].entityId));
    }
    await db
      .update(externalRecords)
      .set({ contentHash: hash, syncedFieldHash: hash, lastSeenAt: now, missingSinceAt: null })
      .where(eq(externalRecords.id, existing[0].id));
    updated += 1;

    if (options.notify !== false && existing[0].entityId) {
      await emitNotification(
        {
          userId,
          kind: 'announcement',
          // A meaningful edit notifies once, keyed by the new content hash.
          eventKey: `bb:ann:${accountId}:${item.externalId}:${hash.slice(0, 16)}`,
          title: `Updated: ${item.title}`,
          body: excerpt.slice(0, 160),
          deepLink: `/announcements/${existing[0].entityId}`,
          courseId,
          entityType: 'announcement',
          entityId: existing[0].entityId,
        },
        db,
      );
    }
  }

  return { created, updated, skipped };
}

export { safeUrlHint };
