import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { findBacklinks, getNote, listNotes } from '@/lib/domain/notes';
import { listCourses } from '@/lib/domain/courses';
import { NotesWorkspace } from '@/components/notes/NotesWorkspace';

export const metadata: Metadata = { title: 'Notes' };
export const dynamic = 'force-dynamic';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const search = typeof params.q === 'string' ? params.q : '';
  const courseId = typeof params.courseId === 'string' ? params.courseId : null;
  const noteId = typeof params.note === 'string' ? params.note : null;

  const [notes, courses] = await Promise.all([
    listNotes(user.id, { search: search || undefined, courseId, limit: 200 }),
    listCourses(user.id),
  ]);

  const active = noteId ? await getNote(user.id, noteId) : (notes[0] ?? null);
  const backlinks = active ? await findBacklinks(user.id, active.title) : [];

  return (
    <NotesWorkspace
      notes={notes.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        courseId: n.courseId,
        pinned: n.pinned,
        updatedAt: n.updatedAt.toISOString(),
      }))}
      active={
        active
          ? {
              id: active.id,
              title: active.title,
              body: active.body,
              courseId: active.courseId,
              pinned: active.pinned,
              updatedAt: active.updatedAt.toISOString(),
            }
          : null
      }
      backlinks={backlinks.filter((b) => b.id !== active?.id).map((b) => ({ id: b.id, title: b.title }))}
      courses={courses.map((c) => ({ id: c.id, code: c.code, color: c.color }))}
      search={search}
      timeZone={user.timeZone}
    />
  );
}
