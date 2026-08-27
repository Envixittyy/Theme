'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/icon';
import { Badge, cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { PRIORITY_LABEL, type Priority } from '@/lib/domain/priority';
import { TASK_TYPE_GLYPH, TASK_TYPE_LABEL, type TaskType } from '@/lib/domain/task-type';
import { formatRelative, formatTime, isoDateIn } from '@/lib/shared/time';

export type TaskRowData = {
  id: string;
  title: string;
  status: 'inbox' | 'planned' | 'in_progress' | 'submitted' | 'done' | 'archived';
  type: TaskType;
  priority: Priority;
  dueAt: string | Date | null;
  allDay: boolean;
  estimateMinutes: number | null;
  source: string;
  courseCode: string | null;
  courseColor: string | null;
  courseShort?: string | null;
};

const PRIORITY_TONE: Record<Priority, 'danger' | 'warn' | 'neutral' | 'info'> = {
  urgent: 'danger',
  high: 'warn',
  medium: 'neutral',
  low: 'info',
};

/**
 * A single task line.
 *
 * Completing and submitting are two separate controls, never one: handing work
 * in and being finished with it are different facts about a task, and collapsing
 * them is how a student loses track of what still needs revising.
 */
export function TaskRow({
  task,
  timeZone,
  now,
  showCourse = true,
  selected,
  onToggleSelect,
  dense,
}: {
  task: TaskRowData;
  timeZone: string;
  now: string | Date;
  showCourse?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  dense?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  const dueAt = task.dueAt ? new Date(task.dueAt) : null;
  const nowDate = new Date(now);
  const done = task.status === 'done';
  const submitted = task.status === 'submitted';
  const overdue = !!dueAt && dueAt < nowDate && !done && !submitted;
  const dueToday = !!dueAt && isoDateIn(dueAt, timeZone) === isoDateIn(nowDate, timeZone);

  const setStatus = async (status: TaskRowData['status']) => {
    setBusy(true);
    const result = await mutate(`/api/tasks/${task.id}`, 'PATCH', { status }, { label: `Update “${task.title}”` });
    setBusy(false);
    if (result.ok && result.queued) {
      setQueued(true);
      return;
    }
    if (result.ok) startTransition(() => router.refresh());
  };

  return (
    <li
      className={cx(
        'group flex items-start gap-2.5 border-b border-line px-3 last:border-b-0',
        dense ? 'py-2' : 'py-2.5',
        (busy || pending) && 'opacity-60',
        selected && 'bg-brand-soft/40',
      )}
      data-task-id={task.id}
    >
      {onToggleSelect ? (
        <label className="-m-2.5 shrink-0 cursor-pointer p-2.5">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect(task.id)}
            aria-label={`Select ${task.title}`}
            className="mt-0.5 h-4 w-4 accent-[var(--c-brand)]"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => void setStatus(done ? 'planned' : 'done')}
        disabled={busy}
        aria-pressed={done}
        aria-label={done ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`}
        className={cx(
          // -m-3 p-3 gives a 44px tap area around a 20px circle without
          // changing how the row looks.
          'mt-0.5 -m-3 grid shrink-0 place-items-center rounded-full border-0 bg-transparent p-3 transition-colors',
        )}
      >
        <span
          className={cx(
            'grid h-5 w-5 place-items-center rounded-full border transition-colors',
            done
              ? 'border-success bg-success text-brand-ink'
              : 'border-line-strong text-transparent hover:border-brand',
          )}
        >
          <Icon name="check" size={12} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link
            href={`/tasks/${task.id}`}
            className={cx(
              'text-[14px] leading-snug text-ink hover:underline',
              done && 'text-ink-3 line-through',
            )}
          >
            {task.title}
          </Link>
          {submitted && (
            <Badge tone="success" title="Handed in, but not marked finished">
              <Icon name="send" size={10} />
              Submitted
            </Badge>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3">
          {showCourse && task.courseCode && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="course-dot"
                style={{ ['--course-color' as string]: task.courseColor ?? 'var(--c-brand)' }}
                aria-hidden
              />
              <span className="font-medium uppercase tracking-wide">{task.courseCode}</span>
            </span>
          )}
          <span title={TASK_TYPE_LABEL[task.type]} className="inline-flex items-center gap-1">
            <span aria-hidden>{TASK_TYPE_GLYPH[task.type]}</span>
            {TASK_TYPE_LABEL[task.type]}
          </span>
          {dueAt && (
            <span
              className={cx('numeric inline-flex items-center gap-1', overdue && 'font-semibold text-danger')}
              title={dueAt.toISOString()}
            >
              <Icon name="clock" size={11} />
              {overdue ? 'Overdue · ' : dueToday ? 'Today · ' : ''}
              {task.allDay ? formatRelative(dueAt, nowDate) : `${formatTime(dueAt, { timeZone })} · ${formatRelative(dueAt, nowDate)}`}
            </span>
          )}
          {task.estimateMinutes ? <span className="numeric">~{task.estimateMinutes}m</span> : null}
          {task.source !== 'local' && (
            <Badge tone="info" title={`Imported from ${task.source}`}>
              {task.source === 'blackboard' ? 'Blackboard' : task.source}
            </Badge>
          )}
          <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
          {queued && <span className="text-warn">queued offline</span>}
        </div>
      </div>

      {/* Always visible where there is no hover to reveal them. Revealing an
          action on hover is fine on a desktop and makes it unreachable on a
          phone, which is where most of these get pressed. */}
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
        {!submitted && !done && (
          <button
            type="button"
            onClick={() => void setStatus('submitted')}
            disabled={busy}
            className="grid h-11 w-11 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink md:h-8 md:w-8"
            title="Mark as submitted"
            aria-label={`Mark ${task.title} as submitted`}
          >
            <Icon name="send" size={15} />
          </button>
        )}
        <Link
          href={`/tasks/${task.id}`}
          className="grid h-11 w-11 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink md:h-8 md:w-8"
          aria-label={`Open ${task.title}`}
        >
          <Icon name="chevronRight" size={16} />
        </Link>
      </div>
    </li>
  );
}
