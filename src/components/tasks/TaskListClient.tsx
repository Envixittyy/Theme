'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TaskRow, type TaskRowData } from './TaskRow';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { mutate } from '@/lib/client/api';

/**
 * List with multi-select and bulk edit.
 *
 * Bulk operations go through the same per-task update path as single edits, so
 * every one of them lands in the audit trail and respects the same field
 * ownership rules — there is no privileged "bulk" write path.
 */
export function TaskListClient({
  tasks,
  timeZone,
  now,
  courses,
}: {
  tasks: TaskRowData[];
  timeZone: string;
  now: string;
  courses: Array<{ id: string; code: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (patch: Record<string, unknown>, label: string) => {
    setBusy(true);
    const result = await mutate('/api/tasks/bulk', 'POST', { ids: [...selected], patch }, { label });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(result.queued ? 'Queued offline.' : `${label} applied to ${selected.size} tasks.`);
    setSelected(new Set());
    if (!result.queued) router.refresh();
  };

  return (
    <>
      {selected.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft px-3 py-2"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="text-[12.5px] font-medium text-brand-strong">{selected.size} selected</span>
          <Button size="sm" onClick={() => void runBulk({ status: 'done' }, 'Mark done')} disabled={busy}>
            <Icon name="check" size={14} /> Done
          </Button>
          <Button size="sm" onClick={() => void runBulk({ status: 'submitted' }, 'Mark submitted')} disabled={busy}>
            <Icon name="send" size={14} /> Submitted
          </Button>
          <Button size="sm" onClick={() => void runBulk({ status: 'archived' }, 'Archive')} disabled={busy}>
            <Icon name="archive" size={14} /> Archive
          </Button>
          <label className="inline-flex items-center gap-1 text-[12px] text-ink-2">
            Course
            <select
              onChange={(e) => e.target.value && void runBulk({ courseId: e.target.value }, 'Set course')}
              defaultValue=""
              className="min-h-8 rounded-md border border-line bg-surface px-1.5 text-[12px]"
              aria-label="Move selected tasks to a course"
            >
              <option value="">—</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[12px] text-ink-2 underline"
          >
            Clear
          </button>
        </div>
      )}

      {message && (
        <p className="border-b border-line bg-surface-2 px-3 py-1.5 text-[12px] text-ink-2" role="status">
          {message}
        </p>
      )}

      <ul>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            timeZone={timeZone}
            now={now}
            selected={selected.has(task.id)}
            onToggleSelect={toggle}
          />
        ))}
      </ul>
    </>
  );
}
