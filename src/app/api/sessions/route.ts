import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { listSessions, revokeSession } from '@/lib/auth/session';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => ({ sessions: await listSessions(user.id) }));

export const DELETE = withUser(async ({ request, user }) => {
  const body = z.object({ id: z.uuid() }).parse(await readJson(request));
  await revokeSession(user.id, body.id);
  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'session.revoked',
    entityType: 'session',
    entityId: body.id,
  });
  return null;
});
