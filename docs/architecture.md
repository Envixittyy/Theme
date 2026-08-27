# Architecture

## Module map

```
Presentation      app/(app)/…             Server Components read domain services
                  components/…            directly; interactivity is opt-in islands
                        │
Request boundary  app/api/…               validate → authorize → act or enqueue → return
                  lib/api/handler.ts      one wrapper: auth, CSRF, rate limit, error mapping
                        │
Domain            lib/domain/…            tasks, courses, notes, announcements,
                                          smart lists, dashboards, priority, quick-add
                        │
Sync              lib/sync/…              provider-agnostic: identity, three-way merge,
                                          field ownership, audit
                        │
Connectors        lib/connectors/…        blackboard · notion · storage · push · localai
                                          every one behind an interface
                        │
Infrastructure    lib/db/ lib/jobs/       Drizzle schema, durable queue, worker
                  lib/security/           encryption, redaction, SSRF, rate limits
```

The dependency direction only ever points down. A connector may call the sync
engine and the domain; neither may call a connector. That is what makes adding a
second Blackboard intake method a new file rather than a refactor.

## Where the rules live

Each guarantee the product makes is implemented in exactly one place, so it can
be verified by reading one file:

| Guarantee | Enforced in |
| --- | --- |
| A sync cannot change your status, priority, notes or tags | `lib/sync/engine.ts` — `SOURCE_FIELDS` |
| A repeated sync creates nothing | `external_records` unique `(account, external id)` |
| A repeated sync notifies nobody | `notification_events` unique `(user, event key)` |
| Nothing is deleted by a sync | `markMissing` — sets a flag, writes a review reason |
| Deadline maths respects the student's zone | `lib/shared/time.ts`, used by every caller |
| Feed URLs never leave the server | `lib/connectors/integrations.ts` — `readSecret` is the only exit, and it is server-only |
| Errors never carry credentials | `lib/security/redact.ts`, applied at every persistence point |
| Every row belongs to a user | `user_id` on every table; every query filters on it |

## A request

```
Browser ──▶ Route handler ──▶ withUser()
                               ├─ requireUser()      session cookie → DB → user
                               ├─ assertCsrf()       on any state change
                               ├─ rateLimit()        per user, per route
                               └─ handler
                                    ├─ zod parse     one schema module, shared with the AI path
                                    ├─ domain call   ownership checked on the row
                                    └─ enqueue       network work never happens in a request
```

Route handlers do not talk to providers. They validate, authorize, write, and
enqueue. A slow Blackboard cannot make the interface slow, because the
interface never waits on it.

## A sync

```
Worker claims job (FOR UPDATE SKIP LOCKED, one per account lock key)
  │
  ├─ startRun(idempotencyKey)          a retry resumes the same run
  ├─ fetch                             SSRF-guarded, conditional GET, size-capped
  ├─ parse                             hard limits on lines, events, property size
  │
  └─ for each item:
       resolveExternalRecord()         (account, external id) → row
         └─ miss → conservative fallback: normalised title + course + deadline,
                   only among records this payload no longer mentions,
                   only when exactly one matches
       │
       ├─ new      → create task in Inbox, derive priority, infer type
       └─ existing → three-way merge per field against the last-synced ancestor
                       ├─ only upstream moved  → apply
                       ├─ only local moved     → keep (and push, for two-way)
                       └─ both moved           → SyncConflict, write nothing
  │
  ├─ markMissing()                     flag, never delete
  ├─ finishRun()                       counts and a redacted error, if any
  └─ emitNotification()                dedup key per event
```

## Time

Every instant is UTC in the database. Wall-clock intent — "due 23:59" — is kept
as the instant *plus* the zone it was authored in, so a deadline stays 23:59 for
the student even if they travel, and "due today" is decided by the local
calendar rather than by a 24-hour window. Every conversion goes through
`lib/shared/time.ts`; nothing calls `Date` methods that depend on the server's
zone.

## Offline

The service worker caches the shell and recently viewed data. Mutations go to an
IndexedDB queue the page owns, are replayed oldest-first on reconnect, and are
visible and individually retryable in Settings. Each carries an idempotency key.
See [ADR 0005](adr/0005-offline-and-layouts.md).

## Local AI

The browser talks to a companion bridge on `127.0.0.1`; the server never does.
See [ADR 0004](adr/0004-local-ai-bridge.md).
