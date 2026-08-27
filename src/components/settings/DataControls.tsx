'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/primitives';
import { getCsrfToken } from '@/lib/client/api';

export function DataControls({ email }: { email: string }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportData = () => {
    // A plain navigation: the file streams from the server with the session
    // cookie, so nothing large has to pass through JavaScript.
    window.location.href = '/api/account/export';
  };

  const deleteAccount = async () => {
    if (confirm !== email) return;
    if (!window.confirm('This permanently deletes your account and everything in it. Continue?')) return;
    setBusy(true);
    const response = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() ?? '' },
      body: JSON.stringify({ confirm }),
    });
    setBusy(false);
    if (response.ok) {
      window.location.href = '/login?deleted=1';
      return;
    }
    const payload = (await response.json()) as { error?: string };
    setMessage(payload.error ?? 'Deletion failed.');
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">Export</h3>
        <p className="mt-1 text-[12.5px] text-ink-3">
          A single JSON file with your courses, tasks, notes, announcements, sync history and audit trail.
          Attachment contents are not included; their metadata is, along with a link to download each one.
          Integration secrets are never exported.
        </p>
        <Button size="sm" className="mt-2" onClick={exportData}>
          <Icon name="download" size={14} />
          Download my data
        </Button>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">Delete this account</h3>
        <p className="mt-1 text-[12.5px] text-ink-3">
          Removes every task, note, attachment, device and integration credential immediately. It cannot be undone,
          and nothing is retained afterwards.
        </p>
        <label className="mt-2 block text-[12px] text-ink-3">
          Type <strong className="font-semibold text-ink-2">{email}</strong> to confirm
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 min-h-9 w-full max-w-sm rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink"
            autoComplete="off"
          />
        </label>
        <Button
          size="sm"
          variant="danger"
          className="mt-2"
          disabled={confirm !== email || busy}
          onClick={() => void deleteAccount()}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </Button>
        {message && <div className="mt-2"><StatePanel kind="error" title="Could not delete" description={message} /></div>}
      </section>
    </div>
  );
}
