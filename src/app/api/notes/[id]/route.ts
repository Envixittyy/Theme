import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { archiveNote, getNote, updateNote } from '@/lib/domain/notes';
import { NotFoundError } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user, params }) => {
  const note = await getNote(user.id, params.id!);
  if (!note) throw new NotFoundError('Note');
  return { note };
});

export const PATCH = withUser(async ({ request, user, params }) => {
  const body = z
    .object({
      title: z.string().max(200).optional(),
      body: z.string().max(200_000).optional(),
      courseId: z.uuid().nullable().optional(),
      taskId: z.uuid().nullable().optional(),
      pinned: z.boolean().optional(),
    })
    .parse(await readJson(request));
  return { note: await updateNote(user.id, params.id!, body) };
});

export const DELETE = withUser(async ({ user, params }) => {
  await archiveNote(user.id, params.id!);
  return null;
});
