# Blackboard: what works today, and what needs your institution

This is the honest matrix. Anything an ordinary student can turn on themselves
is marked **student**; anything that needs an administrator to provision access
is marked **institution**. Where a capability needs institution access, the
fallback that ships is described — and the app shows the same distinction in
the interface rather than presenting a greyed-out button with no explanation.

## Intake methods

| Method | Who can enable it | What it carries |
| --- | --- | --- |
| **Private iCalendar feed** | **Student** — Blackboard's Calendar screen offers a personal subscribe link | Assignment and assessment due dates, titles, descriptions, and usually a link back to the item |
| **Blackboard REST API** (`/learn/api/public/v1`) | **Institution** — a registered application in the Blackboard developer portal, approved for your tenant | Everything below that is marked API-only |
| **Authorised email ingestion** | **Student**, with a little setup | Announcement text as Blackboard emails it |

## Capability matrix

| Capability | Feed | API | Email | Fallback shipped |
| --- | :-: | :-: | :-: | --- |
| Assignment and assessment deadlines | ✅ | ✅ | — | Feed is sufficient |
| Deadline **changes** detected and audited | ✅ | ✅ | — | Feed is sufficient |
| Item title and description | ✅ | ✅ | — | Feed is sufficient |
| Deep link back to the Blackboard item | ✅ | ✅ | — | Feed usually includes `URL` |
| Course code on each item | ⚠️ | ✅ | ⚠️ | Parsed from the title or `CATEGORIES`; the app tolerates a miss and leaves the task uncoursed |
| Course list, names and instructors | — | ✅ | — | **You add courses yourself.** Two minutes once a term, and it is what colour-codes everything |
| Class meeting times / timetable | — | ⚠️ | — | **You enter meeting times per course.** Blackboard's own timetable data is rarely exposed even with API access |
| **Announcements** | ❌ | ✅ | ✅ | Authorised email forwarding — see below |
| Announcement attachments | — | ✅ | ⚠️ | Email gives you what was attached to the mail, which is often a link rather than the file |
| Grades and feedback | — | ✅ | — | **Not implemented.** Out of scope by choice: grades deserve a considered design, not a scrape |
| Submitting work | — | ⚠️ | — | **Not implemented, and deliberately not faked.** Submitting happens in Blackboard; this app tracks *that you submitted* as a separate state you set |
| Course content and files | — | ✅ | — | Attach files to tasks and notes yourself |

✅ full · ⚠️ partial or best-effort · ❌ not available by that method · — not applicable

## Why announcements are the hard one

The calendar feed is a calendar. It carries dated items and nothing else — no
announcement is a dated item, so no feed contains one. That is a property of the
format, not a limitation of this app, and no amount of parsing changes it.

Three honest options, in preference order:

1. **Blackboard REST API.** Full announcement bodies, authors, timestamps and
   attachments. Needs your institution to register an application and grant it
   the `course.announcements-VIEW` scope. The connector interface for this is
   implemented (`lib/connectors/blackboard/`) and inert until credentials exist.

2. **Authorised email ingestion.** Blackboard emails announcements to enrolled
   students. Forward those to a private address the app watches; the parser
   extracts course, title, body and timestamp. It covers exactly the
   announcements you are emailed — no more — and the app labels them as
   email-sourced so you know their provenance.

3. **Nothing.** The Announcements screen says plainly that no announcement
   source is connected, and points at this page. It does not pretend to be
   empty because there is nothing to show.

The app never scrapes the Blackboard web interface. It would break on every
theme change, it needs the student's password, and it violates most
institutions' terms of use.

## Asking your institution

If you want API access, the request is specific and small. An administrator
needs to:

1. Register an application at <https://developer.blackboard.com> to get an
   Application ID and key pair.
2. Approve that Application ID in **Blackboard Learn → System Admin → REST API
   Integrations**, bound to a service account.
3. Grant read scopes only: `course.announcements-VIEW`, `course.content-VIEW`,
   `course-VIEW`, `user.grades-VIEW` if grades are ever wanted.

Nothing in this app needs write access to Blackboard, and it will never ask for
it. If the answer is no, the feed plus manual course entry covers deadlines
completely — which is the part that actually causes missed work.

## What the app does with a partial picture

- A feed item whose course code cannot be parsed becomes an uncoursed task
  rather than being guessed into the wrong course.
- An item that vanishes from the feed is flagged for review, never deleted —
  feeds routinely drop past items.
- A feed that regenerates its UIDs is re-matched by title, course and exact
  deadline, but only when exactly one candidate matches. Two candidates means
  no merge: a duplicate is recoverable, a wrong merge is not.
- Every field a sync changes is recorded with its before, after and reason, at
  Settings → Sync health.
