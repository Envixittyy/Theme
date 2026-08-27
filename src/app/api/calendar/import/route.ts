import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { importIcsText } from '@/lib/connectors/blackboard';
import { createAccount, getAccount, listAccounts } from '@/lib/connectors/integrations';
import { parseIcs } from '@/lib/shared/ics';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Raw .ics text. Capped well below the parser's own limit. */
  ics: z.string().min(10).max(2_000_000),
  accountId: z.uuid().optional(),
  /** Preview first; the student confirms before anything is written. */
  dryRun: z.boolean().default(true),
});

/**
 * Import a `.ics` file the student uploaded.
 *
 * Runs the identical normalization and merge pipeline a live feed uses, so an
 * imported file cannot create duplicates of items a feed already produced, and
 * the same field-ownership rules protect their edits.
 */
export const POST = withUser(async ({ request, user }) => {
  const body = schema.parse(await readJson(request));

  if (body.dryRun) {
    const parsed = parseIcs(body.ics);
    return {
      preview: true,
      calendarName: parsed.calendarName,
      eventCount: parsed.events.length,
      warnings: parsed.warnings,
      sample: parsed.events.slice(0, 10).map((e) => ({
        summary: e.summary,
        dueAt: e.dueAt?.toISOString() ?? null,
        uid: e.uid,
      })),
    };
  }

  let accountId = body.accountId;
  if (!accountId) {
    const existing = (await listAccounts(user.id, 'blackboard_ics')).find(
      (a) => (a.config as Record<string, unknown>).importOnly === true,
    );
    accountId =
      existing?.id ??
      (
        await createAccount({
          userId: user.id,
          provider: 'blackboard_ics',
          label: 'Imported calendar files',
          config: { importOnly: true, timeZone: user.timeZone },
        })
      ).id;
  } else if (!(await getAccount(user.id, accountId))) {
    throw new Error('Integration account not found');
  }

  const summary = await importIcsText(user.id, accountId, body.ics, { notify: false });
  return { preview: false, summary };
});
