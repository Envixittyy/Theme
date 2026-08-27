# ADR 0001 — Stack and runtime

**Status:** accepted · **Date:** 2026-08 · **Supersedes:** —

## Context

The product is a cloud-hosted academic workspace that must also install as a
PWA, work offline, poll external providers on a schedule, and be maintainable by
a very small team (realistically one person). It handles credentials — private
Blackboard feed URLs, Notion tokens — so the security surface matters more than
the feature count.

## Decision

Next.js (App Router) with React and TypeScript in strict mode, on Node, with
PostgreSQL and Drizzle. One web process and one worker process. No Redis, no
message broker, no ORM-generated client, no component framework.

## Why

**Next.js App Router.** Server Components let every screen read straight from
the domain services with no client-side data layer, so most pages ship almost no
JavaScript, and the pieces that must be interactive are explicit `'use client'`
islands. Route handlers give the API surface. The same repository produces the
PWA, so there is no second codebase for mobile.

**TypeScript strict, including `noUncheckedIndexedAccess`.** The sync engine is
full of "this field may be absent upstream" reasoning; a type system that admits
`undefined` at every index is doing that reasoning for us.

**Drizzle over Prisma.** Drizzle's queries *are* SQL, which matters for the
parts of this system that are inherently SQL-shaped: `FOR UPDATE SKIP LOCKED`
queue claims, partial unique indexes, `count(*) FILTER (WHERE …)` rollups. It
also has no generated client and no engine binary, so `npm ci` is the whole
install and there is no build step between editing the schema and running.

**PostgreSQL for everything, including the queue.** A separate broker would add
an operational component and, worse, would break the property this system leans
on hardest: enqueueing a job and writing the row it refers to happen in the same
transaction. That is what makes "a retried sync cannot duplicate a task"
provable rather than hopeful. Postgres queues are well understood and scale far
past one student's workload.

## Tradeoffs

- A database-backed queue polls. At the volumes here (a poll every fifteen
  minutes per account) that is irrelevant; at very high throughput it would not
  be, and the queue interface is narrow enough to swap.
- Server Components make some interactions a round trip that a heavy client
  would do locally. Mitigated by optimistic updates in the components where it
  is noticeable, and it buys a much smaller bundle.
- Drizzle gives less magic than Prisma: relations are joins we write. That is a
  cost in verbosity and a benefit in predictability.

## Consequences

Deployment is two processes and one database. `npm run dev` needs nothing
installed (see ADR 0002). Every query is visible in the code that runs it.
