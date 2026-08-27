import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db';
import { jobs } from '../db/schema';
import { redactError } from '../security/redact';
import { assertServerOnly } from '../server-guard';

assertServerOnly('lib/jobs/queue');

/**
 * Durable job queue on PostgreSQL.
 *
 * Chosen over Redis/BullMQ because the whole system already needs a
 * transactional database and this keeps "job enqueued" and "row written" in the
 * same transaction — which is what makes sync idempotency provable rather than
 * hopeful. Claiming uses `FOR UPDATE SKIP LOCKED`, the standard Postgres queue
 * pattern, so multiple workers scale horizontally without double-processing.
 */

export type JobKind =
  | 'blackboard.sync'
  | 'blackboard.announcements'
  | 'notion.pull'
  | 'notion.push'
  | 'notion.reconcile'
  | 'notifications.scan_reminders'
  | 'notifications.deliver'
  | 'notifications.digest'
  | 'maintenance.prune'
  | 'maintenance.rotate_secrets';

export type JobRow = typeof jobs.$inferSelect;

export type EnqueueOptions = {
  userId?: string | null;
  runAt?: Date;
  /**
   * When set, an identical still-queued job is not enqueued twice. This is the
   * first of the two idempotency layers; the second lives inside each sync run.
   */
  idempotencyKey?: string;
  /** Jobs sharing a lock key never run concurrently (one sync per account). */
  lockKey?: string;
  maxAttempts?: number;
};

export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
  db?: Database,
): Promise<{ id: string; deduped: boolean }> {
  const target = db ?? (await getDb());
  const values = {
    kind,
    payload,
    userId: options.userId ?? null,
    runAt: options.runAt ?? new Date(),
    idempotencyKey: options.idempotencyKey ?? null,
    lockKey: options.lockKey ?? null,
    maxAttempts: options.maxAttempts ?? 5,
  };

  if (!options.idempotencyKey) {
    const [row] = await target.insert(jobs).values(values).returning({ id: jobs.id });
    return { id: row!.id, deduped: false };
  }

  const inserted = await target
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });

  if (inserted[0]) return { id: inserted[0].id, deduped: false };

  const existing = await target
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, options.idempotencyKey))
    .limit(1);
  return { id: existing[0]?.id ?? '', deduped: true };
}

/**
 * Atomically claim the next runnable job. Returns null when the queue is idle.
 * The `lock_key` clause implements a coarse mutex: while one account's sync is
 * running, another job for the same account waits rather than interleaving.
 */
export async function claimNext(workerId: string): Promise<JobRow | null> {
  const db = await getDb();
  const result = await db.execute<JobRow>(sql`
    UPDATE ${jobs}
    SET state = 'running',
        locked_at = now(),
        locked_by = ${workerId},
        attempts = ${jobs.attempts} + 1
    WHERE id = (
      SELECT j.id FROM ${jobs} j
      WHERE j.state = 'queued'
        AND j.run_at <= now()
        AND (
          j.lock_key IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM ${jobs} running
            WHERE running.lock_key = j.lock_key AND running.state = 'running'
          )
        )
      ORDER BY j.run_at ASC, j.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `);
  // `db.execute` returns raw driver rows, so the columns arrive snake_cased and
  // untyped. They are mapped explicitly here: leaving them raw silently gives
  // every caller `undefined` for `attempts` and `maxAttempts`, which would mean
  // a failing job retries forever instead of dead-lettering.
  const rows = (result as unknown as { rows?: RawJobRow[] }).rows ?? (result as unknown as RawJobRow[]);
  const row = rows[0];
  return row ? mapJobRow(row) : null;
}

type RawJobRow = Record<string, unknown>;

function mapJobRow(row: RawJobRow): JobRow {
  const date = (value: unknown): Date | null => (value ? new Date(value as string) : null);
  return {
    id: row.id as string,
    kind: row.kind as string,
    userId: (row.user_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    state: row.state as JobRow['state'],
    runAt: date(row.run_at) ?? new Date(),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    lockKey: (row.lock_key as string | null) ?? null,
    lockedAt: date(row.locked_at),
    lockedBy: (row.locked_by as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: date(row.created_at) ?? new Date(),
    finishedAt: date(row.finished_at),
  };
}

export async function completeJob(id: string): Promise<void> {
  const db = await getDb();
  await db.update(jobs).set({ state: 'succeeded', finishedAt: new Date(), lastError: null }).where(eq(jobs.id, id));
}

/** Exponential backoff with jitter; dead-letters after `maxAttempts`. */
export function backoffMs(attempt: number): number {
  const base = Math.min(2 ** attempt * 1000, 15 * 60_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export async function failJob(job: JobRow, error: unknown, knownSecrets: readonly string[] = []): Promise<void> {
  const db = await getDb();
  const message = redactError(error, knownSecrets);
  const exhausted = job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      state: exhausted ? 'dead' : 'queued',
      lastError: message,
      runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      finishedAt: exhausted ? new Date() : null,
      lockedAt: null,
      lockedBy: null,
    })
    .where(eq(jobs.id, job.id));
}

/** Jobs stuck in `running` (worker crashed) are returned to the queue. */
export async function reclaimStalled(olderThanMs = 10 * 60_000): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(jobs)
    .set({ state: 'queued', lockedAt: null, lockedBy: null })
    .where(
      and(
        eq(jobs.state, 'running'),
        sql`${jobs.lockedAt} < ${new Date(Date.now() - olderThanMs)}`,
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/** The dead-letter view the Settings → Sync health screen reads. */
export async function listDeadLetters(userId: string, limit = 20): Promise<JobRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.state, 'dead'), eq(jobs.userId, userId)))
    .orderBy(sql`${jobs.finishedAt} desc nulls last`)
    .limit(limit);
}

export async function retryJob(userId: string, jobId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(jobs)
    .set({ state: 'queued', attempts: 0, runAt: new Date(), lastError: null, finishedAt: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.state, 'dead')))
    .returning({ id: jobs.id });
  return rows.length > 0;
}
