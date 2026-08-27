import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, getPreferences } from '@/lib/auth/session';
import { listNotifications, unreadNotificationCount } from '@/lib/notifications/engine';
import { getPushProvider } from '@/lib/connectors/push';
import { Badge, Card, EmptyState, StatePanel, cx } from '@/components/ui/primitives';
import { formatDateTime, formatMinuteOfDay, formatRelative } from '@/lib/shared/time';
import { NotificationActions } from '@/components/notifications/NotificationActions';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  blackboard_new_item: 'New work',
  blackboard_due_changed: 'Deadline changed',
  announcement: 'Announcement',
  reminder: 'Reminder',
  daily_digest: 'Digest',
  sync_failure: 'Sync problem',
};

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [events, unread, prefs] = await Promise.all([
    listNotifications(user.id, 100),
    unreadNotificationCount(user.id),
    getPreferences(user.id),
  ]);
  const push = getPushProvider();
  const now = new Date();

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Notifications</h1>
          <p className="text-[13px] text-ink-3">{unread} unread</p>
        </div>
        <NotificationActions unread={unread} />
      </header>

      {!push.available && (
        <div className="mb-3">
          <StatePanel
            kind="offline"
            title="Push delivery is not configured on this server"
            description="Notifications are still recorded here and shown in the app. Set VAPID keys to enable delivery to your phone and desktop."
          />
        </div>
      )}

      {prefs.quietHoursEnabled && (
        <p className="mb-3 text-[12px] text-ink-3">
          Quiet hours {formatMinuteOfDay(prefs.quietHoursStartMinute)} – {formatMinuteOfDay(prefs.quietHoursEndMinute)} in{' '}
          {user.timeZone}. Anything that arrives inside that window is held and delivered afterwards.{' '}
          <Link href="/settings/notifications" className="underline">
            Change
          </Link>
        </p>
      )}

      <Card className="overflow-hidden">
        {events.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="New Blackboard work, deadline changes, announcements and reminders will show up here."
          />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={event.deepLink}
                  className={cx('block px-4 py-3 hover:bg-surface-2', !event.readAt && 'bg-brand-soft/25')}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', event.readAt ? 'bg-transparent' : 'bg-brand')}
                      aria-label={event.readAt ? undefined : 'Unread'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className={cx('text-[14px]', event.readAt ? 'text-ink-2' : 'font-semibold text-ink')}>
                          {event.title}
                        </p>
                        <Badge tone={event.kind === 'sync_failure' ? 'danger' : 'neutral'}>
                          {KIND_LABEL[event.kind] ?? event.kind}
                        </Badge>
                        {event.courseCode && (
                          <Badge tone="neutral">
                            <span
                              className="course-dot"
                              style={{ ['--course-color' as string]: event.courseColor ?? '' }}
                              aria-hidden
                            />
                            {event.courseCode}
                          </Badge>
                        )}
                      </div>
                      {event.body && <p className="mt-0.5 text-[12.5px] text-ink-3">{event.body}</p>}
                      <p className="mt-1 text-[11px] text-ink-3">
                        <time dateTime={event.createdAt.toISOString()}>{formatRelative(event.createdAt, now)}</time>
                        {event.deliverAfter && event.deliverAfter > now && (
                          <> · held until {formatDateTime(event.deliverAfter, { timeZone: user.timeZone })} (quiet hours)</>
                        )}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
