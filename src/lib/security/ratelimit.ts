import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { rateLimits } from '../db/schema';
import { sha256 } from './crypto';

/**
 * Fixed-window rate limiter in the application database.
 *
 * Deliberately not Redis: the whole product is designed to run on one Postgres
 * and one worker. A fixed window is coarse but the limits here exist to blunt
 * abuse (login spam, feed-fetch hammering, push floods), not to shape traffic.
 */
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

export async function rateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const db = await getDb();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const id = `${bucket}:${sha256(identifier).slice(0, 32)}:${windowStart.getTime()}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ id, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.id,
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(windowStart.getTime() + windowMs),
  };
}

/** Housekeeping: called by the scheduler so the table cannot grow forever. */
export async function pruneRateLimits(olderThanMs = 24 * 3600_000): Promise<void> {
  const db = await getDb();
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < ${new Date(Date.now() - olderThanMs)}`);
}
