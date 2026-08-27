'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, StatePanel } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { formatRelative } from '@/lib/shared/time';

type Account = {
  id: string;
  provider: string;
  label: string;
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  secretHint: string | null;
  demo: boolean;
  importOnly: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  blackboard_ics: 'Blackboard calendar feed',
  blackboard_api: 'Blackboard REST API',
  blackboard_email: 'Blackboard email intake',
  notion: 'Notion',
};

export function IntegrationList({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; text: string; kind: 'ok' | 'error' } | null>(null);

  const sync = async (id: string) => {
    setBusy(id);
    setResult(null);
    const response = await mutate<{ summary?: { created: number; updated: number; skipped: number; missing: number } }>(
      `/api/integrations/${id}/sync`,
      'POST',
      {},
      { label: 'Sync now', queueOffline: false },
    );
    setBusy(null);
    if (!response.ok) {
      setResult({ id, text: response.error, kind: 'error' });
      return;
    }
    const s = response.queued ? null : response.data?.summary;
    setResult({
      id,
      text: s
        ? `${s.created} new, ${s.updated} updated, ${s.skipped} unchanged${s.missing ? `, ${s.missing} no longer in the feed` : ''}.`
        : 'Queued.',
      kind: 'ok',
    });
    router.refresh();
  };

  const disconnect = async (id: string, label: string) => {
    if (!window.confirm(`Disconnect “${label}”? Your tasks stay; the stored credential is deleted.`)) return;
    setBusy(id);
    await mutate(`/api/integrations/${id}`, 'DELETE', undefined, { label: 'Disconnect integration', queueOffline: false });
    setBusy(null);
    router.refresh();
  };

  return (
    <ul className="divide-y divide-[var(--c-line)]">
      {accounts.map((account) => (
        <li key={account.id} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[13.5px] font-medium text-ink">{account.label}</p>
                <Badge
                  tone={account.status === 'connected' ? 'success' : account.status === 'error' ? 'danger' : 'neutral'}
                >
                  {account.status}
                </Badge>
                {account.demo && <Badge tone="warn">demo feed — no network</Badge>}
                {account.importOnly && <Badge tone="neutral">file imports</Badge>}
              </div>
              <p className="mt-0.5 text-[11.5px] text-ink-3">
                {PROVIDER_LABEL[account.provider] ?? account.provider}
                {account.secretHint ? ` · ${account.secretHint}` : ''} · connected{' '}
                {formatRelative(new Date(account.createdAt))}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => void sync(account.id)} disabled={busy === account.id}>
                {busy === account.id ? 'Syncing…' : 'Sync now'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void disconnect(account.id, account.label)}>
                Disconnect
              </Button>
            </div>
          </div>

          {account.lastError && account.status === 'error' && (
            <div className="mt-2">
              <StatePanel kind="error" title="Last sync failed" description={account.lastError} />
            </div>
          )}
          {result?.id === account.id && (
            <p
              className={`mt-2 text-[12px] ${result.kind === 'error' ? 'text-danger' : 'text-ink-2'}`}
              role="status"
            >
              {result.text}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
