'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { mutate } from '@/lib/client/api';

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        const result = await mutate('/api/announcements', 'PATCH', { action: 'mark-all-read' }, {
          label: 'Mark all announcements read',
        });
        setBusy(false);
        if (result.ok && !result.queued) router.refresh();
      }}
    >
      {busy ? 'Marking…' : 'Mark all read'}
    </Button>
  );
}
