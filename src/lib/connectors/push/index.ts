import { assertServerOnly } from '../../server-guard';

assertServerOnly('lib/connectors/push');

/**
 * Web Push behind an adapter.
 *
 * The adapter reports its own availability rather than throwing, because the
 * product promise is an *honest* status: when VAPID keys are absent the UI must
 * say "push is not configured on this server" instead of pretending a
 * notification was delivered.
 */

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushPayload = {
  title: string;
  body: string;
  /** In-app route. Never a credential-bearing URL. */
  url: string;
  tag: string;
  eventId: string;
};

export type PushResult =
  | { ok: true }
  | { ok: false; gone: boolean; detail: string };

export interface PushProvider {
  readonly name: string;
  readonly available: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

class WebPushProvider implements PushProvider {
  readonly name = 'web-push';
  constructor(
    private readonly publicKeyValue: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  get available(): boolean {
    return true;
  }
  get publicKey(): string {
    return this.publicKeyValue;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    const webpush = await import('web-push');
    webpush.default.setVapidDetails(this.subject, this.publicKeyValue, this.privateKey);
    try {
      await webpush.default.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: 'normal' },
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      // 404/410 mean the browser dropped the subscription: prune, do not retry.
      return {
        ok: false,
        gone: status === 404 || status === 410,
        detail: `push endpoint responded ${status || 'error'}`,
      };
    }
  }
}

class UnavailablePushProvider implements PushProvider {
  readonly name = 'unconfigured';
  readonly available = false;
  readonly publicKey = null;
  async send(): Promise<PushResult> {
    return { ok: false, gone: false, detail: 'Web Push is not configured on this server (no VAPID keys)' };
  }
}

let cached: PushProvider | null = null;

export function getPushProvider(): PushProvider {
  if (cached) return cached;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost';
  cached =
    publicKey && privateKey ? new WebPushProvider(publicKey, privateKey, subject) : new UnavailablePushProvider();
  return cached;
}

/** Test seam. */
export function __setPushProvider(provider: PushProvider | null): void {
  cached = provider;
}
