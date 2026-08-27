'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Badge, Card, CardHeader, cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { PRIORITY_LABEL, type Priority } from '@/lib/domain/priority';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/domain/task-type';
import { formatDateTime, formatRelative, isoDateIn } from '@/lib/shared/time';
import { AttachmentPanel } from './AttachmentPanel';

type TaskShape = {
  id: string;
  title: string;
  description: string;
  status: 'inbox' | 'planned' | 'in_progress' | 'submitted' | 'done' | 'archived';
  type: TaskType;
  priority: Priority;
  courseId: string | null;
  startAt: string | null;
  dueAt: string | null;
  dueTimeZone: string;
  allDay: boolean;
  estimateMinutes: number | null;
  priorityOverridden: boolean;
  typeOverridden: boolean;
  source: string;
  sourceUrl: string | null;
  completedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  lastWriteOrigin: string;
};

const STATUSES: Array<{ value: TaskShape['status']; label: string; hint: string }> = [
  { value: 'inbox', label: 'Inbox', hint: 'Captured, not planned yet' },
  { value: 'planned', label: 'Planned', hint: 'Scheduled to work on' },
  { value: 'in_progress', label: 'In progress', hint: 'Started' },
  { value: 'submitted', label: 'Submitted', hint: 'Handed in' },
  { value: 'done', label: 'Done', hint: 'Finished with it' },
  { value: 'archived', label: 'Archived', hint: 'Out of the way' },
];

export function TaskDetail({
  task,
  subtasks,
  reminders,
  tags,
  courses,
  attachments,
  history,
  external,
  linkedNotes,
  timeZone,
}: {
  task: TaskShape;
  subtasks: Array<{ id: string; title: string; done: boolean }>;
  reminders: Array<{ id: string; offsetMinutes: number; fireAt: string | null; enabled: boolean }>;
  tags: string[];
  courses: Array<{ id: string; code: string; title: string; color: string }>;
  attachments: Array<{ id: string; fileName: string; byteSize: number; contentType: string; scanState: string; createdAt: string }>;
  history: Array<{ id: string; actor: string; action: string; detail: Record<string, unknown>; createdAt: string }>;
  external: {
    provider: string;
    externalId: string;
    sourceUrl: string | null;
    lastSeenAt: string;
    missingSinceAt: string | null;
    reviewReason: string | null;
  } | null;
  linkedNotes: Array<{ id: string; title: string }>;
  timeZone: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(task);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [newSubtask, setNewSubtask] = useState('');

  const dirty =
    draft.title !== task.title ||
    draft.description !== task.description ||
    draft.courseId !== task.courseId ||
    draft.status !== task.status ||
    draft.type !== task.type ||
    draft.priority !== task.priority ||
    draft.dueAt !== task.dueAt ||
    draft.estimateMinutes !== task.estimateMinutes;

  const save = async (patch?: Partial<TaskShape>) => {
    const next = { ...draft, ...patch };
    setSaving('saving');
    setError(null);
    const result = await mutate(
      `/api/tasks/${task.id}`,
      'PATCH',
      {
        title: next.title,
        description: next.description,
        courseId: next.courseId,
        status: next.status,
        type: next.type,
        priority: next.priority,
        dueAt: next.dueAt,
        estimateMinutes: next.estimateMinutes,
      },
      { label: `Edit “${next.title.slice(0, 30)}”` },
    );
    if (!result.ok) {
      setSaving('error');
      setError(result.error);
      return;
    }
    setSaving(result.queued ? 'queued' : 'saved');
    if (!result.queued) router.refresh();
    window.setTimeout(() => setSaving('idle'), 2000);
  };

  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    const result = await mutate(`/api/tasks/${task.id}/subtasks`, 'POST', { title: newSubtask.trim() }, {
      label: 'Add checklist item',
    });
    if (result.ok) {
      setNewSubtask('');
      if (!result.queued) router.refresh();
    }
  };

  const toggleSubtask = async (id: string, done: boolean) => {
    const result = await mutate(`/api/tasks/${task.id}/subtasks`, 'PATCH', { id, done }, {
      label: 'Update checklist item',
    });
    if (result.ok && !result.queued) router.refresh();
  };

  const snooze = async (reminderId: string, minutes: number) => {
    const result = await mutate(`/api/tasks/${task.id}/reminders`, 'PATCH', { id: reminderId, snoozeMinutes: minutes }, {
      label: 'Snooze reminder',
    });
    if (result.ok && !result.queued) router.refresh();
  };

  const doneCount = subtasks.filter((s) => s.done).length;
  const dueDateValue = draft.dueAt ? isoDateIn(new Date(draft.dueAt), timeZone) : '';
  const dueTimeValue = draft.dueAt
    ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
        new Date(draft.dueAt),
      )
    : '';

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-3">
        <Card>
          <div className="p-4">
            <label htmlFor="task-title" className="sr-only">
              Title
            </label>
            <input
              id="task-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onBlur={() => dirty && void save()}
              className="w-full bg-transparent text-lg font-semibold tracking-tight text-ink outline-none"
            />

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {task.source !== 'local' && <Badge tone="info">From {task.source}</Badge>}
              {task.submittedAt && (
                <Badge tone="success">Submitted {formatRelative(new Date(task.submittedAt))}</Badge>
              )}
              {task.completedAt && <Badge tone="neutral">Completed {formatRelative(new Date(task.completedAt))}</Badge>}
              {tags.map((t) => (
                <Badge key={t} tone="neutral">
                  #{t}
                </Badge>
              ))}
            </div>

            <label htmlFor="task-description" className="mt-4 block text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
              Description
            </label>
            <textarea
              id="task-description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onBlur={() => dirty && void save()}
              rows={5}
              placeholder="Anything worth remembering about this task…"
              className="mt-1 w-full resize-y rounded-md border border-line bg-canvas px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none focus:border-brand"
            />

            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={!dirty || saving === 'saving'}>
                {saving === 'saving' ? 'Saving…' : 'Save changes'}
              </Button>
              <span className="text-[12px] text-ink-3" role="status">
                {saving === 'saved' && 'Saved'}
                {saving === 'queued' && 'Queued — will sync when online'}
                {saving === 'error' && <span className="text-danger">{error}</span>}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Checklist"
            subtitle={subtasks.length ? `${doneCount} of ${subtasks.length} done` : 'Break it into steps'}
          />
          <ul className="divide-y divide-[var(--c-line)]">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 px-4 py-2">
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={(e) => void toggleSubtask(s.id, e.target.checked)}
                  id={`sub-${s.id}`}
                  className="h-4 w-4 accent-[var(--c-brand)]"
                />
                <label
                  htmlFor={`sub-${s.id}`}
                  className={cx('flex-1 text-[13.5px]', s.done ? 'text-ink-3 line-through' : 'text-ink')}
                >
                  {s.title}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-line p-2">
            <label htmlFor="new-subtask" className="sr-only">
              New checklist item
            </label>
            <input
              id="new-subtask"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addSubtask();
                }
              }}
              placeholder="Add a step…"
              className="min-h-9 flex-1 rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink outline-none focus:border-brand"
            />
            <Button size="sm" onClick={() => void addSubtask()} disabled={!newSubtask.trim()}>
              Add
            </Button>
          </div>
        </Card>

        <AttachmentPanel taskId={task.id} attachments={attachments} />

        <Card>
          <CardHeader title="History" subtitle="Every change, including what a sync changed and why" />
          {history.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-3">Nothing recorded yet.</p>
          ) : (
            <ol className="divide-y divide-[var(--c-line)]">
              {history.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] text-ink">
                      <span className="font-medium">{describeActor(entry.actor)}</span> · {describeAction(entry.action)}
                    </p>
                    <time className="numeric shrink-0 text-[11px] text-ink-3" dateTime={entry.createdAt}>
                      {formatRelative(new Date(entry.createdAt))}
                    </time>
                  </div>
                  <FieldChanges detail={entry.detail} timeZone={timeZone} />
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* ------------------------------- sidebar ------------------------------- */}
      <div className="space-y-3">
        <Card>
          <CardHeader title="Status" />
          <div className="space-y-2 p-3">
            <div className="grid grid-cols-2 gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setDraft({ ...draft, status: s.value });
                    void save({ status: s.value });
                  }}
                  aria-pressed={draft.status === s.value}
                  title={s.hint}
                  className={cx(
                    'min-h-9 rounded-md border px-2 text-[12.5px] font-medium',
                    draft.status === s.value
                      ? 'border-brand bg-brand-soft text-brand-strong'
                      : 'border-line text-ink-2 hover:bg-surface-2',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-ink-3">
              Submitted and Done are separate: handing work in does not mark it finished, and a sync can never
              change either one.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <div className="space-y-2.5 p-3">
            <label className="block text-[11.5px] font-medium text-ink-3">
              Course
              <select
                value={draft.courseId ?? ''}
                onChange={(e) => {
                  const value = e.target.value || null;
                  setDraft({ ...draft, courseId: value });
                  void save({ courseId: value });
                }}
                className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
              >
                <option value="">No course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11.5px] font-medium text-ink-3">
                Due date
                <input
                  type="date"
                  value={dueDateValue}
                  onChange={(e) => {
                    const value = e.target.value
                      ? new Date(`${e.target.value}T${dueTimeValue || '23:59'}:00`).toISOString()
                      : null;
                    setDraft({ ...draft, dueAt: value });
                    void save({ dueAt: value });
                  }}
                  className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
                />
              </label>
              <label className="block text-[11.5px] font-medium text-ink-3">
                Time
                <input
                  type="time"
                  value={dueTimeValue}
                  onChange={(e) => {
                    if (!dueDateValue) return;
                    const value = new Date(`${dueDateValue}T${e.target.value || '23:59'}:00`).toISOString();
                    setDraft({ ...draft, dueAt: value });
                    void save({ dueAt: value });
                  }}
                  className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
                />
              </label>
            </div>
            <p className="text-[11px] text-ink-3">
              Shown in {timeZone.replace('_', ' ')}
              {task.dueTimeZone !== timeZone ? ` · authored in ${task.dueTimeZone}` : ''}
            </p>

            <label className="block text-[11.5px] font-medium text-ink-3">
              Type
              <select
                value={draft.type}
                onChange={(e) => {
                  const value = e.target.value as TaskType;
                  setDraft({ ...draft, type: value });
                  void save({ type: value });
                }}
                className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
              >
                {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-[11.5px] font-medium text-ink-3">
              Priority
              <select
                value={draft.priority}
                onChange={(e) => {
                  const value = e.target.value as Priority;
                  setDraft({ ...draft, priority: value });
                  void save({ priority: value });
                }}
                className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
              >
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(task.priorityOverridden || task.typeOverridden) && (
              <p className="rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2">
                You set{' '}
                {[task.priorityOverridden && 'priority', task.typeOverridden && 'type'].filter(Boolean).join(' and ')}{' '}
                manually. Syncs will leave {task.priorityOverridden && task.typeOverridden ? 'them' : 'it'} alone.
              </p>
            )}

            <label className="block text-[11.5px] font-medium text-ink-3">
              Estimate (minutes)
              <input
                type="number"
                min={0}
                step={15}
                value={draft.estimateMinutes ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, estimateMinutes: e.target.value ? Number(e.target.value) : null })
                }
                onBlur={() => dirty && void save()}
                className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
              />
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reminders" subtitle="Snoozing never moves the academic deadline" />
          {reminders.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] text-ink-3">No reminders set.</p>
          ) : (
            <ul className="divide-y divide-[var(--c-line)]">
              {reminders.map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <p className="text-[12.5px] text-ink">
                    {r.fireAt
                      ? `Snoozed to ${formatDateTime(new Date(r.fireAt), { timeZone })}`
                      : `${r.offsetMinutes} min before due`}
                  </p>
                  <div className="mt-1 flex gap-1">
                    {[10, 60, 24 * 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void snooze(r.id, m)}
                        className="min-h-8 rounded border border-line px-2 text-[11.5px] text-ink-2 hover:bg-surface-2"
                      >
                        +{m < 60 ? `${m}m` : m === 60 ? '1h' : '1d'}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {external && (
          <Card>
            <CardHeader title="Source" subtitle={external.provider.replace('_', ' ')} />
            <div className="space-y-1.5 p-3 text-[12.5px] text-ink-2">
              <p>
                Last seen in the feed{' '}
                <time dateTime={external.lastSeenAt}>{formatRelative(new Date(external.lastSeenAt))}</time>
              </p>
              {external.missingSinceAt && (
                <p className="rounded-md bg-warn-soft px-2 py-1.5 text-warn">
                  No longer published upstream since {formatRelative(new Date(external.missingSinceAt))}. It was kept
                  — nothing is deleted automatically.
                </p>
              )}
              {task.sourceUrl && (
                <a
                  href={task.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-medium text-brand underline"
                >
                  <Icon name="link" size={13} />
                  Open in Blackboard
                </a>
              )}
            </div>
          </Card>
        )}

        {linkedNotes.length > 0 && (
          <Card>
            <CardHeader title="Notes" />
            <ul className="divide-y divide-[var(--c-line)]">
              {linkedNotes.map((n) => (
                <li key={n.id}>
                  <Link href={`/notes?note=${n.id}`} className="block px-3 py-2 text-[13px] text-ink hover:bg-surface-2">
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Actions" />
          <div className="flex flex-wrap gap-1.5 p-3">
            <Button
              size="sm"
              onClick={async () => {
                const result = await mutate<{ task: { id: string } }>(`/api/tasks/${task.id}`, 'POST', {
                  action: 'duplicate',
                });
                if (result.ok && !result.queued && result.data) router.push(`/tasks/${result.data.task.id}`);
              }}
            >
              <Icon name="copy" size={14} /> Duplicate
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!window.confirm('Delete this task permanently? This cannot be undone.')) return;
                const result = await mutate(`/api/tasks/${task.id}`, 'DELETE');
                if (result.ok) router.push('/tasks');
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </Button>
          </div>
          <p className="px-3 pb-3 text-[11px] text-ink-3">
            Revision {task.revision} · last written by {task.lastWriteOrigin}
          </p>
        </Card>
      </div>
    </div>
  );
}

function describeActor(actor: string): string {
  if (actor.startsWith('user:')) return 'You';
  if (actor.startsWith('sync:')) return `${actor.slice(5).replace('_', ' ')} sync`;
  if (actor === 'ai:local') return 'Local AI';
  return actor;
}

function describeAction(action: string): string {
  const map: Record<string, string> = {
    'task.created': 'created this task',
    'task.updated': 'edited this task',
    'task.synced': 'applied changes from the provider',
    'task.deleted': 'deleted this task',
    'sync.conflict_resolved': 'resolved a sync conflict',
  };
  return map[action] ?? action;
}

function FieldChanges({ detail, timeZone }: { detail: Record<string, unknown>; timeZone: string }) {
  const fields = (detail.fields ?? null) as Record<string, { from: unknown; to: unknown }> | null;
  const applied = (detail.applied ?? null) as Array<{ field: string; from: string; to: string }> | null;

  const rows = applied
    ? applied.map((a) => ({ field: a.field, from: a.from, to: a.to }))
    : fields
      ? Object.entries(fields).map(([field, v]) => ({ field, from: v.from, to: v.to }))
      : [];

  if (!rows.length) return null;

  const show = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTime(new Date(text), { timeZone });
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  };

  return (
    <ul className="mt-1 space-y-0.5">
      {rows.map((row, i) => (
        <li key={`${row.field}-${i}`} className="text-[11.5px] text-ink-3">
          <span className="font-medium text-ink-2">{row.field}</span>: {show(row.from)} → {show(row.to)}
        </li>
      ))}
    </ul>
  );
}
