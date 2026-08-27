import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { notes } from '../db/schema';
import { recordAudit, type Actor } from './audit';
import { NotFoundError } from './tasks';

export type NoteRow = typeof notes.$inferSelect;

export async function listNotes(
  userId: string,
  options: { search?: string; courseId?: string | null; taskId?: string; limit?: number; offset?: number } = {},
): Promise<NoteRow[]> {
  const db = await getDb();
  const clauses = [eq(notes.userId, userId), isNull(notes.archivedAt)];
  if (options.courseId) clauses.push(eq(notes.courseId, options.courseId));
  if (options.taskId) clauses.push(eq(notes.taskId, options.taskId));
  if (options.search) {
    const needle = `%${options.search.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const match = or(ilike(notes.title, needle), ilike(notes.body, needle));
    if (match) clauses.push(match);
  }
  return db
    .select()
    .from(notes)
    .where(and(...clauses))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);
}

export async function getNote(userId: string, noteId: string): Promise<NoteRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createNote(
  userId: string,
  input: { title?: string; body?: string; courseId?: string | null; taskId?: string | null },
  actor: Actor,
): Promise<NoteRow> {
  const db = await getDb();
  const [row] = await db
    .insert(notes)
    .values({
      userId,
      title: input.title?.trim() || 'Untitled note',
      body: input.body ?? '',
      courseId: input.courseId ?? null,
      taskId: input.taskId ?? null,
    })
    .returning();
  await recordAudit({ userId, actor, action: 'note.created', entityType: 'note', entityId: row!.id });
  return row!;
}

export async function updateNote(
  userId: string,
  noteId: string,
  patch: { title?: string; body?: string; courseId?: string | null; taskId?: string | null; pinned?: boolean },
): Promise<NoteRow> {
  const db = await getDb();
  const set: Record<string, unknown> = { updatedAt: new Date(), revision: sql`${notes.revision} + 1` };
  if (patch.title !== undefined) set.title = patch.title.trim() || 'Untitled note';
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.courseId !== undefined) set.courseId = patch.courseId;
  if (patch.taskId !== undefined) set.taskId = patch.taskId;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;

  const rows = await db
    .update(notes)
    .set(set)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning();
  if (!rows[0]) throw new NotFoundError('Note');
  return rows[0];
}

export async function archiveNote(userId: string, noteId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(notes)
    .set({ archivedAt: new Date() })
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
}

/**
 * Backlinks: notes referencing `[[Title]]`. Kept deliberately simple (no
 * separate link table) because a note corpus for one student is small enough
 * that an ILIKE scan is faster than maintaining an index.
 */
export async function findBacklinks(userId: string, title: string): Promise<NoteRow[]> {
  if (!title.trim()) return [];
  const db = await getDb();
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), ilike(notes.body, `%[[${title}]]%`)))
    .limit(20);
}
