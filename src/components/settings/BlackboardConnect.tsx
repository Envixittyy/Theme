'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';

type TestResult = { ok: boolean; error?: string; eventCount?: number; calendarName?: string | null };

/**
 * Feed connection.
 *
 * The URL is treated as a secret from the first keystroke: it is sent once over
 * the API, never stored in component state beyond the form's lifetime, never
 * placed in the URL bar, and after connecting the server only ever returns a
 * redacted hint. "Test" proves the feed parses before anything is written.
 */
export function BlackboardConnect() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('Blackboard calendar');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [connected, setConnected] = useState<{ eventCount: number } | null>(null);

  const run = async (test: boolean) => {
    setBusy(true);
    setResult(null);
    const response = await mutate<TestResult & { summary?: { created: number } }>(
      '/api/integrations/blackboard',
      'POST',
      { url: url.trim(), label, test },
      { label: 'Connect Blackboard feed', queueOffline: false },
    );
    setBusy(false);

    if (!response.ok) {
      setResult({ ok: false, error: response.error });
      return;
    }
    if (response.queued) return;
    const data = response.data!;
    setResult(data);
    if (data.ok && !test) {
      setConnected({ eventCount: data.eventCount ?? 0 });
      setUrl('');
      router.refresh();
    }
  };

  return (
    <div className="space-y-3">
      <ol className="space-y-1 text-[12.5px] text-ink-2">
        <li>1. In Blackboard, open Calendar and choose the option to share or subscribe to your calendar.</li>
        <li>2. Copy the private iCalendar (webcal:// or https://) link it gives you.</li>
        <li>3. Paste it below. It is encrypted before it is stored, and never shown again.</li>
      </ol>

      <label className="block text-[12px] font-medium text-ink-3">
        Private feed URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://blackboard.example.edu/webapps/calendar/feed/…/learn.ics"
          autoComplete="off"
          spellCheck={false}
          className="mt-1 min-h-10 w-full rounded-md border border-line bg-canvas px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-brand"
        />
        <span className="mt-1 block text-[11px] font-normal text-ink-3">
          Treat this like a password: anyone with the link can read your deadlines.
        </span>
      </label>

      <label className="block text-[12px] font-medium text-ink-3">
        Label
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void run(true)} disabled={busy || !url.trim()}>
          {busy ? 'Checking…' : 'Test feed'}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void run(false)} disabled={busy || !url.trim()}>
          Connect and sync
        </Button>
      </div>

      {result && !result.ok && (
        <StatePanel kind="error" title="That feed could not be used" description={result.error} />
      )}
      {result?.ok && !connected && (
        <StatePanel
          kind="partial"
          title="Feed looks good"
          description={`Parsed ${result.eventCount} events${result.calendarName ? ` from “${result.calendarName}”` : ''}. Nothing has been saved yet — press “Connect and sync”.`}
        />
      )}
      {connected && (
        <StatePanel
          kind="partial"
          title="Connected"
          description={`Imported ${connected.eventCount} items. New work will arrive automatically, and repeated syncs will not create duplicates.`}
        />
      )}
    </div>
  );
}
