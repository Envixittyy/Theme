# Deployment

## Shape

Two processes and one database:

```
        ┌──────────────┐        ┌──────────────┐
 HTTPS ─│  web (next)  │───────▶│  PostgreSQL  │◀───────┐
        └──────────────┘        └──────────────┘        │
                                                 ┌──────────────┐
                                                 │   worker     │
                                                 └──────────────┘
                                                        │
                                        Blackboard feeds, Notion, Web Push
```

The web process serves the app and validates and enqueues work. The worker does
everything that touches a provider on a schedule. Neither is a singleton: run
several of each. The queue claims jobs with `FOR UPDATE SKIP LOCKED` and
serialises per-account work behind a lock key, so extra workers add throughput
without duplicating a sync.

## Requirements

- Node 22+
- PostgreSQL 15+ (16 or newer preferred; the schema uses partial unique indexes)
- Optional: S3-compatible object storage for attachments. Without it, files go
  to `LOCAL_STORAGE_DIR`, which needs a persistent volume shared by every web
  process — fine on one node, wrong on several.

## Pick a path

### 1 · One server with Docker Compose — recommended

Everything the app needs, on one box, in three commands. A `Dockerfile` and
`docker-compose.yml` are in the repository.

```bash
cp .env.example .env          # fill in the five required values below
docker compose up -d --build
docker compose run --rm migrate
```

That gives you Postgres, the web server on :3000, and the worker. Put a reverse
proxy with TLS in front (Caddy needs two lines; nginx a few more) and point
`APP_URL` at the public hostname.

To deploy a new version:

```bash
git pull
docker compose build
docker compose run --rm migrate    # migrations are additive; safe while serving
docker compose up -d
```

### 2 · A platform with separate services — Railway, Render, Fly.io

These fit the two-process shape directly. Create three things:

| | Command | Notes |
| --- | --- | --- |
| Postgres | — | Use the platform's managed instance |
| **web** | `npm start` | Build command `npm run build`; port 3000 |
| **worker** | `npm --prefix . run worker` | No port, no health check |

Give **both** services the same environment. The worker decrypts feed URLs to
poll them, so it needs `SECRET_ENCRYPTION_KEYS` just as much as the web process
does. Run `npm run db:migrate` as a release/pre-deploy command.

### 3 · Vercel — works, with one caveat worth knowing first

The web half deploys cleanly. The worker does not: Vercel has no long-running
process, and this app's polling, reminder scans and push delivery live in one.

Two honest options:

- **Vercel Cron.** `GET /api/cron/drain` runs one batch of queued jobs. Set
  `CRON_SECRET` and have the scheduler send it as a bearer token; without the
  variable the route returns 501 and stays disabled. Add to `vercel.json`:

  ```json
  { "crons": [{ "path": "/api/cron/drain", "schedule": "*/5 * * * *" }] }
  ```

  Reminder resolution is then bounded by the cron interval rather than by the
  reminder, and Vercel's free tier allows only daily crons.
- **Worker elsewhere.** Run the worker container on any small always-on host
  pointed at the same database. This is the arrangement I would choose.

Either way, attachments need `S3_*` set: Vercel's filesystem is ephemeral, so the
local storage adapter would lose files between deploys.

## Manual deployment, without containers

```bash
npm ci
npm run build
npm run db:migrate      # once per release, before starting the new version
npm start               # web  — serves .next/standalone
npm run worker          # worker — separate process
```

`npm start` runs the standalone server, which carries only the modules Next
traced. `tsx` is a runtime dependency rather than a dev one precisely so the
worker and the migration runner work on a production install.

## Environment

Start from [`.env.example`](../.env.example). The ones without which the
deployment is not production-ready:

| Variable | Why it matters |
| --- | --- |
| `APP_URL` | Magic-link and OAuth redirects, and the calendar feed URL |
| `DATABASE_URL` | Without it the app silently uses the local WASM database |
| `SECRET_ENCRYPTION_KEYS` | **Start-up fails without it in production** — integration secrets cannot be stored |
| `SECRET_ENCRYPTION_ACTIVE_KEY_ID` | Which key new secrets are written under |
| `MAIL_WEBHOOK_URL` | Without it nobody can sign in except by reading the server log |
| `VAPID_*` | Without them push is honestly reported as unavailable |
| `FEED_HOST_ALLOWLIST` | Strongly recommended: pins feed URLs to your institution's hosts |

The five that are genuinely required for a working deployment: `APP_URL`,
`DATABASE_URL`, `SECRET_ENCRYPTION_KEYS`, `SECRET_ENCRYPTION_ACTIVE_KEY_ID`,
and a mail transport. Generate the encryption key with:

```bash
node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"
```

Production start-up fails without an encryption key rather than storing
integration credentials in the clear. Without a mail transport nobody can sign
in except by reading the server log.

## Hardening checklist

- **TLS everywhere.** Session cookies are `Secure` in production, so plain HTTP
  will appear to "lose" sign-ins.
- **Trust the proxy correctly.** `x-forwarded-for` feeds the rate limiter; if
  your proxy does not set it, every client shares one bucket.
- **Set `FEED_HOST_ALLOWLIST`.** The SSRF guard already rejects private
  addresses, non-HTTPS schemes, unusual ports, embedded credentials and
  redirects to any of those. An allowlist narrows it further to your own
  Blackboard hosts.
- **Least privilege for the database role.** The app needs DML and the ability
  to run migrations at deploy time; it never needs `SUPERUSER`.
- **Give the worker the same secrets as the web process** — it decrypts feed
  URLs to poll them.
- **Content Security Policy** is set in `next.config.ts` and allows no remote
  script origins. `connect-src` permits loopback so the browser can reach the
  local AI bridge; remove those entries if you do not want that capability.

## Scaling notes

- Blackboard polling defaults to fifteen minutes per account
  (`BLACKBOARD_POLL_INTERVAL_MS`) and uses conditional GETs, so an unchanged
  feed costs one 304.
- The rate-limit table is pruned hourly by a maintenance job.
- Notification history is kept for 120 days, then pruned.
- The heaviest queries (Today, the calendar) are indexed on
  `(user_id, due_at)` and `(user_id, status)`.

## Health checks

- Web: `GET /login` returns 200 without a session. The container image already
  declares a `HEALTHCHECK` that does exactly this.
- Worker: no HTTP surface by design. Alert on rows in `jobs` with
  `state = 'dead'`, and on `sync_runs.status = 'failed'`. Both surface in the
  app at Settings → Sync health, so users see problems even if alerting misses
  them.

## After deploying, check these four things

1. `GET /login` returns 200 over HTTPS.
2. Sign in — proves the mail transport works.
3. Settings → Integrations, connect a feed and press **Sync now** — proves the
   worker's encryption keyring matches the web process's.
4. Settings → Sync health shows the run — proves the worker is alive.

## Rollback

Application rollback is a redeploy of the previous image; the schema is additive
so an older build runs against a newer database. If a migration must be undone,
restore from backup — see [backup and recovery](backup-recovery.md).
