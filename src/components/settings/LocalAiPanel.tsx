'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Badge, StatePanel, cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { formatRelative } from '@/lib/shared/time';
import { bridgeStatus, setBridgeLocalToken, getBridgeLocalToken } from '@/lib/client/local-ai';

type Device = {
  id: string;
  label: string;
  modelName: string | null;
  endpointHint: string | null;
  scopes: string[];
  lastSeenAt: string | null;
  createdAt: string;
};

/**
 * Local AI setup.
 *
 * The connection state shown here is measured, not assumed: the browser probes
 * the bridge on every visit and says "Offline" the moment it cannot reach it.
 * Nothing in the app waits on this panel.
 */
export function LocalAiPanel({
  devices,
  bridgePort,
  enabled,
  indexingEnabled,
  scopeDescriptions,
}: {
  devices: Device[];
  bridgePort: number;
  enabled: boolean;
  indexingEnabled: boolean;
  scopeDescriptions: Record<string, { label: string; sends: string }>;
}) {
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [localToken, setLocalToken] = useState('');
  const [status, setStatus] = useState<{ state: string; model?: string; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    setStatus(await bridgeStatus(bridgePort));
  }, [bridgePort]);

  useEffect(() => {
    setLocalToken(getBridgeLocalToken() ?? '');
    void probe();
    const interval = window.setInterval(() => void probe(), 20_000);
    return () => window.clearInterval(interval);
  }, [probe]);

  const requestCode = async () => {
    setBusy(true);
    const result = await mutate<{ code: string; expiresAt: string }>('/api/ai/pair', 'POST', {}, {
      label: 'Create pairing code',
      queueOffline: false,
    });
    setBusy(false);
    if (result.ok && !result.queued && result.data) setCode(result.data);
  };

  const online = status?.state === 'connected';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={online ? 'success' : 'neutral'}>
          <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-success' : 'bg-ink-3')} aria-hidden />
          {online ? `Connected · ${status?.model ?? 'model'}` : 'Offline'}
        </Badge>
        <Button size="sm" onClick={() => void probe()}>
          <Icon name="refresh" size={14} />
          Check again
        </Button>
        {!online && status?.reason && <span className="text-[12px] text-ink-3">{status.reason}</span>}
      </div>

      {!online && (
        <StatePanel
          kind="offline"
          title="AI features are unavailable"
          description="Nothing else is affected: tasks, sync, notifications and the calendar all work exactly as they do with AI on. AI actions fall back to the deterministic parser and the normal task form."
        />
      )}

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">1 · Install the bridge</h3>
        <p className="mt-1 text-[12.5px] text-ink-2">
          The bridge ships with the project. On the computer that runs your model:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] text-ink-2">
{`SCHOOL_OS_URL=${typeof window !== 'undefined' ? window.location.origin : 'https://your-app'} \\
BRIDGE_MODEL=llama3.1:8b \\
node bridge/school-os-bridge.mjs --pair <CODE>`}
        </pre>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">2 · Pair this account</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => void requestCode()} disabled={busy}>
            Get a pairing code
          </Button>
          {code && (
            <span className="inline-flex items-center gap-2">
              <code className="rounded-md border border-brand bg-brand-soft px-3 py-1.5 font-mono text-[16px] font-semibold tracking-[0.2em] text-brand-strong">
                {code.code}
              </code>
              <span className="text-[11.5px] text-ink-3">
                expires {formatRelative(new Date(code.expiresAt))}
              </span>
            </span>
          )}
        </div>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Single use, ten minutes. The server stores only a hash of it.
        </p>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">3 · Let this browser talk to the bridge</h3>
        <p className="mt-1 text-[11.5px] text-ink-3">
          The bridge prints a local token when you pair. It stays in this browser and is never sent to the server.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={localToken}
            onChange={(e) => setLocalToken(e.target.value)}
            placeholder="local token from the bridge"
            className="min-h-9 min-w-64 flex-1 rounded-md border border-line bg-canvas px-2.5 font-mono text-[12.5px] text-ink"
            aria-label="Bridge local token"
          />
          <Button
            size="sm"
            onClick={() => {
              setBridgeLocalToken(localToken.trim());
              void probe();
            }}
          >
            Save locally
          </Button>
        </div>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">Paired devices</h3>
        {devices.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-3">No device paired yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {devices.map((device) => (
              <li key={device.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{device.label}</span>
                  {device.endpointHint && <Badge tone="neutral">{device.endpointHint}</Badge>}
                  <span className="ml-auto text-[11.5px] text-ink-3">
                    {device.lastSeenAt ? `seen ${formatRelative(new Date(device.lastSeenAt))}` : 'never used'}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      if (!window.confirm('Revoke this device? The bridge will stop working until you pair again.'))
                        return;
                      await mutate(`/api/ai/devices/${device.id}`, 'DELETE', undefined, {
                        label: 'Revoke AI device',
                        queueOffline: false,
                      });
                      router.refresh();
                    }}
                  >
                    Revoke
                  </Button>
                </div>
                <p className="mt-1 text-[11.5px] text-ink-3">
                  Scopes: {device.scopes.length ? device.scopes.join(', ') : 'none'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">What each capability sends</h3>
        <ul className="mt-2 space-y-1.5">
          {Object.entries(scopeDescriptions).map(([key, value]) => (
            <li key={key} className="rounded-md border border-line px-3 py-2">
              <p className="text-[12.5px] font-medium text-ink">{value.label}</p>
              <p className="text-[11.5px] text-ink-3">{value.sends}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              void mutate('/api/preferences', 'PATCH', { localAiEnabled: e.target.checked }).then(() =>
                router.refresh(),
              );
            }}
            className="mt-0.5 h-4 w-4 accent-[var(--c-brand)]"
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">Show AI actions in the app</span>
            <span className="block text-[11.5px] text-ink-3">
              Adds the “extract a task”, “summarise” and “study plan” buttons. They appear disabled when the bridge
              is offline.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2">
          <input
            type="checkbox"
            checked={indexingEnabled}
            onChange={(e) => {
              void mutate('/api/preferences', 'PATCH', { localAiIndexingEnabled: e.target.checked }).then(() =>
                router.refresh(),
              );
            }}
            className="mt-0.5 h-4 w-4 accent-[var(--c-brand)]"
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">Allow semantic search over notes</span>
            <span className="block text-[11.5px] text-ink-3">
              Off by default. When on, only notes you explicitly mark for indexing are sent to your local model.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
