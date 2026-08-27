import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { courseMeetings, courses, tasks } from '../db/schema';
import { addDaysIn, endOfDayIn, isoDateIn, startOfDayIn, startOfMonthIn, startOfWeekIn } from '../shared/time';

export type CalendarView = 'month' | 'week' | 'agenda' | 'timetable';

export type CalendarTask = {
  id: string;
  title: string;
  dueAt: string;
  allDay: boolean;
  status: string;
  type: string;
  priority: string;
  courseId: string | null;
  courseCode: string | null;
  courseColor: string | null;
  durationMinutes: number | null;
};

export type CalendarMeeting = {
  id: string;
  courseId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  location: string | null;
  modality: string;
  code: string;
  title: string;
  color: string;
};

/** The visible window for a view, anchored on a date the user picked. */
export function calendarRange(
  view: CalendarView,
  anchor: Date,
  timeZone: string,
  weekStartsOn: number,
): { from: Date; to: Date } {
  switch (view) {
    case 'month': {
      const monthStart = startOfMonthIn(anchor, timeZone);
      // Month grids show leading/trailing days from adjacent months.
      const from = startOfWeekIn(monthStart, timeZone, weekStartsOn);
      return { from, to: endOfDayIn(addDaysIn(from, 41, timeZone), timeZone) };
    }
    case 'week':
    case 'timetable': {
      const from = startOfWeekIn(anchor, timeZone, weekStartsOn);
      return { from, to: endOfDayIn(addDaysIn(from, 6, timeZone), timeZone) };
    }
    case 'agenda':
    default: {
      const from = startOfDayIn(anchor, timeZone);
      return { from, to: endOfDayIn(addDaysIn(from, 30, timeZone), timeZone) };
    }
  }
}

export async function loadCalendar(
  userId: string,
  range: { from: Date; to: Date },
  options: { courseId?: string | null; includeCompleted?: boolean } = {},
): Promise<{ tasks: CalendarTask[]; meetings: CalendarMeeting[] }> {
  const db = await getDb();

  const clauses = [
    eq(tasks.userId, userId),
    gte(tasks.dueAt, range.from),
    lte(tasks.dueAt, range.to),
    sql`${tasks.status} <> 'archived'`,
  ];
  if (options.courseId) clauses.push(eq(tasks.courseId, options.courseId));
  if (!options.includeCompleted) clauses.push(sql`${tasks.status} <> 'done'`);

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      allDay: tasks.allDay,
      status: tasks.status,
      type: tasks.type,
      priority: tasks.priority,
      courseId: tasks.courseId,
      durationMinutes: tasks.durationMinutes,
      courseCode: courses.code,
      courseColor: courses.color,
    })
    .from(tasks)
    .leftJoin(courses, eq(courses.id, tasks.courseId))
    .where(and(...clauses))
    .orderBy(tasks.dueAt);

  const meetingClauses = [eq(courseMeetings.userId, userId), eq(courses.archived, false)];
  if (options.courseId) meetingClauses.push(eq(courseMeetings.courseId, options.courseId));

  const meetingRows = await db
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
    })
    .from(courseMeetings)
    .innerJoin(courses, eq(courses.id, courseMeetings.courseId))
    .where(and(...meetingClauses))
    .orderBy(courseMeetings.weekday, courseMeetings.startMinute);

  return {
    tasks: taskRows
      .filter((t): t is typeof t & { dueAt: Date } => t.dueAt !== null)
      .map((t) => ({ ...t, dueAt: t.dueAt.toISOString() })),
    meetings: meetingRows,
  };
}

/** Deadline counts per ISO date, used for month-cell density. */
export function countByDay(items: CalendarTask[], timeZone: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = isoDateIn(new Date(item.dueAt), timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
