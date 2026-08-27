# Testing

Two suites, aimed at different risks.

```bash
npm test           # Vitest: 129 unit and integration tests
npm run test:e2e   # Playwright: flows, offline, security surface, accessibility
```

## Integration tests run against real PostgreSQL

Not a mock, not SQLite, not an in-memory repository — PGlite, which *is*
PostgreSQL. That matters because much of what this system relies on is database
behaviour: `ON CONFLICT` semantics, partial unique indexes, NULL distinctness,
enum ordering, transactional visibility.

Testing against a stub would have hidden three bugs that this arrangement
surfaced instead: a unique index that did not cover NULLs the way the code
assumed, a raw `execute` returning snake_cased columns, and a merge that pushed
local defaults back to Notion.

`tests/setup.ts` points the suite at an ephemeral database; `tests/helpers.ts`
truncates between tests, so each starts from nothing.

## What is covered, and why it was chosen

| Suite | Guards |
| --- | --- |
| `time.test.ts` | Time-zone arithmetic: Manila offsets, DST transitions, calendar-vs-24-hour day counting, quiet-hour windows that wrap midnight |
| `quick-add.test.ts` | The parser, the priority ladder, keyword type inference, and the override flags that stop a sync from undoing a student's choice |
| `sync-blackboard.test.ts` | The acceptance criteria, literally: no duplicates over ten runs, a deadline change that keeps status and notes and notifies once, nothing deleted, conflicts raised rather than overwritten, UID regeneration re-matched, and no feed URL in a stored error |
| `notion-sync.test.ts` | Three-way merge in every combination, loop prevention in both directions, archived pages flagged not deleted, unmapped values never becoming Done |
| `notifications.test.ts` | Dedup by event key, one delivery per device across retries, quiet-hours deferral (not dropping), per-kind and per-course suppression, honest failure when push is unconfigured, pruning dead endpoints |
| `authorization.test.ts` | Every entity, from the point of view of a second account that knows the primary key |
| `jobs-and-tasks.test.ts` | Queue idempotency, lock-key serialisation, backoff, dead-lettering, and Submitted-vs-Done semantics |
| `security.test.ts` | SSRF address policy and URL rules, envelope encryption and rotation, redaction |

## End-to-end

Playwright runs the built app against its own database, and signs in through the
**real** magic-link flow — the mail transport posts to a catcher the test suite
runs. There is no test-only authentication back door, because a back door is a
thing that can ship by accident.

Sign-in happens once and the session is shared, since signing in per test trips
the magic-link rate limiter. That is the limiter working correctly, so the
harness adapts to it rather than the product being loosened.

Both a desktop and a phone viewport run every spec. The phone run has already
earned its place: it caught row actions that were revealed on hover and
therefore unreachable on touch.

The security specs make their requests **from inside the page**, so they carry a
real session — an out-of-band HTTP client tests an anonymous caller, which is a
different and much weaker assertion.

## Accessibility

`e2e/accessibility.spec.ts` runs axe against every primary screen at
`wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`, in both viewports, and fails on
any violation. It also asserts the dark theme separately, and that the interface
is reachable by keyboard alone — skip link, command palette, `g`-prefixed jumps.

This gate found four genuine defects: tertiary text at 4.24:1 against light
surfaces, a calendar preview claiming `role="grid"` without row structure,
visually hidden file inputs with no accessible name, and dimmed text inside
status panels dropping under the threshold. All are fixed; the tests keep them
fixed.

## Adding a test

Reach for the integration suite when the behaviour involves the database, which
is most of what matters here. Reach for end-to-end when the risk is that the
*pieces* are wired wrongly rather than that a piece is wrong.

For anything touching sync, the question worth asking first is: what does this
do when it runs twice?
