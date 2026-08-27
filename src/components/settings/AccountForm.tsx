'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { mutate } from '@/lib/client/api';

const COMMON_ZONES = [
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

export function AccountForm({
  displayName,
  timeZone,
  weekStartsOn,
  timeFormat,
  defaultView,
}: {
  displayName: string;
  timeZone: string;
  weekStartsOn: number;
  timeFormat: 'h12' | 'h24';
  defaultView: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({ displayName, timeZone, weekStartsOn, timeFormat, defaultView });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const zones = COMMON_ZONES.includes(timeZone) ? COMMON_ZONES : [timeZone, ...COMMON_ZONES];

  const save = async () => {
    setState('saving');
    const result = await mutate('/api/preferences', 'PATCH', {
      timeZone: draft.timeZone,
      weekStartsOn: draft.weekStartsOn,
      timeFormat: draft.timeFormat,
      defaultView: draft.defaultView,
    });
    if (!result.ok) {
      setState('error');
      setError(result.error);
      return;
    }
    setState('saved');
    router.refresh();
    window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] font-medium text-ink-3">
          Time zone
          <select
            value={draft.timeZone}
            onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace('_', ' ')}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-ink-3">
            Deadlines are stored in UTC and shown here. Changing this does not move any deadline.
          </span>
        </label>

        <label className="text-[12px] font-medium text-ink-3">
          Week starts on
          <select
            value={draft.weekStartsOn}
            onChange={(e) => setDraft({ ...draft, weekStartsOn: Number(e.target.value) })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
            <option value={6}>Saturday</option>
          </select>
        </label>

        <label className="text-[12px] font-medium text-ink-3">
          Time format
          <select
            value={draft.timeFormat}
            onChange={(e) => setDraft({ ...draft, timeFormat: e.target.value as 'h12' | 'h24' })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          >
            <option value="h12">12-hour (5:30 PM)</option>
            <option value="h24">24-hour (17:30)</option>
          </select>
        </label>

        <label className="text-[12px] font-medium text-ink-3">
          Open the app on
          <select
            value={draft.defaultView}
            onChange={(e) => setDraft({ ...draft, defaultView: e.target.value })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          >
            <option value="/today">Today</option>
            <option value="/tasks">Tasks</option>
            <option value="/calendar">Calendar</option>
            <option value="/courses">Courses</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save'}
        </Button>
        <span className="text-[12px] text-ink-3" role="status">
          {state === 'saved' && 'Saved'}
          {state === 'error' && <span className="text-danger">{error}</span>}
        </span>
      </div>
    </div>
  );
}
