import { NextResponse, type NextRequest } from 'next/server';
import { constantTimeEqual } from '@/lib/security/crypto';
import { runWorker, scheduleRecurring } from '@/lib/jobs/worker';
import { errorResponse } from '@/lib/api/handler';
import { redactError } from '@/lib/security/redact';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Drains the job queue in one request.
 *
 * For hosts that cannot run a long-lived worker process (Vercel and similar),
 * a scheduler calls this every few minutes instead. It does exactly what the
 * worker's loop does, bounded by a job count so it finishes inside the
 * platform's request timeout.
 *
 * A real worker process is still the better arrangement — reminder resolution
 * here is bounded by the cron interval, not by the reminder. This exists so
 * that constraint is a choice rather than a dead end.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured, so this endpoint is disabled.' },
        { status: 501 },
      );
    }

    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; other schedulers
    // can use the same header.
    const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!provided || !constantTimeEqual(provided, secret)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }

    const limit = Math.min(Number(new URL(request.url).searchParams.get('max') ?? 50), 200);
    await scheduleRecurring();
    const { processed } = await runWorker({ maxJobs: limit });

    return NextResponse.json(
      { processed, limit },
      // A scheduler's response must never be cached by an intermediary.
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[cron:drain]', redactError(err));
    return errorResponse(err);
  }
}
