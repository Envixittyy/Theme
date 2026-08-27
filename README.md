# Mapua School OS

One dependable place for a university student's classes, deadlines, coursework,
notes and announcements — installable on an iPhone Home Screen, usable offline,
and honest about what it cannot do.

> **Working title.** This is an original interface influenced by the warmth of
> Mapua's red palette. It contains no Mapua or Blackboard branding, assets or
> code, and is not affiliated with either.

---

## What it does

- **Today** — a dashboard of classes, deadlines, overdue work, new imported
  items and announcements, arranged from widgets you can reorder, resize and
  hide, with separate layouts for phone, tablet and desktop.
- **Tasks** — capture in one line (`Lab report #CHM031 !high @lab tomorrow 5pm ~90m`),
  organise with smart lists and filters that live in the URL, and track
  *Submitted* separately from *Done*, because handing work in and being finished
  with it are different facts.
- **Calendar** — month, week, agenda and a proper weekly timetable, with classes
  and deadlines drawn differently and toggled independently.
- **Courses** — colour and icon per course, meeting times, workload and progress.
- **Announcements** and **Notes** — Markdown notes with backlinks, attachments,
  and full-text search.
- **Blackboard sync** — a repeated sync creates no duplicates; a changed deadline
  updates the date, keeps your status and notes, records a field-level audit
  entry and notifies once; an item that disappears upstream is flagged for
  review, never deleted.
- **Notion two-way sync** — field-level three-way merge with loop prevention;
  anything both sides changed waits for you in a conflict review screen.
- **Notifications** — Web Push to desktop and installed iPhone PWAs, with quiet
  hours, per-course and per-kind controls, digests, and deep links.
- **Offline** — read what you have visited, create and edit tasks and notes, see
  exactly what is queued, and reconcile on reconnect.
- **Optional local AI** — runs on *your* machine through a companion bridge.
  Turn it off, or never turn it on, and nothing else changes.

## Quick start

```bash
npm install
npm run db:migrate     # applies migrations
npm run db:seed        # a term of realistic demo data
npm run dev            # http://localhost:3000
```

No database server is required for development: with `DATABASE_URL` unset the
app runs on **PGlite**, PostgreSQL compiled to WebAssembly, stored in
`.data/pglite`. See [ADR 0002](docs/adr/0002-two-database-drivers.md).

Sign in with the seeded address (`demo@school.local`). With no mail transport
configured the sign-in link is printed to the server log and shown in the UI,
which says plainly that no email was sent.

Run the background worker in a second terminal — polling, reminders and push
delivery live there:

```bash
npm run worker
```

## Documentation

| | |
| --- | --- |
| [Setup and local development](docs/setup.md) | Prerequisites, scripts, database options, seeding |
| [Deployment](docs/deployment.md) | Processes, environment, migrations, hardening |
| [PWA installation](docs/pwa.md) | Home Screen install, offline behaviour, updates |
| [Notifications](docs/notifications.md) | VAPID keys, the iOS caveat, quiet hours, troubleshooting |
| [Integrations](docs/integrations.md) | Connecting Blackboard and Notion, field mapping, conflicts |
| [Blackboard capability matrix](docs/blackboard-capabilities.md) | What needs institution API access, and the fallback for each |
| [Backup and recovery](docs/backup-recovery.md) | What to back up, restore drills, key rotation |
| [Architecture](docs/architecture.md) | Module map, request and sync flow |
| [Architecture decisions](docs/adr/) | Five ADRs covering stack, drivers, sync rules, local AI, offline |
| [Security model](docs/security.md) | Threats considered, mitigations, and the tests that hold them |

## Testing

```bash
npm test           # 129 unit and integration tests against real PostgreSQL
npm run test:e2e   # Playwright: flows, offline, security surface, axe accessibility
npm run typecheck
```

The integration tests run against PGlite, so they exercise genuine constraints
and transactions rather than a mocked repository. Several product bugs in this
repository's history were found by them and are documented in the commit log.

## Repository layout

```
src/
  app/                     Next.js App Router
    (app)/                 Authenticated screens: today, tasks, calendar,
                           courses, announcements, notes, notifications, settings
    api/                   Route handlers (validate → authorize → act → return)
    login/, auth/, offline/
  components/
    shell/                 App shell, command palette, quick add, sync status
    dashboard/             Widget catalogue, grid, editor
    tasks/ calendar/ courses/ notes/ settings/ ui/
  lib/
    db/                    Drizzle schema, migrations runner, seed
    auth/                  Magic links, sessions, CSRF, mail adapter
    security/              Envelope encryption, redaction, SSRF guard, rate limits
    domain/                Tasks, courses, notes, announcements, smart lists,
                           dashboards, priority and type rules, quick-add parser
    sync/                  Provider-agnostic engine: identity, merge, audit
    connectors/            blackboard/ notion/ storage/ push/ localai/
    notifications/         Event dedup, quiet hours, delivery, digests
    jobs/                  Durable queue, handlers, worker
    client/                Browser API layer, offline queue, local-AI client
    shared/                Time zones, iCalendar, validation
bridge/                    The local-AI companion (no dependencies)
drizzle/                   Generated SQL migrations
docs/                      Documentation and ADRs
e2e/                       Playwright specs
tests/                     Vitest suites
```

## What this app deliberately will not do

- Put a feed URL or token in a page, a log, an error message or a notification.
- Send your coursework to a third-party AI service.
- Delete a task because a provider stopped listing it.
- Change a task to Submitted or Done because of a sync.
- Report a sync as successful when it was not, or a notification as delivered
  when push is not configured.

## Licence

Original work. No proprietary interface, branding, asset or source code from any
other product is reproduced here.
