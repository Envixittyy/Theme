'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { replayQueue } from '@/lib/client/api';
import { clearFailed, discardMutation, listMutations, type QueuedMutation } from '@/lib/client/offline-queue';
import { formatRelative } from '@/lib/shared/time';

/**
 * The offline queue, made visible.
 *
 * A queue the user cannot see is indistinguishable from lost data, so every
 * pending change is listed with what it was and when it was made, and can be
 * retried or discarded individually.
 */
export function OfflineQueuePanel() {
  const router = useRouter();
  const [items, setItems] = useState<QueuedMutation[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listMutations());
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const retry = async () => {
    setBusy(true);
    const result = await replayQueue();
    await refresh();
    setBusy(false);
    if (result.sent > 0) router.refresh();
  };

  return (
    <Card>
      <CardHeader
        title="Offline changes"
        subtitle={items.length ? `${items.length} queued on this device` : 'Nothing waiting on this device'}
        action={
          items.length > 0 ? (
            <Button size="sm" onClick={() => void retry()} disabled={busy}>
              {busy ? 'Sending…' : 'Retry now'}
            </Button>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="Everything is sent"
          description="Changes made without a connection queue here and go out automatically when you are back."
        />
      ) : (
        <>
          <ul className="divide-y divide-[var(--c-line)]">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{item.label}</span>
                  <span className="block text-[11.5px] text-ink-3">
                    {formatRelative(new Date(item.createdAt))}
                    {item.attempts > 0 ? ` · ${item.attempts} attempts` : ''}
                    {item.lastError ? ` · ${item.lastError.slice(0, 80)}` : ''}
                  </span>
                </span>
                <Badge tone={item.state === 'pending' ? 'info' : item.state === 'conflict' ? 'warn' : 'danger'}>
                  {item.state}
                </Badge>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (item.id !== undefined) await discardMutation(item.id);
                    await refresh();
                  }}
                >
                  Discard
                </Button>
              </li>
            ))}
          </ul>
          {items.some((i) => i.state !== 'pending') && (
            <div className="border-t border-line px-4 py-2">
              <Button
                size="sm"
                onClick={async () => {
                  await clearFailed();
                  await refresh();
                }}
              >
                Clear the ones that failed
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
