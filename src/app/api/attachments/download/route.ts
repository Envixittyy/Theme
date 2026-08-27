import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { ALLOWED_CONTENT_TYPES, getStorage } from '@/lib/connectors/storage';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/** Byte delivery for the local adapter, re-authorized per request. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
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

    const bytes = await getStorage().get(key);
    const previewable = ALLOWED_CONTENT_TYPES.get(attachment.contentType)?.preview === true;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        // Only formats we are confident about render inline; everything else
        // downloads, so a hostile file cannot execute in the app's origin.
        'content-type': previewable ? attachment.contentType : 'application/octet-stream',
        'content-disposition': `${previewable ? 'inline' : 'attachment'}; filename="${attachment.fileName.replace(/["\\]/g, '_')}"`,
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=60, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
