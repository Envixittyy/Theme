import { NextResponse, type NextRequest } from 'next/server';
import { destroyCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  await destroyCurrentSession();
  const base = process.env.APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(`${base}/login`, { status: 303 });
}
