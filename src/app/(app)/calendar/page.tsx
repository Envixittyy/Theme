import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getPreferences } from '@/lib/auth/session';
import { calendarRange, loadCalendar, type CalendarView as ViewName } from '@/lib/domain/calendar';
import { listCourses } from '@/lib/domain/courses';
import { CalendarView } from '@/components/calendar/CalendarView';
import { zonedToUtc } from '@/lib/shared/time';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

const VIEWS: ViewName[] = ['month', 'week', 'agenda', 'timetable'];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const prefs = await getPreferences(user.id);

  const view = (typeof params.view === 'string' && VIEWS.includes(params.view as ViewName)
    ? params.view
    : 'month') as ViewName;

  const now = new Date();
  const anchor =
    typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? zonedToUtc(
          {
            year: Number(params.date.slice(0, 4)),
            month: Number(params.date.slice(5, 7)),
            day: Number(params.date.slice(8, 10)),
            hour: 12,
          },
          user.timeZone,
        )
      : now;

  const courseId = typeof params.courseId === 'string' ? params.courseId : '';
  const showClasses = params.classes !== '0';
  const showDeadlines = params.deadlines !== '0';
  const showCompleted = params.completed === '1';

  const range = calendarRange(view, anchor, user.timeZone, prefs.weekStartsOn);
  const [{ tasks, meetings }, courses] = await Promise.all([
    loadCalendar(user.id, range, { courseId: courseId || null, includeCompleted: showCompleted }),
    listCourses(user.id),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Calendar</h1>
        <Link
          href="/api/calendar/feed"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-2"
        >
          <Icon name="download" size={14} />
          Subscribe / export
        </Link>
      </header>

      <CalendarView
        view={view}
        anchorIso={anchor.toISOString()}
        nowIso={now.toISOString()}
        tasks={tasks}
        meetings={meetings}
        courses={courses.map((c) => ({ id: c.id, code: c.code, color: c.color }))}
        timeZone={user.timeZone}
        weekStartsOn={prefs.weekStartsOn}
        filters={{ courseId, showClasses, showDeadlines, showCompleted }}
      />
    </div>
  );
}
