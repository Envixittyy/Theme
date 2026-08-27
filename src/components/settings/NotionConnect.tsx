'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge, StatePanel } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';

type MappingInfo = {
  databaseTitle?: string;
  properties?: Array<{ name: string; type: string }>;
  mapping?: Record<string, string | null>;
  matched?: string[];
  unmatched?: string[];
  databases?: Array<{ id: string; title: string }>;
};

const FIELD_LABELS: Array<{ key: string; label: string; note?: string }> = [
  { key: 'title', label: 'Task title' },
  { key: 'course', label: 'Course' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'dueDate', label: 'Due date/time' },
  { key: 'source', label: 'Source' },
  { key: 'sourceUrl', label: 'Source URL' },
  { key: 'submitted', label: 'Submitted', note: 'Checkbox. Ticking it records a submission; it never marks a task Done.' },
  { key: 'notes', label: 'Notes' },
];

/**
 * Notion setup.
 *
 * Deliberately three explicit steps — authorise, choose a database, confirm the
 * mapping — with a pull-only first run. Two-way sync only starts once the
 * student has seen what came back, because the failure mode of an unattended
 * first sync is writing nonsense into a database they care about.
 */
export function NotionConnect({
  accounts,
}: {
  accounts: Array<{ id: string; label: string; status: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selectedAccount, setSelectedAccount] = useState(accounts[0]?.id ?? '');
  const [info, setInfo] = useState<MappingInfo | null>(null);
  const [databaseId, setDatabaseId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const notice = params.get('notion');

  useEffect(() => {
    if (!selectedAccount) return;
    void fetch(`/api/integrations/notion/mapping?accountId=${selectedAccount}`)
      .then((r) => r.json())
      .then((data: MappingInfo) => setInfo(data))
      .catch(() => setInfo(null));
  }, [selectedAccount]);

  const inspect = async (id: string) => {
    setDatabaseId(id);
    setBusy(true);
    const response = await fetch(
      `/api/integrations/notion/mapping?accountId=${selectedAccount}&databaseId=${encodeURIComponent(id)}`,
    );
    const data = (await response.json()) as MappingInfo;
    setBusy(false);
    setInfo((prev) => ({ ...prev, ...data }));
    setMapping((data.mapping ?? {}) as Record<string, string | null>);
  };

  const save = async () => {
    setBusy(true);
    const result = await mutate('/api/integrations/notion/mapping', 'POST', {
      accountId: selectedAccount,
      databaseId,
      mapping,
    });
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="space-y-3">
        {notice && notice !== 'connected' && (
          <StatePanel
            kind="error"
            title="Notion did not connect"
            description={
              notice === 'denied'
                ? 'The authorization was declined.'
                : notice === 'state'
                  ? 'The authorization could not be verified. Start again from this page.'
                  : 'Something went wrong during authorization.'
            }
          />
        )}
        <p className="text-[12.5px] text-ink-2">
          Connect a Notion workspace to keep an Academic Tasks database in step with this app. Changes flow both
          ways, and anything both sides edited is held for your review rather than overwritten.
        </p>
        <Button variant="primary" size="sm" onClick={() => (window.location.href = '/api/integrations/notion/authorize')}>
          Connect Notion
        </Button>
      </div>
    );
  }

  const databases = info?.databases ?? [];

  return (
    <div className="space-y-3">
      {accounts.length > 1 && (
        <label className="block text-[12px] font-medium text-ink-3">
          Workspace
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-[12px] font-medium text-ink-3">
        Database
        <select
          value={databaseId}
          onChange={(e) => void inspect(e.target.value)}
          className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
        >
          <option value="">Choose a database…</option>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        {databases.length === 0 && (
          <span className="mt-1 block text-[11.5px] font-normal text-ink-3">
            No databases are shared with the integration yet. In Notion, open your Academic Tasks database, choose
            Connections, and add this app.
          </span>
        )}
      </label>

      {info?.properties && (
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-ink">Field mapping</p>
            {info.matched && <Badge tone="success">{info.matched.length} matched</Badge>}
            {info.unmatched && info.unmatched.length > 0 && (
              <Badge tone="warn">{info.unmatched.length} unmatched</Badge>
            )}
          </div>
          <p className="mb-2 text-[11.5px] text-ink-3">
            Unmapped fields are simply not synchronised. Nothing is guessed.
          </p>
          <ul className="space-y-1.5">
            {FIELD_LABELS.map((field) => (
              <li key={field.key} className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 text-[12.5px] text-ink-2">{field.label}</span>
                <select
                  value={mapping[field.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || null })}
                  className="min-h-9 min-w-40 flex-1 rounded-md border border-line bg-canvas px-2 text-[12.5px] text-ink"
                  aria-label={`Notion property for ${field.label}`}
                >
                  <option value="">Not synchronised</option>
                  {info.properties!.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                </select>
                {field.note && <span className="w-full text-[11px] text-ink-3">{field.note}</span>}
              </li>
            ))}
          </ul>

          <Button variant="primary" size="sm" className="mt-3" onClick={() => void save()} disabled={busy || !databaseId}>
            {busy ? 'Saving…' : 'Save mapping and run a first pull'}
          </Button>
        </div>
      )}

      {saved && (
        <StatePanel
          kind="partial"
          title="Mapping saved"
          description="A pull-only sync has been queued. Review what arrives, then two-way sync continues on schedule."
        />
      )}
    </div>
  );
}
