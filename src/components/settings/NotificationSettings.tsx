'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge, StatePanel, cx } from '@/components/ui/primitives';
import { mutate, getCsrfToken } from '@/lib/client/api';
import { formatMinuteOfDay } from '@/lib/shared/time';

const KINDS: Array<{ key: string; label: string; description: string }> = [
  { key: 'blackboard_new_item', label: 'New Blackboard work', description: 'An assignment or assessment appears in your feed' },
  { key: 'blackboard_due_changed', label: 'Deadline changes', description: 'A due date moves upstream' },
  { key: 'announcement', label: 'Announcements', description: 'A new or meaningfully edited course announcement' },
  { key: 'reminder', label: 'Reminders', description: 'Your own reminders before a deadline' },
  { key: 'daily_digest', label: 'Daily digest', description: 'One summary each morning — off by default' },
  { key: 'sync_failure', label: 'Sync problems', description: 'A sync needs your attention; rate-limited to one an hour' },
];

type SubscriptionInfo = {
  available: boolean;
  publicKey: string | null;
  subscriptions: Array<{ id: string; origin: string; createdAt: string; expired: boolean; userAgent: string | null }>;
};

/**
 * Notification preferences and device registration.
 *
 * The iOS caveat is spelled out rather than hidden: Safari only offers the
 * Notification permission prompt to a PWA that has been added to the Home
 * Screen, so asking before that simply fails. The button detects standalone
 * mode and explains what to do when it is missing.
 */
export function NotificationSettings({
  pushAvailable,
  timeZone,
  prefs,
  courses,
}: {
  pushAvailable: boolean;
  timeZone: string;
  prefs: {
    quietHoursEnabled: boolean;
    quietHoursStartMinute: number;
    quietHoursEndMinute: number;
    dailyDigestEnabled: boolean;
    dailyDigestMinute: number;
    notificationKinds: Record<string, boolean>;
    courseNotificationOptOut: Record<string, boolean>;
  };
  courses: Array<{ id: string; code: string; title: string; color: string }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(prefs);
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [standalone, setStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    setStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as { standalone?: boolean }).standalone === true,
    );
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    void fetch('/api/push/subscribe')
      .then((r) => r.json())
      .then((data: SubscriptionInfo) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, ...(patch as object) }));
    const result = await mutate('/api/preferences', 'PATCH', patch);
    if (result.ok) router.refresh();
  };

  const enablePush = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (typeof Notification === 'undefined') {
        setMessage('This browser does not support notifications.');
        return;
      }
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') {
        setMessage('Permission was not granted, so nothing was registered.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const key = info?.publicKey;
      if (!key) {
        setMessage('This server has no push keys configured, so there is nothing to subscribe to.');
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() ?? '' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          deviceLabel: navigator.platform || 'This device',
          isStandalone: standalone,
        }),
      });
      if (!response.ok) {
        setMessage('The server rejected the subscription.');
        return;
      }
      setMessage('This device is registered for notifications.');
      const refreshed = (await (await fetch('/api/push/subscribe')).json()) as SubscriptionInfo;
      setInfo(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {!pushAvailable && (
        <StatePanel
          kind="offline"
          title="Push is not configured on this server"
          description="Notifications are still recorded in the app. An administrator can enable delivery by setting VAPID keys."
        />
      )}

      {isIos && !standalone && (
        <StatePanel
          kind="partial"
          title="Add to Home Screen first"
          description="On iPhone, notification permission can only be requested from an installed app. Open the Share menu, choose “Add to Home Screen”, then open School OS from the Home Screen and come back here."
        />
      )}

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">This device</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void enablePush()}
            disabled={busy || !pushAvailable || permission === 'denied' || (isIos && !standalone)}
          >
            {permission === 'granted' ? 'Re-register this device' : 'Enable notifications'}
          </Button>
          <Badge tone={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'neutral'}>
            permission: {permission}
          </Badge>
          {standalone && <Badge tone="info">installed app</Badge>}
          {message && (
            <span className="text-[12px] text-ink-2" role="status">
              {message}
            </span>
          )}
        </div>
        {permission === 'denied' && (
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            Notifications are blocked in your browser settings for this site. That has to be changed there first.
          </p>
        )}

        {info && info.subscriptions.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {info.subscriptions.map((sub) => (
              <li key={sub.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-ink">{sub.userAgent ?? sub.origin}</span>
                {sub.expired && <Badge tone="warn">expired</Badge>}
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await mutate('/api/push/subscribe', 'DELETE', { id: sub.id }, { label: 'Remove device' });
                    setInfo({ ...info, subscriptions: info.subscriptions.filter((s) => s.id !== sub.id) });
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">What to send</h3>
        <ul className="mt-2 space-y-1.5">
          {KINDS.map((kind) => {
            const enabled = draft.notificationKinds[kind.key] !== false;
            return (
              <li key={kind.key} className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2">
                <input
                  id={`kind-${kind.key}`}
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    void save({ notificationKinds: { ...draft.notificationKinds, [kind.key]: e.target.checked } })
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--c-brand)]"
                />
                <label htmlFor={`kind-${kind.key}`} className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{kind.label}</span>
                  <span className="block text-[11.5px] text-ink-3">{kind.description}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">Quiet hours</h3>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Anything that arrives inside the window is held and delivered when it ends. Times are in {timeZone}.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={draft.quietHoursEnabled}
              onChange={(e) => void save({ quietHoursEnabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--c-brand)]"
            />
            Enabled
          </label>
          <label className="text-[12px] text-ink-3">
            From
            <input
              type="time"
              value={toTime(draft.quietHoursStartMinute)}
              onChange={(e) => void save({ quietHoursStartMinute: fromTime(e.target.value) })}
              className="ml-1.5 min-h-9 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            />
          </label>
          <label className="text-[12px] text-ink-3">
            Until
            <input
              type="time"
              value={toTime(draft.quietHoursEndMinute)}
              onChange={(e) => void save({ quietHoursEndMinute: fromTime(e.target.value) })}
              className="ml-1.5 min-h-9 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            />
          </label>
          <span className="text-[11.5px] text-ink-3">
            {formatMinuteOfDay(draft.quietHoursStartMinute)} → {formatMinuteOfDay(draft.quietHoursEndMinute)}
          </span>
        </div>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">Daily digest</h3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={draft.dailyDigestEnabled}
              onChange={(e) => void save({ dailyDigestEnabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--c-brand)]"
            />
            Send one summary each day
          </label>
          <label className="text-[12px] text-ink-3">
            At
            <input
              type="time"
              value={toTime(draft.dailyDigestMinute)}
              onChange={(e) => void save({ dailyDigestMinute: fromTime(e.target.value) })}
              className="ml-1.5 min-h-9 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            />
          </label>
        </div>
      </section>

      <section>
        <h3 className="text-[12px] font-semibold text-ink-2">Per course</h3>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Muting a course still records its notifications in the app; it only stops the buzz.
        </p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {courses.map((course) => {
            const muted = draft.courseNotificationOptOut[course.id] === true;
            return (
              <li key={course.id}>
                <label
                  className={cx(
                    'flex min-h-10 items-center gap-2 rounded-md border px-2.5 text-[13px]',
                    muted ? 'border-line bg-surface-2 text-ink-3' : 'border-line text-ink',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={!muted}
                    onChange={(e) =>
                      void save({
                        courseNotificationOptOut: {
                          ...draft.courseNotificationOptOut,
                          [course.id]: !e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4 accent-[var(--c-brand)]"
                  />
                  <span className="course-dot" style={{ ['--course-color' as string]: course.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{course.code}</span>
                  {muted && <span className="text-[11px]">muted</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const toTime = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const fromTime = (value: string): number => {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
};

/** VAPID keys arrive base64url-encoded; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
