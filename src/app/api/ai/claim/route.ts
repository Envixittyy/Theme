import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { claimPairingCode } from '@/lib/connectors/localai/pairing';
import { ALL_SCOPES, BRIDGE_PROTOCOL_VERSION } from '@/lib/connectors/localai/protocol';
import { rateLimit } from '@/lib/security/ratelimit';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

const schema = z.object({
  code: z.string().trim().min(6).max(16),
  bridgeVersion: z.string().max(32).default('unknown'),
  provider: z.string().max(40).default('unknown'),
  model: z.string().max(120).default('unknown'),
  endpointHint: z.string().max(120).optional(),
  scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).default(ALL_SCOPES),
});

/**
 * Called by the companion bridge, not the browser.
 *
 * There is no session here — the pairing code is the only credential — so the
 * route is rate limited hard by source address and the code is single-use and
 * short-lived. A wrong code is answered identically to an expired one.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const gate = await rateLimit('ai:claim', ip, 20, 10 * 60_000);
    if (!gate.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
    }

    const body = schema.parse(await request.json());
    const result = await claimPairingCode(body.code, {
      version: body.bridgeVersion,
      provider: body.provider,
      model: body.model,
      scopes: body.scopes as never,
      endpointHint: body.endpointHint,
    });

    if (!result.ok) {
      return NextResponse.json({ error: 'That pairing code is not valid.', reason: result.reason }, { status: 400 });
    }
    return NextResponse.json({
      protocol: BRIDGE_PROTOCOL_VERSION,
      deviceToken: result.deviceToken,
      deviceId: result.deviceId,
      userLabel: result.userLabel,
      scopes: result.scopes,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
