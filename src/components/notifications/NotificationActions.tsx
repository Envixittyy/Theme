'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { mutate } from '@/lib/client/api';

export function NotificationActions({ unread }: { unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={unread === 0 || busy}
      onClick={async () => {
        setBusy(true);
        const result = await mutate('/api/notifications', 'PATCH', { ids: 'all' }, { label: 'Mark notifications read' });
        setBusy(false);
        if (result.ok && !result.queued) router.refresh();
      }}
    >
      {busy ? 'Marking…' : 'Mark all read'}
    </Button>
  );
}
