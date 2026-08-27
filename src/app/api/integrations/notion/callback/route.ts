import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth/session';
import { createAccount } from '@/lib/connectors/integrations';
import { exchangeNotionCode, HttpNotionClient } from '@/lib/connectors/notion/client';
import { proposeMapping } from '@/lib/connectors/notion/mapping';
import { constantTimeEqual, sha256 } from '@/lib/security/crypto';
import { errorResponse } from '@/lib/api/handler';
import { redactError } from '@/lib/security/redact';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const base = process.env.APP_URL ?? new URL(request.url).origin;
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) return NextResponse.redirect(`${base}/settings/integrations?notion=denied`);
    if (!code || !state) return NextResponse.redirect(`${base}/settings/integrations?notion=invalid`);

    const store = await cookies();
    const expected = store.get('mos_notion_state')?.value;
    if (!expected || !constantTimeEqual(sha256(state), expected)) {
      return NextResponse.redirect(`${base}/settings/integrations?notion=state`);
    }
    store.delete('mos_notion_state');

    const { accessToken, workspaceId, workspaceName } = await exchangeNotionCode(code);

    // Offer the databases the integration can actually see, so the student
    // picks the real Academic Tasks database instead of typing an id.
    const client = new HttpNotionClient(accessToken);
    const databases = await client.listDatabases().catch(() => []);

    const account = await createAccount({
      userId: user.id,
      provider: 'notion',
      label: workspaceName,
      externalAccountId: workspaceId,
      config: {
        timeZone: user.timeZone,
        databases,
        // No database is chosen yet: syncing stays off until one is picked and
        // its mapping confirmed.
        databaseId: null,
        mapping: proposeMapping({}).mapping,
      },
      secrets: { access_token: accessToken },
    });

    return NextResponse.redirect(`${base}/settings/integrations?notion=connected&account=${account.id}`);
  } catch (err) {
    console.error('[notion:callback]', redactError(err));
    return NextResponse.redirect(`${base}/settings/integrations?notion=failed`);
  }
}
