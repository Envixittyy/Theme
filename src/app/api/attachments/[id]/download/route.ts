import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { getStorage } from '@/lib/connectors/storage';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * Authorization happens here, on every single request, against the row's owner.
 * There is no public bucket and no long-lived URL: the redirect target expires
 * in minutes, and a second user asking for the same id gets a 404 rather than a
 * hint that the file exists.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const db = await getDb();
    const rows = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.userId, user.id)))
      .limit(1);
    const attachment = rows[0];
    if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const url = await getStorage().createDownloadUrl(attachment.storageKey, attachment.fileName, 300);
    return NextResponse.redirect(new URL(url, process.env.APP_URL ?? 'http://localhost:3000'), {
      status: 302,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
