import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getPreferences } from '@/lib/auth/session';
import { listDevices } from '@/lib/connectors/localai/pairing';
import { DEFAULT_BRIDGE_PORT, SCOPE_DESCRIPTIONS } from '@/lib/connectors/localai/protocol';
import { Card, CardHeader } from '@/components/ui/primitives';
import { LocalAiPanel } from '@/components/settings/LocalAiPanel';

export const metadata: Metadata = { title: 'Local AI' };
export const dynamic = 'force-dynamic';

export default async function LocalAiSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const [devices, prefs] = await Promise.all([listDevices(user.id), getPreferences(user.id)]);

  return (
    <>
      <Card>
        <CardHeader
          title="Local AI"
          subtitle="Optional. Everything in the app works without it, and it is never required for a sync or a deadline."
        />
        <div className="p-4">
          <LocalAiPanel
            devices={devices.map((d) => ({
              id: d.id,
              label: d.label,
              modelName: d.modelName,
              endpointHint: d.endpointHint,
              scopes: (d.scopes as string[]) ?? [],
              lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
              createdAt: d.createdAt.toISOString(),
            }))}
            bridgePort={DEFAULT_BRIDGE_PORT}
            enabled={prefs.localAiEnabled}
            indexingEnabled={prefs.localAiIndexingEnabled}
            scopeDescriptions={SCOPE_DESCRIPTIONS}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="How it is wired" subtitle="What leaves your machine, and what does not" />
        <div className="space-y-2 p-4 text-[13px] text-ink-2">
          <p>
            The cloud server never contacts your model. Your browser talks to a small bridge running on your own
            computer over <code className="rounded bg-surface-2 px-1">127.0.0.1</code>, and the bridge talks to
            Ollama or any OpenAI-compatible endpoint you point it at.
          </p>
          <p>
            The server stores only: a device label, the model name you chose to report, a hash of the device token,
            and the granted scopes. It never receives your model endpoint, your prompts, or the model&apos;s
            replies.
          </p>
          <p>
            Every AI action shows you the exact text that will be sent before it is sent, and every result is a
            preview you confirm before anything is saved. Deadlines extracted from text are shown with the exact
            wording they came from; if there is no such wording, no deadline is proposed.
          </p>
        </div>
      </Card>
    </>
  );
}
