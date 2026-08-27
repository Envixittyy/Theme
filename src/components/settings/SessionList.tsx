'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { mutate } from '@/lib/client/api';
import { formatRelative } from '@/lib/shared/time';

export function SessionList({
  sessions,
}: {
  sessions: Array<{
    id: string;
    userAgent: string | null;
    createdAt: string;
    lastSeenAt: string;
    revoked: boolean;
    current: boolean;
  }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-[var(--c-line)]">
      {sessions.map((session) => (
        <li key={session.id} className="flex items-center gap-2 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-ink">{describeAgent(session.userAgent)}</p>
            <p className="text-[11.5px] text-ink-3">
              Last used {formatRelative(new Date(session.lastSeenAt))} · started{' '}
              {formatRelative(new Date(session.createdAt))}
            </p>
          </div>
          {session.current && <Badge tone="success">This device</Badge>}
          {session.revoked ? (
            <Badge tone="neutral">Revoked</Badge>
          ) : (
            !session.current && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy === session.id}
                onClick={async () => {
                  setBusy(session.id);
                  await mutate('/api/sessions', 'DELETE', { id: session.id }, { label: 'Revoke session' });
                  setBusy(null);
                  router.refresh();
                }}
              >
                Revoke
              </Button>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

function describeAgent(agent: string | null): string {
  if (!agent) return 'Unknown device';
  const browser = /Firefox\/[\d.]+/.test(agent)
    ? 'Firefox'
    : /Edg\//.test(agent)
      ? 'Edge'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Mac OS X/.test(agent)
        ? 'macOS'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}
