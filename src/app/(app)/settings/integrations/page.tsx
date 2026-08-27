import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { listAccounts, secretHints } from '@/lib/connectors/integrations';
import { Badge, Card, CardHeader, StatePanel } from '@/components/ui/primitives';
import { BlackboardConnect } from '@/components/settings/BlackboardConnect';
import { IntegrationList } from '@/components/settings/IntegrationList';
import { NotionConnect } from '@/components/settings/NotionConnect';
import { IcsImport } from '@/components/settings/IcsImport';
import { formatRelative } from '@/lib/shared/time';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const accounts = await listAccounts(user.id);
  const hints = Object.fromEntries(
    await Promise.all(accounts.map(async (a) => [a.id, await secretHints(a.id)] as const)),
  );
  const notionConfigured = !!process.env.NOTION_CLIENT_ID && !!process.env.NOTION_CLIENT_SECRET;

  return (
    <>
      <Card>
        <CardHeader
          title="Connected accounts"
          subtitle={accounts.length ? `${accounts.length} connected` : 'Nothing connected yet'}
        />
        {accounts.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">
            Everything in the app works without an integration. Connect one to bring deadlines in automatically.
          </p>
        ) : (
          <IntegrationList
            accounts={accounts.map((a) => ({
              id: a.id,
              provider: a.provider,
              label: a.label,
              status: a.status,
              lastError: a.lastError,
              createdAt: a.createdAt.toISOString(),
              updatedAt: a.updatedAt.toISOString(),
              // Only a redacted hint ever reaches the browser.
              secretHint: (hints[a.id] as Record<string, string>)?.ics_url ?? null,
              demo: (a.config as Record<string, unknown>).demo === true,
              importOnly: (a.config as Record<string, unknown>).importOnly === true,
            }))}
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Blackboard calendar feed"
          subtitle="Assignments and assessments, no administrator required"
        />
        <div className="p-4">
          <BlackboardConnect />
        </div>
      </Card>

      <Card>
        <CardHeader title="Import a calendar file" subtitle="One-off .ics import, deduplicated against your feeds" />
        <div className="p-4">
          <IcsImport />
        </div>
      </Card>

      <Card>
        <CardHeader title="Notion" subtitle="Two-way sync with an Academic Tasks database" />
        <div className="p-4">
          {notionConfigured ? (
            <NotionConnect accounts={accounts.filter((a) => a.provider === 'notion').map((a) => ({ id: a.id, label: a.label, status: a.status }))} />
          ) : (
            <StatePanel
              kind="offline"
              title="Notion is not configured on this server"
              description="Two-way sync needs a Notion OAuth integration. An administrator sets NOTION_CLIENT_ID and NOTION_CLIENT_SECRET; the connect button appears once they do."
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Announcements" subtitle="What each intake method can and cannot do" />
        <div className="space-y-3 p-4 text-[13px] text-ink-2">
          <p>
            Blackboard&apos;s calendar feed carries deadlines only. Announcements need one of the following, and the
            app tells you plainly which one you have:
          </p>
          <ul className="space-y-2">
            <li className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <Badge tone="info">Preferred</Badge>
                <span className="font-medium text-ink">Blackboard REST API</span>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-3">
                Full announcement bodies, authors and attachments. Requires your institution to register an
                application and grant it access — this is not something a student can enable alone.
              </p>
            </li>
            <li className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <Badge tone="neutral">Fallback</Badge>
                <span className="font-medium text-ink">Authorised email forwarding</span>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-3">
                Forward Blackboard notification emails to a private address; the parser extracts the course, title
                and body. Works today without administrator involvement, but only covers announcements that are
                emailed to you.
              </p>
            </li>
          </ul>
          <p>
            The full matrix of what needs institution access is in{' '}
            <Link href="/settings/sync" className="underline">
              sync health
            </Link>{' '}
            and in the project&apos;s <code className="rounded bg-surface-2 px-1">docs/blackboard-capabilities.md</code>.
          </p>
        </div>
      </Card>

      {accounts.length > 0 && (
        <p className="px-1 text-[11.5px] text-ink-3">
          Oldest connection {formatRelative(accounts[accounts.length - 1]!.createdAt)}. Disconnecting deletes the
          stored credential immediately and keeps your tasks.
        </p>
      )}
    </>
  );
}
