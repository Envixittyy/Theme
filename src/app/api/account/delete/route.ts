import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assertCsrf } from '@/lib/auth/csrf';
import { destroyCurrentSession, requireUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { attachments, users } from '@/lib/db/schema';
import { getStorage } from '@/lib/connectors/storage';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * Account deletion.
 *
 * Stored objects are removed first, because the database rows are what tell us
 * which objects exist — deleting the rows first would orphan the files forever.
 * The user row then cascades through every table.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    await assertCsrf();
    const body = z.object({ confirm: z.string() }).parse(await request.json());
    if (body.confirm !== user.email) {
      return NextResponse.json({ error: 'The confirmation did not match your email address.' }, { status: 400 });
    }

    const db = await getDb();
    const files = await db.select().from(attachments).where(eq(attachments.userId, user.id));
    const storage = getStorage();
    for (const file of files) {
      await storage.delete(file.storageKey).catch(() => {
        // A missing object must not block the deletion of the account.
      });
    }

    await db.delete(users).where(eq(users.id, user.id));
    await destroyCurrentSession();
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
