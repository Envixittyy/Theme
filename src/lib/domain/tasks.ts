import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db';
import { courses, reminders, subtasks, tags as tagsTable, taskTags, tasks } from '../db/schema';
import { DEFAULT_TIME_ZONE } from '../shared/time';
import { recordAudit, type Actor } from './audit';
import { derivePriority, type Priority } from './priority';
import type { TaskType } from './task-type';
import { buildTaskFilter, buildTaskOrder, type SmartListContext } from './smart-lists';
import type { CreateTaskInput, SmartListQuery, UpdateTaskInput } from './validation';

export type TaskRow = typeof tasks.$inferSelect;
export type TaskStatus = TaskRow['status'];

export class NotFoundError extends Error {
  constructor(what = 'Record') {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/**
 * Field ownership.
 *
 * `SOURCE_CONTROLLED` fields belong to whichever provider created the task: a
 * later sync may overwrite them. Everything else belongs to the student and a
 * sync may never touch it. Keeping the split as data (rather than scattered
 * `if` statements in each connector) is what makes the guarantee auditable.
 */
export const SOURCE_CONTROLLED_FIELDS = ['title', 'description', 'dueAt', 'sourceUrl'] as const;
export const USER_CONTROLLED_FIELDS = [
  'status',
  'priority',
  'type',
  'courseId',
  'estimateMinutes',
  'startAt',
  'position',
] as const;

/* ------------------------------- reading ------------------------------- */

export async function listTasks(
  query: SmartListQuery,
  ctx: SmartListContext,
  options: { limit?: number; offset?: number } = {},
): Promise<TaskRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(tasks)
    .where(buildTaskFilter(query, ctx))
    .orderBy(...buildTaskOrder(query))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0);
}

export async function countTasks(query: SmartListQuery, ctx: SmartListContext): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(buildTaskFilter(query, ctx));
  return rows[0]?.count ?? 0;
}

export async function getTask(userId: string, taskId: string): Promise<TaskRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTaskDetail(userId: string, taskId: string) {
  const db = await getDb();
  const task = await getTask(userId, taskId);
  if (!task) return null;
  const [subs, rems, tagRows] = await Promise.all([
    db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(subtasks.position),
    db.select().from(reminders).where(eq(reminders.taskId, taskId)),
    db
      .select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color })
      .from(taskTags)
      .innerJoin(tagsTable, eq(tagsTable.id, taskTags.tagId))
      .where(eq(taskTags.taskId, taskId)),
  ]);
  return { task, subtasks: subs, reminders: rems, tags: tagRows };
}

/* ------------------------------- writing ------------------------------- */

export type WriteContext = {
  userId: string;
  actor: Actor;
  /** 'local' for user edits; 'blackboard'/'notion' for connectors. Drives loop prevention. */
  origin?: string;
  timeZone?: string;
  now?: Date;
  db?: Database;
};

export async function createTask(input: CreateTaskInput, ctx: WriteContext): Promise<TaskRow> {
  const db = ctx.db ?? (await getDb());
  const now = ctx.now ?? new Date();
  const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;

  if (input.courseId) await assertCourseOwned(db, ctx.userId, input.courseId);

  const [row] = await db
    .insert(tasks)
    .values({
      userId: ctx.userId,
      courseId: input.courseId ?? null,
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'inbox',
      type: input.type ?? 'assignment',
      priority: input.priority ?? derivePriority(dueAt, now, tz),
      priorityOverridden: !!input.priority,
      startAt: input.startAt ? new Date(input.startAt) : null,
      dueAt,
      dueTimeZone: input.dueTimeZone ?? tz,
      allDay: input.allDay ?? false,
      durationMinutes: input.durationMinutes ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      sourceUrl: input.sourceUrl ?? null,
      source: ctx.origin === 'blackboard' ? 'blackboard' : ctx.origin === 'notion' ? 'notion' : 'local',
      lastWriteOrigin: ctx.origin ?? 'local',
      completedAt: input.status === 'done' ? now : null,
      submittedAt: input.status === 'submitted' ? now : null,
    })
    .returning();

  const task = row!;
  if (input.tags?.length) await setTags(db, ctx.userId, task.id, input.tags);
  if (input.subtasks?.length) {
    await db.insert(subtasks).values(
      input.subtasks.map((title, i) => ({ userId: ctx.userId, taskId: task.id, title, position: i })),
    );
  }
  if (input.reminders?.length) {
    await db.insert(reminders).values(
      input.reminders.map((offsetMinutes) => ({ userId: ctx.userId, taskId: task.id, offsetMinutes })),
    );
  }

  await recordAudit(
    {
      userId: ctx.userId,
      actor: ctx.actor,
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      detail: { title: task.title, source: task.source },
    },
    db,
  );
  return task;
}

/**
 * Status transitions.
 *
 * Submitted and Done are genuinely different states: a student submits work and
 * *then* may still have follow-up (peer review, revision). Completing does not
 * imply submitting, and submitting does not silently complete.
 */
export function statusTimestamps(
  status: TaskStatus,
  current: Pick<TaskRow, 'completedAt' | 'submittedAt' | 'archivedAt'>,
  now: Date,
): Pick<TaskRow, 'completedAt' | 'submittedAt' | 'archivedAt'> {
  switch (status) {
    case 'done':
      return { ...current, completedAt: current.completedAt ?? now, archivedAt: null };
    case 'submitted':
      return { ...current, submittedAt: current.submittedAt ?? now, completedAt: null, archivedAt: null };
    case 'archived':
      return { ...current, archivedAt: current.archivedAt ?? now };
    default:
      // Moving back to an open state clears completion but keeps the submitted
      // record: the work really was handed in, whatever happens afterwards.
      return { ...current, completedAt: null, archivedAt: null };
  }
}

export async function updateTask(taskId: string, patch: UpdateTaskInput, ctx: WriteContext): Promise<TaskRow> {
  const db = ctx.db ?? (await getDb());
  const now = ctx.now ?? new Date();
  const existing = await getTask(ctx.userId, taskId);
  if (!existing) throw new NotFoundError('Task');

  if (patch.courseId) await assertCourseOwned(db, ctx.userId, patch.courseId);

  const next: Partial<TaskRow> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  const assign = <K extends keyof TaskRow>(key: K, value: TaskRow[K]): void => {
    if (existing[key] instanceof Date && value instanceof Date) {
      if ((existing[key] as Date).getTime() === value.getTime()) return;
    } else if (existing[key] === value) return;
    next[key] = value;
    changed[key as string] = { from: existing[key], to: value };
  };

  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.description !== undefined) assign('description', patch.description);
  if (patch.courseId !== undefined) assign('courseId', patch.courseId ?? null);
  if (patch.type !== undefined) {
    assign('type', patch.type as TaskType);
    if (ctx.origin === undefined || ctx.origin === 'local') next.typeOverridden = true;
  }
  if (patch.typeOverridden !== undefined) next.typeOverridden = patch.typeOverridden;
  if (patch.priority !== undefined) {
    assign('priority', patch.priority as Priority);
    if (ctx.origin === undefined || ctx.origin === 'local') next.priorityOverridden = true;
  }
  if (patch.priorityOverridden !== undefined) next.priorityOverridden = patch.priorityOverridden;
  if (patch.startAt !== undefined) assign('startAt', patch.startAt ? new Date(patch.startAt) : null);
  if (patch.dueAt !== undefined) {
    const due = patch.dueAt ? new Date(patch.dueAt) : null;
    assign('dueAt', due);
    // Recompute priority from the new deadline unless the student pinned it.
    if (!existing.priorityOverridden && patch.priority === undefined) {
      const derived = derivePriority(due, now, patch.dueTimeZone ?? existing.dueTimeZone);
      if (derived !== existing.priority) assign('priority', derived);
    }
  }
  if (patch.dueTimeZone !== undefined) assign('dueTimeZone', patch.dueTimeZone);
  if (patch.allDay !== undefined) assign('allDay', patch.allDay);
  if (patch.durationMinutes !== undefined) assign('durationMinutes', patch.durationMinutes ?? null);
  if (patch.estimateMinutes !== undefined) assign('estimateMinutes', patch.estimateMinutes ?? null);
  if (patch.sourceUrl !== undefined) assign('sourceUrl', patch.sourceUrl ?? null);

  if (patch.status !== undefined && patch.status !== existing.status) {
    assign('status', patch.status);
    const stamps = statusTimestamps(patch.status, existing, now);
    if (stamps.completedAt?.getTime() !== existing.completedAt?.getTime()) next.completedAt = stamps.completedAt;
    if (stamps.submittedAt?.getTime() !== existing.submittedAt?.getTime()) next.submittedAt = stamps.submittedAt;
    if (stamps.archivedAt?.getTime() !== existing.archivedAt?.getTime()) next.archivedAt = stamps.archivedAt;
  }

  if (patch.tags !== undefined) await setTags(db, ctx.userId, taskId, patch.tags);

  if (Object.keys(next).length === 0 && patch.tags === undefined) return existing;

  const [updated] = await db
    .update(tasks)
    .set({
      ...next,
      revision: existing.revision + 1,
      lastWriteOrigin: ctx.origin ?? 'local',
      updatedAt: now,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, ctx.userId)))
    .returning();

  if (Object.keys(changed).length) {
    await recordAudit(
      {
        userId: ctx.userId,
        actor: ctx.actor,
        action: 'task.updated',
        entityType: 'task',
        entityId: taskId,
        detail: { fields: changed, origin: ctx.origin ?? 'local' },
      },
      db,
    );
  }
  return updated!;
}

/** Distinct from `submitTask` on purpose — see `statusTimestamps`. */
export async function completeTask(taskId: string, ctx: WriteContext): Promise<TaskRow> {
  return updateTask(taskId, { status: 'done' }, ctx);
}

export async function submitTask(taskId: string, ctx: WriteContext): Promise<TaskRow> {
  return updateTask(taskId, { status: 'submitted' }, ctx);
}

export async function reopenTask(taskId: string, ctx: WriteContext): Promise<TaskRow> {
  return updateTask(taskId, { status: 'planned' }, ctx);
}

export async function archiveTask(taskId: string, ctx: WriteContext): Promise<TaskRow> {
  return updateTask(taskId, { status: 'archived' }, ctx);
}

export async function bulkUpdate(
  ids: string[],
  patch: {
    status?: TaskStatus;
    priority?: Priority;
    type?: TaskType;
    courseId?: string | null;
    dueAt?: string | null;
    addTags?: string[];
    removeTags?: string[];
  },
  ctx: WriteContext,
): Promise<number> {
  const db = ctx.db ?? (await getDb());
  const owned = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, ctx.userId), inArray(tasks.id, ids)));
  let count = 0;
  for (const { id } of owned) {
    await updateTask(
      id,
      {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.priority ? { priority: patch.priority } : {}),
        ...(patch.type ? { type: patch.type } : {}),
        ...(patch.courseId !== undefined ? { courseId: patch.courseId } : {}),
        ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      },
      ctx,
    );
    if (patch.addTags?.length || patch.removeTags?.length) {
      await mutateTags(db, ctx.userId, id, patch.addTags ?? [], patch.removeTags ?? []);
    }
    count += 1;
  }
  return count;
}

export async function duplicateTask(taskId: string, ctx: WriteContext): Promise<TaskRow> {
  const db = ctx.db ?? (await getDb());
  const detail = await getTaskDetail(ctx.userId, taskId);
  if (!detail) throw new NotFoundError('Task');
  const { task, subtasks: subs, tags: tagRows } = detail;
  return createTask(
    {
      title: `${task.title} (copy)`,
      description: task.description,
      courseId: task.courseId,
      status: 'inbox',
      type: task.type,
      priority: task.priority,
      startAt: task.startAt?.toISOString() ?? null,
      dueAt: task.dueAt?.toISOString() ?? null,
      dueTimeZone: task.dueTimeZone,
      allDay: task.allDay,
      durationMinutes: task.durationMinutes,
      estimateMinutes: task.estimateMinutes,
      tags: tagRows.map((t) => t.name),
      subtasks: subs.map((s) => s.title),
      reminders: [],
      sourceUrl: null,
    },
    { ...ctx, db },
  );
}

/** Hard delete. Only ever reachable from an explicit user action. */
export async function deleteTask(taskId: string, ctx: WriteContext): Promise<void> {
  const db = ctx.db ?? (await getDb());
  const existing = await getTask(ctx.userId, taskId);
  if (!existing) throw new NotFoundError('Task');
  await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, ctx.userId)));
  await recordAudit(
    {
      userId: ctx.userId,
      actor: ctx.actor,
      action: 'task.deleted',
      entityType: 'task',
      entityId: taskId,
      detail: { title: existing.title },
    },
    db,
  );
}

/* -------------------------------- tags -------------------------------- */

async function ensureTag(db: Database, userId: string, name: string): Promise<string> {
  const clean = name.trim().toLowerCase();
  const existing = await db
    .select({ id: tagsTable.id })
    .from(tagsTable)
    .where(and(eq(tagsTable.userId, userId), eq(tagsTable.name, clean)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db.insert(tagsTable).values({ userId, name: clean }).returning({ id: tagsTable.id });
  return created!.id;
}

export async function setTags(db: Database, userId: string, taskId: string, names: string[]): Promise<void> {
  const ids = await Promise.all(names.map((n) => ensureTag(db, userId, n)));
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  if (ids.length) {
    await db
      .insert(taskTags)
      .values(ids.map((tagId) => ({ taskId, tagId })))
      .onConflictDoNothing();
  }
}

async function mutateTags(
  db: Database,
  userId: string,
  taskId: string,
  add: string[],
  remove: string[],
): Promise<void> {
  for (const name of add) {
    const tagId = await ensureTag(db, userId, name);
    await db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing();
  }
  for (const name of remove) {
    const rows = await db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(and(eq(tagsTable.userId, userId), eq(tagsTable.name, name.trim().toLowerCase())))
      .limit(1);
    if (rows[0]) await db.delete(taskTags).where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, rows[0].id)));
  }
}

async function assertCourseOwned(db: Database, userId: string, courseId: string): Promise<void> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Course');
}

/* ------------------------------ subtasks ------------------------------ */

export async function addSubtask(userId: string, taskId: string, title: string) {
  const db = await getDb();
  const owner = await getTask(userId, taskId);
  if (!owner) throw new NotFoundError('Task');
  const [max] = await db
    .select({ max: sql<number>`coalesce(max(${subtasks.position}), -1)` })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId));
  const [row] = await db
    .insert(subtasks)
    .values({ userId, taskId, title, position: (max?.max ?? -1) + 1 })
    .returning();
  return row!;
}

export async function toggleSubtask(userId: string, subtaskId: string, done: boolean) {
  const db = await getDb();
  const rows = await db
    .update(subtasks)
    .set({ done })
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, userId)))
    .returning();
  if (!rows[0]) throw new NotFoundError('Subtask');
  return rows[0];
}

export async function deleteSubtask(userId: string, subtaskId: string): Promise<void> {
  const db = await getDb();
  await db.delete(subtasks).where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, userId)));
}
