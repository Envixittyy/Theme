import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import {
  announcements,
  attachments,
  auditEvents,
  courseMeetings,
  courses,
  externalRecords,
  integrationAccounts,
  notes,
  reminders,
  smartLists,
  subtasks,
  syncChanges,
  syncRuns,
  tags,
  tasks,
  terms,
  themes,
  userPreferences,
  users,
} from '@/lib/db/schema';
import { errorResponse } from '@/lib/api/handler';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

/**
 * Account export.
 *
 * Deliberately excludes `integration_secrets` and every token hash: an export
 * lands in a downloads folder, and a file that re-grants access to a Blackboard
 * feed is a credential in the wrong place. Everything the student authored is
 * included in full.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    // Every user-owned table carries `user_id`, so one helper covers them all.
    const mine = (table: typeof tasks): Promise<Array<Record<string, unknown>>> =>
      db.select().from(table).where(eq(table.userId, user.id)) as unknown as Promise<
        Array<Record<string, unknown>>
      >;

    const [
      profile,
      preferences,
      termRows,
      courseRows,
      meetingRows,
      taskRows,
      subtaskRows,
      tagRows,
      reminderRows,
      noteRows,
      attachmentRows,
      announcementRows,
      smartListRows,
      themeRows,
      accountRows,
      externalRows,
      runRows,
      changeRows,
      auditRows,
    ] = await Promise.all([
      db.select({ id: users.id, email: users.email, displayName: users.displayName, timeZone: users.timeZone, createdAt: users.createdAt }).from(users).where(eq(users.id, user.id)),
      db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)),
      mine(terms as unknown as typeof tasks),
      mine(courses as unknown as typeof tasks),
      mine(courseMeetings as unknown as typeof tasks),
      mine(tasks as unknown as typeof tasks),
      mine(subtasks as unknown as typeof tasks),
      mine(tags as unknown as typeof tasks),
      mine(reminders as unknown as typeof tasks),
      mine(notes as unknown as typeof tasks),
      mine(attachments as unknown as typeof tasks),
      mine(announcements as unknown as typeof tasks),
      mine(smartLists as unknown as typeof tasks),
      mine(themes as unknown as typeof tasks),
      db
        .select({
          id: integrationAccounts.id,
          provider: integrationAccounts.provider,
          label: integrationAccounts.label,
          status: integrationAccounts.status,
          createdAt: integrationAccounts.createdAt,
        })
        .from(integrationAccounts)
        .where(eq(integrationAccounts.userId, user.id)),
      mine(externalRecords as unknown as typeof tasks),
      mine(syncRuns as unknown as typeof tasks),
      mine(syncChanges as unknown as typeof tasks),
      mine(auditEvents as unknown as typeof tasks),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      format: 'mapua-school-os/v1',
      note: 'Integration secrets, session tokens and push keys are deliberately excluded.',
      profile: profile[0] ?? null,
      // The feed token is a live credential; it is stripped from exports.
      preferences: preferences[0] ? { ...preferences[0], calendarFeedToken: undefined } : null,
      terms: termRows,
      courses: courseRows,
      courseMeetings: meetingRows,
      tasks: taskRows,
      subtasks: subtaskRows,
      tags: tagRows,
      reminders: reminderRows,
      notes: noteRows,
      attachments: attachmentRows.map((a) => ({ ...a, storageKey: undefined })),
      announcements: announcementRows,
      smartLists: smartListRows,
      themes: themeRows,
      integrationAccounts: accountRows,
      externalRecords: externalRows,
      syncRuns: runRows,
      syncChanges: changeRows,
      auditEvents: auditRows,
    };

    await recordAudit({ userId: user.id, actor: `user:${user.id}`, action: 'account.exported' });

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="school-os-export-${new Date().toISOString().slice(0, 10)}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
