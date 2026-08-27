import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { announcements } from '../db/schema';

export type AnnouncementRow = typeof announcements.$inferSelect;

export async function listAnnouncements(
  userId: string,
  options: { courseId?: string | null; unreadOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<AnnouncementRow[]> {
  const db = await getDb();
  const clauses = [eq(announcements.userId, userId)];
  if (options.courseId) clauses.push(eq(announcements.courseId, options.courseId));
  if (options.unreadOnly) clauses.push(isNull(announcements.readAt));
  return db
    .select()
    .from(announcements)
    .where(and(...clauses))
    .orderBy(desc(announcements.publishedAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);
}

export async function unreadCount(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(announcements)
    .where(and(eq(announcements.userId, userId), isNull(announcements.readAt)));
  return rows[0]?.count ?? 0;
}

export async function markRead(userId: string, announcementId: string, read = true): Promise<void> {
  const db = await getDb();
  await db
    .update(announcements)
    .set({ readAt: read ? new Date() : null })
    .where(and(eq(announcements.id, announcementId), eq(announcements.userId, userId)));
}

export async function markAllRead(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(announcements)
    .set({ readAt: new Date() })
    .where(and(eq(announcements.userId, userId), isNull(announcements.readAt)))
    .returning({ id: announcements.id });
  return rows.length;
}
