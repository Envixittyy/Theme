import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { reminders, tasks } from '@/lib/db/schema';
import { NotFoundError } from '@/lib/domain/tasks';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

export const POST = withUser(async ({ request, user, params }) => {
  const body = z.object({ offsetMinutes: z.number().int().min(-10_080).max(43_200) }).parse(await readJson(request));
  const db = await getDb();
  const owned = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, params.id!), eq(tasks.userId, user.id)))
    .limit(1);
  if (!owned[0]) throw new NotFoundError('Task');
  const [row] = await db
    .insert(reminders)
    .values({ userId: user.id, taskId: params.id!, offsetMinutes: body.offsetMinutes })
    .returning();
  return { reminder: row };
});

/**
 * Snoozing writes an absolute `fireAt` and never touches the task's `dueAt`.
 * The academic deadline is a fact about the course; a reminder is a fact about
 * the student's attention, and conflating the two loses real information.
 */
export const PATCH = withUser(async ({ request, user, params }) => {
  const body = z
    .object({ id: z.uuid(), snoozeMinutes: z.number().int().min(1).max(20_160).optional(), enabled: z.boolean().optional() })
    .parse(await readJson(request));
  const db = await getDb();

  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, body.id), eq(reminders.userId, user.id)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Reminder');

  const set: Record<string, unknown> = {};
  if (body.snoozeMinutes) set.fireAt = new Date(Date.now() + body.snoozeMinutes * 60_000);
  if (body.enabled !== undefined) set.enabled = body.enabled;

  const [updated] = await db.update(reminders).set(set).where(eq(reminders.id, body.id)).returning();
  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'reminder.snoozed',
    entityType: 'task',
    entityId: params.id!,
    detail: { reminderId: body.id, snoozeMinutes: body.snoozeMinutes ?? null, dueDateUnchanged: true },
  });
  return { reminder: updated };
});

export const DELETE = withUser(async ({ request, user }) => {
  const body = z.object({ id: z.uuid() }).parse(await readJson(request));
  const db = await getDb();
  await db.delete(reminders).where(and(eq(reminders.id, body.id), eq(reminders.userId, user.id)));
  return null;
});
