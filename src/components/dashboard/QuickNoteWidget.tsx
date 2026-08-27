'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { mutate } from '@/lib/client/api';

/** Scratch capture that becomes a real note — including while offline. */
export function QuickNoteWidget() {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'error'>('idle');

  const save = async () => {
    if (!body.trim()) return;
    setState('saving');
    const firstLine = body.trim().split('\n')[0]!.slice(0, 80);
    const result = await mutate('/api/notes', 'POST', { title: firstLine, body }, { label: 'Add note' });
    if (!result.ok) {
      setState('error');
      return;
    }
    setBody('');
    setState(result.queued ? 'queued' : 'saved');
    if (!result.queued) router.refresh();
    window.setTimeout(() => setState('idle'), 2500);
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <label htmlFor="quick-note" className="sr-only">
        Quick note
      </label>
      <textarea
        id="quick-note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Jot something down…"
        className="min-h-24 w-full flex-1 resize-none rounded-md border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-3" role="status">
          {state === 'saved' && 'Saved to Notes'}
          {state === 'queued' && 'Queued — will sync when online'}
          {state === 'error' && 'Could not save'}
        </span>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={!body.trim() || state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save note'}
        </Button>
      </div>
    </div>
  );
}
