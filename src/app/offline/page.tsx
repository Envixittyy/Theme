import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-ink">You are offline</h1>
        <p className="mt-2 text-sm text-ink-2">
          This page was not cached before you lost connection. Screens you have already visited still open, and
          anything you create is queued and sent when you are back.
        </p>
        <a
          href="/today"
          className="mt-5 inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-ink"
        >
          Go to Today
        </a>
      </div>
    </div>
  );
}
