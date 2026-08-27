import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { announcements, attachments, auditEvents, notes, tasks } from '@/lib/db/schema';
import { Card, CardHeader } from '@/components/ui/primitives';
import { DataControls } from '@/components/settings/DataControls';
import { listAudit } from '@/lib/domain/audit';
import { formatRelative } from '@/lib/shared/time';

export const metadata: Metadata = { title: 'Data & privacy' };
export const dynamic = 'force-dynamic';

export default async function DataSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = await getDb();

  const countRows = await db
    .select({
      tasks: sql<number>`(select count(*) from ${tasks} where ${tasks.userId} = ${user.id})::int`,
      notes: sql<number>`(select count(*) from ${notes} where ${notes.userId} = ${user.id})::int`,
      announcements: sql<number>`(select count(*) from ${announcements} where ${announcements.userId} = ${user.id})::int`,
      attachments: sql<number>`(select count(*) from ${attachments} where ${attachments.userId} = ${user.id})::int`,
    })
    .from(sql`(select 1) as one`);
  const counts = countRows[0] ?? { tasks: 0, notes: 0, announcements: 0, attachments: 0 };
  const audit = await listAudit(user.id, 25);

  const integrationAudit = audit.filter(
    (a) => a.action.startsWith('integration.') || a.action.startsWith('localai.') || a.action.startsWith('push.'),
  );

  return (
    <>
      <Card>
        <CardHeader title="What is stored" subtitle="Everything below belongs to your account alone" />
        <dl className="grid grid-cols-2 gap-px bg-[var(--c-line)] sm:grid-cols-4">
          {[
            ['Tasks', counts.tasks],
            ['Notes', counts.notes],
            ['Announcements', counts.announcements],
            ['Attachments', counts.attachments],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-surface px-4 py-3">
              <dt className="text-[11.5px] uppercase tracking-wide text-ink-3">{label}</dt>
              <dd className="numeric text-lg font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader title="Export, disconnect, delete" />
        <div className="p-4">
          <DataControls email={user.email} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Audit trail" subtitle="Integration changes, device pairing and notification setup" />
        {integrationAudit.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">Nothing recorded yet.</p>
        ) : (
          <ol className="divide-y divide-[var(--c-line)]">
            {integrationAudit.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 text-[13px] text-ink">{entry.action.replace(/[._]/g, ' ')}</span>
                <time className="numeric text-[11px] text-ink-3" dateTime={entry.createdAt.toISOString()}>
                  {formatRelative(entry.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <CardHeader title="What this app never does" />
        <ul className="space-y-1.5 p-4 text-[13px] text-ink-2">
          <li>· It never puts your Blackboard feed URL or any token in a page, a log, or a notification.</li>
          <li>· It never sends your coursework to a third-party AI service. Local AI runs on your own machine.</li>
          <li>· It never deletes a task because a provider stopped listing it.</li>
          <li>· It never changes a task to Submitted or Done because of a sync.</li>
          <li>· It never makes attachments public; every download is authorised and short-lived.</li>
        </ul>
      </Card>
    </>
  );
}
