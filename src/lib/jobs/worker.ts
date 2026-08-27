import { randomBytes } from 'node:crypto';
import { claimNext, completeJob, failJob, reclaimStalled } from './queue';
import { HANDLERS } from './handlers';
import { redactError } from '../security/redact';
import { assertServerOnly } from '../server-guard';
import { enqueue } from './queue';

assertServerOnly('lib/jobs/worker');

/**
 * The background worker.
 *
 * A plain loop: claim one job, run it, mark it, repeat. No cleverness, because
 * the interesting behaviour (idempotency, backoff, locking) lives in the queue
 * and in the handlers, where it can be tested. Several workers can run at once;
 * `FOR UPDATE SKIP LOCKED` keeps them from colliding.
 */
export type WorkerOptions = {
  pollIntervalMs?: number;
  /** Stop after this many jobs — used by tests and by one-shot runs. */
  maxJobs?: number;
  signal?: AbortSignal;
  onJob?: (kind: string, ok: boolean) => void;
};

export async function runWorker(options: WorkerOptions = {}): Promise<{ processed: number }> {
  const workerId = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const pollInterval = options.pollIntervalMs ?? 2000;
  let processed = 0;
  let sinceReclaim = 0;

  while (!options.signal?.aborted) {
    if (options.maxJobs !== undefined && processed >= options.maxJobs) break;

    if (sinceReclaim++ > 30) {
      sinceReclaim = 0;
      const reclaimed = await reclaimStalled();
      if (reclaimed) console.info(`[worker] returned ${reclaimed} stalled job(s) to the queue`);
    }

    const job = await claimNext(workerId);
    if (!job) {
      if (options.maxJobs !== undefined) break; // one-shot drain
      await sleep(pollInterval, options.signal);
      continue;
    }

    const handler = HANDLERS[job.kind as keyof typeof HANDLERS];
    if (!handler) {
      await failJob(job, new Error(`no handler for job kind "${job.kind}"`));
      options.onJob?.(job.kind, false);
      processed += 1;
      continue;
    }

    try {
      await handler(job);
      await completeJob(job.id);
      options.onJob?.(job.kind, true);
    } catch (err) {
      console.error(`[worker] ${job.kind} failed:`, redactError(err));
      await failJob(job, err);
      options.onJob?.(job.kind, false);
    }
    processed += 1;
  }

  return { processed };
}

/**
 * Periodic work that is not triggered by a user action. Enqueued with
 * idempotency keys derived from the time bucket, so a restart storm cannot
 * produce a backlog of duplicates.
 */
export async function scheduleRecurring(now = new Date()): Promise<void> {
  const fiveMinute = Math.floor(now.getTime() / (5 * 60_000));
  const hour = Math.floor(now.getTime() / 3_600_000);

  await enqueue('notifications.scan_reminders', {}, { idempotencyKey: `reminders:${fiveMinute}` });
  await enqueue('notifications.digest', {}, { idempotencyKey: `digest:${fiveMinute}` });
  await enqueue('maintenance.prune', {}, { idempotencyKey: `prune:${hour}` });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
