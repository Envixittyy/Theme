import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { courseMeetings, courses, enrollments, tasks } from '../db/schema';
import { recordAudit, type Actor } from './audit';
import { NotFoundError } from './tasks';
import type { CreateCourseInput } from './validation';
import { DEFAULT_TIME_ZONE } from '../shared/time';

export type CourseRow = typeof courses.$inferSelect;
export type MeetingRow = typeof courseMeetings.$inferSelect;

export { COURSE_PALETTE } from './course-palette';

export async function listCourses(userId: string, includeArchived = false): Promise<CourseRow[]> {
  const db = await getDb();
  const where = includeArchived
    ? eq(courses.userId, userId)
    : and(eq(courses.userId, userId), eq(courses.archived, false));
  return db.select().from(courses).where(where).orderBy(asc(courses.position), asc(courses.code));
}

export async function listMeetings(userId: string): Promise<MeetingRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(courseMeetings)
    .where(eq(courseMeetings.userId, userId))
    .orderBy(asc(courseMeetings.weekday), asc(courseMeetings.startMinute));
}

export async function getCourse(userId: string, courseId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  const meetings = await db
    .select()
    .from(courseMeetings)
    .where(eq(courseMeetings.courseId, courseId))
    .orderBy(asc(courseMeetings.weekday), asc(courseMeetings.startMinute));
  return { course: rows[0], meetings };
}

export async function createCourse(
  userId: string,
  input: CreateCourseInput,
  actor: Actor,
): Promise<CourseRow> {
  const db = await getDb();
  const [max] = await db
    .select({ max: sql<number>`coalesce(max(${courses.position}), -1)` })
    .from(courses)
    .where(eq(courses.userId, userId));

  const [row] = await db
    .insert(courses)
    .values({
      userId,
      code: input.code.toUpperCase(),
      title: input.title,
      instructor: input.instructor ?? null,
      room: input.room ?? null,
      color: input.color,
      icon: input.icon ?? null,
      shortLabel: input.shortLabel ?? input.code.slice(0, 4).toUpperCase(),
      units: input.units ?? null,
      termId: input.termId ?? null,
      position: (max?.max ?? -1) + 1,
    })
    .returning();

  const course = row!;
  await db.insert(enrollments).values({ userId, courseId: course.id }).onConflictDoNothing();
  if (input.meetings.length) {
    await db.insert(courseMeetings).values(
      input.meetings.map((m) => ({
        userId,
        courseId: course.id,
        weekday: m.weekday,
        startMinute: m.startMinute,
        endMinute: m.endMinute,
        location: m.location ?? null,
        modality: m.modality,
        timeZone: m.timeZone ?? DEFAULT_TIME_ZONE,
      })),
    );
  }
  await recordAudit({ userId, actor, action: 'course.created', entityType: 'course', entityId: course.id });
  return course;
}

export async function updateCourse(
  userId: string,
  courseId: string,
  patch: Partial<CreateCourseInput> & { archived?: boolean },
  actor: Actor,
): Promise<CourseRow> {
  const db = await getDb();
  const next: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ['title', 'instructor', 'room', 'color', 'icon', 'shortLabel', 'units', 'termId', 'archived'] as const) {
    if (patch[key as keyof typeof patch] !== undefined) next[key] = patch[key as keyof typeof patch];
  }
  if (patch.code) next.code = patch.code.toUpperCase();

  const rows = await db
    .update(courses)
    .set(next)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .returning();
  if (!rows[0]) throw new NotFoundError('Course');

  if (patch.meetings) {
    await db.delete(courseMeetings).where(eq(courseMeetings.courseId, courseId));
    if (patch.meetings.length) {
      await db.insert(courseMeetings).values(
        patch.meetings.map((m) => ({
          userId,
          courseId,
          weekday: m.weekday,
          startMinute: m.startMinute,
          endMinute: m.endMinute,
          location: m.location ?? null,
          modality: m.modality,
          timeZone: m.timeZone ?? DEFAULT_TIME_ZONE,
        })),
      );
    }
  }
  await recordAudit({
    userId,
    actor,
    action: 'course.updated',
    entityType: 'course',
    entityId: courseId,
    detail: { fields: Object.keys(next) },
  });
  return rows[0];
}

/** Workload rollup used by the Courses screen and the course-workload widget. */
export async function courseWorkload(userId: string) {
  const db = await getDb();
  return db
    .select({
      courseId: courses.id,
      code: courses.code,
      title: courses.title,
      color: courses.color,
      shortLabel: courses.shortLabel,
      open: sql<number>`count(*) filter (where ${tasks.status} in ('inbox','planned','in_progress'))::int`,
      submitted: sql<number>`count(*) filter (where ${tasks.status} = 'submitted')::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < now() and ${tasks.status} not in ('done','submitted','archived'))::int`,
      nextDueAt: sql<Date | null>`min(${tasks.dueAt}) filter (where ${tasks.status} not in ('done','submitted','archived'))`,
    })
    .from(courses)
    .leftJoin(tasks, and(eq(tasks.courseId, courses.id), sql`${tasks.status} <> 'archived'`))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false)))
    .groupBy(courses.id, courses.code, courses.title, courses.color, courses.shortLabel)
    .orderBy(asc(courses.position), asc(courses.code));
}

/** Resolve a Blackboard-style course code to a local course, tolerantly. */
export async function findCourseByCode(userId: string, code: string): Promise<CourseRow | null> {
  if (!code) return null;
  const db = await getDb();
  const normalized = code.trim().toUpperCase().replace(/[\s_-]+/g, '');
  const all = await db.select().from(courses).where(eq(courses.userId, userId));
  return (
    all.find((c) => c.code.toUpperCase().replace(/[\s_-]+/g, '') === normalized) ??
    all.find((c) => normalized.startsWith(c.code.toUpperCase().replace(/[\s_-]+/g, ''))) ??
    null
  );
}
