import { assertServerOnly } from '../server-guard';

assertServerOnly('lib/auth/mailer');

/**
 * Mail transport behind an adapter so the auth flow does not depend on any one
 * provider. The default `console` transport prints the sign-in link to the
 * server log, which is what local development and the demo use — it is honest
 * about not sending real mail rather than pretending delivery succeeded.
 */
export type MailMessage = { to: string; subject: string; text: string; html?: string };

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }>;
}

class ConsoleTransport implements MailTransport {
  readonly name = 'console';
  async send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }> {
    // eslint-disable-next-line no-console
    console.info(
      `\n──── sign-in email (console transport) ────\nto: ${message.to}\n${message.text}\n───────────────────────────────────────────\n`,
    );
    return { delivered: false, detail: 'console transport: no mail was actually sent' };
  }
}

/**
 * Generic HTTP transport: point MAIL_WEBHOOK_URL at any provider that accepts a
 * JSON POST (Resend, Postmark, an internal relay). Keeps provider SDKs out of
 * the dependency tree.
 */
class WebhookTransport implements MailTransport {
  readonly name = 'webhook';
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<{ delivered: boolean; detail?: string }> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ from: this.from, ...message }),
    });
    if (!res.ok) return { delivered: false, detail: `mail webhook returned ${res.status}` };
    return { delivered: true };
  }
}

export function getMailTransport(): MailTransport {
  const url = process.env.MAIL_WEBHOOK_URL;
  if (url) {
    return new WebhookTransport(url, process.env.MAIL_WEBHOOK_TOKEN, process.env.MAIL_FROM ?? 'no-reply@localhost');
  }
  return new ConsoleTransport();
}
