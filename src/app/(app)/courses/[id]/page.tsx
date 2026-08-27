import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { announcements, attachments, notes, tasks } from '@/lib/db/schema';
import { getCourse } from '@/lib/domain/courses';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { TaskRow } from '@/components/tasks/TaskRow';
import { formatMinuteOfDay, formatRelative } from '@/lib/shared/time';
import { CourseSettingsPanel } from '@/components/courses/CourseSettingsPanel';

export const dynamic = 'force-dynamic';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user) return { title: 'Course' };
  const found = await getCourse(user.id, (await params).id);
  return { title: found ? `${found.course.code}` : 'Course' };
}

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const found = await getCourse(user.id, id);
  if (!found) notFound();
  const { course, meetings } = found;

  const db = await getDb();
  const now = new Date();
  const [openTasks, doneTasks, courseNotes, courseAnnouncements, files] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), eq(tasks.courseId, id), sql`${tasks.status} not in ('done','archived')`))
      .orderBy(sql`${tasks.dueAt} asc nulls last`)
      .limit(50),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), eq(tasks.courseId, id), eq(tasks.status, 'done')))
      .orderBy(desc(tasks.completedAt))
      .limit(10),
    db.select().from(notes).where(and(eq(notes.userId, user.id), eq(notes.courseId, id))).orderBy(desc(notes.updatedAt)).limit(10),
    db
      .select()
      .from(announcements)
      .where(and(eq(announcements.userId, user.id), eq(announcements.courseId, id)))
      .orderBy(desc(announcements.publishedAt))
      .limit(6),
    db.select().from(attachments).where(and(eq(attachments.userId, user.id), eq(attachments.courseId, id))).limit(20),
  ]);

  const toRow = (t: typeof openTasks[number]) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    type: t.type,
    priority: t.priority,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    allDay: t.allDay,
    estimateMinutes: t.estimateMinutes,
    source: t.source,
    courseCode: course.code,
    courseColor: course.color,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 text-[13px] text-ink-3">
        <Link href="/courses" className="hover:underline">
          Courses
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-2">{course.code}</span>
      </nav>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg"
            style={{ background: `color-mix(in srgb, ${course.color} 18%, transparent)`, color: course.color }}
            aria-hidden
          >
            {course.icon ?? course.code.slice(0, 2)}
          </span>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{course.code}</p>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{course.title}</h1>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {[course.instructor, course.room, course.units ? `${course.units} units` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <CourseSettingsPanel
          course={{
            id: course.id,
            code: course.code,
            title: course.title,
            instructor: course.instructor,
            room: course.room,
            color: course.color,
            icon: course.icon,
            units: course.units,
          }}
          meetings={meetings.map((m) => ({
            weekday: m.weekday,
            startMinute: m.startMinute,
            endMinute: m.endMinute,
            location: m.location,
            modality: m.modality,
          }))}
        />
      </header>

      <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <CardHeader title="Open work" subtitle={`${openTasks.length} items`} />
            {openTasks.length === 0 ? (
              <EmptyState title="Nothing open" description="Everything for this course is submitted or done." />
            ) : (
              <ul>
                {openTasks.map((t) => (
                  <TaskRow key={t.id} task={toRow(t)} timeZone={user.timeZone} now={now.toISOString()} showCourse={false} />
                ))}
              </ul>
            )}
          </Card>

          {doneTasks.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Recently completed" />
              <ul>
                {doneTasks.map((t) => (
                  <TaskRow key={t.id} task={toRow(t)} timeZone={user.timeZone} now={now.toISOString()} showCourse={false} dense />
                ))}
              </ul>
            </Card>
          )}

          {courseAnnouncements.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Announcements" />
              <ul className="divide-y divide-[var(--c-line)]">
                {courseAnnouncements.map((a) => (
                  <li key={a.id}>
                    <Link href={`/announcements/${a.id}`} className="block px-4 py-2.5 hover:bg-surface-2">
                      <div className="flex items-center gap-2">
                        {!a.readAt && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-label="Unread" />}
                        <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{a.title}</p>
                        <span className="numeric shrink-0 text-[11px] text-ink-3">
                          {formatRelative(a.publishedAt, now)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader title="Schedule" />
            {meetings.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">No meeting times set.</p>
            ) : (
              <ul className="divide-y divide-[var(--c-line)]">
                {meetings.map((m) => (
                  <li key={m.id} className="px-4 py-2">
                    <p className="text-[13px] font-medium text-ink">{DAY_NAMES[m.weekday]}</p>
                    <p className="numeric text-[12px] text-ink-3">
                      {formatMinuteOfDay(m.startMinute)}–{formatMinuteOfDay(m.endMinute)}
                      {m.location ? ` · ${m.location}` : ''}
                    </p>
                    {m.modality !== 'onsite' && <Badge tone="info">{m.modality}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Notes"
              action={
                <Link href={`/notes?courseId=${course.id}`} className="text-[12px] font-medium text-brand hover:underline">
                  All
                </Link>
              }
            />
            {courseNotes.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">No notes for this course.</p>
            ) : (
              <ul className="divide-y divide-[var(--c-line)]">
                {courseNotes.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes?note=${n.id}`} className="block px-4 py-2 text-[13px] text-ink hover:bg-surface-2">
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {files.length > 0 && (
            <Card>
              <CardHeader title="Files" />
              <ul className="divide-y divide-[var(--c-line)]">
                {files.map((f) => (
                  <li key={f.id} className="px-4 py-2">
                    <a href={`/api/attachments/${f.id}/download`} className="text-[13px] text-ink hover:underline">
                      {f.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
