import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { externalRecords, syncChanges, tasks } from '@/lib/db/schema';
import { syncHealth } from '@/lib/connectors/integrations';
import { listDeadLetters } from '@/lib/jobs/queue';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { formatDateTime, formatRelative } from '@/lib/shared/time';
import { ConflictReview } from '@/components/settings/ConflictReview';
import { OfflineQueuePanel } from '@/components/settings/OfflineQueuePanel';

export const metadata: Metadata = { title: 'Sync health' };
export const dynamic = 'force-dynamic';

export default async function SyncHealthPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = await getDb();
  const [{ accounts, runs, conflicts }, changes, missing, deadLetters] = await Promise.all([
    syncHealth(user.id),
    db
      .select({ change: syncChanges, taskTitle: tasks.title })
      .from(syncChanges)
      .leftJoin(tasks, eq(tasks.id, syncChanges.entityId))
      .where(eq(syncChanges.userId, user.id))
      .orderBy(desc(syncChanges.createdAt))
      .limit(40),
    db
      .select({ record: externalRecords, taskTitle: tasks.title })
      .from(externalRecords)
      .leftJoin(tasks, eq(tasks.id, externalRecords.entityId))
      .where(and(eq(externalRecords.userId, user.id), isNotNull(externalRecords.missingSinceAt)))
      .limit(50),
    listDeadLetters(user.id),
  ]);

  const conflictTitles = new Map<string, string>();
  for (const c of changes) if (c.change.entityId && c.taskTitle) conflictTitles.set(c.change.entityId, c.taskTitle);
  const now = new Date();

  return (
    <>
      <Card>
        <CardHeader title="Connections" subtitle={`${accounts.length} configured`} />
        {accounts.length === 0 ? (
          <EmptyState
            title="Nothing connected"
            description="The app is fully usable without an integration."
            action={
              <Link href="/settings/integrations" className="text-[13px] font-medium text-brand underline">
                Set one up
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {accounts.map((a) => {
              const lastRun = runs.find((r) => r.accountId === a.id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-ink">{a.label}</span>
                    <span className="block text-[11.5px] text-ink-3">
                      {lastRun
                        ? `last run ${formatRelative(lastRun.finishedAt ?? lastRun.startedAt, now)} · ${lastRun.status}`
                        : 'never run'}
                    </span>
                  </span>
                  <Badge tone={a.status === 'connected' ? 'success' : a.status === 'error' ? 'danger' : 'neutral'}>
                    {a.status}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Conflicts needing review"
          subtitle="Both sides changed the same field, so nothing was overwritten"
        />
        {conflicts.length === 0 ? (
          <EmptyState title="No conflicts" description="Every field had an unambiguous answer." />
        ) : (
          <ConflictReview
            conflicts={conflicts.map((c) => ({
              id: c.id,
              field: c.field,
              localValue: c.localValue,
              remoteValue: c.remoteValue,
              baseValue: c.baseValue,
              entityId: c.entityId,
              title: c.entityId ? (conflictTitles.get(c.entityId) ?? 'Task') : 'Task',
              localChangedAt: c.localChangedAt?.toISOString() ?? null,
              remoteChangedAt: c.remoteChangedAt?.toISOString() ?? null,
              createdAt: c.createdAt.toISOString(),
            }))}
            timeZone={user.timeZone}
          />
        )}
      </Card>

      <OfflineQueuePanel />

      <Card>
        <CardHeader
          title="No longer in the source"
          subtitle="Kept deliberately — an item disappearing upstream never deletes your task"
        />
        {missing.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">Nothing has gone missing.</p>
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {missing.map(({ record, taskTitle }) => (
              <li key={record.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">
                    {record.entityId ? (
                      <Link href={`/tasks/${record.entityId}`} className="hover:underline">
                        {taskTitle ?? 'Task'}
                      </Link>
                    ) : (
                      (taskTitle ?? 'Task')
                    )}
                  </span>
                  <span className="block text-[11.5px] text-ink-3">
                    {record.reviewReason} · since {formatRelative(record.missingSinceAt!, now)}
                  </span>
                </span>
                <Badge tone="warn">review</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent sync activity" subtitle="Field-level, with the reason for every change" />
        {changes.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">No sync has run yet.</p>
        ) : (
          <ol className="divide-y divide-[var(--c-line)]">
            {changes.map(({ change, taskTitle }) => (
              <li key={change.id} className="px-4 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Badge
                    tone={
                      change.action === 'conflict'
                        ? 'danger'
                        : change.action === 'missing'
                          ? 'warn'
                          : change.action === 'created'
                            ? 'success'
                            : 'neutral'
                    }
                  >
                    {change.action}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{taskTitle ?? change.entityType}</span>
                  <time className="numeric text-[11px] text-ink-3" dateTime={change.createdAt.toISOString()}>
                    {formatRelative(change.createdAt, now)}
                  </time>
                </div>
                {change.field && (
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    <span className="font-medium text-ink-2">{change.field}</span>: {truncate(change.oldValue)} →{' '}
                    {truncate(change.newValue)}
                  </p>
                )}
                {change.reason && <p className="text-[11px] text-ink-3">{change.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {deadLetters.length > 0 && (
        <Card>
          <CardHeader title="Failed background jobs" subtitle="Retried with backoff, then parked here" />
          <ul className="divide-y divide-[var(--c-line)]">
            {deadLetters.map((job) => (
              <li key={job.id} className="px-4 py-2.5">
                <p className="text-[13px] text-ink">{job.kind}</p>
                <p className="text-[11.5px] text-danger">{job.lastError}</p>
                <p className="text-[11px] text-ink-3">
                  {job.attempts} attempts · {job.finishedAt ? formatDateTime(job.finishedAt, { timeZone: user.timeZone }) : ''}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function truncate(value: string | null): string {
  if (!value) return '—';
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}
