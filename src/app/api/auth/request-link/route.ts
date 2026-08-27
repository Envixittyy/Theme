import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requestMagicLink } from '@/lib/auth/magic-link';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.email().max(254) });

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const result = await requestMagicLink(body.email, ip);
    // The response never reveals whether the address has an account.
    return NextResponse.json({
      accepted: result.accepted,
      transport: result.transport,
      delivered: result.delivered,
      detail: result.detail,
      devLink: result.devLink,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
