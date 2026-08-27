import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { courseWorkload, listCourses, listMeetings } from '@/lib/domain/courses';
import { Badge, Card, EmptyState, Meter } from '@/components/ui/primitives';
import { formatMinuteOfDay, formatRelative } from '@/lib/shared/time';
import { CourseCreateButton } from '@/components/courses/CourseCreateButton';

export const metadata: Metadata = { title: 'Courses' };
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [courses, meetings, workload] = await Promise.all([
    listCourses(user.id),
    listMeetings(user.id),
    courseWorkload(user.id),
  ]);
  const workloadById = new Map(workload.map((w) => [w.courseId, w]));
  const meetingsByCourse = new Map<string, typeof meetings>();
  for (const m of meetings) {
    meetingsByCourse.set(m.courseId, [...(meetingsByCourse.get(m.courseId) ?? []), m]);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Courses</h1>
          <p className="text-[13px] text-ink-3">{courses.length} active this term</p>
        </div>
        <CourseCreateButton />
      </header>

      {courses.length === 0 ? (
        <Card>
          <EmptyState
            title="No courses yet"
            description="Add your courses to colour-code deadlines, build the timetable and match Blackboard items automatically."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => {
            const stats = workloadById.get(course.id);
            const courseMeetings = meetingsByCourse.get(course.id) ?? [];
            const total = (stats?.open ?? 0) + (stats?.submitted ?? 0) + (stats?.done ?? 0);
            return (
              <Card key={course.id} as="li" className="overflow-hidden">
                <div className="h-1.5" style={{ background: course.color }} aria-hidden />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/courses/${course.id}`} className="block hover:underline">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                          {course.icon ? `${course.icon} ` : ''}
                          {course.code}
                        </p>
                        <h2 className="truncate text-[15px] font-semibold text-ink">{course.title}</h2>
                      </Link>
                      {course.instructor && <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{course.instructor}</p>}
                    </div>
                    {(stats?.overdue ?? 0) > 0 && <Badge tone="danger">{stats!.overdue} overdue</Badge>}
                  </div>

                  {courseMeetings.length > 0 && (
                    <ul className="mt-3 space-y-0.5 text-[12px] text-ink-2">
                      {courseMeetings.map((m) => (
                        <li key={m.id} className="numeric">
                          {DAY_NAMES[m.weekday]} {formatMinuteOfDay(m.startMinute)}–{formatMinuteOfDay(m.endMinute)}
                          {m.location ? ` · ${m.location}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3">
                    <Meter
                      value={(stats?.done ?? 0) + (stats?.submitted ?? 0)}
                      max={Math.max(1, total)}
                      label={`${course.code} progress`}
                    />
                    <p className="mt-1.5 text-[11.5px] text-ink-3">
                      {stats?.open ?? 0} open · {stats?.submitted ?? 0} submitted · {stats?.done ?? 0} done
                      {stats?.nextDueAt ? ` · next ${formatRelative(new Date(stats.nextDueAt))}` : ''}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
