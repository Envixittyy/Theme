import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth/session';
import { notionAuthorizeUrl } from '@/lib/connectors/notion/client';
import { randomToken, sha256 } from '@/lib/security/crypto';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * Start the Notion OAuth flow.
 *
 * The `state` value is random, stored hashed in a short-lived httpOnly cookie,
 * and compared on the way back. That is what stops an attacker from causing the
 * student's account to be connected to a workspace of the attacker's choosing.
 */
export async function GET() {
  try {
    await requireUser();
    const state = randomToken(16);
    const url = notionAuthorizeUrl(state);
    if (!url) {
      return NextResponse.json({ error: 'Notion is not configured on this server.' }, { status: 501 });
    }
    const store = await cookies();
    store.set('mos_notion_state', sha256(state), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/notion',
      maxAge: 600,
    });
    return NextResponse.redirect(url);
  } catch (err) {
    return errorResponse(err);
  }
}
