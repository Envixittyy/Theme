import { readJson, withUser } from '@/lib/api/handler';
import { bulkUpdate } from '@/lib/domain/tasks';
import { bulkTaskUpdateSchema } from '@/lib/domain/validation';

export const dynamic = 'force-dynamic';

export const POST = withUser(async ({ request, user }) => {
  const body = bulkTaskUpdateSchema.parse(await readJson(request));
  const count = await bulkUpdate(body.ids, body.patch, {
    userId: user.id,
    actor: `user:${user.id}`,
    origin: 'local',
    timeZone: user.timeZone,
  });
  return { updated: count };
});
