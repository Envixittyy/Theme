'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { formatDateTime } from '@/lib/shared/time';

type Conflict = {
  id: string;
  field: string;
  localValue: string | null;
  remoteValue: string | null;
  baseValue: string | null;
  entityId: string | null;
  title: string;
  localChangedAt: string | null;
  remoteChangedAt: string | null;
  createdAt: string;
};

/**
 * Conflict review.
 *
 * Shows both values, when each changed, and what they diverged from. There is
 * no "merge automatically" button on purpose: if the system could tell which
 * side was right, this would not be a conflict.
 */
export function ConflictReview({ conflicts, timeZone }: { conflicts: Conflict[]; timeZone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (id: string, choice: 'local' | 'remote') => {
    setBusy(id);
    const result = await mutate('/api/sync/conflicts', 'POST', { id, choice }, { label: 'Resolve conflict' });
    setBusy(null);
    if (result.ok && !result.queued) router.refresh();
  };

  return (
    <ul className="divide-y divide-[var(--c-line)]">
      {conflicts.map((conflict) => (
        <li key={conflict.id} className="px-4 py-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            {conflict.entityId ? (
              <Link href={`/tasks/${conflict.entityId}`} className="text-[13.5px] font-medium text-ink hover:underline">
                {conflict.title}
              </Link>
            ) : (
              <span className="text-[13.5px] font-medium text-ink">{conflict.title}</span>
            )}
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
              {conflict.field}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['local', 'Your version', conflict.localValue, conflict.localChangedAt],
                ['remote', 'Their version', conflict.remoteValue, conflict.remoteChangedAt],
              ] as const
            ).map(([choice, label, value, changedAt]) => (
              <div key={choice} className="rounded-md border border-line p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
                <p className={cx('mt-1 break-words text-[13px] text-ink')}>{display(value, timeZone)}</p>
                {changedAt && (
                  <p className="mt-1 text-[11px] text-ink-3">
                    changed {formatDateTime(new Date(changedAt), { timeZone })}
                  </p>
                )}
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  variant={choice === 'local' ? 'secondary' : 'primary'}
                  disabled={busy === conflict.id}
                  onClick={() => void resolve(conflict.id, choice)}
                >
                  Keep this
                </Button>
              </div>
            ))}
          </div>

          {conflict.baseValue && (
            <p className="mt-2 text-[11px] text-ink-3">
              Both were {display(conflict.baseValue, timeZone)} at the last sync.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function display(value: string | null, timeZone: string): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return formatDateTime(date, { timeZone });
  }
  return value.length > 200 ? `${value.slice(0, 197)}…` : value;
}
