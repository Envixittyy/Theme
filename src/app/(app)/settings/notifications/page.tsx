import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getPreferences } from '@/lib/auth/session';
import { listCourses } from '@/lib/domain/courses';
import { getPushProvider } from '@/lib/connectors/push';
import { Card, CardHeader } from '@/components/ui/primitives';
import { NotificationSettings } from '@/components/settings/NotificationSettings';

export const metadata: Metadata = { title: 'Notification settings' };
export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const [prefs, courses] = await Promise.all([getPreferences(user.id), listCourses(user.id)]);
  const provider = getPushProvider();

  return (
    <Card>
      <CardHeader title="Notifications" subtitle="What reaches you, when, and on which devices" />
      <div className="p-4">
        <NotificationSettings
          pushAvailable={provider.available}
          timeZone={user.timeZone}
          prefs={{
            quietHoursEnabled: prefs.quietHoursEnabled,
            quietHoursStartMinute: prefs.quietHoursStartMinute,
            quietHoursEndMinute: prefs.quietHoursEndMinute,
            dailyDigestEnabled: prefs.dailyDigestEnabled,
            dailyDigestMinute: prefs.dailyDigestMinute,
            notificationKinds: (prefs.notificationKinds ?? {}) as Record<string, boolean>,
            courseNotificationOptOut: (prefs.courseNotificationOptOut ?? {}) as Record<string, boolean>,
          }}
          courses={courses.map((c) => ({ id: c.id, code: c.code, title: c.title, color: c.color }))}
        />
      </div>
    </Card>
  );
}
