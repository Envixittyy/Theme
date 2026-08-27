# ADR 0003 — Field ownership, three-way merge, and never deleting

**Status:** accepted · **Date:** 2026-08

## Context

Two providers write to the same task rows as the student does. Blackboard is
one-way (it publishes deadlines); Notion is two-way. The failure mode that
matters is not a missed sync — it is a sync that quietly destroys something the
student did: un-submitting handed-in work, overwriting their edited title,
deleting a task because a feed stopped listing it.

## Decision

Four rules, enforced in the sync engine rather than in each connector.

**1 · Fields have owners.** `SOURCE_FIELDS` (`title`, `description`, `dueAt`,
`sourceUrl`) may be written by a one-way connector. Status, priority, type,
tags, notes and reminders belong to the student, and no connector can write
them. The list is data, so a reviewer can check the guarantee by reading one
constant instead of auditing every provider.

**2 · Merges are three-way and per field.** Each external record stores the
values at the last successful sync — the common ancestor. A field only one side
changed is applied. A field both sides changed becomes a `SyncConflict` with all
three values, and *nothing is written*. Last-write-wins across the whole record
was rejected: it turns one contested field into a silent loss of every other
field the student had edited.

**3 · Deletion is never a sync outcome.** An item that stops appearing upstream
is marked `missingSinceAt` with a reason and surfaced for review. Only an
explicit user action deletes.

**4 · Uncertainty never decides.** If Notion's status value is not one the
mapping recognises, the local status is left alone and the discrepancy is
reported. A task never becomes Done or Submitted because a translation table
came up empty.

## Loop prevention

For two-way sync, three mechanisms in layers: the remote revision
(`last_edited_time`) we produced is recognised and skipped; the hash of what we
last pushed is compared against what comes back; and the merge ancestor is
updated on every write, so a field that matches the ancestor has, by definition,
nothing to push. The ancestor is the load-bearing one — origin flags proved too
coarse, because a pull and an unpushed local edit can land in the same run.

## Identity and deduplication

Primary key for dedup is `(integration account, external id)` — a unique index,
so idempotency is enforced by the database rather than by a code path. A
conservative fallback exists for feeds that regenerate UIDs: normalised title +
course code + exact deadline, matched only against records the current payload
no longer mentions, and only when exactly one candidate matches. Two candidates
means no merge — a wrong merge is unrecoverable, a duplicate is not.

## Consequences

Conflicts are a visible product surface (Settings → Sync health), not an
internal state. Sync runs are idempotent by construction, which the test suite
asserts by running the same feed ten times and expecting zero drift.
