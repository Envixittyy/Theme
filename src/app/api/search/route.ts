import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { notes, tasks } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Search for the command palette. Scoped to the caller by predicate, always. */
export const GET = withUser(async ({ request, user }) => {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return { tasks: [], notes: [] };
  const needle = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const db = await getDb();

  const [taskRows, noteRows] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, user.id),
          sql`${tasks.status} <> 'archived'`,
          or(ilike(tasks.title, needle), ilike(tasks.description, needle))!,
        ),
      )
      .limit(8),
    db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(and(eq(notes.userId, user.id), or(ilike(notes.title, needle), ilike(notes.body, needle))!))
      .limit(6),
  ]);

  return {
    tasks: taskRows.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      label: t.title,
      href: `/tasks/${t.id}`,
      hint: t.status.replace('_', ' '),
    })),
    notes: noteRows.map((n) => ({
      kind: 'note' as const,
      id: n.id,
      label: n.title,
      href: `/notes?note=${n.id}`,
      hint: 'Note',
    })),
  };
});
