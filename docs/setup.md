# Setup and local development

## Prerequisites

Node 22 or newer. That is the whole list — no database server, no Docker, no
Redis. See [ADR 0002](adr/0002-two-database-drivers.md) for why.

## First run

```bash
npm install
cp .env.example .env.local     # optional; every value has a sensible default
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> and sign in as `demo@school.local`. With no mail
transport configured, the sign-in link is printed to the terminal *and* shown in
the browser, labelled as a development transport that sent no email.

In a second terminal:

```bash
npm run worker
```

The worker owns everything scheduled: Blackboard polling, Notion
reconciliation, reminder scans, digests, push delivery and maintenance. The app
is fully usable without it — you simply have to press "Sync now" yourself.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Background job worker and scheduler |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Reset and reseed the demo account |
| `npm run db:reset` | Delete the local PGlite database (refuses on real Postgres) |
| `npm test` | Vitest suites against real PostgreSQL |
| `npm run test:e2e` | Playwright end-to-end and accessibility |
| `npm run typecheck` | `tsc --noEmit` |

## Choosing a database

**Development and tests (default).** Leave `DATABASE_URL` empty. The app uses
PGlite — genuine PostgreSQL compiled to WebAssembly — stored in `.data/pglite`.
Set `PGLITE_DATA_DIR=memory` for a database that vanishes when the process does.

**Production.** Set `DATABASE_URL=postgres://…`. Nothing else changes: the same
migrations and the same queries run against a pooled node-postgres client. Set
`DATABASE_SSL=require` where the provider expects a verified TLS connection.

## The demo data

`npm run db:seed` creates one account with six courses, their meeting times, a
term's worth of tasks spread around *today* (so Today, the priority ladder and
the calendar all have something to show), notes, announcements, smart lists,
dashboard layouts for all three breakpoints, and a **demo Blackboard feed**.

The demo feed is clearly labelled in the UI and makes no network request: the
calendar document is generated locally and pushed through the *real* connector,
so the external records, sync run, audit entries and notifications it produces
are the ones production would have produced. Nothing about it is faked.

## Environment variables

Every name is documented in [`.env.example`](../.env.example). Two are worth
calling out for local work:

- `SECRET_ENCRYPTION_KEYS` — required in production, optional in development
  (a fixed development key is derived if it is unset). Integration secrets are
  encrypted with it; without it, production start-up fails rather than storing
  credentials in the clear.
- `ALLOW_INSECURE_FEED_URLS` — permits `http://` feed URLs while testing against
  a local fixture server. Never enable it in a deployment.

## Working on the schema

```bash
# edit src/lib/db/schema.ts
npm run db:generate -- --name what_changed
npm run db:migrate
```

Migrations are plain SQL in `drizzle/` and are committed. The runner works
against both drivers, so a migration that applies locally applies in production.

## Working on the local AI bridge

The bridge lives in `bridge/school-os-bridge.mjs` and has no dependencies. From
Settings → Local AI, get a pairing code, then:

```bash
SCHOOL_OS_URL=http://localhost:3000 BRIDGE_MODEL=llama3.1:8b \
  node bridge/school-os-bridge.mjs --pair ABCD2345
node bridge/school-os-bridge.mjs
```

It prints a local token; paste that into Settings → Local AI once. The browser
talks to the bridge directly on `127.0.0.1:4319`; the server never does.

## Troubleshooting

**`ENOENT … .data/pglite`** — run `mkdir -p .data` once, or `npm run db:migrate`
which creates it.

**Sign-in link never arrives** — with no `MAIL_WEBHOOK_URL` there is no email by
design. Read the link from the server log, or from the panel the login page
shows in development.

**"Too many requests" when signing in repeatedly** — the magic-link limiter
allows five per address per fifteen minutes. That is the limiter working; wait,
or use a different address.

**Push says "not configured"** — set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
(`npx web-push generate-vapid-keys`). Until then notifications are recorded
in-app and the UI says delivery is unavailable rather than pretending.
