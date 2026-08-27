# Documentation

| Document | Read it when |
| --- | --- |
| [Setup and local development](setup.md) | You are running this for the first time |
| [Deployment](deployment.md) | You are putting it somewhere real |
| [Architecture](architecture.md) | You want to know where a rule lives before changing it |
| [Architecture decisions](adr/) | You want to know *why* something is the way it is |
| [Security model](security.md) | You are reviewing it, or adding something that touches credentials |
| [Testing](testing.md) | You are adding behaviour and wondering what to prove about it |
| [PWA installation](pwa.md) | You are installing on a phone, or offline is misbehaving |
| [Notifications](notifications.md) | You are setting up push, or something is not arriving |
| [Integrations](integrations.md) | You are connecting Blackboard or Notion |
| [Blackboard capabilities](blackboard-capabilities.md) | You want to know what needs your institution, and what does not |
| [Backup and recovery](backup-recovery.md) | Before you need it |

## The five decisions worth knowing

1. [Stack and runtime](adr/0001-stack-and-runtime.md) — Next.js, Drizzle, and
   PostgreSQL for everything including the job queue, so that enqueueing a job
   and writing the row it refers to are one transaction.
2. [Two database drivers](adr/0002-two-database-drivers.md) — PGlite locally so
   nothing needs installing, node-postgres in production, identical schema and
   queries. The tests run against real PostgreSQL as a result.
3. [Sync ownership and conflicts](adr/0003-sync-ownership-and-conflicts.md) —
   fields have owners, merges are three-way and per field, nothing is ever
   deleted by a sync, and uncertainty never decides.
4. [Local AI through a bridge](adr/0004-local-ai-bridge.md) — the browser talks
   to the student's machine; the server never does, because on a server
   `localhost` means the server.
5. [Offline and layouts](adr/0005-offline-and-layouts.md) — a queue the user can
   see and edit, and per-breakpoint dashboards emitted as CSS so the first paint
   is correct at any width.
