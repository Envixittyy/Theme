/**
 * Worker entry point: `npm run worker`.
 *
 * Runs alongside the web process. Everything that touches the network on a
 * schedule — Blackboard polling, Notion reconciliation, push delivery, reminder
 * scans — happens here rather than in a request, so a slow provider can never
 * make the interface slow.
 */
import { closeDb } from '../db';
import { runMigrations } from '../db/migrate';
import { runWorker, scheduleRecurring } from './worker';

const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[worker] ${signal} received, finishing the current job…`);
    controller.abort();
  });
}

async function main(): Promise<void> {
  await runMigrations();
  console.info('[worker] started');

  const scheduler = setInterval(() => {
    void scheduleRecurring().catch((err) => console.error('[worker] scheduling failed:', err));
  }, 60_000);
  await scheduleRecurring();

  await runWorker({
    signal: controller.signal,
    onJob: (kind, ok) => {
      if (!ok) console.warn(`[worker] ${kind} did not succeed`);
    },
  });

  clearInterval(scheduler);
  await closeDb();
  console.info('[worker] stopped');
}

main().catch(async (err) => {
  console.error('[worker] fatal:', err);
  await closeDb();
  process.exit(1);
});
