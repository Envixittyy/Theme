import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from '../../db';
import { courses, externalRecords, syncConflicts, syncCursors, tasks } from '../../db/schema';
import { recordAudit } from '../../domain/audit';
import { findCourseByCode } from '../../domain/courses';
import { contentHash } from '../../security/crypto';
import { redactError } from '../../security/redact';
import { assertServerOnly } from '../../server-guard';
import { finishRun, logChange, startRun, stringify, type SyncContext } from '../../sync/engine';
import type { SyncSummary } from '../../sync/types';
import { getAccount, readSecret, setAccountStatus } from '../integrations';
import { HttpNotionClient, NotionApiError, type NotionClient, type NotionPage } from './client';
import {
  DEFAULT_MAPPING,
  readCheckbox,
  readDate,
  readRelationOrText,
  readRichText,
  readSelect,
  readTitle,
  readUrl,
  toLocalPriority,
  toLocalStatus,
  toLocalType,
  writeCheckbox,
  writeDate,
  writeRichText,
  writeSelect,
  writeTitle,
  writeUrl,
  type FieldMapping,
} from './mapping';

assertServerOnly('lib/connectors/notion/sync');

/**
 * Notion two-way synchronisation.
 *
 * The hard parts, and how they are handled:
 *
 * **Loop prevention.** Every write records what was written (`syncedFieldHash`)
 * and the resulting `last_edited_time`. When a page comes back in a later pull
 * with that same revision, or with content identical to what we pushed, it is
 * recognised as our own echo and skipped. Without this, a push triggers a pull
 * triggers a push, forever.
 *
 * **Field-level conflicts.** Merging is per field against a common ancestor —
 * the values at the last successful sync — not last-write-wins across the whole
 * record. Only a field both sides changed becomes a conflict; everything else
 * merges silently, which is what makes the conflict list short enough to be read.
 *
 * **Uncertain mappings never decide.** If Notion's status value is not one this
 * mapping knows, the local status is left untouched and the discrepancy is
 * reported. A student's "Done" is never invented by a translation table.
 *
 * **Nothing is deleted.** Archiving in Notion marks the local record for review.
 */

export type SyncedField = 'title' | 'dueAt' | 'status' | 'priority' | 'type' | 'submitted' | 'notes';

const SYNCED_FIELDS: SyncedField[] = ['title', 'dueAt', 'status', 'priority', 'type', 'submitted', 'notes'];

type Snapshot = Partial<Record<SyncedField, string | null>> & { courseCode?: string | null };

type LocalTask = typeof tasks.$inferSelect;

export function mappingFor(account: { config: unknown }): FieldMapping {
  const config = (account.config ?? {}) as { mapping?: Partial<FieldMapping>; databaseId?: string };
  return { ...DEFAULT_MAPPING, ...(config.mapping ?? {}) };
}

export function databaseIdFor(account: { config: unknown }): string | null {
  return ((account.config ?? {}) as { databaseId?: string }).databaseId ?? null;
}

/* --------------------------- snapshot & compare --------------------------- */

function localSnapshot(task: LocalTask, courseCode: string | null): Snapshot {
  return {
    title: task.title,
    dueAt: task.dueAt?.toISOString() ?? null,
    status: task.status,
    priority: task.priority,
    type: task.type,
    submitted: task.status === 'submitted' || task.submittedAt !== null ? 'true' : 'false',
    notes: task.description || null,
    courseCode,
  };
}

function remoteSnapshot(page: NotionPage, mapping: FieldMapping): { snapshot: Snapshot; unmapped: string[] } {
  const props = page.properties;
  const unmapped: string[] = [];

  const statusRaw = mapping.status ? readSelect(props[mapping.status]) : null;
  const status = toLocalStatus(statusRaw, mapping);
  if (statusRaw && !status.confident) unmapped.push(`status "${statusRaw}"`);

  const typeRaw = mapping.type ? readSelect(props[mapping.type]) : null;
  const type = toLocalType(typeRaw, mapping);
  if (typeRaw && !type) unmapped.push(`type "${typeRaw}"`);

  const priorityRaw = mapping.priority ? readSelect(props[mapping.priority]) : null;
  const priority = toLocalPriority(priorityRaw, mapping);
  if (priorityRaw && !priority) unmapped.push(`priority "${priorityRaw}"`);

  const due = mapping.dueDate ? readDate(props[mapping.dueDate]) : { start: null, hasTime: false };

  // `undefined` means "this field takes no part in the merge"; `null` means
  // "genuinely empty upstream". The distinction matters for fields the local
  // model always has a value for -- a task is always in *some* status -- where
  // an unset Notion property means the student never set it, not that they
  // cleared it. Treating those as null would make the local default look like a
  // local edit and push it back on the next run.
  return {
    snapshot: {
      title: readTitle(props[mapping.title]) || undefined,
      dueAt: due.start?.toISOString() ?? null,
      status: status.status ?? undefined,
      priority: priority ?? undefined,
      type: type ?? undefined,
      submitted: mapping.submitted ? String(readCheckbox(props[mapping.submitted])) : undefined,
      notes: mapping.notes ? readRichText(props[mapping.notes]) || null : undefined,
      courseCode: mapping.course ? readRelationOrText(props[mapping.course]) : null,
    },
    unmapped,
  };
}

function propertiesFromTask(
  task: LocalTask,
  courseCode: string | null,
  mapping: FieldMapping,
  fields: SyncedField[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const set = (name: string | null, value: unknown) => {
    if (name) props[name] = value;
  };

  if (fields.includes('title')) set(mapping.title, writeTitle(task.title));
  if (fields.includes('dueAt')) set(mapping.dueDate, writeDate(task.dueAt, task.allDay));
  if (fields.includes('status')) set(mapping.status, writeSelect(mapping.statusValues[task.status] ?? null, 'select'));
  if (fields.includes('priority')) set(mapping.priority, writeSelect(mapping.priorityValues[task.priority] ?? null));
  if (fields.includes('type')) set(mapping.type, writeSelect(mapping.typeValues[task.type] ?? null));
  if (fields.includes('submitted')) {
    set(mapping.submitted, writeCheckbox(task.status === 'submitted' || task.submittedAt !== null));
  }
  if (fields.includes('notes')) set(mapping.notes, writeRichText(task.description));
  set(mapping.source, writeSelect(task.source === 'blackboard' ? 'Blackboard' : 'School OS'));
  set(mapping.sourceUrl, writeUrl(task.sourceUrl));
  if (courseCode) set(mapping.course, writeSelect(courseCode));
  return props;
}

/* -------------------------------- the sync -------------------------------- */

export type NotionSyncOptions = {
  client?: NotionClient;
  now?: Date;
  trigger?: 'schedule' | 'manual' | 'webhook' | 'connect';
  /** Skip the push half — used by the first reconciliation after connecting. */
  pullOnly?: boolean;
};

export async function syncNotionAccount(
  userId: string,
  accountId: string,
  options: NotionSyncOptions = {},
): Promise<SyncSummary> {
  const db = await getDb();
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? 'schedule';
  const account = await getAccount(userId, accountId);
  if (!account) throw new Error('Integration account not found');

  const databaseId = databaseIdFor(account);
  if (!databaseId) throw new Error('No Notion database is selected for this account');
  const mapping = mappingFor(account);

  let client = options.client;
  let token: string | null = null;
  if (!client) {
    token = await readSecret(accountId, 'access_token', db);
    if (!token) throw new Error('This Notion connection has no stored credential');
    client = new HttpNotionClient(token);
  }

  const windowMs = trigger === 'schedule' ? 10 * 60_000 : 1;
  const { runId } = await startRun({
    db,
    userId,
    accountId,
    direction: options.pullOnly ? 'pull' : 'both',
    trigger,
    idempotencyKey: `notion:${accountId}:${trigger}:${Math.floor(now.getTime() / windowMs)}`,
  });

  const summary: SyncSummary = {
    runId,
    seen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    missing: 0,
    warnings: [],
  };

  const ctx: SyncContext = {
    db,
    userId,
    accountId,
    provider: 'notion',
    runId,
    timeZone: ((account.config as Record<string, unknown>).timeZone as string) ?? 'Asia/Manila',
    now,
  };

  try {
    const cursorRows = await db
      .select()
      .from(syncCursors)
      .where(and(eq(syncCursors.accountId, accountId), eq(syncCursors.name, 'notion_last_edited')))
      .limit(1);
    const since = cursorRows[0]?.value ? new Date(cursorRows[0].value) : undefined;

    /* ------------------------------- pull ------------------------------- */
    let cursor: string | undefined;
    let latestEdit = since ?? new Date(0);

    do {
      const page = await client.queryDatabase(databaseId, { since, cursor });
      cursor = page.nextCursor ?? undefined;

      for (const remote of page.pages) {
        summary.seen += 1;
        const edited = new Date(remote.last_edited_time);
        if (edited > latestEdit) latestEdit = edited;
        const outcome = await applyRemotePage(ctx, remote, mapping);
        if (outcome === 'created') summary.created += 1;
        else if (outcome === 'updated') summary.updated += 1;
        else if (outcome === 'conflict') summary.conflicts += 1;
        else if (outcome === 'missing') summary.missing += 1;
        else summary.skipped += 1;
      }
    } while (cursor);

    /* ------------------------------- push ------------------------------- */
    if (!options.pullOnly) {
      const pushed = await pushLocalChanges(ctx, client, databaseId, mapping);
      summary.created += pushed.created;
      summary.updated += pushed.updated;
      summary.conflicts += pushed.conflicts;
    }

    await db
      .insert(syncCursors)
      .values({ accountId, name: 'notion_last_edited', value: latestEdit.toISOString() })
      .onConflictDoUpdate({
        target: [syncCursors.accountId, syncCursors.name],
        set: { value: latestEdit.toISOString(), updatedAt: now },
      });

    await finishRun(db, runId, summary.conflicts ? 'partial' : 'succeeded', summary);
    await setAccountStatus(accountId, 'connected', null, db);
    return summary;
  } catch (err) {
    const message = redactError(err, token ? [token] : []);
    await finishRun(db, runId, 'failed', summary, message);
    await setAccountStatus(accountId, 'error', message, db);
    if (err instanceof NotionApiError && err.retryable) throw err;
    throw new Error(message);
  }
}

/* ------------------------------ pull one page ----------------------------- */

async function applyRemotePage(
  ctx: SyncContext,
  page: NotionPage,
  mapping: FieldMapping,
): Promise<'created' | 'updated' | 'skipped' | 'conflict' | 'missing'> {
  const { db, userId, accountId } = ctx;
  const { snapshot: remote, unmapped } = remoteSnapshot(page, mapping);

  const existing = await db
    .select()
    .from(externalRecords)
    .where(and(eq(externalRecords.accountId, accountId), eq(externalRecords.externalId, page.id)))
    .limit(1);
  const record = existing[0];

  /* --------------------------- archived upstream --------------------------- */
  if (page.archived) {
    if (record && !record.missingSinceAt) {
      await db
        .update(externalRecords)
        .set({ missingSinceAt: ctx.now, reviewReason: 'archived_in_notion' })
        .where(eq(externalRecords.id, record.id));
      await logChange(ctx, {
        entityType: 'task',
        entityId: record.entityId,
        externalRecordId: record.id,
        action: 'missing',
        reason: 'the Notion page was archived; the local task was kept for review',
      });
      return 'missing';
    }
    return 'skipped';
  }

  /* ------------------------------- new page ------------------------------- */
  if (!record) {
    const course = remote.courseCode ? await findCourseByCode(userId, remote.courseCode) : null;
    const [task] = await db
      .insert(tasks)
      .values({
        userId,
        courseId: course?.id ?? null,
        title: remote.title || 'Untitled Notion task',
        description: remote.notes ?? '',
        // An unrecognised status must not become Done or Submitted.
        status: (remote.status as LocalTask['status'] | null) ?? 'inbox',
        type: (remote.type as LocalTask['type'] | null) ?? 'assignment',
        priority: (remote.priority as LocalTask['priority'] | null) ?? 'medium',
        priorityOverridden: remote.priority !== null && remote.priority !== undefined,
        dueAt: remote.dueAt ? new Date(remote.dueAt) : null,
        dueTimeZone: ctx.timeZone,
        source: 'notion',
        sourceUrl: page.url,
        lastWriteOrigin: 'notion',
        submittedAt: remote.submitted === 'true' ? ctx.now : null,
      })
      .returning();

    // The merge ancestor is the *local* snapshot, not the remote one. A page
    // that leaves Status or Type unset still produces a task with defaults, and
    // recording the remote nulls as the ancestor would make those defaults look
    // like local edits and push them straight back into Notion.
    const createdCourseCode = course?.code ?? remote.courseCode ?? null;
    const ancestor = localSnapshot(task!, createdCourseCode);

    const [created] = await db
      .insert(externalRecords)
      .values({
        userId,
        accountId,
        provider: 'notion',
        externalId: page.id,
        entityType: 'task',
        entityId: task!.id,
        courseCode: remote.courseCode ?? null,
        normalizedTitle: (remote.title ?? '').toLowerCase(),
        dueAt: remote.dueAt ? new Date(remote.dueAt) : null,
        sourceUrl: page.url,
        sourceUpdatedAt: new Date(page.last_edited_time),
        contentHash: contentHash(remote),
        syncedFieldHash: contentHash(remote),
        remoteRevision: page.last_edited_time,
        localRevision: task!.revision,
        lastSeenAt: ctx.now,
        reviewReason: unmapped.length ? `unmapped: ${unmapped.join(', ')}` : null,
        payload: { lastApplied: ancestor },
      })
      .returning();

    await logChange(ctx, {
      entityType: 'task',
      entityId: task!.id,
      externalRecordId: created!.id,
      action: 'created',
      reason: 'new page in the Notion database',
    });
    await recordAudit(
      {
        userId,
        actor: 'sync:notion',
        action: 'task.created',
        entityType: 'task',
        entityId: task!.id,
        detail: { runId: ctx.runId, notionPageId: page.id },
      },
      db,
    );
    return 'created';
  }

  /* ------------------------------ echo check ------------------------------ */
  await db
    .update(externalRecords)
    .set({ lastSeenAt: ctx.now, missingSinceAt: null })
    .where(eq(externalRecords.id, record.id));

  // The two loop breakers: the revision we produced, and the content we wrote.
  if (record.remoteRevision === page.last_edited_time) return 'skipped';
  const remoteHash = contentHash(remote);
  if (record.syncedFieldHash === remoteHash) {
    await db
      .update(externalRecords)
      .set({ remoteRevision: page.last_edited_time, sourceUpdatedAt: new Date(page.last_edited_time) })
      .where(eq(externalRecords.id, record.id));
    return 'skipped';
  }

  const taskRows = record.entityId
    ? await db.select().from(tasks).where(eq(tasks.id, record.entityId)).limit(1)
    : [];
  const task = taskRows[0];
  if (!task) {
    await db
      .update(externalRecords)
      .set({ contentHash: remoteHash, reviewReason: 'local_entity_deleted' })
      .where(eq(externalRecords.id, record.id));
    return 'skipped';
  }

  const courseCode = task.courseId ? await courseCodeFor(db, task.courseId) : null;
  const local = localSnapshot(task, courseCode);
  const base = ((record.payload as { lastApplied?: Snapshot } | null)?.lastApplied ?? {}) as Snapshot;

  const merge = mergeFields(local, remote, base);

  if (Object.keys(merge.apply).length) {
    const patch = await toTaskPatch(ctx, merge.apply, task);
    await db
      .update(tasks)
      .set({ ...patch, revision: task.revision + 1, lastWriteOrigin: 'notion', updatedAt: ctx.now })
      .where(eq(tasks.id, task.id));

    for (const [field, value] of Object.entries(merge.apply)) {
      await logChange(ctx, {
        entityType: 'task',
        entityId: task.id,
        externalRecordId: record.id,
        action: 'updated',
        field,
        oldValue: stringify(local[field as SyncedField] ?? null),
        newValue: stringify(value),
        reason: 'changed in Notion since the last sync',
      });
    }
    await recordAudit(
      {
        userId,
        actor: 'sync:notion',
        action: 'task.synced',
        entityType: 'task',
        entityId: task.id,
        detail: { runId: ctx.runId, applied: Object.keys(merge.apply), conflicts: merge.conflicts.map((c) => c.field) },
      },
      db,
    );
  }

  for (const conflict of merge.conflicts) {
    await db
      .insert(syncConflicts)
      .values({
        userId,
        accountId,
        externalRecordId: record.id,
        entityType: 'task',
        entityId: task.id,
        field: conflict.field,
        localValue: stringify(conflict.local),
        remoteValue: stringify(conflict.remote),
        baseValue: stringify(conflict.base),
        localChangedAt: task.updatedAt,
        remoteChangedAt: new Date(page.last_edited_time),
        state: 'open',
      })
      .onConflictDoNothing();
    await logChange(ctx, {
      entityType: 'task',
      entityId: task.id,
      externalRecordId: record.id,
      action: 'conflict',
      field: conflict.field,
      oldValue: stringify(conflict.local),
      newValue: stringify(conflict.remote),
      reason: 'both sides changed this field since the last sync',
    });
  }

  await db
    .update(externalRecords)
    .set({
      contentHash: remoteHash,
      // Only merged fields advance the ancestor; a conflicted field keeps its
      // old base so the conflict remains visible until a human settles it.
      syncedFieldHash: contentHash({ ...base, ...merge.apply }),
      remoteRevision: page.last_edited_time,
      sourceUpdatedAt: new Date(page.last_edited_time),
      dueAt: remote.dueAt ? new Date(remote.dueAt) : null,
      normalizedTitle: (remote.title ?? '').toLowerCase(),
      courseCode: remote.courseCode ?? null,
      // `localRevision` deliberately stays put: it means "the local revision we
      // last *pushed*". A pull raises the task's revision without sending
      // anything, and advancing it here would hide an unpushed local edit from
      // the push phase for good.
      reviewReason: unmapped.length ? `unmapped: ${unmapped.join(', ')}` : null,
      payload: { lastApplied: { ...base, ...merge.apply } },
    })
    .where(eq(externalRecords.id, record.id));

  if (merge.conflicts.length) return 'conflict';
  return Object.keys(merge.apply).length ? 'updated' : 'skipped';
}

/* -------------------------------- the merge ------------------------------- */

export type MergeResult = {
  apply: Partial<Record<SyncedField, string | null>>;
  push: Partial<Record<SyncedField, string | null>>;
  conflicts: Array<{ field: SyncedField; local: string | null; remote: string | null; base: string | null }>;
};

/**
 * Three-way, field by field.
 *
 * `base` is the value at the last successful sync — the common ancestor. Only a
 * field where *both* sides moved away from it, to different values, is a
 * conflict; everything else has an unambiguous answer.
 */
export function mergeFields(local: Snapshot, remote: Snapshot, base: Snapshot): MergeResult {
  const result: MergeResult = { apply: {}, push: {}, conflicts: [] };

  for (const field of SYNCED_FIELDS) {
    const l = normalize(local[field]);
    const r = normalize(remote[field]);
    const b = normalize(base[field]);

    // A field the remote does not map at all takes no part in the merge.
    if (remote[field] === undefined) continue;

    const localChanged = l !== b;
    const remoteChanged = r !== b;

    if (!localChanged && !remoteChanged) continue;
    if (remoteChanged && !localChanged) {
      result.apply[field] = r;
      continue;
    }
    if (localChanged && !remoteChanged) {
      result.push[field] = l;
      continue;
    }
    if (l === r) continue; // both moved to the same place
    result.conflicts.push({ field, local: l, remote: r, base: b });
  }
  return result;
}

function normalize(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

async function toTaskPatch(
  ctx: SyncContext,
  apply: Partial<Record<SyncedField, string | null>>,
  task: LocalTask,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};
  if ('title' in apply) patch.title = apply.title ?? task.title;
  if ('notes' in apply) patch.description = apply.notes ?? '';
  if ('dueAt' in apply) patch.dueAt = apply.dueAt ? new Date(apply.dueAt) : null;
  if ('priority' in apply && apply.priority) {
    patch.priority = apply.priority;
    patch.priorityOverridden = true;
  }
  if ('type' in apply && apply.type) {
    patch.type = apply.type;
    patch.typeOverridden = true;
  }
  if ('status' in apply && apply.status) {
    patch.status = apply.status;
    if (apply.status === 'done') patch.completedAt = task.completedAt ?? ctx.now;
    if (apply.status === 'submitted') patch.submittedAt = task.submittedAt ?? ctx.now;
  }
  if ('submitted' in apply) {
    // The checkbox only ever *records* a submission; it never flips the task to
    // Done, and clearing it does not un-submit work that was really handed in.
    if (apply.submitted === 'true' && !task.submittedAt) patch.submittedAt = ctx.now;
  }
  return patch;
}

async function courseCodeFor(db: Database, courseId: string): Promise<string | null> {
  const rows = await db.select({ code: courses.code }).from(courses).where(eq(courses.id, courseId)).limit(1);
  return rows[0]?.code ?? null;
}

/* --------------------------------- push ---------------------------------- */

async function pushLocalChanges(
  ctx: SyncContext,
  client: NotionClient,
  databaseId: string,
  mapping: FieldMapping,
): Promise<{ created: number; updated: number; conflicts: number }> {
  const { db, userId, accountId } = ctx;
  let created = 0;
  let updated = 0;

  // Tasks whose local revision moved past the one we last pushed.
  const linked = await db
    .select({ record: externalRecords, task: tasks })
    .from(externalRecords)
    .innerJoin(tasks, eq(tasks.id, externalRecords.entityId))
    .where(
      and(
        eq(externalRecords.accountId, accountId),
        eq(externalRecords.entityType, 'task'),
        isNull(externalRecords.missingSinceAt),
        sql`${externalRecords.localRevision} is null or ${tasks.revision} > ${externalRecords.localRevision}`,
      ),
    )
    .limit(200);

  for (const { record, task } of linked) {
    // Loop protection is the *base snapshot*, not `lastWriteOrigin`: after a
    // pull applies a remote change, that field's base equals the local value,
    // so there is nothing to push back. Using the origin flag instead would
    // strand a local edit that happened to be merged in the same run.
    const courseCode = task.courseId ? await courseCodeFor(db, task.courseId) : null;
    const local = localSnapshot(task, courseCode);
    const base = ((record.payload as { lastApplied?: Snapshot } | null)?.lastApplied ?? {}) as Snapshot;

    const changedFields = SYNCED_FIELDS.filter((f) => normalize(local[f]) !== normalize(base[f]));
    if (!changedFields.length) {
      await db.update(externalRecords).set({ localRevision: task.revision }).where(eq(externalRecords.id, record.id));
      continue;
    }

    const page = await client.updatePage(
      record.externalId,
      propertiesFromTask(task, courseCode, mapping, changedFields) as Record<string, never>,
    );
    updated += 1;

    const nextBase: Snapshot = { ...base };
    for (const field of changedFields) nextBase[field] = normalize(local[field]);

    await db
      .update(externalRecords)
      .set({
        localRevision: task.revision,
        remoteRevision: page.last_edited_time,
        sourceUpdatedAt: new Date(page.last_edited_time),
        syncedFieldHash: contentHash(nextBase),
        payload: { lastApplied: nextBase },
      })
      .where(eq(externalRecords.id, record.id));

    for (const field of changedFields) {
      await logChange(ctx, {
        entityType: 'task',
        entityId: task.id,
        externalRecordId: record.id,
        action: 'updated',
        field,
        oldValue: stringify(base[field] ?? null),
        newValue: stringify(local[field] ?? null),
        reason: 'pushed to Notion',
      });
    }
  }

  /* --------------------- local tasks with no Notion page -------------------- */
  const unlinked = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        sql`${tasks.status} <> 'archived'`,
        sql`not exists (
          select 1 from ${externalRecords} er
          where er.entity_id = ${tasks.id} and er.account_id = ${accountId}
        )`,
        gt(tasks.createdAt, new Date(Date.now() - 90 * 86_400_000)),
      ),
    )
    .limit(50);

  for (const task of unlinked) {
    const courseCode = task.courseId ? await courseCodeFor(db, task.courseId) : null;
    const page = await client.createPage(
      databaseId,
      propertiesFromTask(task, courseCode, mapping, SYNCED_FIELDS) as Record<string, never>,
    );
    const snapshot = localSnapshot(task, courseCode);
    await db.insert(externalRecords).values({
      userId,
      accountId,
      provider: 'notion',
      externalId: page.id,
      entityType: 'task',
      entityId: task.id,
      courseCode,
      normalizedTitle: task.title.toLowerCase(),
      dueAt: task.dueAt,
      sourceUrl: page.url,
      sourceUpdatedAt: new Date(page.last_edited_time),
      contentHash: contentHash(snapshot),
      syncedFieldHash: contentHash(snapshot),
      remoteRevision: page.last_edited_time,
      localRevision: task.revision,
      lastSeenAt: ctx.now,
      payload: { lastApplied: snapshot },
    });
    created += 1;
    await logChange(ctx, {
      entityType: 'task',
      entityId: task.id,
      externalRecordId: null,
      action: 'created',
      reason: 'created in Notion from a local task',
    });
  }

  return { created, updated, conflicts: 0 };
}
