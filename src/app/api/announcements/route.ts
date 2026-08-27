import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { listAnnouncements, markAllRead, unreadCount } from '@/lib/domain/announcements';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ request, user }) => {
  const url = new URL(request.url);
  return {
    announcements: await listAnnouncements(user.id, {
      courseId: url.searchParams.get('courseId'),
      unreadOnly: url.searchParams.get('unread') === '1',
      limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
    }),
    unread: await unreadCount(user.id),
  };
});

export const PATCH = withUser(async ({ request, user }) => {
  const body = z.object({ action: z.literal('mark-all-read') }).parse(await readJson(request));
  void body;
  return { marked: await markAllRead(user.id) };
});
