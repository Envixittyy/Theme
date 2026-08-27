# ADR 0002 — PGlite for development and tests, node-postgres for production

**Status:** accepted · **Date:** 2026-08

## Context

Two things were in tension. The test suite needs *real* PostgreSQL semantics —
this system depends on `ON CONFLICT`, partial unique indexes, enum ordering and
transactional behaviour, and a mocked repository layer would test the mock. But
requiring a running database (or Docker) before anyone can type `npm run dev`
or `npm test` is a real cost, and in constrained environments it is a blocker.

## Decision

One `Database` type, two drivers chosen at runtime from `DATABASE_URL`:

- a `postgres://` URL → node-postgres pool (production);
- anything else, including unset → **PGlite**, PostgreSQL compiled to WebAssembly,
  running in the same process against `.data/pglite`.

Migrations, schema and every query are identical across both. The test suite
sets `PGLITE_DATA_DIR=memory` for a fully ephemeral database.

## Why

PGlite is not a PostgreSQL emulator; it is PostgreSQL. The same planner, the
same constraint enforcement, the same error codes. So the tests exercise the
real thing — including the two bugs this arrangement caught during development:
a unique index that did not cover NULLs the way the code assumed, and a raw
`db.execute` returning snake_cased columns.

## Tradeoffs

- PGlite is single-connection and in-process, so it cannot model contention
  between concurrent workers. Queue *locking* is therefore tested for its
  logic — one job per lock key, stalled reclaim — while genuine multi-worker
  contention is left to staging on real Postgres.
- The bundle carries a WASM database in development dependencies.
- Two drivers means the union of their APIs is what the code may use. In
  practice the query builder is identical; only the pool setup differs.

## Consequences

`git clone && npm install && npm run db:migrate && npm run db:seed && npm run dev`
works with nothing else installed. Production sets `DATABASE_URL` and gets a
pooled client with no code change.
