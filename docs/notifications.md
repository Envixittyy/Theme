# Notifications

## What the app sends

| Kind | When | Default |
| --- | --- | --- |
| New Blackboard item | A sync discovers work that was not there before | on |
| Deadline changed | A deadline moves upstream | on |
| Announcement | A new or meaningfully edited announcement arrives | on |
| Reminder | Your own reminder, at its offset before the deadline | on |
| Daily digest | One summary at a time you choose | **off** |
| Sync problem | A sync needs you; rate-limited to one per account per hour | on |

Each is a switch at **Settings → Notifications**, alongside a per-course mute.
Muting a course still records its notifications in the app — it only stops the
buzz — so nothing goes missing silently.

## Server setup

Generate a VAPID key pair once:

```bash
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
(`mailto:you@example.com`) on **both** the web and worker processes; the worker
is what actually delivers.

Without them, nothing pretends to work: the notification centre still records
every event, the settings screen says push is not configured on this server, and
delivery rows are written with that reason rather than marked sent.

## The iPhone sequence

Safari exposes the Notification permission prompt only to a PWA that has been
added to the Home Screen, and only after a user gesture. The app enforces that
order rather than failing mysteriously — see [PWA installation](pwa.md).

## Quiet hours

A window in *your* time zone, defaulting to 22:00–07:00. Anything arriving
inside it is **held, not dropped**: the event is recorded immediately, given a
`deliverAfter` timestamp, and delivered when the window ends. The notification
centre shows held items with the time they will arrive.

The window may wrap midnight. Setting start equal to end pauses notifications
entirely, which is a legitimate thing to want.

## Not being spammed

Four mechanisms, each doing a different job:

1. **Event keys.** Every notification has a stable key — for a new Blackboard
   item, `bb:new:<account>:<external id>`; for a deadline change, the key
   includes the *new* deadline. A unique index on (user, key) means a repeated
   sync physically cannot notify twice. The tests run a sync ten times and
   assert the count does not move.
2. **Per-device delivery records.** A retried delivery job cannot re-send to a
   device that already received it.
3. **Burst grouping.** Several events for one user inside a few minutes collapse
   into a single digest, so a five-item Blackboard drop is one buzz.
4. **Failure rate limiting.** Sync failure notifications are keyed by the hour,
   so a broken feed tells you once, not every fifteen minutes.

## Deep links

Every notification carries an in-app route — `/tasks/<id>`,
`/announcements/<id>` — and tapping it focuses an existing window and navigates,
or opens a new one. Payloads never contain credentials, feed URLs, or more of an
announcement than its excerpt.

## Managing devices

Settings → Notifications lists every registered device with when it last
received something, and lets you remove any of them. Removal is immediate.

When a push service reports an endpoint as gone (404/410), the subscription is
marked expired and not retried — that is how a phone that was reset stops
counting as a delivery target.

## Troubleshooting

**"Push is not configured on this server."** The VAPID keys are missing. The
in-app notification centre still works.

**Permission says "denied".** The browser is blocking notifications for the
site; that has to be changed in browser settings, and the app says so rather
than re-prompting uselessly.

**Nothing arrives on iOS.** Confirm you opened the app from the Home Screen icon
(Settings → Notifications shows an "installed app" badge), then check Focus
modes and iOS Settings → Notifications → School OS.

**Notifications arrive late.** Check quiet hours, and check that the worker
process is running — it is what delivers.

**Duplicates.** These should be impossible; if you see one, the event keys of
the two notifications are the diagnostic, and they are visible in the
notification centre's data.
