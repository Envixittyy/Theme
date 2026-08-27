'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Badge, cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { parseQuickAdd } from '@/lib/domain/quick-add';
import { TASK_TYPE_LABEL } from '@/lib/domain/task-type';
import { formatDateTime } from '@/lib/shared/time';
import type { ShellCourse } from './AppShell';

/**
 * Quick add.
 *
 * The single-line parser is the fast path and the structured form is always one
 * click away — the same pair the product relies on when local AI is offline.
 * Whatever the parser understood is echoed back before saving, so a
 * misread date is visible rather than surprising.
 */
export function QuickAdd({
  open,
  onClose,
  courses,
  timeZone,
  defaultCourseId,
}: {
  open: boolean;
  onClose: () => void;
  courses: ShellCourse[];
  timeZone: string;
  defaultCourseId?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'quick' | 'form'>('quick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Structured form state
  const [courseId, setCourseId] = useState(defaultCourseId ?? '');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('23:59');
  const [type, setType] = useState('assignment');
  const [priority, setPriority] = useState('');

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setQueued(false);
      setMode('quick');
      setCourseId(defaultCourseId ?? '');
      setDueDate('');
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, defaultCourseId]);

  const parsed = useMemo(() => parseQuickAdd(text, { timeZone }), [text, timeZone]);
  const matchedCourse = useMemo(
    () => (parsed.courseCode ? courses.find((c) => c.code.toUpperCase() === parsed.courseCode) : undefined),
    [parsed.courseCode, courses],
  );

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);

    const payload =
      mode === 'quick'
        ? {
            title: parsed.title,
            courseId: matchedCourse?.id ?? null,
            type: parsed.type,
            ...(parsed.priority ? { priority: parsed.priority } : {}),
            dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
            dueTimeZone: timeZone,
            allDay: parsed.allDay,
            estimateMinutes: parsed.estimateMinutes,
            tags: parsed.tags,
          }
        : {
            title: text.trim(),
            courseId: courseId || null,
            type,
            ...(priority ? { priority } : {}),
            dueAt: dueDate ? new Date(`${dueDate}T${dueTime || '23:59'}:00`).toISOString() : null,
            dueTimeZone: timeZone,
            allDay: !dueTime,
          };

    if (!payload.title) {
      setError('Give the task a title.');
      setBusy(false);
      return;
    }

    const result = await mutate<{ id: string }>('/api/tasks', 'POST', payload, {
      label: `Add “${payload.title.slice(0, 40)}”`,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.queued) {
      setQueued(true);
      window.setTimeout(() => {
        setQueued(false);
        onClose();
      }, 1200);
      return;
    }
    onClose();
    router.refresh();
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Quick add task">
      <button type="button" className="absolute inset-0 bg-[var(--c-overlay)]" onClick={onClose} aria-label="Close" />
      <div
        className={cx(
          'absolute inset-x-0 bottom-0 rounded-t-xl border-t border-line bg-surface p-4 shadow-e3',
          'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[12vh] md:w-full md:max-w-lg md:-translate-x-1/2 md:rounded-lg md:border',
        )}
        style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">New task</h2>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode(mode === 'quick' ? 'form' : 'quick')}
              className="rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              {mode === 'quick' ? 'Use full form' : 'Use quick entry'}
            </button>
          </div>
        </div>

        <label htmlFor="quick-add-input" className="sr-only">
          {mode === 'quick' ? 'Task, with optional #course !priority @type and a date' : 'Task title'}
        </label>
        <input
          id="quick-add-input"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={
            mode === 'quick' ? 'Lab report #CHM031 !high @lab tomorrow 5pm ~90m' : 'What needs doing?'
          }
          className="w-full rounded-md border border-line bg-canvas px-3 py-3 text-sm text-ink outline-none focus:border-brand"
          autoComplete="off"
        />

        {mode === 'quick' ? (
          <div className="mt-2 min-h-9" aria-live="polite">
            {text.trim() ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {parsed.dueAt && (
                  <Badge tone="brand">
                    <Icon name="clock" size={12} />
                    {parsed.allDay
                      ? `${formatDateTime(parsed.dueAt, { timeZone })} (end of day)`
                      : formatDateTime(parsed.dueAt, { timeZone })}
                  </Badge>
                )}
                {parsed.courseCode && (
                  <Badge tone={matchedCourse ? 'info' : 'warn'}>
                    {matchedCourse ? matchedCourse.code : `${parsed.courseCode} — no such course`}
                  </Badge>
                )}
                <Badge tone="neutral">{TASK_TYPE_LABEL[parsed.type]}</Badge>
                {parsed.priority && <Badge tone="accent">{parsed.priority}</Badge>}
                {parsed.estimateMinutes && <Badge tone="neutral">~{parsed.estimateMinutes}m</Badge>}
                {parsed.tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    #{t}
                  </Badge>
                ))}
                {!parsed.dueAt && <span className="text-[12px] text-ink-3">No date — it will land in Inbox.</span>}
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">
                <code className="rounded bg-surface-2 px-1">#course</code>{' '}
                <code className="rounded bg-surface-2 px-1">!priority</code>{' '}
                <code className="rounded bg-surface-2 px-1">@type</code>{' '}
                <code className="rounded bg-surface-2 px-1">+tag</code>{' '}
                <code className="rounded bg-surface-2 px-1">~90m</code> and dates like{' '}
                <code className="rounded bg-surface-2 px-1">tomorrow 5pm</code>
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="col-span-2 text-[12px] font-medium text-ink-2">
              Course
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">No course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-2 text-sm text-ink"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Time
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-2 text-sm text-ink"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-2 text-sm text-ink"
              >
                <option value="">Auto (from deadline)</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
        )}

        {error && (
          <p className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 text-[12px] text-danger" role="alert">
            {error}
          </p>
        )}
        {queued && (
          <p className="mt-2 rounded-md bg-warn-soft px-2 py-1.5 text-[12px] text-warn" role="status">
            Saved offline — it will sync when you are back online.
          </p>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : 'Add task'}
          </Button>
        </div>
      </div>
    </div>
  );
}
