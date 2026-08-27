import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getPreferences, listSessions } from '@/lib/auth/session';
import { Card, CardHeader } from '@/components/ui/primitives';
import { AccountForm } from '@/components/settings/AccountForm';
import { SessionList } from '@/components/settings/SessionList';

export const metadata: Metadata = { title: 'Account settings' };
export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const [prefs, sessions] = await Promise.all([getPreferences(user.id), listSessions(user.id)]);

  return (
    <>
      <Card>
        <CardHeader title="Account" subtitle={user.email} />
        <div className="p-4">
          <AccountForm
            displayName={user.displayName}
            timeZone={user.timeZone}
            weekStartsOn={prefs.weekStartsOn}
            timeFormat={prefs.timeFormat as 'h12' | 'h24'}
            defaultView={prefs.defaultView}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Signed-in devices" subtitle="Revoking a session signs that device out immediately" />
        <SessionList
          sessions={sessions.map((s) => ({
            id: s.id,
            userAgent: s.userAgent,
            createdAt: s.createdAt.toISOString(),
            lastSeenAt: s.lastSeenAt.toISOString(),
            revoked: !!s.revokedAt,
            current: s.id === user.sessionId,
          }))}
        />
      </Card>
    </>
  );
}
