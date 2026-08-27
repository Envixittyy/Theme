# Acceptance criteria — status

Each criterion from the brief, with where it is implemented and what proves it.
"Proven by" names a test that fails if the behaviour regresses.

| # | Criterion | Status | Proven by |
| --- | --- | --- | --- |
| 1 | Installs on an iPhone Home Screen and launches standalone | ✅ | `manifest.webmanifest` (`display: standalone`, `start_url: /today`), maskable icons, `viewport-fit=cover`, safe-area insets. e2e: *the app declares itself installable*. Physical install steps in [pwa.md](pwa.md) |
| 2 | Same account and data on desktop and mobile | ✅ | One account, one database, no device-scoped data except layouts (deliberately per breakpoint). e2e runs every spec in both viewports |
| 3 | Tasks created, scheduled, searched, filtered, completed, submitted, edited offline, reconciled online | ✅ | e2e: *a task created offline is queued and reconciled on reconnect*; `jobs-and-tasks.test.ts` for status semantics |
| 4 | Calendar and timetable usable at small and wide widths | ✅ | e2e asserts each of the four views renders with **no horizontal document overflow** in both viewports |
| 5 | Widgets reorder; layouts persist separately per breakpoint | ✅ | e2e: *a reordered layout persists and is stored per breakpoint*, which also asserts the editor names the breakpoint it is editing |
| 6 | A repeated Blackboard sync creates no duplicate tasks or notifications | ✅ | `sync-blackboard.test.ts`: *is idempotent* and *runs ten times without drift* |
| 7 | A changed deadline updates the date, keeps notes and status, audits, notifies once | ✅ | `sync-blackboard.test.ts`: *updates a changed deadline, keeps user state, audits it, and notifies once* |
| 8 | A missing Blackboard event is not deleted | ✅ | `sync-blackboard.test.ts`: *never deletes a task that disappears from the feed* |
| 9 | Notion changes flow both ways, loops prevented, same-field conflicts need review | ✅ | `notion-sync.test.ts`: eight scenarios covering pull, push, echo suppression, and conflict raise-and-resolve |
| 10 | Push deep-links correctly and respects course preferences and quiet hours | ✅ | `notifications.test.ts`: deep link assertions, per-course mute, quiet-hours deferral to the end of the window |
| 11 | Credentials never appear in the bundle, logs, notifications or errors | ✅ | `security.test.ts` redaction suite; sync-failure test asserting the feed URL is absent from the stored error; e2e scans every served JS chunk |
| 12 | Attachments are private and inaccessible to other users | ✅ | `authorization.test.ts`; e2e requests a foreign attachment id from inside an authenticated page and asserts 404 |
| 13 | With local AI offline the app is fully functional and says AI is unavailable | ✅ | The bridge is probed from the browser; Settings shows *Offline* with the reason, and every AI action falls back to the deterministic parser. Nothing in the app awaits the probe |
| 14 | AI-proposed tasks are reviewed before saving | ✅ | `parseExtractedTask` returns a preview; a deadline with no cited evidence in the source is discarded rather than shown |
| 15 | Tests cover sync idempotency, conflicts, priority rules, time-zone edges, notification dedup, authorization, SSRF | ✅ | 129 unit/integration tests across eight suites — see [testing.md](testing.md) |
| 16 | No critical accessibility violations on primary screens | ✅ | axe at WCAG 2.1 A/AA over twelve screens in two viewports and both themes, failing on **any** violation, not merely critical ones |

## Deliverables

| Deliverable | Where |
| --- | --- |
| Architecture decision record | [docs/adr/](adr/) — five ADRs |
| Repository structure | [README](../README.md#repository-layout) |
| Database schema and migrations | `src/lib/db/schema.ts`, `drizzle/*.sql` |
| Working UI with realistic demo data | The app; `npm run db:seed` |
| Backend APIs and background workers | `src/app/api/`, `src/lib/jobs/` |
| Blackboard connector | `src/lib/connectors/blackboard/` |
| Notion connector interface | `src/lib/connectors/notion/` (`NotionClient` is an interface; the test suite substitutes a fake workspace) |
| Notification service | `src/lib/notifications/`, `src/lib/connectors/push/` |
| Local-AI bridge protocol | `src/lib/connectors/localai/protocol.ts`, `bridge/school-os-bridge.mjs` |
| Environment template | [.env.example](../.env.example) — names only |
| Seed script | `src/lib/db/seed.ts` |
| Automated tests | `tests/`, `e2e/` |
| Setup, dev, deploy, PWA, notifications, integrations, backup, recovery docs | [docs/](.) |
| Features requiring institution Blackboard access, and fallbacks | [blackboard-capabilities.md](blackboard-capabilities.md) |

## Deliberately not implemented

Named here rather than stubbed, because a placeholder that looks like a feature
is worse than an absence that is documented.

- **Grades and feedback ingestion.** Needs institution API access, and deserves
  its own design rather than a scrape.
- **Submitting work to Blackboard.** Submission happens in Blackboard. This app
  tracks *that you submitted* as a state you set — it never claims to have
  handed anything in.
- **Announcement intake without institution access.** The calendar feed cannot
  carry announcements. The email fallback's connector shape exists; wiring a
  specific mail provider is deployment-specific.
- **Recurring task expansion.** `recurrence_rules` stores RFC 5545 RRULE text
  and the schema supports parent/instance links; the expansion engine is not
  built, and the UI does not offer recurrence rather than offering a control
  that does nothing.
- **Antivirus scanning.** Signature checking only, and the UI says so.
