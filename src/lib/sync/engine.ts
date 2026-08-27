import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db';
import { externalRecords, syncChanges, syncConflicts, syncRuns, tasks } from '../db/schema';
import { recordAudit } from '../domain/audit';
import { findCourseByCode } from '../domain/courses';
import { derivePriority } from '../domain/priority';
import { inferTaskType } from '../domain/task-type';
import { contentHash } from '../security/crypto';
import { DEFAULT_TIME_ZONE } from '../shared/time';
import { assertServerOnly } from '../server-guard';
import { normalizeTitle } from './normalize';
import type { FieldChange, ItemOutcome, NormalizedItem } from './types';

assertServerOnly('lib/sync/engine');

/**
 * The sync engine.
 *
 * Three invariants hold for every provider:
 *
 *  1. **Idempotent.** Re-running a sync over unchanged input performs no writes
 *     and emits no notifications. Identity is (account, external id); change
 *     detection is a content hash of the source-controlled fields.
 *
 *  2. **User fields are sacred.** A connector may write only
 *     `SOURCE_FIELDS`. Status, priority, type, notes, tags and reminders belong
 *     to the student and are never touched — which is what makes "Blackboard
 *     cannot un-submit your work" a structural property rather than a promise.
 *
 *  3. **Nothing disappears.** An item that stops appearing upstream is *marked*
 *     missing and surfaced for review. Deletion is only ever a user action.
 */

/** The only fields a one-way connector may own. */
export const SOURCE_FIELDS = ['title', 'description', 'dueAt', 'sourceUrl'] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];

export type SyncContext = {
  db: Database;
  userId: string;
  accountId: string;
  provider: 'blackboard_ics' | 'blackboard_api' | 'blackboard_email' | 'notion';
  runId: string;
  timeZone: string;
  now: Date;
  /** When false, source-controlled fields never overwrite a diverged local value. */
  allowOverwriteDivergedFields?: boolean;
  /**
   * External record ids that this run's payload did not mention. A provider that
   * regenerates UIDs drops the old id and introduces the new one in the *same*
   * poll, so the fallback matcher needs to know which records are orphaned by
   * this run — not only which ones a previous run already flagged.
   */
  orphanRecordIds?: Set<string>;
};

export function sourceContentHash(item: NormalizedItem): string {
  return contentHash({
    title: item.title,
    description: item.description,
    dueAt: item.dueAt?.toISOString() ?? null,
    sourceUrl: item.sourceUrl,
    courseCode: item.courseCode,
  });
}

type ExternalRecordRow = typeof externalRecords.$inferSelect;
type LastApplied = Partial<Record<SourceField, unknown>>;

function lastApplied(record: ExternalRecordRow): LastApplied {
  const payload = record.payload as { lastApplied?: LastApplied } | null;
  return payload?.lastApplied ?? {};
}

/* ---------------------------------------------------------------------------
   Identity
--------------------------------------------------------------------------- */

/**
 * Resolve a provider item to an existing external record.
 *
 * Primary: exact (account, external id).
 * Fallback (only when the primary misses): a *unique* match on normalized
 * title + course code + due instant among records that are currently missing
 * upstream — i.e. the same item whose UID was regenerated. If more than one
 * candidate matches, nothing is merged: the item is created fresh and flagged
 * for review, because a wrong merge silently destroys a student's notes.
 */
export async function resolveExternalRecord(
  ctx: SyncContext,
  item: NormalizedItem,
): Promise<{ record: ExternalRecordRow | null; rekeyedFrom?: string; ambiguous?: boolean }> {
  const exact = await ctx.db
    .select()
    .from(externalRecords)
    .where(and(eq(externalRecords.accountId, ctx.accountId), eq(externalRecords.externalId, item.externalId)))
    .limit(1);
  if (exact[0]) return { record: exact[0] };

  const normalized = normalizeTitle(item.title, item.courseCode);
  if (!normalized || !item.dueAt) return { record: null };

  const rows = await ctx.db
    .select()
    .from(externalRecords)
    .where(
      and(
        eq(externalRecords.accountId, ctx.accountId),
        eq(externalRecords.entityType, item.entityType),
        eq(externalRecords.normalizedTitle, normalized),
        item.courseCode
          ? eq(externalRecords.courseCode, item.courseCode)
          : isNull(externalRecords.courseCode),
        eq(externalRecords.dueAt, item.dueAt),
      ),
    )
    .limit(10);

  // Only records the provider has stopped publishing are eligible: an item that
  // is still live under its own id must never be stolen by a look-alike.
  const candidates = rows.filter(
    (row) => row.missingSinceAt !== null || ctx.orphanRecordIds?.has(row.id) === true,
  );

  if (candidates.length === 1) return { record: candidates[0]!, rekeyedFrom: candidates[0]!.externalId };
  if (candidates.length > 1) return { record: null, ambiguous: true };
  return { record: null };
}

/* ---------------------------------------------------------------------------
   Apply
--------------------------------------------------------------------------- */

export type ApplyTaskResult = ItemOutcome & { notify: null | { kind: 'new' | 'due_changed'; from?: Date | null; to?: Date | null } };

export async function applyIncomingTask(ctx: SyncContext, item: NormalizedItem): Promise<ApplyTaskResult> {
  const hash = sourceContentHash(item);
  const resolved = await resolveExternalRecord(ctx, item);
  const course = item.courseCode ? await findCourseByCode(ctx.userId, item.courseCode) : null;

  /* ---------------------------- create path ---------------------------- */
  if (!resolved.record) {
    const inferred = inferTaskType(item.title, item.description);
    const [task] = await ctx.db
      .insert(tasks)
      .values({
        userId: ctx.userId,
        courseId: course?.id ?? null,
        title: item.title,
        description: item.description,
        // Imported work always lands in Inbox, never pre-marked as submitted.
        status: 'inbox',
        type: inferred.type,
        priority: derivePriority(item.dueAt, ctx.now, ctx.timeZone),
        dueAt: item.dueAt,
        dueTimeZone: item.timeZone ?? ctx.timeZone,
        allDay: item.allDay,
        sourceUrl: item.sourceUrl,
        source: ctx.provider.startsWith('blackboard') ? 'blackboard' : 'notion',
        lastWriteOrigin: ctx.provider,
      })
      .returning();

    const [record] = await ctx.db
      .insert(externalRecords)
      .values({
        userId: ctx.userId,
        accountId: ctx.accountId,
        provider: ctx.provider,
        externalId: item.externalId,
        entityType: 'task',
        entityId: task!.id,
        courseCode: item.courseCode,
        normalizedTitle: normalizeTitle(item.title, item.courseCode),
        dueAt: item.dueAt,
        sourceUrl: item.sourceUrl,
        sourceUpdatedAt: item.sourceUpdatedAt,
        contentHash: hash,
        syncedFieldHash: hash,
        localRevision: task!.revision,
        lastSeenAt: ctx.now,
        reviewReason: resolved.ambiguous ? 'ambiguous_title_match' : null,
        payload: { ...item.payload, lastApplied: snapshot(item) },
      })
      .returning();

    await logChange(ctx, {
      entityType: 'task',
      entityId: task!.id,
      externalRecordId: record!.id,
      action: resolved.ambiguous ? 'needs_review' : 'created',
      reason: resolved.ambiguous
        ? 'more than one existing item matched by title; created separately for review'
        : 'new upstream item',
    });
    await recordAudit(
      {
        userId: ctx.userId,
        actor: `sync:${ctx.provider}`,
        action: 'task.created',
        entityType: 'task',
        entityId: task!.id,
        detail: { externalId: item.externalId, courseCode: item.courseCode, runId: ctx.runId },
      },
      ctx.db,
    );

    return {
      action: resolved.ambiguous ? 'needs_review' : 'created',
      entityId: task!.id,
      externalRecordId: record!.id,
      changes: [],
      conflicts: [],
      notify: { kind: 'new' },
    };
  }

  /* ---------------------------- update path ---------------------------- */
  const record = resolved.record;

  // Always refresh liveness, even when nothing else changed: this is what
  // clears a stale "missing upstream" flag.
  await ctx.db
    .update(externalRecords)
    .set({
      lastSeenAt: ctx.now,
      missingSinceAt: null,
      ...(resolved.rekeyedFrom ? { externalId: item.externalId } : {}),
    })
    .where(eq(externalRecords.id, record.id));

  if (record.contentHash === hash && !resolved.rekeyedFrom) {
    return {
      action: 'skipped',
      entityId: record.entityId,
      externalRecordId: record.id,
      changes: [],
      conflicts: [],
      notify: null,
    };
  }

  const taskRows = record.entityId
    ? await ctx.db.select().from(tasks).where(eq(tasks.id, record.entityId)).limit(1)
    : [];
  const task = taskRows[0];
  if (!task) {
    // The local row was deleted by the student. Do not resurrect it; record the
    // new hash so the item stops being re-reported on every run.
    await ctx.db
      .update(externalRecords)
      .set({ contentHash: hash, reviewReason: 'local_entity_deleted' })
      .where(eq(externalRecords.id, record.id));
    return {
      action: 'skipped',
      entityId: null,
      externalRecordId: record.id,
      changes: [],
      conflicts: [],
      notify: null,
    };
  }

  const base = lastApplied(record);
  const changes: FieldChange[] = [];
  const conflicts: FieldChange[] = [];
  const patch: Record<string, unknown> = {};
  let dueChangedFrom: Date | null = null;

  const consider = (field: SourceField, incoming: unknown, local: unknown): void => {
    const baseValue = base[field] ?? null;
    const same = (a: unknown, b: unknown): boolean => {
      if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
      if (a instanceof Date || b instanceof Date) {
        return dateish(a) === dateish(b);
      }
      return (a ?? null) === (b ?? null);
    };
    if (same(incoming, baseValue)) return; // upstream did not change this field

    if (!same(local, baseValue) && !ctx.allowOverwriteDivergedFields) {
      // Both sides moved. Keep the student's text and raise a reviewable
      // conflict rather than silently overwriting their edit.
      conflicts.push({ field, from: local, to: incoming, reason: 'both sides changed since last sync' });
      return;
    }
    patch[field] = incoming;
    changes.push({ field, from: local, to: incoming });
    if (field === 'dueAt') dueChangedFrom = (local as Date | null) ?? null;
  };

  consider('title', item.title, task.title);
  consider('description', item.description, task.description);
  consider('dueAt', item.dueAt, task.dueAt);
  consider('sourceUrl', item.sourceUrl, task.sourceUrl);

  // Course linkage follows the feed only while the task has none.
  if (course && !task.courseId) {
    patch.courseId = course.id;
    changes.push({ field: 'courseId', from: null, to: course.id, reason: 'matched by course code' });
  }

  // Priority tracks the deadline unless the student pinned it.
  if ('dueAt' in patch && !task.priorityOverridden) {
    const next = derivePriority(patch.dueAt as Date | null, ctx.now, task.dueTimeZone);
    if (next !== task.priority) {
      patch.priority = next;
      changes.push({ field: 'priority', from: task.priority, to: next, reason: 'recomputed from new deadline' });
    }
  }
  // Type refines only while unpinned.
  if ('title' in patch && !task.typeOverridden) {
    const next = inferTaskType(patch.title as string, task.description).type;
    if (next !== task.type) {
      patch.type = next;
      changes.push({ field: 'type', from: task.type, to: next, reason: 'inferred from new title' });
    }
  }

  if (Object.keys(patch).length) {
    await ctx.db
      .update(tasks)
      .set({
        ...patch,
        revision: task.revision + 1,
        lastWriteOrigin: ctx.provider,
        updatedAt: ctx.now,
      })
      .where(eq(tasks.id, task.id));
  }

  for (const conflict of conflicts) {
    await raiseConflict(ctx, record, task.id, conflict, base);
  }

  await ctx.db
    .update(externalRecords)
    .set({
      contentHash: hash,
      // Only fields we actually applied advance the merge base; a conflicted
      // field keeps its old base so the conflict stays visible next run.
      syncedFieldHash: hash,
      normalizedTitle: normalizeTitle(item.title, item.courseCode),
      courseCode: item.courseCode,
      dueAt: item.dueAt,
      sourceUrl: item.sourceUrl,
      sourceUpdatedAt: item.sourceUpdatedAt,
      localRevision: task.revision + (Object.keys(patch).length ? 1 : 0),
      payload: { ...item.payload, lastApplied: { ...base, ...snapshotApplied(item, patch) } },
    })
    .where(eq(externalRecords.id, record.id));

  for (const change of changes) {
    await logChange(ctx, {
      entityType: 'task',
      entityId: task.id,
      externalRecordId: record.id,
      action: 'updated',
      field: change.field,
      oldValue: stringify(change.from),
      newValue: stringify(change.to),
      reason: change.reason ?? 'upstream change',
    });
  }
  if (resolved.rekeyedFrom) {
    await logChange(ctx, {
      entityType: 'task',
      entityId: task.id,
      externalRecordId: record.id,
      action: 'rekeyed',
      oldValue: resolved.rekeyedFrom,
      newValue: item.externalId,
      reason: 'upstream regenerated the item id; matched by title, course and deadline',
    });
  }

  if (changes.length || conflicts.length) {
    await recordAudit(
      {
        userId: ctx.userId,
        actor: `sync:${ctx.provider}`,
        action: 'task.synced',
        entityType: 'task',
        entityId: task.id,
        detail: {
          runId: ctx.runId,
          applied: changes.map((c) => ({ field: c.field, from: stringify(c.from), to: stringify(c.to) })),
          conflicts: conflicts.map((c) => c.field),
        },
      },
      ctx.db,
    );
  }

  const dueChanged = changes.find((c) => c.field === 'dueAt');
  return {
    action: conflicts.length ? 'conflict' : changes.length ? 'updated' : 'skipped',
    entityId: task.id,
    externalRecordId: record.id,
    changes,
    conflicts,
    notify: dueChanged ? { kind: 'due_changed', from: dueChangedFrom, to: dueChanged.to as Date | null } : null,
  };
}

/* ---------------------------------------------------------------------------
   Missing items
--------------------------------------------------------------------------- */

/**
 * Flag records that were not present in this run. Nothing is deleted — the UI
 * shows "no longer in the feed, review" and the student decides.
 */
export async function markMissing(ctx: SyncContext, seenExternalIds: string[]): Promise<number> {
  const seen = new Set(seenExternalIds);
  const all = await ctx.db
    .select()
    .from(externalRecords)
    .where(and(eq(externalRecords.accountId, ctx.accountId), eq(externalRecords.entityType, 'task')));

  let count = 0;
  for (const record of all) {
    if (seen.has(record.externalId)) continue;
    if (record.missingSinceAt) continue;
    await ctx.db
      .update(externalRecords)
      .set({ missingSinceAt: ctx.now, reviewReason: 'not_in_latest_feed' })
      .where(eq(externalRecords.id, record.id));
    await logChange(ctx, {
      entityType: 'task',
      entityId: record.entityId,
      externalRecordId: record.id,
      action: 'missing',
      reason: 'item is no longer published by the provider; kept for review',
    });
    count += 1;
  }
  return count;
}

/* ---------------------------------------------------------------------------
   Bookkeeping
--------------------------------------------------------------------------- */

export async function logChange(
  ctx: SyncContext,
  entry: {
    entityType: string;
    entityId: string | null;
    externalRecordId: string | null;
    action: string;
    field?: string;
    oldValue?: string | null;
    newValue?: string | null;
    reason?: string;
  },
): Promise<void> {
  await ctx.db.insert(syncChanges).values({
    runId: ctx.runId,
    userId: ctx.userId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    externalRecordId: entry.externalRecordId,
    action: entry.action,
    field: entry.field ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    reason: entry.reason ?? null,
  });
}

export async function raiseConflict(
  ctx: SyncContext,
  record: ExternalRecordRow,
  entityId: string,
  change: FieldChange,
  base: LastApplied,
): Promise<void> {
  await ctx.db
    .insert(syncConflicts)
    .values({
      userId: ctx.userId,
      accountId: ctx.accountId,
      externalRecordId: record.id,
      entityType: 'task',
      entityId,
      field: change.field,
      localValue: stringify(change.from),
      remoteValue: stringify(change.to),
      baseValue: stringify(base[change.field as SourceField] ?? null),
      remoteChangedAt: record.sourceUpdatedAt,
      state: 'open',
    })
    // A conflict that is already open for this field stays as it is rather than
    // multiplying on every poll.
    .onConflictDoNothing();

  await logChange(ctx, {
    entityType: 'task',
    entityId,
    externalRecordId: record.id,
    action: 'conflict',
    field: change.field,
    oldValue: stringify(change.from),
    newValue: stringify(change.to),
    reason: change.reason ?? 'both sides changed',
  });
}

export async function startRun(args: {
  db: Database;
  userId: string;
  accountId: string;
  direction: 'pull' | 'push' | 'both';
  trigger: string;
  idempotencyKey: string;
}): Promise<{ runId: string; alreadyRan: boolean }> {
  const inserted = await args.db
    .insert(syncRuns)
    .values({
      userId: args.userId,
      accountId: args.accountId,
      direction: args.direction,
      trigger: args.trigger,
      idempotencyKey: args.idempotencyKey,
      status: 'running',
    })
    .onConflictDoNothing({ target: syncRuns.idempotencyKey })
    .returning({ id: syncRuns.id });

  if (inserted[0]) return { runId: inserted[0].id, alreadyRan: false };

  const existing = await args.db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(eq(syncRuns.idempotencyKey, args.idempotencyKey))
    .limit(1);
  return { runId: existing[0]!.id, alreadyRan: true };
}

export async function finishRun(
  db: Database,
  runId: string,
  status: 'succeeded' | 'partial' | 'failed',
  stats: { seen: number; created: number; updated: number; skipped: number; conflicts: number },
  error?: string | null,
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      status,
      finishedAt: new Date(),
      itemsSeen: stats.seen,
      itemsCreated: stats.created,
      itemsUpdated: stats.updated,
      itemsSkipped: stats.skipped,
      conflicts: stats.conflicts,
      error: error ?? null,
    })
    .where(eq(syncRuns.id, runId));
}

/* ------------------------------- helpers ------------------------------- */

function snapshot(item: NormalizedItem): LastApplied {
  return {
    title: item.title,
    description: item.description,
    dueAt: item.dueAt?.toISOString() ?? null,
    sourceUrl: item.sourceUrl,
  };
}

function snapshotApplied(item: NormalizedItem, patch: Record<string, unknown>): LastApplied {
  const applied: LastApplied = {};
  for (const field of SOURCE_FIELDS) {
    if (field in patch) {
      const value = patch[field];
      applied[field] = value instanceof Date ? value.toISOString() : (value as string | null);
    }
  }
  // A conflicted field is intentionally absent so its base stays put.
  void item;
  return applied;
}

function dateish(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return new Date(value).toISOString();
  return null;
}

export function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.slice(0, 2000);
  return JSON.stringify(value).slice(0, 2000);
}

/** Used by the conflict review UI. */
export async function resolveConflict(
  userId: string,
  conflictId: string,
  choice: 'local' | 'remote',
): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.id, conflictId), eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')))
    .limit(1);
  const conflict = rows[0];
  if (!conflict) return false;

  if (choice === 'remote' && conflict.entityId) {
    const field = conflict.field as SourceField;
    const value =
      field === 'dueAt' ? (conflict.remoteValue ? new Date(conflict.remoteValue) : null) : conflict.remoteValue;
    await db
      .update(tasks)
      .set({ [field]: value, revision: sql`${tasks.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(tasks.id, conflict.entityId), eq(tasks.userId, userId)));
  }

  // Whichever side wins, the merge base advances so the conflict cannot recur.
  if (conflict.externalRecordId) {
    const recordRows = await db
      .select()
      .from(externalRecords)
      .where(eq(externalRecords.id, conflict.externalRecordId))
      .limit(1);
    const record = recordRows[0];
    if (record) {
      const base = lastApplied(record);
      const chosen = choice === 'remote' ? conflict.remoteValue : conflict.localValue;
      await db
        .update(externalRecords)
        .set({ payload: { ...(record.payload as object), lastApplied: { ...base, [conflict.field]: chosen } } })
        .where(eq(externalRecords.id, record.id));
    }
  }

  await db
    .update(syncConflicts)
    .set({ state: choice === 'local' ? 'resolved_local' : 'resolved_remote', resolvedAt: new Date() })
    .where(eq(syncConflicts.id, conflictId));

  await recordAudit({
    userId,
    actor: `user:${userId}`,
    action: 'sync.conflict_resolved',
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    detail: { field: conflict.field, choice },
  });
  return true;
}
