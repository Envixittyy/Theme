# Installing on a phone or desktop

## iPhone and iPad

Safari does not offer an install prompt; installation is a menu action, and
notification permission only becomes available *after* installing. The order
matters.

1. Open the app in **Safari** (not Chrome or Firefox on iOS — only Safari can
   add to the Home Screen).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open **School OS from the Home Screen icon**, not from Safari. It launches
   without browser chrome, which is how you can tell it is the installed app.
4. Go to **Settings → Notifications** and press **Enable notifications**. iOS
   shows its permission prompt only now.

The Notifications settings screen detects all of this: on iOS, outside
standalone mode, the enable button is disabled and the panel explains that the
app must be added to the Home Screen first. It does not ask for a permission
that cannot be granted.

## Android

Chrome offers an install prompt, or use **⋮ → Install app**. Notification
permission can be requested before or after installing.

## Desktop

Chrome, Edge and Brave show an install icon in the address bar; Safari on macOS
uses **File → Add to Dock**. The installed app is the same code in a plain
window.

## What works offline

Once you have opened the app online at least once:

- The application shell launches offline.
- Screens you have visited render from cache, marked as an offline copy.
- You can **create and edit tasks and notes**. They queue locally and are sent
  when you reconnect.
- The header shows one of four states — Synced, Syncing, Offline (with a count
  of queued changes), or "needs review".

What does not work offline, and says so: uploading attachments (queuing
megabytes in a phone's storage is a poor trade), connecting an integration, and
running a sync.

Everything queued is visible and individually retryable or discardable at
**Settings → Sync health → Offline changes**. A queue you cannot inspect is
indistinguishable from lost data, which is why this one is not hidden inside the
service worker.

## Conflicts after being offline

Each queued change carries a client-generated idempotency key, so a replay after
an ambiguous failure cannot apply twice. If the server rejects a change (say the
task was deleted on another device), it is parked as `failed` or `conflict`
rather than blocking everything behind it, and the queue continues.

## Updates

The service worker caches the shell and updates it in the background. A new
version is picked up on the next launch. To force it: close every window (on
iOS, swipe the app away from the app switcher) and reopen.

To clear cached data entirely: iOS **Settings → Safari → Advanced → Website
Data**; on desktop, DevTools → Application → Storage → Clear site data.

## What is stored on the device

- The cached shell and recently viewed pages (Cache Storage).
- The offline mutation queue (IndexedDB).
- Your theme, density and the local-AI bridge token (localStorage). The bridge
  token stays on the device and is never sent to the server.
- The session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.

Signing out clears the session. Removing the app from the Home Screen removes
its storage with it.

## Verifying an install

Settings → Notifications shows an **installed app** badge when the page is
running in standalone mode. If that badge is missing, you opened it from the
browser rather than the Home Screen icon, and iOS will not offer notifications.
