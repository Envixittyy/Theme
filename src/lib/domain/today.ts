import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  announcements,
  courseMeetings,
  courses,
  externalRecords,
  integrationAccounts,
  syncConflicts,
  syncRuns,
  tasks,
} from '../db/schema';
import { addDaysIn, endOfDayIn, startOfDayIn, weekdayIn } from '../shared/time';
import { courseWorkload } from './courses';

export type TaskWithCourse = typeof tasks.$inferSelect & {
  courseCode: string | null;
  courseColor: string | null;
  courseShort: string | null;
};

export type TodayData = Awaited<ReturnType<typeof loadTodayData>>;

/**
 * One loader for the whole Today screen.
 *
 * Widgets are configurable, so the naive approach — each widget fetching its
 * own data — would mean a variable and unbounded number of round trips per
 * render. Loading once and slicing in memory keeps Today at a fixed cost no
 * matter how the student arranges it.
 */
export async function loadTodayData(userId: string, timeZone: string, now = new Date()) {
  const db = await getDb();
  const dayStart = startOfDayIn(now, timeZone);
  const dayEnd = endOfDayIn(now, timeZone);
  const weekEnd = endOfDayIn(addDaysIn(now, 7, timeZone), timeZone);
  const weekday = weekdayIn(now, timeZone);

  const withCourse = {
    id: tasks.id,
    userId: tasks.userId,
    courseId: tasks.courseId,
    title: tasks.title,
    description: tasks.description,
    status: tasks.status,
    type: tasks.type,
    priority: tasks.priority,
    startAt: tasks.startAt,
    dueAt: tasks.dueAt,
    dueTimeZone: tasks.dueTimeZone,
    allDay: tasks.allDay,
    durationMinutes: tasks.durationMinutes,
    estimateMinutes: tasks.estimateMinutes,
    priorityOverridden: tasks.priorityOverridden,
    typeOverridden: tasks.typeOverridden,
    source: tasks.source,
    sourceUrl: tasks.sourceUrl,
    completedAt: tasks.completedAt,
    submittedAt: tasks.submittedAt,
    archivedAt: tasks.archivedAt,
    revision: tasks.revision,
    lastWriteOrigin: tasks.lastWriteOrigin,
    recurrenceRuleId: tasks.recurrenceRuleId,
    recurrenceParentId: tasks.recurrenceParentId,
    position: tasks.position,
    createdAt: tasks.createdAt,
    updatedAt: tasks.updatedAt,
    courseCode: courses.code,
    courseColor: courses.color,
    courseShort: courses.shortLabel,
  };

  const openStatuses = sql`${tasks.status} not in ('done','submitted','archived')`;

  const [dueToday, overdue, upcoming, meetings, recentExternal, latestAnnouncements, workload, health] =
    await Promise.all([
      db
        .select(withCourse)
        .from(tasks)
        .leftJoin(courses, eq(courses.id, tasks.courseId))
        .where(and(eq(tasks.userId, userId), gte(tasks.dueAt, dayStart), lte(tasks.dueAt, dayEnd), sql`${tasks.status} <> 'archived'`))
        .orderBy(asc(tasks.dueAt))
        .limit(50),

      db
        .select(withCourse)
        .from(tasks)
        .leftJoin(courses, eq(courses.id, tasks.courseId))
        .where(and(eq(tasks.userId, userId), lt(tasks.dueAt, dayStart), openStatuses))
        .orderBy(asc(tasks.dueAt))
        .limit(50),

      db
        .select(withCourse)
        .from(tasks)
        .leftJoin(courses, eq(courses.id, tasks.courseId))
        .where(and(eq(tasks.userId, userId), gte(tasks.dueAt, dayEnd), lte(tasks.dueAt, weekEnd), openStatuses))
        .orderBy(asc(tasks.dueAt))
        .limit(60),

      db
        .select({
          id: courseMeetings.id,
          courseId: courseMeetings.courseId,
          weekday: courseMeetings.weekday,
          startMinute: courseMeetings.startMinute,
          endMinute: courseMeetings.endMinute,
          location: courseMeetings.location,
          modality: courseMeetings.modality,
          code: courses.code,
          title: courses.title,
          color: courses.color,
          room: courses.room,
          instructor: courses.instructor,
        })
        .from(courseMeetings)
        .innerJoin(courses, eq(courses.id, courseMeetings.courseId))
        .where(and(eq(courseMeetings.userId, userId), eq(courseMeetings.weekday, weekday), eq(courses.archived, false)))
        .orderBy(asc(courseMeetings.startMinute)),

      db
        .select({
          id: externalRecords.id,
          entityId: externalRecords.entityId,
          title: tasks.title,
          courseCode: externalRecords.courseCode,
          dueAt: externalRecords.dueAt,
          firstSeenAt: externalRecords.firstSeenAt,
          provider: externalRecords.provider,
          color: courses.color,
        })
        .from(externalRecords)
        .leftJoin(tasks, eq(tasks.id, externalRecords.entityId))
        .leftJoin(courses, eq(courses.id, tasks.courseId))
        .where(and(eq(externalRecords.userId, userId), eq(externalRecords.entityType, 'task')))
        .orderBy(desc(externalRecords.firstSeenAt))
        .limit(6),

      db
        .select({
          id: announcements.id,
          title: announcements.title,
          bodyExcerpt: announcements.bodyExcerpt,
          publishedAt: announcements.publishedAt,
          readAt: announcements.readAt,
          courseCode: courses.code,
          courseColor: courses.color,
        })
        .from(announcements)
        .leftJoin(courses, eq(courses.id, announcements.courseId))
        .where(eq(announcements.userId, userId))
        .orderBy(desc(announcements.publishedAt))
        .limit(6),

      courseWorkload(userId),

      (async () => {
        const accounts = await db
          .select()
          .from(integrationAccounts)
          .where(eq(integrationAccounts.userId, userId));
        const runs = await db
          .select()
          .from(syncRuns)
          .where(eq(syncRuns.userId, userId))
          .orderBy(desc(syncRuns.startedAt))
          .limit(5);
        const conflictRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(syncConflicts)
          .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')));
        const missingRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(externalRecords)
          .where(and(eq(externalRecords.userId, userId), sql`${externalRecords.missingSinceAt} is not null`));
        return {
          accounts,
          runs,
          openConflicts: conflictRows[0]?.count ?? 0,
          missingUpstream: missingRows[0]?.count ?? 0,
        };
      })(),
    ]);

  const inboxCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'inbox')));

  const unreadAnnouncements = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(announcements)
    .where(and(eq(announcements.userId, userId), isNull(announcements.readAt)));

  return {
    now,
    timeZone,
    dueToday: dueToday as TaskWithCourse[],
    overdue: overdue as TaskWithCourse[],
    upcoming: upcoming as TaskWithCourse[],
    meetings,
    recentExternal,
    latestAnnouncements,
    workload,
    health,
    inboxCount: inboxCount[0]?.count ?? 0,
    unreadAnnouncements: unreadAnnouncements[0]?.count ?? 0,
  };
}
