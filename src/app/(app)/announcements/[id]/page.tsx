import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { announcements, courses } from '@/lib/db/schema';
import { markRead } from '@/lib/domain/announcements';
import { Badge, Card } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icon';
import { formatDateTime } from '@/lib/shared/time';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user) return { title: 'Announcement' };
  const db = await getDb();
  const rows = await db
    .select({ title: announcements.title })
    .from(announcements)
    .where(and(eq(announcements.id, (await params).id), eq(announcements.userId, user.id)))
    .limit(1);
  return { title: rows[0]?.title ?? 'Announcement' };
}

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const db = await getDb();
  const rows = await db
    .select({
      announcement: announcements,
      courseCode: courses.code,
      courseColor: courses.color,
      courseId: courses.id,
    })
    .from(announcements)
    .leftJoin(courses, eq(courses.id, announcements.courseId))
    .where(and(eq(announcements.id, id), eq(announcements.userId, user.id)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  // Opening an announcement is what marks it read — the list is the index, the
  // page is the reading.
  if (!row.announcement.readAt) await markRead(user.id, id, true);

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-[13px] text-ink-3">
        <Link href="/announcements" className="hover:underline">
          Announcements
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-2">{row.courseCode ?? 'General'}</span>
      </nav>

      <Card>
        <article className="p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {row.courseCode && (
              <Link href={`/courses/${row.courseId}`}>
                <Badge tone="neutral">
                  <span className="course-dot" style={{ ['--course-color' as string]: row.courseColor ?? '' }} aria-hidden />
                  {row.courseCode}
                </Badge>
              </Link>
            )}
            <Badge tone="info">{row.announcement.source}</Badge>
          </div>

          <h1 className="text-lg font-semibold tracking-tight text-ink">{row.announcement.title}</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {row.announcement.author ? `${row.announcement.author} · ` : ''}
            <time dateTime={row.announcement.publishedAt.toISOString()}>
              {formatDateTime(row.announcement.publishedAt, { timeZone: user.timeZone })}
            </time>
          </p>

          <div className="mt-4 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">
            {row.announcement.bodyFull ?? row.announcement.bodyExcerpt}
          </div>

          {row.announcement.sourceUrl && (
            <a
              href={row.announcement.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand underline"
            >
              <Icon name="link" size={14} />
              Open the original
            </a>
          )}
        </article>
      </Card>
    </div>
  );
}
