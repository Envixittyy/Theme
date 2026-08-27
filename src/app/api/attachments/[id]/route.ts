import { and, eq } from 'drizzle-orm';
import { withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { getStorage } from '@/lib/connectors/storage';
import { NotFoundError } from '@/lib/domain/tasks';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

export const DELETE = withUser(async ({ user, params }) => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, params.id!), eq(attachments.userId, user.id)))
    .limit(1);
  const attachment = rows[0];
  if (!attachment) throw new NotFoundError('Attachment');

  await getStorage().delete(attachment.storageKey);
  await db.delete(attachments).where(eq(attachments.id, attachment.id));
  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'attachment.removed',
    entityType: 'attachment',
    entityId: attachment.id,
    detail: { fileName: attachment.fileName },
  });
  return null;
});

export const PATCH = withUser(async ({ request, user, params }) => {
  const body = (await request.json()) as { fileName?: string };
  const { sanitizeFileName } = await import('@/lib/connectors/storage');
  if (!body.fileName) throw new NotFoundError('Name');
  const db = await getDb();
  const rows = await db
    .update(attachments)
    .set({ fileName: sanitizeFileName(body.fileName) })
    .where(and(eq(attachments.id, params.id!), eq(attachments.userId, user.id)))
    .returning();
  if (!rows[0]) throw new NotFoundError('Attachment');
  return { attachment: rows[0] };
});
