# Connecting Blackboard and Notion

Both are optional. Everything in the app — tasks, calendar, courses, notes,
notifications, offline — works with nothing connected.

---

## Blackboard calendar feed

The one intake method a student can enable alone, and the one that covers the
thing that actually causes missed work: deadlines.

### Getting the URL

1. In Blackboard, open **Calendar**.
2. Find the option to share or subscribe to your calendar (its exact name
   varies by version — "Calendar Settings", "Share Calendar", or an iCal icon).
3. Copy the personal link. It looks like
   `https://blackboard.yourschool.edu/webapps/calendar/feed/<long opaque string>/learn.ics`,
   and may be offered as `webcal://` — either works.

**Treat that link like a password.** Anyone holding it can read your deadlines.
It is a bearer credential with no expiry and no second factor.

### Connecting

**Settings → Integrations → Blackboard calendar feed.** Press **Test feed**
first: the server validates the URL against its SSRF policy, fetches it once,
and reports how many events it parsed — without storing anything. Then
**Connect and sync**.

From that moment the URL is encrypted at rest (AES-256-GCM, envelope-encrypted
under a rotatable key) and is never returned to the browser again. The interface
shows a redacted hint — host plus a truncated tail — enough to recognise your
own feed and useless to anyone else.

### What each sync does

- Creates genuinely new tasks, in **Inbox**, never pre-marked as submitted.
- Updates the deadline, title, description and source link when Blackboard
  changes them.
- Leaves your status, priority, type, notes, tags and reminders alone. Always.
- Recomputes priority from the deadline **unless you set it yourself** — once
  you pick a priority, it is yours.
- Records every field change with its before, after and reason.
- Flags an item that has vanished upstream for review. It never deletes.
- Notifies once per new item and once per deadline change.

Re-running a sync over unchanged input writes nothing and notifies nobody.

### Importing a file instead

**Settings → Integrations → Import a calendar file** takes any `.ics` — a
Blackboard export, a departmental calendar, a timetable. It previews what it
found before writing anything, and runs the same pipeline as a live feed, so
importing the same file twice cannot create duplicates.

### Announcements

Not available through a calendar feed, because a calendar contains dated items
and an announcement is not one. See the
[capability matrix](blackboard-capabilities.md) for the two honest options and
what each requires.

---

## Notion

Two-way sync with an existing Academic Tasks database.

### Server prerequisites

An administrator creates a Notion integration (public OAuth) and sets
`NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` and `NOTION_REDIRECT_URI`. Until they
do, the Notion card says so plainly instead of offering a button that fails.

### Connecting

1. **Settings → Integrations → Connect Notion**, and authorise the workspace.
2. In Notion, open your tasks database → **Connections** → add the app. Notion
   grants access per page, so a database it has not been added to is invisible.
3. Back in the app, pick the database. It reads the real property names and
   proposes a mapping.
4. Check the mapping and save. The first run is **pull-only**: nothing is
   written to Notion until you have seen what came back.

### Field mapping

| App field | Notion property type | Notes |
| --- | --- | --- |
| Task title | title | Required |
| Course | select, multi-select, relation or text | Matched to your courses by code |
| Type | select | Assignment, Quiz, Exam, Project, Lab, Reading, Admin |
| Status | status or select | Inbox, Planned, In progress, Submitted, Done, Archived |
| Priority | select | Urgent, High, Medium, Low |
| Due date/time | date | Times are preserved; all-day dates stay all-day |
| Source / Source URL | select / url | Where the task came from |
| Submitted | checkbox | **Records** a submission; never marks a task Done |
| Notes | rich text | The task description |

Anything you leave unmapped is simply not synchronised. Nothing is guessed. A
value the mapping does not recognise — a status of "Waiting on prof" — leaves
the local field untouched and is reported as unmapped, rather than being
rounded to the nearest option.

### How conflicts work

Each synced field is compared three ways: your value, Notion's value, and the
value at the last successful sync.

- Only you changed it → your change goes to Notion.
- Only Notion changed it → Notion's change comes here.
- **Both changed it** → nothing is written. It appears at **Settings → Sync
  health** with both values, both timestamps, and what they diverged from, and
  you choose.

Sync loops are prevented by tracking the revision and content of every write, so
a change this app made is recognised on the way back and ignored.

Neither side ever deletes. Archiving a Notion page marks the local task for
review; archiving locally does not touch Notion.

---

## Disconnecting

**Settings → Integrations → Disconnect** deletes the stored credential
immediately. Your tasks stay — they are yours. External records are kept, so
reconnecting the same account re-links instead of duplicating.

## When something goes wrong

**Settings → Sync health** shows every connection's state, the last successful
run, open conflicts, items missing upstream, a field-level activity log, and any
background job that exhausted its retries.

Sync errors are shown in full — with credentials redacted. If a feed URL rotates
or a token is revoked, the message says so, and the account is marked in error
rather than quietly doing nothing.
