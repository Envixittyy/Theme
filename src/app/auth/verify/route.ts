import { NextResponse, type NextRequest } from 'next/server';
import { consumeMagicLink } from '@/lib/auth/magic-link';
import { createSession } from '@/lib/auth/session';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  const base = process.env.APP_URL ?? new URL(request.url).origin;
  if (!token) return NextResponse.redirect(`${base}/login?error=missing`);

  const result = await consumeMagicLink(token);
  if ('error' in result) {
    return NextResponse.redirect(`${base}/login?error=${result.error}`);
  }

  await createSession(result.userId);
  await recordAudit({
    userId: result.userId,
    actor: `user:${result.userId}`,
    action: result.created ? 'account.created' : 'session.signed_in',
  });
  return NextResponse.redirect(`${base}/today`);
}
