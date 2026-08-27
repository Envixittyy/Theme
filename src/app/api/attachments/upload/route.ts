import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { assertCsrf } from '@/lib/auth/csrf';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { getStorage, MAX_ATTACHMENT_BYTES } from '@/lib/connectors/storage';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * Step 2 for the local storage adapter (S3 deployments PUT straight to the
 * presigned URL and never reach this route). The key is looked up against the
 * caller's own reserved attachment row, so a guessed key belonging to someone
 * else resolves to nothing.
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser();
    await assertCsrf();
    const key = new URL(request.url).searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

    const db = await getDb();
    const rows = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.storageKey, key), eq(attachments.userId, user.id)))
      .limit(1);
    const attachment = rows[0];
    if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 });
    }
    await getStorage().put(key, body, attachment.contentType);
    return NextResponse.json({ ok: true, bytes: body.length });
  } catch (err) {
    return errorResponse(err);
  }
}
