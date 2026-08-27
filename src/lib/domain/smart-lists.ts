import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { tasks, taskTags, tags as tagsTable } from '../db/schema';
import type { SmartListQuery } from './validation';
import { addDaysIn, endOfDayIn, startOfDayIn } from '../shared/time';

/**
 * Smart lists are *saved queries*, not saved result sets: date windows are
 * stored relative ("due within 7 days") so a list stays correct tomorrow
 * without a rewrite job.
 */

export type SmartListContext = { userId: string; now: Date; timeZone: string };

export const SYSTEM_SMART_LISTS: Array<{ key: string; name: string; icon: string; query: SmartListQuery }> = [
  {
    key: 'inbox',
    name: 'Inbox',
    icon: 'inbox',
    query: { statuses: ['inbox'], sort: 'created', direction: 'desc' },
  },
  {
    key: 'today',
    name: 'Today',
    icon: 'sun',
    query: { dueWithinDays: 0, includeCompleted: false, sort: 'priority', direction: 'asc' },
  },
  {
    key: 'overdue',
    name: 'Overdue',
    icon: 'alert',
    query: { overdueOnly: true, includeCompleted: false, sort: 'due', direction: 'asc' },
  },
  {
    key: 'upcoming',
    name: 'Upcoming 7 days',
    icon: 'calendar',
    query: { dueWithinDays: 7, includeCompleted: false, sort: 'due', direction: 'asc' },
  },
  {
    key: 'submitted',
    name: 'Submitted',
    icon: 'send',
    query: { statuses: ['submitted'], includeCompleted: true, sort: 'due', direction: 'desc' },
  },
  {
    key: 'completed',
    name: 'Completed',
    icon: 'check',
    query: { statuses: ['done'], includeCompleted: true, sort: 'due', direction: 'desc' },
  },
  {
    key: 'exams',
    name: 'Exams & quizzes',
    icon: 'star',
    query: { types: ['exam', 'quiz'], includeCompleted: false, sort: 'due', direction: 'asc' },
  },
  {
    key: 'no-date',
    name: 'No deadline',
    icon: 'help',
    query: { hasNoDueDate: true, includeCompleted: false, sort: 'created', direction: 'desc' },
  },
];

/** Translates a saved query into a WHERE clause. Always scoped to one user. */
export function buildTaskFilter(query: SmartListQuery, ctx: SmartListContext): SQL {
  const clauses: SQL[] = [eq(tasks.userId, ctx.userId)];

  if (query.statuses?.length) {
    clauses.push(inArray(tasks.status, query.statuses));
  } else {
    // Archived work is never in a list unless explicitly asked for.
    clauses.push(sql`${tasks.status} <> 'archived'`);
    if (!query.includeCompleted) clauses.push(sql`${tasks.status} <> 'done'`);
  }

  if (query.types?.length) clauses.push(inArray(tasks.type, query.types));
  if (query.priorities?.length) clauses.push(inArray(tasks.priority, query.priorities));
  if (query.courseIds?.length) clauses.push(inArray(tasks.courseId, query.courseIds));
  if (query.sources?.length) clauses.push(inArray(tasks.source, query.sources));

  if (query.overdueOnly) {
    clauses.push(isNotNull(tasks.dueAt));
    clauses.push(lt(tasks.dueAt, ctx.now));
    clauses.push(sql`${tasks.status} not in ('done','submitted','archived')`);
  }

  if (query.hasNoDueDate) clauses.push(isNull(tasks.dueAt));

  if (typeof query.dueWithinDays === 'number') {
    const from =
      typeof query.dueAfterDays === 'number'
        ? startOfDayIn(addDaysIn(ctx.now, query.dueAfterDays, ctx.timeZone), ctx.timeZone)
        : null;
    const to = endOfDayIn(addDaysIn(ctx.now, query.dueWithinDays, ctx.timeZone), ctx.timeZone);
    clauses.push(isNotNull(tasks.dueAt));
    clauses.push(lte(tasks.dueAt, to));
    // Without an explicit lower bound, "due within N days" includes overdue work
    // — a student needs to see what they missed alongside what is next.
    if (from) clauses.push(gte(tasks.dueAt, from));
  } else if (typeof query.dueAfterDays === 'number') {
    clauses.push(isNotNull(tasks.dueAt));
    clauses.push(gte(tasks.dueAt, startOfDayIn(addDaysIn(ctx.now, query.dueAfterDays, ctx.timeZone), ctx.timeZone)));
  }

  if (query.search) {
    const needle = `%${query.search.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const match = or(ilike(tasks.title, needle), ilike(tasks.description, needle));
    if (match) clauses.push(match);
  }

  if (query.tags?.length) {
    clauses.push(
      sql`exists (
        select 1 from ${taskTags}
        join ${tagsTable} on ${tagsTable.id} = ${taskTags.tagId}
        where ${taskTags.taskId} = ${tasks.id} and ${tagsTable.name} = any(${sql.raw(`ARRAY[${query.tags
          .map((t) => `'${t.replace(/'/g, "''")}'`)
          .join(',')}]::text[]`)})
      )`,
    );
  }

  return and(...clauses)!;
}

export function buildTaskOrder(query: SmartListQuery) {
  const dir = query.direction === 'desc' ? desc : asc;
  switch (query.sort) {
    case 'priority':
      // Enum ordering is declaration order, which is already urgent→low.
      return [sql`${tasks.priority} asc`, sql`${tasks.dueAt} asc nulls last`];
    case 'created':
      return [dir(tasks.createdAt)];
    case 'title':
      return [dir(tasks.title)];
    case 'manual':
      return [asc(tasks.position), asc(tasks.createdAt)];
    case 'due':
    default:
      return [
        query.direction === 'desc'
          ? sql`${tasks.dueAt} desc nulls last`
          : sql`${tasks.dueAt} asc nulls last`,
        sql`${tasks.priority} asc`,
      ];
  }
}
