/* eslint-disable no-restricted-globals */
/**
 * Mapua School OS service worker.
 *
 * Responsibilities:
 *   - keep the application shell installable and launchable offline;
 *   - serve recently viewed data from cache when the network is gone;
 *   - render Web Push notifications and deep-link them to the exact record;
 *   - stay out of the way of mutations, which the page queues in IndexedDB so
 *     that queued state is visible in the UI rather than hidden in here.
 */

const VERSION = 'v1';
const SHELL_CACHE = `mos-shell-${VERSION}`;
const DATA_CACHE = `mos-data-${VERSION}`;
const ASSET_CACHE = `mos-assets-${VERSION}`;

const SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('mos-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2')
  );
}

/** Read-only API responses worth keeping for offline reading. */
function isCacheableData(url) {
  return url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutations are the page's business
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network, fall back to the last good copy of that page,
  // then to the offline shell. This is what makes a Home Screen launch work
  // on a train.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? (await caches.match('/offline')) ?? Response.error();
        }),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (isCacheableData(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            // Mark the response so the UI can show "showing offline copy".
            const headers = new Headers(cached.headers);
            headers.set('x-mos-offline', '1');
            return new Response(await cached.blob(), { status: 200, headers });
          }
          return new Response(JSON.stringify({ error: 'offline', offline: true }), {
            status: 503,
            headers: { 'content-type': 'application/json', 'x-mos-offline': '1' },
          });
        }),
    );
  }
});

/* ------------------------------ notifications ----------------------------- */

self.addEventListener('push', (event) => {
  let payload = { title: 'School OS', body: '', url: '/notifications', tag: 'mos' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // `tag` is the server's dedup key: a repeated event replaces rather than
      // stacks, which is what keeps a re-sync from spamming the lock screen.
      tag: payload.tag,
      renotify: false,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      data: { url: payload.url, eventId: payload.eventId },
      timestamp: Date.now(),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const url = new URL(client.url);
        if (url.origin === self.location.origin && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'navigate', url: target });
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser rotated the subscription. Tell the page so it can re-register
  // with the server; the server prunes the dead endpoint on its next send.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'push-subscription-change' }));
    }),
  );
});
