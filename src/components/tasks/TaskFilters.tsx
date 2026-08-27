'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';
import { TASK_TYPE_LABEL } from '@/lib/domain/task-type';

/**
 * Filters write to the URL rather than to component state, so a filtered list
 * is shareable, bookmarkable, survives a refresh, and is restorable from the
 * back button — which matters more than it sounds when a student is hunting for
 * one assignment mid-revision.
 */
export function TaskFilters({
  courses,
  params,
}: {
  courses: Array<{ id: string; code: string; color: string }>;
  params: {
    list: string;
    courseId: string;
    type: string;
    priority: string;
    q: string;
    completed: boolean;
    sort: string;
  };
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.q);
  const [expanded, setExpanded] = useState(
    !!(params.courseId || params.type || params.priority || params.completed),
  );

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`/tasks?${next.toString()}`));
  };

  const activeCount = [params.courseId, params.type, params.priority].filter(Boolean).length + (params.completed ? 1 : 0);

  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex items-center gap-2 p-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-2"
          onSubmit={(e) => {
            e.preventDefault();
            update('q', q || null);
          }}
        >
          <Icon name="search" size={15} className="text-ink-3" />
          <label htmlFor="task-search" className="sr-only">
            Search tasks
          </label>
          <input
            id="task-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter these tasks…"
            className="min-h-9 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                update('q', null);
              }}
              className="text-ink-3 hover:text-ink"
              aria-label="Clear search"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </form>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cx(
            'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium',
            activeCount ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2',
          )}
        >
          <Icon name="filter" size={14} />
          Filters
          {activeCount > 0 && <span className="numeric">({activeCount})</span>}
        </button>
      </div>

      {expanded && (
        <div className="grid gap-2 border-t border-line p-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11.5px] font-medium text-ink-3">
            Course
            <select
              value={params.courseId}
              onChange={(e) => update('courseId', e.target.value || null)}
              className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            >
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11.5px] font-medium text-ink-3">
            Type
            <select
              value={params.type}
              onChange={(e) => update('type', e.target.value || null)}
              className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            >
              <option value="">Any type</option>
              {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11.5px] font-medium text-ink-3">
            Priority
            <select
              value={params.priority}
              onChange={(e) => update('priority', e.target.value || null)}
              className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            >
              <option value="">Any priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="text-[11.5px] font-medium text-ink-3">
            Sort by
            <select
              value={params.sort}
              onChange={(e) => update('sort', e.target.value)}
              className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            >
              <option value="due">Deadline</option>
              <option value="priority">Priority</option>
              <option value="created">Recently added</option>
              <option value="title">Title</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2 sm:col-span-2 lg:col-span-4">
            <input
              type="checkbox"
              checked={params.completed}
              onChange={(e) => update('completed', e.target.checked ? 'true' : null)}
              className="h-4 w-4 accent-[var(--c-brand)]"
            />
            Include completed work
          </label>
        </div>
      )}
    </div>
  );
}
