'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';

type Preview = {
  preview: boolean;
  eventCount?: number;
  calendarName?: string | null;
  warnings?: string[];
  sample?: Array<{ summary: string; dueAt: string | null }>;
  summary?: { created: number; updated: number; skipped: number };
};

/** Import runs preview-first: nothing is written until the student confirms. */
export function IcsImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ics, setIcs] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    setError(null);
    setPreview(null);
    if (file.size > 2_000_000) {
      setError('That file is larger than the 2 MB import limit.');
      return;
    }
    const text = await file.text();
    setIcs(text);
    setBusy(true);
    const result = await mutate<Preview>('/api/calendar/import', 'POST', { ics: text, dryRun: true }, {
      label: 'Preview calendar import',
      queueOffline: false,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.queued) setPreview(result.data);
  };

  const commit = async () => {
    if (!ics) return;
    setBusy(true);
    const result = await mutate<Preview>('/api/calendar/import', 'POST', { ics, dryRun: false }, {
      label: 'Import calendar file',
      queueOffline: false,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.queued) {
      setPreview(result.data);
      setIcs(null);
      router.refresh();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-2">
        Any standard <code className="rounded bg-surface-2 px-1">.ics</code> file works — a downloaded Blackboard
        export, a departmental calendar, or a timetable. It runs through the same pipeline as a live feed, so
        importing the same file twice cannot create duplicates.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".ics,text/calendar"
        className="sr-only"
        aria-label="Choose an iCalendar file to import"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void load(file);
          e.target.value = '';
        }}
      />
      <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Icon name="upload" size={14} />
        Choose a .ics file
      </Button>

      {error && <StatePanel kind="error" title="Import failed" description={error} />}

      {preview?.preview && (
        <div className="rounded-md border border-line p-3">
          <p className="text-[13px] font-medium text-ink">
            {preview.eventCount} events{preview.calendarName ? ` from “${preview.calendarName}”` : ''}
          </p>
          {preview.warnings && preview.warnings.length > 0 && (
            <ul className="mt-1 text-[11.5px] text-warn">
              {preview.warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          )}
          <ul className="mt-2 space-y-0.5 text-[12px] text-ink-2">
            {preview.sample?.map((s, i) => (
              <li key={i} className="truncate">
                {s.summary}
                {s.dueAt ? ` — ${new Date(s.dueAt).toLocaleString()}` : ''}
              </li>
            ))}
          </ul>
          <Button variant="primary" size="sm" className="mt-2" onClick={() => void commit()} disabled={busy}>
            Import these
          </Button>
        </div>
      )}

      {preview && !preview.preview && preview.summary && (
        <StatePanel
          kind="partial"
          title="Imported"
          description={`${preview.summary.created} new, ${preview.summary.updated} updated, ${preview.summary.skipped} already present.`}
        />
      )}
    </div>
  );
}
