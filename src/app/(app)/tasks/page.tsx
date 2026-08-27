import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { listCourses } from '@/lib/domain/courses';
import { countTasks, listTasks } from '@/lib/domain/tasks';
import { SYSTEM_SMART_LISTS } from '@/lib/domain/smart-lists';
import { smartListQuerySchema, type SmartListQuery } from '@/lib/domain/validation';
import { getDb } from '@/lib/db';
import { courses as coursesTable, smartLists, tasks as tasksTable } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { Card, EmptyState } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icon';
import { TaskListClient } from '@/components/tasks/TaskListClient';
import { TaskFilters } from '@/components/tasks/TaskFilters';

export const metadata: Metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function queryFromParams(params: SearchParams): { query: SmartListQuery; listKey: string } {
  const listKey = typeof params.list === 'string' ? params.list : 'today';
  const preset = SYSTEM_SMART_LISTS.find((l) => l.key === listKey)?.query;
  const base: Record<string, unknown> = { ...(preset ?? { sort: 'due', direction: 'asc' }) };

  if (typeof params.courseId === 'string') base.courseIds = [params.courseId];
  if (typeof params.q === 'string' && params.q) base.search = params.q;
  if (typeof params.type === 'string') base.types = [params.type];
  if (typeof params.priority === 'string') base.priorities = [params.priority];
  if (typeof params.source === 'string') base.sources = [params.source];
  if (params.completed === 'true') base.includeCompleted = true;
  if (typeof params.sort === 'string') base.sort = params.sort;

  return { query: smartListQuerySchema.parse(base), listKey };
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const { query, listKey } = queryFromParams(params);
  const now = new Date();
  const ctx = { userId: user.id, now, timeZone: user.timeZone };

  const db = await getDb();
  const [rows, total, courses, customLists] = await Promise.all([
    listTasks(query, ctx, { limit: 200 }),
    countTasks(query, ctx),
    listCourses(user.id),
    db
      .select()
      .from(smartLists)
      .where(and(eq(smartLists.userId, user.id), eq(smartLists.isSystem, false)))
      .orderBy(smartLists.position),
  ]);

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const taskRows = rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    type: t.type,
    priority: t.priority,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    allDay: t.allDay,
    estimateMinutes: t.estimateMinutes,
    source: t.source,
    courseCode: t.courseId ? (courseById.get(t.courseId)?.code ?? null) : null,
    courseColor: t.courseId ? (courseById.get(t.courseId)?.color ?? null) : null,
  }));

  const activeList = SYSTEM_SMART_LISTS.find((l) => l.key === listKey);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{activeList?.name ?? 'Tasks'}</h1>
          <p className="text-[13px] text-ink-3">
            {total} {total === 1 ? 'task' : 'tasks'}
            {query.search ? ` matching “${query.search}”` : ''}
          </p>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Task lists" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1.5 overflow-x-auto scroll-thin pb-1 lg:flex-col lg:overflow-visible">
            {SYSTEM_SMART_LISTS.map((list) => {
              const active = list.key === listKey;
              return (
                <li key={list.key} className="shrink-0">
                  <Link
                    href={`/tasks?list=${list.key}`}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md bg-brand-soft px-2.5 text-[13px] font-medium text-brand-strong'
                        : 'flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-surface-2'
                    }
                  >
                    <Icon name={list.icon} size={15} />
                    {list.name}
                  </Link>
                </li>
              );
            })}
            {customLists.length > 0 && (
              <li className="hidden pt-2 lg:block">
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Saved</p>
              </li>
            )}
            {customLists.map((list) => (
              <li key={list.id} className="shrink-0">
                <Link
                  href={`/tasks?saved=${list.id}`}
                  className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-surface-2"
                >
                  <Icon name={list.icon ?? 'star'} size={15} />
                  {list.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <TaskFilters
            courses={courses.map((c) => ({ id: c.id, code: c.code, color: c.color }))}
            params={{
              list: listKey,
              courseId: typeof params.courseId === 'string' ? params.courseId : '',
              type: typeof params.type === 'string' ? params.type : '',
              priority: typeof params.priority === 'string' ? params.priority : '',
              q: typeof params.q === 'string' ? params.q : '',
              completed: params.completed === 'true',
              sort: typeof params.sort === 'string' ? params.sort : 'due',
            }}
          />

          <Card className="mt-3 overflow-hidden">
            {taskRows.length === 0 ? (
              <EmptyState
                title="Nothing here"
                description={
                  listKey === 'overdue'
                    ? 'No overdue work — everything with a past deadline is submitted or done.'
                    : 'Add something with the button in the header, or change the filters above.'
                }
              />
            ) : (
              <TaskListClient tasks={taskRows} timeZone={user.timeZone} now={now.toISOString()} courses={courses.map((c) => ({ id: c.id, code: c.code }))} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
