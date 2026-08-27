import { withUser, readJson } from '@/lib/api/handler';
import {
  deleteTask,
  duplicateTask,
  getTaskDetail,
  NotFoundError,
  updateTask,
} from '@/lib/domain/tasks';
import { updateTaskSchema } from '@/lib/domain/validation';
import { enqueue } from '@/lib/jobs/queue';
import { listAccounts } from '@/lib/connectors/integrations';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user, params }) => {
  const detail = await getTaskDetail(user.id, params.id!);
  if (!detail) throw new NotFoundError('Task');
  return detail;
});

export const PATCH = withUser(async ({ request, user, params }) => {
  const body = await readJson<unknown>(request);
  const patch = updateTaskSchema.parse(body);
  const task = await updateTask(params.id!, patch, {
    userId: user.id,
    actor: `user:${user.id}`,
    origin: 'local',
    timeZone: user.timeZone,
  });

  for (const account of await listAccounts(user.id, 'notion')) {
    if (account.status !== 'connected') continue;
    await enqueue(
      'notion.push',
      { accountId: account.id, taskId: task.id },
      { userId: user.id, idempotencyKey: `notion:push:${task.id}:${task.revision}`, lockKey: `notion:${account.id}` },
    );
  }
  return { task };
});

export const DELETE = withUser(async ({ user, params }) => {
  await deleteTask(params.id!, { userId: user.id, actor: `user:${user.id}`, origin: 'local' });
  return null;
});

export const POST = withUser(async ({ request, user, params }) => {
  const body = (await readJson<{ action?: string }>(request)) ?? {};
  if (body.action === 'duplicate') {
    const task = await duplicateTask(params.id!, {
      userId: user.id,
      actor: `user:${user.id}`,
      origin: 'local',
      timeZone: user.timeZone,
    });
    return { task };
  }
  throw new NotFoundError('Action');
});
