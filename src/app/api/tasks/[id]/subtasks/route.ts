import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { addSubtask, deleteSubtask, toggleSubtask } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

export const POST = withUser(async ({ request, user, params }) => {
  const body = z.object({ title: z.string().trim().min(1).max(300) }).parse(await readJson(request));
  return { subtask: await addSubtask(user.id, params.id!, body.title) };
});

export const PATCH = withUser(async ({ request, user }) => {
  const body = z.object({ id: z.uuid(), done: z.boolean() }).parse(await readJson(request));
  return { subtask: await toggleSubtask(user.id, body.id, body.done) };
});

export const DELETE = withUser(async ({ request, user }) => {
  const body = z.object({ id: z.uuid() }).parse(await readJson(request));
  await deleteSubtask(user.id, body.id);
  return null;
});
