import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { listAnnouncements, unreadCount } from '@/lib/domain/announcements';
import { listCourses } from '@/lib/domain/courses';
import { listAccounts } from '@/lib/connectors/integrations';
import { Badge, Card, EmptyState, StatePanel, cx } from '@/components/ui/primitives';
import { formatRelative } from '@/lib/shared/time';
import { MarkAllReadButton } from '@/components/announcements/MarkAllReadButton';

export const metadata: Metadata = { title: 'Announcements' };
export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const courseId = typeof params.courseId === 'string' ? params.courseId : null;
  const unreadOnly = params.unread === '1';

  const [items, courses, unread, accounts] = await Promise.all([
    listAnnouncements(user.id, { courseId, unreadOnly, limit: 100 }),
    listCourses(user.id),
    unreadCount(user.id),
    listAccounts(user.id),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const now = new Date();

  const hasAnnouncementSource = accounts.some(
    (a) => (a.provider === 'blackboard_api' || a.provider === 'blackboard_email') && a.status === 'connected',
  );

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Announcements</h1>
          <p className="text-[13px] text-ink-3">{unread} unread</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href={unreadOnly ? '/announcements' : '/announcements?unread=1'}
            className={cx(
              'inline-flex min-h-9 items-center rounded-md border px-2.5 text-[12.5px] font-medium',
              unreadOnly ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2',
            )}
          >
            Unread only
          </Link>
          <MarkAllReadButton disabled={unread === 0} />
        </div>
      </header>

      {!hasAnnouncementSource && (
        <div className="mb-3">
          <StatePanel
            kind="partial"
            title="Announcement sync is not connected"
            description={
              <>
                Blackboard&apos;s calendar feed carries deadlines but not announcements. Announcement intake needs
                either institution-provisioned API access or authorised email forwarding — see{' '}
                <Link href="/settings/integrations" className="underline">
                  Settings → Integrations
                </Link>
                . Announcements below were added locally or by a previous connection.
              </>
            }
          />
        </div>
      )}

      {courses.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Link
            href="/announcements"
            className={cx(
              'inline-flex min-h-8 items-center rounded-full border px-2.5 text-[12px]',
              !courseId ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2',
            )}
          >
            All courses
          </Link>
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/announcements?courseId=${c.id}`}
              className={cx(
                'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px]',
                courseId === c.id ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              <span className="course-dot" style={{ ['--course-color' as string]: c.color }} aria-hidden />
              {c.code}
            </Link>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState
            title={unreadOnly ? 'Nothing unread' : 'No announcements yet'}
            description={unreadOnly ? 'You are caught up.' : 'Announcements appear here once a source is connected.'}
          />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {items.map((a) => {
              const course = a.courseId ? courseById.get(a.courseId) : null;
              return (
                <li key={a.id}>
                  <Link href={`/announcements/${a.id}`} className="block px-4 py-3 hover:bg-surface-2">
                    <div className="flex items-start gap-2">
                      <span
                        className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.readAt ? 'bg-transparent' : 'bg-brand')}
                        aria-label={a.readAt ? undefined : 'Unread'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <p className={cx('text-[14px]', a.readAt ? 'text-ink-2' : 'font-semibold text-ink')}>
                            {a.title}
                          </p>
                          {course && (
                            <Badge tone="neutral">
                              <span className="course-dot" style={{ ['--course-color' as string]: course.color }} aria-hidden />
                              {course.code}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{a.bodyExcerpt}</p>
                        <p className="mt-1 text-[11px] text-ink-3">
                          {a.author ? `${a.author} · ` : ''}
                          <time dateTime={a.publishedAt.toISOString()}>{formatRelative(a.publishedAt, now)}</time>
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
