import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getLayout } from '@/lib/domain/dashboard';
import { loadTodayData } from '@/lib/domain/today';
import { WidgetGrid, type Layouts } from '@/components/dashboard/WidgetGrid';
import { DashboardEditor } from '@/components/dashboard/DashboardEditor';
import { formatDate } from '@/lib/shared/time';
import { Badge } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const now = new Date();
  const [data, mobile, tablet, desktop] = await Promise.all([
    loadTodayData(user.id, user.timeZone, now),
    getLayout(user.id, 'mobile'),
    getLayout(user.id, 'tablet'),
    getLayout(user.id, 'desktop'),
  ]);

  const layouts: Layouts = {
    mobile: mobile.map((w) => ({ widgetKey: w.widgetKey, position: w.position, span: w.span, height: w.height, hidden: w.hidden })),
    tablet: tablet.map((w) => ({ widgetKey: w.widgetKey, position: w.position, span: w.span, height: w.height, hidden: w.hidden })),
    desktop: desktop.map((w) => ({ widgetKey: w.widgetKey, position: w.position, span: w.span, height: w.height, hidden: w.hidden })),
  };

  const firstName = user.displayName.split(/[\s.@]/)[0] || 'there';
  const greeting = greetingFor(now, user.timeZone);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {greeting}, {firstName}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <time dateTime={now.toISOString()}>{formatDate(now, { timeZone: user.timeZone })}</time>
            {data.dueToday.length > 0 && <Badge tone="brand">{data.dueToday.length} due today</Badge>}
            {data.overdue.length > 0 && <Badge tone="danger">{data.overdue.length} overdue</Badge>}
            {data.inboxCount > 0 && <Badge tone="neutral">{data.inboxCount} in inbox</Badge>}
          </p>
        </div>
        <DashboardEditor layouts={layouts} />
      </header>

      <WidgetGrid layouts={layouts} data={data} />
    </div>
  );
}

function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now),
  );
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
