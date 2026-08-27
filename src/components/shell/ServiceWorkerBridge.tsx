'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Registers the service worker and relays its messages.
 *
 * Registration is deliberately deferred to after load: a Home Screen launch
 * should paint before it spends bandwidth priming caches.
 */
export function ServiceWorkerBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration is not fatal: the app works online without it.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === 'navigate' && data.url) router.push(data.url);
      if (data?.type === 'push-subscription-change') {
        // The browser rotated our endpoint; ask the settings page to re-register.
        window.dispatchEvent(new CustomEvent('mos:push-resubscribe'));
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
