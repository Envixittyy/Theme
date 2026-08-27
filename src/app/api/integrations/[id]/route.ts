import { withUser } from '@/lib/api/handler';
import { disconnectAccount, getAccount, secretHints } from '@/lib/connectors/integrations';
import { NotFoundError } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user, params }) => {
  const account = await getAccount(user.id, params.id!);
  if (!account) throw new NotFoundError('Integration');
  return { account: { ...account, config: account.config }, secrets: await secretHints(account.id) };
});

export const DELETE = withUser(async ({ user, params }) => {
  const ok = await disconnectAccount(user.id, params.id!);
  if (!ok) throw new NotFoundError('Integration');
  return { disconnected: true };
});
