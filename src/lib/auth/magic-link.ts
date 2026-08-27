import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { magicLinkTokens, users } from '../db/schema';
import { randomToken, sha256 } from '../security/crypto';
import { rateLimit } from '../security/ratelimit';
import { assertServerOnly } from '../server-guard';
import { getMailTransport } from './mailer';

assertServerOnly('lib/auth/magic-link');

const TOKEN_TTL_MS = 15 * 60_000;

export type RequestLinkResult = {
  /** Always true for existing *and* unknown addresses — no account enumeration. */
  accepted: boolean;
  /** Present only when mail delivery is not configured (dev/demo). */
  devLink?: string;
  transport: string;
  delivered: boolean;
  detail?: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function requestMagicLink(rawEmail: string, requestIp: string | null): Promise<RequestLinkResult> {
  const email = normalizeEmail(rawEmail);
  const db = await getDb();

  // Two limits: per address (stops mail-bombing one victim) and per source IP.
  const byEmail = await rateLimit('magic-link:email', email, 5, 15 * 60_000);
  const byIp = await rateLimit('magic-link:ip', requestIp ?? 'unknown', 20, 15 * 60_000);
  if (!byEmail.allowed || !byIp.allowed) {
    return { accepted: true, transport: 'none', delivered: false, detail: 'rate limited' };
  }

  const token = randomToken(32);
  await db.insert(magicLinkTokens).values({
    email,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    requestIpHash: requestIp ? sha256(`ip:${requestIp}`).slice(0, 32) : null,
  });

  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const link = `${base}/auth/verify?token=${encodeURIComponent(token)}`;
  const transport = getMailTransport();
  const result = await transport.send({
    to: email,
    subject: 'Your Mapua School OS sign-in link',
    text: [
      'Sign in to Mapua School OS by opening this link within 15 minutes:',
      '',
      link,
      '',
      'If you did not request this, you can ignore this message.',
    ].join('\n'),
  });

  return {
    accepted: true,
    transport: transport.name,
    delivered: result.delivered,
    detail: result.detail,
    // Surfacing the link in the UI is gated on the transport genuinely not
    // sending mail, and on not being in production.
    devLink: !result.delivered && process.env.NODE_ENV !== 'production' ? link : undefined,
  };
}

export type ConsumeResult = { userId: string; created: boolean } | { error: 'invalid' | 'expired' | 'used' };

export async function consumeMagicLink(token: string): Promise<ConsumeResult> {
  const db = await getDb();
  const hash = sha256(token);

  const rows = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, hash)).limit(1);
  const row = rows[0];
  if (!row) return { error: 'invalid' };
  if (row.consumedAt) return { error: 'used' };
  if (row.expiresAt.getTime() < Date.now()) return { error: 'expired' };

  // Single-use: the UPDATE is the guard, so two concurrent redemptions cannot
  // both win.
  const claimed = await db
    .update(magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(magicLinkTokens.id, row.id),
        isNull(magicLinkTokens.consumedAt),
        gt(magicLinkTokens.expiresAt, new Date()),
      ),
    )
    .returning({ id: magicLinkTokens.id });
  if (!claimed[0]) return { error: 'used' };

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, row.email)).limit(1);
  if (existing[0]) return { userId: existing[0].id, created: false };

  const [created] = await db
    .insert(users)
    .values({ email: row.email, displayName: row.email.split('@')[0] ?? 'Student' })
    .returning({ id: users.id });
  return { userId: created!.id, created: true };
}
