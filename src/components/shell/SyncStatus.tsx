'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';
import { listMutations, type QueuedMutation } from '@/lib/client/offline-queue';
import { replayQueue } from '@/lib/client/api';
import { useRouter } from 'next/navigation';

/**
 * Honest connection state.
 *
 * Four states, never conflated: online and clear, online with queued changes
 * replaying, offline with queued changes, and "some changes need you". The
 * badge is a link into the queue rather than a decoration.
 */
export function SyncStatus({ openConflicts }: { openConflicts: number }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const refresh = async () => setQueue(await listMutations());
    void refresh();

    const flush = async () => {
      setFlushing(true);
      const result = await replayQueue();
      setQueue(await listMutations());
      setFlushing(false);
      if (result.sent > 0) router.refresh();
    };

    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const interval = window.setInterval(refresh, 5000);
    if (navigator.onLine) void flush();

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(interval);
    };
  }, [router]);

  const pending = queue.filter((m) => m.state === 'pending').length;
  const stuck = queue.filter((m) => m.state !== 'pending').length;

  const state = !online
    ? { tone: 'bg-warn-soft text-warn', icon: 'cloudOff', label: pending ? `Offline · ${pending} queued` : 'Offline' }
    : stuck || openConflicts
      ? {
          tone: 'bg-danger-soft text-danger',
          icon: 'alert',
          label: `${stuck + openConflicts} need${stuck + openConflicts === 1 ? 's' : ''} review`,
        }
      : pending || flushing
        ? { tone: 'bg-info-soft text-info', icon: 'refresh', label: `Syncing ${pending}` }
        : { tone: 'text-ink-3', icon: 'cloud', label: 'Synced' };

  return (
    <Link
      href={stuck || openConflicts ? '/settings/sync' : '/settings/sync'}
      className={cx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors',
        state.tone,
      )}
      aria-label={`Sync status: ${state.label}`}
      title={state.label}
    >
      <Icon name={state.icon} size={16} className={flushing ? 'animate-spin' : undefined} />
      <span className="hidden sm:inline">{state.label}</span>
    </Link>
  );
}
