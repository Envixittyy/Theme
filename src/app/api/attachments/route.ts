import { and, eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { attachments, courses, notes, tasks } from '@/lib/db/schema';
import { attachmentInitSchema } from '@/lib/domain/validation';
import { NotFoundError } from '@/lib/domain/tasks';
import {
  assertAcceptableUpload,
  AttachmentRejected,
  getStorage,
  newStorageKey,
  sanitizeFileName,
} from '@/lib/connectors/storage';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

/**
 * Step 1 of the upload: validate and reserve. Nothing is stored until the bytes
 * arrive and pass inspection, and the caller's ownership of the parent record is
 * proven here rather than assumed later.
 */
export const POST = withUser(async ({ request, user }) => {
  const input = attachmentInitSchema.parse(await readJson(request));
  try {
    assertAcceptableUpload(input.contentType, input.byteSize);
  } catch (err) {
    if (err instanceof AttachmentRejected) {
      return { error: err.message, rejected: true };
    }
    throw err;
  }

  const db = await getDb();
  if (input.taskId) {
    const owned = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, user.id)))
      .limit(1);
    if (!owned[0]) throw new NotFoundError('Task');
  }
  if (input.noteId) {
    const owned = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.id, input.noteId), eq(notes.userId, user.id)))
      .limit(1);
    if (!owned[0]) throw new NotFoundError('Note');
  }
  if (input.courseId) {
    const owned = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, input.courseId), eq(courses.userId, user.id)))
      .limit(1);
    if (!owned[0]) throw new NotFoundError('Course');
  }

  const storageKey = newStorageKey(user.id);
  const fileName = sanitizeFileName(input.fileName);

  const [row] = await db
    .insert(attachments)
    .values({
      userId: user.id,
      taskId: input.taskId ?? null,
      noteId: input.noteId ?? null,
      courseId: input.courseId ?? null,
      storageKey,
      fileName,
      contentType: input.contentType,
      byteSize: input.byteSize,
      scanState: 'pending',
    })
    .returning();

  const upload = await getStorage().createUploadTarget(storageKey, input.contentType, input.byteSize);
  return {
    attachmentId: row!.id,
    fileName,
    upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt },
  };
});
