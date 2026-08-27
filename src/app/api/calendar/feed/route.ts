import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { courses, tasks, userPreferences, users } from '@/lib/db/schema';
import { buildIcs } from '@/lib/shared/ics';
import { getCurrentUser } from '@/lib/auth/session';
import { randomToken, sha256 } from '@/lib/security/crypto';
import { rateLimit } from '@/lib/security/ratelimit';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * Read-only calendar feed.
 *
 * Calendar clients cannot sign in, so the token *is* the credential: it is
 * opaque, rotatable from Settings, and grants nothing but a read of deadlines.
 * Signed-in browsers may fetch the feed with a session instead of a token, which
 * is how the "export" button works without ever putting the token in a link the
 * user might paste somewhere public.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const db = await getDb();

    let userId: string | null = null;
    let timeZone = 'Asia/Manila';

    if (token) {
      const gate = await rateLimit('calendar-feed', sha256(token), 60, 60_000);
      if (!gate.allowed) return new NextResponse('Too many requests', { status: 429 });
      const rows = await db
        .select({ userId: userPreferences.userId, timeZone: users.timeZone })
        .from(userPreferences)
        .innerJoin(users, eq(users.id, userPreferences.userId))
        .where(eq(userPreferences.calendarFeedToken, token))
        .limit(1);
      if (rows[0]) {
        userId = rows[0].userId;
        timeZone = rows[0].timeZone;
      }
    } else {
      const user = await getCurrentUser();
      if (user) {
        userId = user.id;
        timeZone = user.timeZone;
      }
    }

    if (!userId) return new NextResponse('Not found', { status: 404 });

    const from = new Date(Date.now() - 60 * 86_400_000);
    const to = new Date(Date.now() + 365 * 86_400_000);
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        dueAt: tasks.dueAt,
        durationMinutes: tasks.durationMinutes,
        status: tasks.status,
        type: tasks.type,
        code: courses.code,
      })
      .from(tasks)
      .leftJoin(courses, eq(courses.id, tasks.courseId))
      .where(
        and(
          eq(tasks.userId, userId),
          gte(tasks.dueAt, from),
          lte(tasks.dueAt, to),
          sql`${tasks.status} <> 'archived'`,
        ),
      )
      .orderBy(tasks.dueAt);

    const ics = buildIcs(
      rows
        .filter((r): r is typeof r & { dueAt: Date } => r.dueAt !== null)
        .map((r) => ({
          uid: `task-${r.id}@mapua-school-os`,
          summary: `${r.code ? `${r.code}: ` : ''}${r.title}${r.status === 'done' ? ' ✓' : ''}`,
          // Descriptions are trimmed: a subscribed calendar is often synced to
          // devices the student does not control.
          description: r.description.slice(0, 500),
          start: r.dueAt,
          end: new Date(r.dueAt.getTime() + (r.durationMinutes ?? 30) * 60_000),
          categories: [r.type, r.code ?? 'no-course'],
        })),
      'Mapua School OS deadlines',
    );

    return new NextResponse(ics, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="school-os.ics"',
        'cache-control': 'private, max-age=300',
        // Never let a shared feed be indexed or cached by an intermediary.
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Issue or rotate the feed token. */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const { assertCsrf } = await import('@/lib/auth/csrf');
    await assertCsrf();

    const db = await getDb();
    const token = randomToken(24);
    await db
      .insert(userPreferences)
      .values({ userId: user.id, calendarFeedToken: token })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { calendarFeedToken: token } });

    const base = process.env.APP_URL ?? 'http://localhost:3000';
    return NextResponse.json({ url: `${base}/api/calendar/feed?token=${token}` });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const { assertCsrf } = await import('@/lib/auth/csrf');
    await assertCsrf();
    const db = await getDb();
    await db
      .update(userPreferences)
      .set({ calendarFeedToken: null })
      .where(eq(userPreferences.userId, user.id));
    return NextResponse.json({ revoked: true });
  } catch (err) {
    return errorResponse(err);
  }
}
