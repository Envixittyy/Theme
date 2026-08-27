import { withUser } from '@/lib/api/handler';
import { revokeDevice } from '@/lib/connectors/localai/pairing';
import { NotFoundError } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

export const DELETE = withUser(async ({ user, params }) => {
  const ok = await revokeDevice(user.id, params.id!);
  if (!ok) throw new NotFoundError('Device');
  return { revoked: true };
});
