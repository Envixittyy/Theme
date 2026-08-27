import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { getCurrentUser } from '@/lib/auth/session';
import { unreadCount } from '@/lib/domain/announcements';
import { listCourses } from '@/lib/domain/courses';
import { unreadNotificationCount } from '@/lib/notifications/engine';
import { getDb } from '@/lib/db';
import { syncConflicts } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function openConflictCount(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(syncConflicts)
    .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')));
  return rows[0]?.count ?? 0;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [courses, csrfToken, notifications, announcements, conflicts] = await Promise.all([
    listCourses(user.id),
    currentCsrfToken(),
    unreadNotificationCount(user.id),
    unreadCount(user.id),
    openConflictCount(user.id),
  ]);

  return (
    <AppShell
      user={{ id: user.id, displayName: user.displayName, email: user.email, timeZone: user.timeZone }}
      courses={courses.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        color: c.color,
        shortLabel: c.shortLabel,
      }))}
      csrfToken={csrfToken ?? ''}
      unreadNotifications={notifications}
      unreadAnnouncements={announcements}
      openConflicts={conflicts}
    >
      {children}
    </AppShell>
  );
}
