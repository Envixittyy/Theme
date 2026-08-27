import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Badge, Card, CardHeader, EmptyState, Meter, cx } from '@/components/ui/primitives';
import type { TodayData } from '@/lib/domain/today';
import { TaskRow } from '@/components/tasks/TaskRow';
import { formatDate, formatMinuteOfDay, formatRelative, isoDateIn, minutesSinceMidnightIn, startOfDayIn, addDaysIn } from '@/lib/shared/time';
import { WIDGET_CATALOG } from '@/lib/domain/widget-catalog';

/**
 * Widget bodies.
 *
 * Each one renders from the single `TodayData` payload — no widget fetches for
 * itself — and each has a real empty state, because a fresh account and a
 * disconnected integration are normal conditions, not errors.
 */

function toRow(t: TodayData['dueToday'][number]) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    type: t.type,
    priority: t.priority,
    dueAt: t.dueAt,
    allDay: t.allDay,
    estimateMinutes: t.estimateMinutes,
    source: t.source,
    courseCode: t.courseCode,
    courseColor: t.courseColor,
  };
}

function TaskListBody({
  tasks,
  data,
  emptyTitle,
  emptyBody,
}: {
  tasks: TodayData['dueToday'];
  data: TodayData;
  emptyTitle: string;
  emptyBody?: string;
}) {
  if (!tasks.length) return <EmptyState title={emptyTitle} description={emptyBody} />;
  return (
    <ul>
      {tasks.slice(0, 8).map((task) => (
        <TaskRow key={task.id} task={toRow(task)} timeZone={data.timeZone} now={data.now.toISOString()} dense />
      ))}
    </ul>
  );
}

export function WidgetBody({ widgetKey, data }: { widgetKey: string; data: TodayData }) {
  switch (widgetKey) {
    case 'today-schedule': {
      const nowMinute = minutesSinceMidnightIn(data.now, data.timeZone);
      if (!data.meetings.length) {
        return <EmptyState title="No classes today" description="Add meeting times on a course to see them here." />;
      }
      return (
        <ul className="divide-y divide-[var(--c-line)]">
          {data.meetings.map((m) => {
            const current = nowMinute >= m.startMinute && nowMinute < m.endMinute;
            const past = nowMinute >= m.endMinute;
            return (
              <li
                key={m.id}
                className={cx('flex items-center gap-3 px-3 py-2.5', past && 'opacity-55')}
              >
                <div className="numeric w-[4.75rem] shrink-0 text-right">
                  <p className="text-[13px] font-semibold text-ink">{formatMinuteOfDay(m.startMinute)}</p>
                  <p className="text-[11px] text-ink-3">{formatMinuteOfDay(m.endMinute)}</p>
                </div>
                <span
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ background: m.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    <Link href={`/courses/${m.courseId}`} className="hover:underline">
                      {m.code} — {m.title}
                    </Link>
                  </p>
                  <p className="truncate text-[11.5px] text-ink-3">
                    {m.location ?? m.room ?? 'Room TBA'}
                    {m.modality !== 'onsite' ? ` · ${m.modality}` : ''}
                    {m.instructor ? ` · ${m.instructor}` : ''}
                  </p>
                </div>
                {current && <Badge tone="brand">Now</Badge>}
              </li>
            );
          })}
        </ul>
      );
    }

    case 'due-today':
      return (
        <TaskListBody
          tasks={data.dueToday}
          data={data}
          emptyTitle="Nothing due today"
          emptyBody="Anything you add with today's date lands here."
        />
      );

    case 'overdue':
      return (
        <TaskListBody
          tasks={data.overdue}
          data={data}
          emptyTitle="Nothing overdue"
          emptyBody="Submitted and completed work is excluded."
        />
      );

    case 'upcoming-7': {
      if (!data.upcoming.length) {
        return <EmptyState title="The next seven days are clear" />;
      }
      const groups = new Map<string, TodayData['upcoming']>();
      for (const task of data.upcoming) {
        if (!task.dueAt) continue;
        const key = isoDateIn(task.dueAt, data.timeZone);
        groups.set(key, [...(groups.get(key) ?? []), task]);
      }
      return (
        <div className="divide-y divide-[var(--c-line)]">
          {[...groups.entries()].slice(0, 7).map(([day, items]) => (
            <div key={day} className="px-3 py-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                {formatDate(new Date(`${day}T12:00:00Z`), { timeZone: 'UTC' })}
              </p>
              <ul className="space-y-1">
                {items.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-[13px]">
                    <span
                      className="course-dot"
                      style={{ ['--course-color' as string]: t.courseColor ?? 'var(--c-brand)' }}
                      aria-hidden
                    />
                    <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                      {t.title}
                    </Link>
                    <span className="numeric shrink-0 text-[11px] text-ink-3">{t.courseCode ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }

    case 'recent-blackboard': {
      if (!data.recentExternal.length) {
        return (
          <EmptyState
            title="No imported items yet"
            description="Connect a Blackboard calendar feed to see newly posted work here."
            action={
              <Link href="/settings/integrations" className="text-[13px] font-medium text-brand underline">
                Connect Blackboard
              </Link>
            }
          />
        );
      }
      return (
        <ul className="divide-y divide-[var(--c-line)]">
          {data.recentExternal.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2">
              <span
                className="course-dot"
                style={{ ['--course-color' as string]: item.color ?? 'var(--c-brand)' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">
                  {item.entityId ? (
                    <Link href={`/tasks/${item.entityId}`} className="hover:underline">
                      {item.title ?? 'Imported item'}
                    </Link>
                  ) : (
                    (item.title ?? 'Imported item')
                  )}
                </p>
                <p className="text-[11px] text-ink-3">
                  {item.courseCode ?? 'No course'} · discovered {formatRelative(item.firstSeenAt, data.now)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      );
    }

    case 'latest-announcements': {
      if (!data.latestAnnouncements.length) {
        return (
          <EmptyState
            title="No announcements"
            description="Announcement intake needs institution API access or authorised email forwarding."
          />
        );
      }
      return (
        <ul className="divide-y divide-[var(--c-line)]">
          {data.latestAnnouncements.map((a) => (
            <li key={a.id} className="px-3 py-2">
              <Link href={`/announcements/${a.id}`} className="group block">
                <div className="flex items-center gap-2">
                  {!a.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                  <p className={cx('min-w-0 flex-1 truncate text-[13px] group-hover:underline', a.readAt ? 'text-ink-2' : 'font-medium text-ink')}>
                    {a.title}
                  </p>
                  <span className="numeric shrink-0 text-[11px] text-ink-3">
                    {formatRelative(a.publishedAt, data.now)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-3">{a.bodyExcerpt}</p>
              </Link>
            </li>
          ))}
        </ul>
      );
    }

    case 'course-workload': {
      if (!data.workload.length) return <EmptyState title="No courses yet" />;
      return (
        <ul className="space-y-2.5 px-3 py-3">
          {data.workload.map((w) => (
            <li key={w.courseId}>
              <div className="mb-1 flex items-center gap-2 text-[12.5px]">
                <span className="course-dot" style={{ ['--course-color' as string]: w.color }} aria-hidden />
                <Link href={`/courses/${w.courseId}`} className="font-medium text-ink hover:underline">
                  {w.code}
                </Link>
                <span className="ml-auto numeric text-[11px] text-ink-3">
                  {w.open} open{w.overdue > 0 ? ` · ${w.overdue} overdue` : ''}
                </span>
              </div>
              <Meter
                value={w.done + w.submitted}
                max={Math.max(1, w.open + w.submitted + w.done)}
                label={`${w.code}: ${w.done + w.submitted} of ${w.open + w.submitted + w.done} finished`}
              />
            </li>
          ))}
        </ul>
      );
    }

    case 'calendar-preview': {
      const start = startOfDayIn(data.now, data.timeZone);
      const days = Array.from({ length: 28 }, (_, i) => addDaysIn(start, i - 7, data.timeZone));
      const counts = new Map<string, number>();
      for (const t of [...data.dueToday, ...data.upcoming, ...data.overdue]) {
        if (!t.dueAt) continue;
        const key = isoDateIn(t.dueAt, data.timeZone);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const todayKey = isoDateIn(data.now, data.timeZone);
      return (
        <div className="p-3">
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Deadline density, four weeks">
            {days.map((d) => {
              const key = isoDateIn(d, data.timeZone);
              const count = counts.get(key) ?? 0;
              const isToday = key === todayKey;
              return (
                <Link
                  key={key}
                  href={`/calendar?date=${key}`}
                  role="gridcell"
                  aria-label={`${key}, ${count} due`}
                  className={cx(
                    'grid aspect-square place-items-center rounded text-[11px] transition-colors',
                    isToday ? 'ring-1 ring-brand' : '',
                    count === 0
                      ? 'bg-surface-2 text-ink-3'
                      : count < 2
                        ? 'bg-brand/20 text-ink'
                        : count < 4
                          ? 'bg-brand/45 text-ink'
                          : 'bg-brand text-brand-ink',
                  )}
                >
                  {key.slice(-2)}
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Shading shows how many deadlines fall on each day.</p>
        </div>
      );
    }

    case 'sync-health': {
      const { accounts, runs, openConflicts, missingUpstream } = data.health;
      const lastGood = runs.find((r) => r.status === 'succeeded' || r.status === 'partial');
      return (
        <div className="space-y-2 px-3 py-3 text-[12.5px]">
          {accounts.length === 0 ? (
            <EmptyState
              title="No integrations connected"
              description="Blackboard and Notion are optional — everything works without them."
              action={
                <Link href="/settings/integrations" className="text-[13px] font-medium text-brand underline">
                  Set one up
                </Link>
              }
            />
          ) : (
            <>
              <ul className="space-y-1.5">
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <span
                      className={cx(
                        'h-2 w-2 rounded-full',
                        a.status === 'connected' ? 'bg-success' : a.status === 'error' ? 'bg-danger' : 'bg-ink-3',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{a.label}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">{a.status}</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-3">
                {lastGood
                  ? `Last successful sync ${formatRelative(lastGood.finishedAt ?? lastGood.startedAt, data.now)}`
                  : 'No successful sync yet'}
              </p>
              {(openConflicts > 0 || missingUpstream > 0) && (
                <p className="rounded-md bg-warn-soft px-2 py-1.5 text-warn">
                  {openConflicts > 0 && `${openConflicts} conflict${openConflicts === 1 ? '' : 's'} to review. `}
                  {missingUpstream > 0 && `${missingUpstream} item${missingUpstream === 1 ? '' : 's'} no longer in the feed.`}
                </p>
              )}
              <Link href="/settings/sync" className="inline-block font-medium text-brand underline">
                Sync details
              </Link>
            </>
          )}
        </div>
      );
    }

    case 'quick-note':
      return <QuickNoteWidget />;

    default:
      return <EmptyState title="Unknown widget" description={widgetKey} />;
  }
}

export function widgetTitle(key: string): string {
  return WIDGET_CATALOG.find((w) => w.key === key)?.name ?? key;
}

export function WidgetCount({ widgetKey, data }: { widgetKey: string; data: TodayData }) {
  const counts: Record<string, number> = {
    'due-today': data.dueToday.length,
    overdue: data.overdue.length,
    'upcoming-7': data.upcoming.length,
    'today-schedule': data.meetings.length,
    'latest-announcements': data.unreadAnnouncements,
  };
  const n = counts[widgetKey];
  if (!n) return null;
  return (
    <span className="numeric rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{n}</span>
  );
}

/* The quick note widget is interactive, so it lives in its own client island. */
import { QuickNoteWidget } from './QuickNoteWidget';

export function WidgetCard({
  widgetKey,
  data,
  href,
}: {
  widgetKey: string;
  data: TodayData;
  href?: string;
}) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader
        title={
          href ? (
            <Link href={href} className="hover:underline">
              {widgetTitle(widgetKey)}
            </Link>
          ) : (
            widgetTitle(widgetKey)
          )
        }
        action={
          <>
            <WidgetCount widgetKey={widgetKey} data={data} />
            {href ? (
              <Link
                href={href}
                className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
                aria-label={`Open ${widgetTitle(widgetKey)}`}
              >
                <Icon name="chevronRight" size={15} />
              </Link>
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <WidgetBody widgetKey={widgetKey} data={data} />
      </div>
    </Card>
  );
}
