import { withUser } from '@/lib/api/handler';
import { getAccount } from '@/lib/connectors/integrations';
import { syncBlackboardAccount } from '@/lib/connectors/blackboard';
import { NotFoundError } from '@/lib/domain/tasks';
import { enqueue } from '@/lib/jobs/queue';

export const dynamic = 'force-dynamic';

/**
 * Manual sync. Runs inline so the student sees the result immediately, but with
 * the same idempotency key discipline as the scheduled run: pressing the button
 * twice cannot produce two sets of tasks.
 */
export const POST = withUser(async ({ user, params }) => {
  const account = await getAccount(user.id, params.id!);
  if (!account) throw new NotFoundError('Integration');

  if (account.provider === 'blackboard_ics') {
    const summary = await syncBlackboardAccount(user.id, account.id, { trigger: 'manual' });
    return { summary };
  }
  if (account.provider === 'notion') {
    await enqueue(
      'notion.reconcile',
      { accountId: account.id },
      { userId: user.id, lockKey: `notion:${account.id}`, idempotencyKey: `notion:manual:${account.id}:${Date.now()}` },
    );
    return { queued: true };
  }
  return { unsupported: account.provider };
});
