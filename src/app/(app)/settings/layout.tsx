import Link from 'next/link';
import { SettingsNav } from '@/components/settings/SettingsNav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-3">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="text-[13px] text-ink-3">
          Everything here is per-account and takes effect immediately.{' '}
          <Link href="/settings/data" className="underline">
            Export or delete your data
          </Link>{' '}
          at any time.
        </p>
      </header>
      <div className="grid gap-3 lg:grid-cols-[13rem_1fr]">
        <SettingsNav />
        <div className="min-w-0 space-y-3">{children}</div>
      </div>
    </div>
  );
}
