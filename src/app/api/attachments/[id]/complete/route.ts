import { and, eq } from 'drizzle-orm';
import { withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { getStorage, inspectBytes } from '@/lib/connectors/storage';
import { NotFoundError } from '@/lib/domain/tasks';
import { recordAudit } from '@/lib/domain/audit';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

/**
 * Step 3: the bytes are in place, so inspect them before the attachment counts
 * as usable. A file whose contents contradict its declared type, or that looks
 * like an executable, is deleted rather than quarantined — there is no reason a
 * coursework attachment needs a second chance.
 */
export const POST = withUser(async ({ user, params }) => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, params.id!), eq(attachments.userId, user.id)))
    .limit(1);
  const attachment = rows[0];
  if (!attachment) throw new NotFoundError('Attachment');

  const storage = getStorage();
  const stored = await storage.head(attachment.storageKey);
  if (!stored) {
    await db.delete(attachments).where(eq(attachments.id, attachment.id));
    return { error: 'The upload did not arrive.', rejected: true };
  }

  const bytes = await storage.get(attachment.storageKey);
  const verdict = inspectBytes(bytes, attachment.contentType);
  if (verdict.state === 'rejected') {
    await storage.delete(attachment.storageKey);
    await db.delete(attachments).where(eq(attachments.id, attachment.id));
    await recordAudit({
      userId: user.id,
      actor: `user:${user.id}`,
      action: 'attachment.rejected',
      entityType: 'attachment',
      entityId: attachment.id,
      detail: { reason: verdict.detail, fileName: attachment.fileName },
    });
    return { error: `File rejected: ${verdict.detail}`, rejected: true };
  }

  const [updated] = await db
    .update(attachments)
    .set({
      scanState: verdict.state,
      scanDetail: verdict.detail,
      byteSize: bytes.length,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    })
    .where(eq(attachments.id, attachment.id))
    .returning();

  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'attachment.added',
    entityType: 'attachment',
    entityId: attachment.id,
    detail: { fileName: attachment.fileName, byteSize: bytes.length },
  });
  return { attachment: updated };
});
