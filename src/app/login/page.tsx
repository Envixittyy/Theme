import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth/session';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  missing: 'That link was incomplete. Request a new one below.',
  invalid: 'That sign-in link is not valid. Request a new one.',
  expired: 'That link expired. Sign-in links last 15 minutes.',
  used: 'That link was already used. Request a new one.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/today');

  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand text-brand-ink" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <div>
              <p className="text-base font-semibold leading-tight text-ink">Mapua School OS</p>
              <p className="text-xs text-ink-3">Classes, deadlines and coursework in one place</p>
            </div>
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-2">
            We send a one-time link to your school address. No password to remember or leak.
          </p>

          {errorKey && ERRORS[errorKey] ? (
            <p className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {ERRORS[errorKey]}
            </p>
          ) : null}

          <SignInForm />

          <p className="mt-8 text-xs text-ink-2">
            By signing in you agree that your coursework data is stored on this server. You can export or delete
            everything from{' '}
            <Link href="/settings/data" className="underline">
              Settings → Data
            </Link>
            .
          </p>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-brand lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.16),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-brand-ink">
          <p className="max-w-sm text-2xl font-semibold leading-snug">
            Every deadline, class and announcement — in one place that works offline.
          </p>
          <ul className="space-y-3 text-sm">
            <li>· Blackboard deadlines sync in without duplicates</li>
            <li>· Two-way Notion sync with conflict review</li>
            <li>· Installs on your iPhone Home Screen</li>
            <li>· Optional local AI — never required</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
