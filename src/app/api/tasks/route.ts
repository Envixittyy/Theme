import { z } from 'zod';
import { withUser, readJson } from '@/lib/api/handler';
import { getPreferences } from '@/lib/auth/session';
import { createTask, listTasks } from '@/lib/domain/tasks';
import { createTaskSchema, smartListQuerySchema } from '@/lib/domain/validation';
import { enqueue } from '@/lib/jobs/queue';
import { listAccounts } from '@/lib/connectors/integrations';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ request, user }) => {
  const url = new URL(request.url);
  const query = smartListQuerySchema.parse({
    ...(url.searchParams.get('statuses')
      ? { statuses: url.searchParams.get('statuses')!.split(',') }
      : {}),
    ...(url.searchParams.get('courseIds')
      ? { courseIds: url.searchParams.get('courseIds')!.split(',') }
      : {}),
    ...(url.searchParams.get('search') ? { search: url.searchParams.get('search') } : {}),
    ...(url.searchParams.get('dueWithinDays')
      ? { dueWithinDays: Number(url.searchParams.get('dueWithinDays')) }
      : {}),
    ...(url.searchParams.get('overdueOnly') === 'true' ? { overdueOnly: true } : {}),
    ...(url.searchParams.get('includeCompleted') === 'true' ? { includeCompleted: true } : {}),
    sort: (url.searchParams.get('sort') as 'due') ?? 'due',
    direction: (url.searchParams.get('direction') as 'asc') ?? 'asc',
  });

  const tasks = await listTasks(query, { userId: user.id, now: new Date(), timeZone: user.timeZone }, {
    limit: Math.min(Number(url.searchParams.get('limit') ?? 100), 500),
    offset: Number(url.searchParams.get('offset') ?? 0),
  });
  return { tasks };
});

export const POST = withUser(async ({ request, user }) => {
  const body = await readJson<unknown>(request);
  const input = createTaskSchema.parse(body);
  const prefs = await getPreferences(user.id);
  void prefs;

  const task = await createTask(input, {
    userId: user.id,
    actor: `user:${user.id}`,
    origin: 'local',
    timeZone: user.timeZone,
  });

  // Push the new task to any connected two-way provider, out of band.
  for (const account of await listAccounts(user.id, 'notion')) {
    if (account.status !== 'connected') continue;
    await enqueue(
      'notion.push',
      { accountId: account.id, taskId: task.id },
      { userId: user.id, idempotencyKey: `notion:push:${task.id}:${task.revision}`, lockKey: `notion:${account.id}` },
    );
  }

  return { id: task.id, task };
});

export const schema = z.object({});
