import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { listNotifications, markNotificationRead, unreadNotificationCount } from '@/lib/notifications/engine';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => ({
  notifications: await listNotifications(user.id, 50),
  unread: await unreadNotificationCount(user.id),
}));

export const PATCH = withUser(async ({ request, user }) => {
  const body = z.object({ ids: z.union([z.literal('all'), z.array(z.uuid()).max(200)]) }).parse(await readJson(request));
  return { marked: await markNotificationRead(user.id, body.ids) };
});
