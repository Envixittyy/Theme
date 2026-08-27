import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { attachments, auditEvents, externalRecords, notes as notesTable } from '@/lib/db/schema';
import { listCourses } from '@/lib/domain/courses';
import { getTaskDetail } from '@/lib/domain/tasks';
import { TaskDetail } from '@/components/tasks/TaskDetail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user) return { title: 'Task' };
  const detail = await getTaskDetail(user.id, (await params).id);
  return { title: detail?.task.title ?? 'Task' };
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const detail = await getTaskDetail(user.id, id);
  if (!detail) notFound();

  const db = await getDb();
  const [courses, files, history, external, linkedNotes] = await Promise.all([
    listCourses(user.id),
    db.select().from(attachments).where(and(eq(attachments.userId, user.id), eq(attachments.taskId, id))),
    db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.userId, user.id), eq(auditEvents.entityId, id)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(25),
    db.select().from(externalRecords).where(and(eq(externalRecords.userId, user.id), eq(externalRecords.entityId, id))).limit(1),
    db.select().from(notesTable).where(and(eq(notesTable.userId, user.id), eq(notesTable.taskId, id))),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-[13px] text-ink-3">
        <Link href="/tasks" className="hover:underline">
          Tasks
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-2">{detail.task.title}</span>
      </nav>

      <TaskDetail
        task={{
          ...detail.task,
          startAt: detail.task.startAt?.toISOString() ?? null,
          dueAt: detail.task.dueAt?.toISOString() ?? null,
          completedAt: detail.task.completedAt?.toISOString() ?? null,
          submittedAt: detail.task.submittedAt?.toISOString() ?? null,
          createdAt: detail.task.createdAt.toISOString(),
          updatedAt: detail.task.updatedAt.toISOString(),
        }}
        subtasks={detail.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done }))}
        reminders={detail.reminders.map((r) => ({
          id: r.id,
          offsetMinutes: r.offsetMinutes,
          fireAt: r.fireAt?.toISOString() ?? null,
          enabled: r.enabled,
        }))}
        tags={detail.tags.map((t) => t.name)}
        courses={courses.map((c) => ({ id: c.id, code: c.code, title: c.title, color: c.color }))}
        attachments={files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          byteSize: f.byteSize,
          contentType: f.contentType,
          scanState: f.scanState,
          createdAt: f.createdAt.toISOString(),
        }))}
        history={history.map((h) => ({
          id: h.id,
          actor: h.actor,
          action: h.action,
          detail: h.detail as Record<string, unknown>,
          createdAt: h.createdAt.toISOString(),
        }))}
        external={
          external[0]
            ? {
                provider: external[0].provider,
                externalId: external[0].externalId,
                sourceUrl: external[0].sourceUrl,
                lastSeenAt: external[0].lastSeenAt.toISOString(),
                missingSinceAt: external[0].missingSinceAt?.toISOString() ?? null,
                reviewReason: external[0].reviewReason,
              }
            : null
        }
        linkedNotes={linkedNotes.map((n) => ({ id: n.id, title: n.title }))}
        timeZone={user.timeZone}
      />
    </div>
  );
}
