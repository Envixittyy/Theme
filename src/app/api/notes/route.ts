import { readJson, withUser } from '@/lib/api/handler';
import { createNote, listNotes } from '@/lib/domain/notes';
import { noteSchema } from '@/lib/domain/validation';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ request, user }) => {
  const url = new URL(request.url);
  return {
    notes: await listNotes(user.id, {
      search: url.searchParams.get('q') ?? undefined,
      courseId: url.searchParams.get('courseId'),
      limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
      offset: Number(url.searchParams.get('offset') ?? 0),
    }),
  };
});

export const POST = withUser(async ({ request, user }) => {
  const input = noteSchema.parse(await readJson(request));
  const note = await createNote(user.id, input, `user:${user.id}`);
  return { note };
});
