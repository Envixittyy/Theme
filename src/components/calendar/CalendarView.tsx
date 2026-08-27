'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { Badge, Card, cx, EmptyState } from '@/components/ui/primitives';
import type { CalendarMeeting, CalendarTask, CalendarView as ViewName } from '@/lib/domain/calendar';
import { TASK_TYPE_GLYPH } from '@/lib/domain/task-type';
import {
  addDaysIn,
  formatDate,
  formatMinuteOfDay,
  formatTime,
  isoDateIn,
  minutesSinceMidnightIn,
  startOfDayIn,
  startOfWeekIn,
  wallClockIn,
} from '@/lib/shared/time';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GRID_START = 7 * 60;
const GRID_END = 21 * 60;
const PX_PER_MIN = 0.9;

export type CalendarProps = {
  view: ViewName;
  anchorIso: string;
  tasks: CalendarTask[];
  meetings: CalendarMeeting[];
  courses: Array<{ id: string; code: string; color: string }>;
  timeZone: string;
  weekStartsOn: number;
  nowIso: string;
  filters: { courseId: string; showClasses: boolean; showDeadlines: boolean; showCompleted: boolean };
};

/**
 * Four views over one dataset.
 *
 * Classes and deadlines are drawn differently on purpose — a class is a block
 * of time you must be somewhere, a deadline is an instant you must have
 * finished by — and each can be toggled independently, because revision week
 * and class week need different pictures.
 */
export function CalendarView(props: CalendarProps) {
  const { view, tasks, meetings, timeZone, weekStartsOn, filters } = props;
  const router = useRouter();
  const search = useSearchParams();
  const anchor = useMemo(() => new Date(props.anchorIso), [props.anchorIso]);
  const now = useMemo(() => new Date(props.nowIso), [props.nowIso]);
  const [selected, setSelected] = useState<CalendarTask | CalendarMeeting | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(search.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.push(`/calendar?${next.toString()}`);
  };

  const shift = (direction: number) => {
    const step = view === 'month' ? 28 : view === 'agenda' ? 30 : 7;
    setParam('date', isoDateIn(addDaysIn(anchor, direction * step, timeZone), timeZone));
  };

  const visibleTasks = filters.showDeadlines ? tasks : [];
  const visibleMeetings = filters.showClasses ? meetings : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-2 hover:bg-surface-2"
            aria-label="Previous period"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            onClick={() => setParam('date', isoDateIn(now, timeZone))}
            className="min-h-9 rounded-md border border-line px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-2"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-2 hover:bg-surface-2"
            aria-label="Next period"
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>

        <h2 className="text-[15px] font-semibold text-ink" aria-live="polite">
          {periodLabel(view, anchor, timeZone, weekStartsOn)}
        </h2>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-line p-0.5" role="tablist" aria-label="Calendar view">
            {(['month', 'week', 'agenda', 'timetable'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setParam('view', v)}
                className={cx(
                  'min-h-8 rounded px-2.5 text-[12.5px] font-medium capitalize',
                  view === v ? 'bg-brand text-brand-ink' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                {v}
              </button>
            ))}
          </div>

          <select
            value={filters.courseId}
            onChange={(e) => setParam('courseId', e.target.value || null)}
            className="min-h-9 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink"
            aria-label="Filter by course"
          >
            <option value="">All courses</option>
            {props.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-ink-2">
        {(
          [
            ['classes', 'Classes', filters.showClasses],
            ['deadlines', 'Deadlines', filters.showDeadlines],
            ['completed', 'Completed', filters.showCompleted],
          ] as const
        ).map(([key, label, checked]) => (
          <label key={key} className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setParam(key, e.target.checked ? '1' : '0')}
              className="h-4 w-4 accent-[var(--c-brand)]"
            />
            {label}
          </label>
        ))}
      </div>

      {view === 'month' && (
        <MonthGrid {...props} tasks={visibleTasks} onSelect={setSelected} anchor={anchor} now={now} />
      )}
      {view === 'week' && (
        <WeekGrid {...props} tasks={visibleTasks} meetings={visibleMeetings} onSelect={setSelected} anchor={anchor} now={now} />
      )}
      {view === 'agenda' && <AgendaList {...props} tasks={visibleTasks} meetings={visibleMeetings} anchor={anchor} now={now} />}
      {view === 'timetable' && <Timetable {...props} meetings={visibleMeetings} onSelect={setSelected} now={now} />}

      {selected && <DetailPanel item={selected} timeZone={timeZone} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* --------------------------------- month --------------------------------- */

function MonthGrid({
  tasks,
  timeZone,
  weekStartsOn,
  anchor,
  now,
  onSelect,
}: CalendarProps & { anchor: Date; now: Date; onSelect: (t: CalendarTask) => void }) {
  const start = startOfWeekIn(startOfMonth(anchor, timeZone), timeZone, weekStartsOn);
  const days = Array.from({ length: 42 }, (_, i) => addDaysIn(start, i, timeZone));
  const anchorMonth = wallClockIn(anchor, timeZone).month;
  const todayKey = isoDateIn(now, timeZone);

  const byDay = new Map<string, CalendarTask[]>();
  for (const task of tasks) {
    const key = isoDateIn(new Date(task.dueAt), timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), task]);
  }

  const headers = Array.from({ length: 7 }, (_, i) => DAY_NAMES[(weekStartsOn + i) % 7]!);

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2">
        {headers.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = isoDateIn(day, timeZone);
          const items = byDay.get(key) ?? [];
          const wc = wallClockIn(day, timeZone);
          const outside = wc.month !== anchorMonth;
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={cx(
                'min-h-[5.5rem] border-b border-r border-line p-1 last:border-r-0',
                outside && 'bg-surface-2/50',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cx(
                    'numeric grid h-6 w-6 place-items-center rounded-full text-[11.5px]',
                    isToday ? 'bg-brand font-semibold text-brand-ink' : outside ? 'text-ink-3' : 'text-ink-2',
                  )}
                >
                  {wc.day}
                </span>
                {items.length > 2 && <span className="numeric text-[10px] text-ink-3">{items.length}</span>}
              </div>
              <ul className="space-y-0.5">
                {items.slice(0, 3).map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(task)}
                      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-surface-2"
                      style={{ borderLeft: `3px solid ${task.courseColor ?? 'var(--c-brand)'}` }}
                    >
                      <span aria-hidden className="shrink-0 opacity-70">
                        {TASK_TYPE_GLYPH[task.type as keyof typeof TASK_TYPE_GLYPH] ?? '•'}
                      </span>
                      <span className={cx('truncate', task.status === 'done' && 'line-through opacity-60')}>
                        {task.title}
                      </span>
                    </button>
                  </li>
                ))}
                {items.length > 3 && (
                  <li>
                    <Link href={`/calendar?view=agenda&date=${key}`} className="px-1 text-[10.5px] text-ink-3 hover:underline">
                      +{items.length - 3} more
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function startOfMonth(anchor: Date, timeZone: string): Date {
  const wc = wallClockIn(anchor, timeZone);
  return new Date(Date.UTC(wc.year, wc.month - 1, 1, 12));
}

/* ---------------------------------- week ---------------------------------- */

function WeekGrid({
  tasks,
  meetings,
  timeZone,
  weekStartsOn,
  anchor,
  now,
  onSelect,
}: CalendarProps & { anchor: Date; now: Date; onSelect: (item: CalendarTask | CalendarMeeting) => void }) {
  const start = startOfWeekIn(anchor, timeZone, weekStartsOn);
  const days = Array.from({ length: 7 }, (_, i) => addDaysIn(start, i, timeZone));
  const todayKey = isoDateIn(now, timeZone);
  const nowMinute = minutesSinceMidnightIn(now, timeZone);
  const hours = Array.from({ length: (GRID_END - GRID_START) / 60 + 1 }, (_, i) => GRID_START + i * 60);

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scroll-thin">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-[3.9rem_repeat(7,1fr)] border-b border-line bg-surface-2">
            <div />
            {days.map((day) => {
              const key = isoDateIn(day, timeZone);
              const wc = wallClockIn(day, timeZone);
              return (
                <div key={key} className={cx('px-1 py-1.5 text-center', key === todayKey && 'bg-brand-soft')}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    {DAY_NAMES[new Date(Date.UTC(wc.year, wc.month - 1, wc.day)).getUTCDay()]}
                  </p>
                  <p className="numeric text-[13px] font-semibold text-ink">{wc.day}</p>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid grid-cols-[3.9rem_repeat(7,1fr)]"
            style={{ height: `${(GRID_END - GRID_START) * PX_PER_MIN + 14}px` }}
          >
            <div className="relative border-r border-line">
              {hours.map((minute) => (
                <div
                  key={minute}
                  className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-[10.5px] text-ink-3"
                  style={{ top: `${(minute - GRID_START) * PX_PER_MIN}px` }}
                >
                  {formatMinuteOfDay(minute)}
                </div>
              ))}
            </div>

            {days.map((day) => {
              const key = isoDateIn(day, timeZone);
              const weekday = new Date(
                Date.UTC(
                  wallClockIn(day, timeZone).year,
                  wallClockIn(day, timeZone).month - 1,
                  wallClockIn(day, timeZone).day,
                ),
              ).getUTCDay();
              const dayMeetings = meetings.filter((m) => m.weekday === weekday);
              const dayTasks = tasks.filter((t) => isoDateIn(new Date(t.dueAt), timeZone) === key);

              return (
                <div key={key} className="relative border-r border-line last:border-r-0">
                  {hours.map((minute) => (
                    <div
                      key={minute}
                      className="absolute inset-x-0 border-t border-line/60"
                      style={{ top: `${(minute - GRID_START) * PX_PER_MIN}px` }}
                    />
                  ))}

                  {key === todayKey && nowMinute >= GRID_START && nowMinute <= GRID_END && (
                    <div
                      className="absolute inset-x-0 z-10 border-t-2 border-brand"
                      style={{ top: `${(nowMinute - GRID_START) * PX_PER_MIN}px` }}
                      aria-hidden
                    />
                  )}

                  {dayMeetings.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m)}
                      className="absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[10.5px] leading-tight"
                      style={{
                        top: `${(m.startMinute - GRID_START) * PX_PER_MIN}px`,
                        height: `${Math.max(18, (m.endMinute - m.startMinute) * PX_PER_MIN)}px`,
                        background: `color-mix(in srgb, ${m.color} 18%, transparent)`,
                        borderLeft: `3px solid ${m.color}`,
                      }}
                    >
                      <span className="block truncate font-semibold text-ink">{m.code}</span>
                      <span className="block truncate text-ink-2">{formatMinuteOfDay(m.startMinute)}</span>
                    </button>
                  ))}

                  {dayTasks.map((t) => {
                    const due = new Date(t.dueAt);
                    const minute = Math.min(Math.max(minutesSinceMidnightIn(due, timeZone), GRID_START), GRID_END - 10);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onSelect(t)}
                        className="absolute inset-x-0.5 z-20 flex items-center gap-1 rounded border border-dashed bg-surface px-1 text-[10.5px] shadow-e1"
                        style={{
                          top: `${(minute - GRID_START) * PX_PER_MIN - 8}px`,
                          borderColor: t.courseColor ?? 'var(--c-brand)',
                        }}
                        title={`${t.title} — due ${formatTime(due, { timeZone })}`}
                      >
                        <span aria-hidden>{TASK_TYPE_GLYPH[t.type as keyof typeof TASK_TYPE_GLYPH] ?? '•'}</span>
                        <span className="truncate">{t.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
        Solid blocks are class meetings. Dashed markers are deadlines, positioned at the time they are due.
      </p>
    </Card>
  );
}

/* --------------------------------- agenda --------------------------------- */

function AgendaList({
  tasks,
  meetings,
  timeZone,
  anchor,
  now,
}: CalendarProps & { anchor: Date; now: Date }) {
  const days = Array.from({ length: 31 }, (_, i) => addDaysIn(startOfDayIn(anchor, timeZone), i, timeZone));
  const todayKey = isoDateIn(now, timeZone);

  const rows = days
    .map((day) => {
      const key = isoDateIn(day, timeZone);
      const weekday = new Date(
        Date.UTC(wallClockIn(day, timeZone).year, wallClockIn(day, timeZone).month - 1, wallClockIn(day, timeZone).day),
      ).getUTCDay();
      return {
        key,
        day,
        meetings: meetings.filter((m) => m.weekday === weekday),
        tasks: tasks.filter((t) => isoDateIn(new Date(t.dueAt), timeZone) === key),
      };
    })
    .filter((row) => row.meetings.length || row.tasks.length);

  if (!rows.length) {
    return (
      <Card>
        <EmptyState title="Nothing scheduled" description="No classes or deadlines in the next month." />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <ol className="divide-y divide-[var(--c-line)]">
        {rows.map((row) => (
          <li key={row.key} className="grid gap-2 px-3 py-3 sm:grid-cols-[8rem_1fr]">
            <div>
              <p className={cx('text-[13px] font-semibold', row.key === todayKey ? 'text-brand' : 'text-ink')}>
                {row.key === todayKey ? 'Today' : formatDate(row.day, { timeZone })}
              </p>
              <p className="numeric text-[11px] text-ink-3">{row.key}</p>
            </div>
            <ul className="space-y-1">
              {row.meetings.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[13px]">
                  <span className="numeric w-20 shrink-0 text-[11.5px] text-ink-3">
                    {formatMinuteOfDay(m.startMinute)}
                  </span>
                  <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: m.color }} aria-hidden />
                  <span className="truncate text-ink">
                    {m.code} — {m.title}
                  </span>
                  <Badge tone="neutral">class</Badge>
                </li>
              ))}
              {row.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[13px]">
                  <span className="numeric w-20 shrink-0 text-[11.5px] text-ink-3">
                    {t.allDay ? 'all day' : formatTime(new Date(t.dueAt), { timeZone })}
                  </span>
                  <span
                    className="course-dot"
                    style={{ ['--course-color' as string]: t.courseColor ?? 'var(--c-brand)' }}
                    aria-hidden
                  />
                  <Link
                    href={`/tasks/${t.id}`}
                    className={cx('min-w-0 flex-1 truncate text-ink hover:underline', t.status === 'done' && 'line-through opacity-60')}
                  >
                    {t.title}
                  </Link>
                  {t.priority === 'urgent' && <Badge tone="danger">urgent</Badge>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* -------------------------------- timetable ------------------------------- */

function Timetable({
  meetings,
  timeZone,
  weekStartsOn,
  now,
  onSelect,
}: CalendarProps & { now: Date; onSelect: (m: CalendarMeeting) => void }) {
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  const todayWeekday = new Date(
    Date.UTC(wallClockIn(now, timeZone).year, wallClockIn(now, timeZone).month - 1, wallClockIn(now, timeZone).day),
  ).getUTCDay();

  const bounds = meetings.length
    ? {
        start: Math.min(...meetings.map((m) => m.startMinute)) - 30,
        end: Math.max(...meetings.map((m) => m.endMinute)) + 30,
      }
    : { start: GRID_START, end: GRID_END };
  const startMinute = Math.max(0, Math.floor(bounds.start / 60) * 60);
  const endMinute = Math.min(24 * 60, Math.ceil(bounds.end / 60) * 60);
  const hours = Array.from({ length: (endMinute - startMinute) / 60 + 1 }, (_, i) => startMinute + i * 60);

  if (!meetings.length) {
    return (
      <Card>
        <EmptyState
          title="No class meetings yet"
          description="Add meeting times to a course and the weekly grid fills in."
          action={
            <Link href="/courses" className="text-[13px] font-medium text-brand underline">
              Go to Courses
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scroll-thin">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-[3.9rem_repeat(7,1fr)] border-b border-line bg-accent-soft">
            <div />
            {order.map((weekday) => (
              <div
                key={weekday}
                className={cx(
                  'px-1 py-2 text-center text-[11.5px] font-semibold uppercase tracking-wide',
                  weekday === todayWeekday ? 'text-brand-strong' : 'text-warn',
                )}
              >
                {DAY_NAMES[weekday]}
              </div>
            ))}
          </div>
          <div
            className="relative grid grid-cols-[3.9rem_repeat(7,1fr)]"
            // The extra 14px keeps the final hour label from being clipped.
            style={{ height: `${(endMinute - startMinute) * PX_PER_MIN + 14}px` }}
          >
            <div className="relative border-r border-line">
              {hours.map((minute) => (
                <div
                  key={minute}
                  className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-[10.5px] text-ink-3"
                  style={{ top: `${(minute - startMinute) * PX_PER_MIN}px` }}
                >
                  {formatMinuteOfDay(minute)}
                </div>
              ))}
            </div>
            {order.map((weekday) => (
              <div key={weekday} className={cx('relative border-r border-line last:border-r-0', weekday === todayWeekday && 'bg-brand-soft/25')}>
                {hours.map((minute) => (
                  <div
                    key={minute}
                    className="absolute inset-x-0 border-t border-line/60"
                    style={{ top: `${(minute - startMinute) * PX_PER_MIN}px` }}
                  />
                ))}
                {meetings
                  .filter((m) => m.weekday === weekday)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m)}
                      className="absolute inset-x-0.5 overflow-hidden rounded px-1.5 py-1 text-left leading-tight"
                      style={{
                        top: `${(m.startMinute - startMinute) * PX_PER_MIN}px`,
                        height: `${Math.max(26, (m.endMinute - m.startMinute) * PX_PER_MIN)}px`,
                        background: `color-mix(in srgb, ${m.color} 20%, transparent)`,
                        borderLeft: `3px solid ${m.color}`,
                      }}
                    >
                      <span className="block truncate text-[11.5px] font-semibold text-ink">{m.code}</span>
                      <span className="block truncate text-[10.5px] text-ink-2">
                        {formatMinuteOfDay(m.startMinute)}–{formatMinuteOfDay(m.endMinute)}
                      </span>
                      {m.location && <span className="block truncate text-[10px] text-ink-3">{m.location}</span>}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------ detail panel ------------------------------ */

function DetailPanel({
  item,
  timeZone,
  onClose,
}: {
  item: CalendarTask | CalendarMeeting;
  timeZone: string;
  onClose: () => void;
}) {
  const isTask = 'dueAt' in item;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Details">
      <button type="button" className="absolute inset-0 bg-[var(--c-overlay)]" onClick={onClose} aria-label="Close" />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-xl border-t border-line bg-surface p-4 md:inset-y-0 md:left-auto md:right-0 md:w-96 md:rounded-none md:border-l md:border-t-0"
        style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{isTask ? item.title : `${item.code} — ${item.title}`}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2"
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {isTask ? (
          <div className="space-y-2 text-[13px] text-ink-2">
            <p>
              Due {formatDate(new Date(item.dueAt), { timeZone })} at {formatTime(new Date(item.dueAt), { timeZone })}
            </p>
            <p className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">{item.type}</Badge>
              <Badge tone={item.priority === 'urgent' ? 'danger' : 'neutral'}>{item.priority}</Badge>
              <Badge tone="neutral">{item.status}</Badge>
            </p>
            <Link href={`/tasks/${item.id}`} className="inline-block font-medium text-brand underline">
              Open task
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 text-[13px] text-ink-2">
            <p>
              {formatMinuteOfDay(item.startMinute)}–{formatMinuteOfDay(item.endMinute)} · {DAY_NAMES[item.weekday]}
            </p>
            {item.location && <p>{item.location}</p>}
            <p className="capitalize">{item.modality}</p>
            <Link href={`/courses/${item.courseId}`} className="inline-block font-medium text-brand underline">
              Open course
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function periodLabel(view: ViewName, anchor: Date, timeZone: string, weekStartsOn: number): string {
  if (view === 'month') {
    return new Intl.DateTimeFormat('en-PH', { timeZone, month: 'long', year: 'numeric' }).format(anchor);
  }
  if (view === 'agenda') return `From ${formatDate(anchor, { timeZone })}`;
  const start = startOfWeekIn(anchor, timeZone, weekStartsOn);
  const end = addDaysIn(start, 6, timeZone);
  return `${formatDate(start, { timeZone })} – ${formatDate(end, { timeZone })}`;
}
