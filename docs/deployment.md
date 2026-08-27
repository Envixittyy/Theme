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

## Steps

```bash
npm ci
npm run build
npm run db:migrate      # run once per release, before starting the new version
npm start               # web
npm run worker          # worker (separate process)
```

Migrations are additive and safe to run while the previous version is serving.

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

- Web: `GET /login` returns 200 without a session.
- Worker: no HTTP surface by design. Alert on rows in `jobs` with
  `state = 'dead'`, and on `sync_runs.status = 'failed'`. Both surface in the
  app at Settings → Sync health, so users see problems even if alerting misses
  them.

## Rollback

Application rollback is a redeploy of the previous image; the schema is additive
so an older build runs against a newer database. If a migration must be undone,
restore from backup — see [backup and recovery](backup-recovery.md).
