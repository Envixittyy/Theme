import { desc, eq, and } from 'drizzle-orm';
import { getDb, type Database } from '../db';
import { auditEvents } from '../db/schema';

/**
 * Append-only audit trail. Every integration change, sync mutation and device
 * pairing writes here. `actor` is deliberately a string rather than a foreign
 * key so a row can name a non-user actor ("sync:blackboard") without a join.
 */
export type Actor = `user:${string}` | `sync:${string}` | 'system' | 'ai:local';

export async function recordAudit(
  args: {
    userId: string;
    actor: Actor;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    detail?: Record<string, unknown>;
  },
  db?: Database,
): Promise<void> {
  const target = db ?? (await getDb());
  await target.insert(auditEvents).values({
    userId: args.userId,
    actor: args.actor,
    action: args.action,
    entityType: args.entityType ?? null,
    entityId: args.entityId ?? null,
    detail: args.detail ?? {},
  });
}

export async function listAudit(userId: string, limit = 50, entityId?: string) {
  const db = await getDb();
  return db
    .select()
    .from(auditEvents)
    .where(entityId ? and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, entityId)) : eq(auditEvents.userId, userId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
