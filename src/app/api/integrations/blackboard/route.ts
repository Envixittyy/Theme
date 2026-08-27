import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { createAccount, putSecret } from '@/lib/connectors/integrations';
import { syncBlackboardAccount } from '@/lib/connectors/blackboard';
import { assertSafeUrl, safeFetch } from '@/lib/security/ssrf';
import { parseIcs } from '@/lib/shared/ics';
import { enqueue } from '@/lib/jobs/queue';
import { redactError } from '@/lib/security/redact';

export const dynamic = 'force-dynamic';

const schema = z.object({
  url: z.string().min(10).max(2000),
  label: z.string().max(80).default('Blackboard calendar'),
  /** Validate and preview without storing anything. */
  test: z.boolean().default(false),
});

/**
 * Connect a private Blackboard iCalendar feed.
 *
 * The URL is a credential from the moment it arrives: it is validated against
 * the SSRF policy, fetched *once* to prove it is a real calendar, then
 * encrypted at rest. It is never echoed back, never logged, and never reaches
 * the client again — the UI gets a redacted hint instead.
 */
export const POST = withUser(async ({ request, user }) => {
  const body = schema.parse(await readJson(request));

  // Fails closed with a specific reason (scheme, port, private address...).
  await assertSafeUrl(body.url);

  let eventCount = 0;
  let calendarName: string | null = null;
  try {
    const response = await safeFetch(body.url);
    if (response.status !== 200) {
      return { ok: false, error: `The feed responded with HTTP ${response.status}.` };
    }
    const parsed = parseIcs(response.body);
    eventCount = parsed.events.length;
    calendarName = parsed.calendarName;
  } catch (err) {
    return { ok: false, error: redactError(err, [body.url]) };
  }

  if (body.test) {
    return { ok: true, test: true, eventCount, calendarName };
  }

  const account = await createAccount({
    userId: user.id,
    provider: 'blackboard_ics',
    label: calendarName ?? body.label,
    config: { timeZone: user.timeZone },
    secrets: { ics_url: body.url },
  });

  const summary = await syncBlackboardAccount(user.id, account.id, { trigger: 'connect', notify: false });

  // Subsequent polls run in the background on the schedule.
  await enqueue(
    'blackboard.sync',
    { accountId: account.id },
    { userId: user.id, runAt: new Date(Date.now() + 15 * 60_000), lockKey: `bb:${account.id}` },
  );

  return { ok: true, accountId: account.id, eventCount, summary };
});

/** Validate a URL without connecting — used by the form as you type. */
export const PUT = withUser(async ({ request }) => {
  const body = z.object({ url: z.string().max(2000) }).parse(await readJson(request));
  try {
    await assertSafeUrl(body.url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That URL cannot be used.' };
  }
});
