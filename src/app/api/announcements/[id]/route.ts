import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { markRead } from '@/lib/domain/announcements';

export const dynamic = 'force-dynamic';

export const PATCH = withUser(async ({ request, user, params }) => {
  const body = z.object({ read: z.boolean() }).parse(await readJson(request));
  await markRead(user.id, params.id!, body.read);
  return { ok: true };
});
