import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { syncConflicts, tasks } from '@/lib/db/schema';
import { resolveConflict } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => {
  const db = await getDb();
  const rows = await db
    .select({
      conflict: syncConflicts,
      taskTitle: tasks.title,
    })
    .from(syncConflicts)
    .leftJoin(tasks, eq(tasks.id, syncConflicts.entityId))
    .where(and(eq(syncConflicts.userId, user.id), eq(syncConflicts.state, 'open')))
    .orderBy(desc(syncConflicts.createdAt))
    .limit(100);
  return { conflicts: rows };
});

export const POST = withUser(async ({ request, user }) => {
  const body = z.object({ id: z.uuid(), choice: z.enum(['local', 'remote']) }).parse(await readJson(request));
  return { resolved: await resolveConflict(user.id, body.id, body.choice) };
});
