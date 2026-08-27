'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('sending');
    setDevLink(null);
    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as {
        accepted?: boolean;
        delivered?: boolean;
        detail?: string;
        devLink?: string;
        error?: string;
      };
      if (!res.ok) {
        setState('error');
        setDetail(data.error ?? 'That did not work.');
        return;
      }
      setState('sent');
      setDevLink(data.devLink ?? null);
      setDetail(
        data.delivered
          ? 'Check your inbox — the link is valid for 15 minutes.'
          : 'Mail delivery is not configured on this server, so no email was sent.',
      );
    } catch {
      setState('error');
      setDetail('Could not reach the server. Check your connection.');
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label htmlFor="email" className="block text-[13px] font-medium text-ink-2">
        School email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@school.edu"
        className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand"
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={state === 'sending' || !email}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </Button>

      {state === 'sent' && (
        <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2" role="status">
          <p>{detail}</p>
          {devLink && (
            <p className="mt-2 break-all">
              Development transport — open this link to sign in:{' '}
              <a href={devLink} className="font-medium text-brand underline">
                {devLink}
              </a>
            </p>
          )}
        </div>
      )}
      {state === 'error' && (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
          {detail}
        </p>
      )}
    </form>
  );
}
