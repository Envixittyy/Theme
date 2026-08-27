import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createCourse,
  createIcsAccount,
  createUser,
  db,
  icsDocument,
  resetDb,
  setAccountSecret,
} from './helpers';
import { syncBlackboardAccount } from '@/lib/connectors/blackboard';
import {
  externalRecords,
  notificationEvents,
  syncChanges,
  syncConflicts,
  syncRuns,
  tasks,
} from '@/lib/db/schema';
import { resolveConflict } from '@/lib/sync/engine';
import type { SafeFetchResult } from '@/lib/security/ssrf';

const FEED = 'https://blackboard.example.edu/webapps/calendar/feed/abcd1234efgh5678/learn.ics';

function fetcherFor(body: string, headers: Record<string, string> = {}) {
  return async (): Promise<SafeFetchResult> => ({
    finalUrl: FEED,
    status: 200,
    headers: { 'content-type': 'text/calendar', ...headers },
    body,
    bytes: body.length,
    truncated: false,
  });
}

let userId: string;
let accountId: string;

beforeAll(async () => {
  await db();
});

beforeEach(async () => {
  await resetDb();
  const user = await createUser();
  userId = user.id;
  await createCourse(userId, 'CHM031', 'Chemistry for Engineers');
  const account = await createIcsAccount(userId);
  accountId = account.id;
  await setAccountSecret(accountId, 'ics_url', FEED);
});

const baseFeed = icsDocument([
  {
    uid: 'bb-assignment-1@blackboard.example.edu',
    summary: 'CHM031 - Problem Set 3',
    description: 'Submit through Blackboard.',
    due: '20260901T155900Z',
    url: 'https://blackboard.example.edu/ultra/courses/_101_1/outline/assessment/123',
    lastModified: '20260820T090000Z',
  },
  {
    uid: 'bb-quiz-1@blackboard.example.edu',
    summary: 'CHM031 - Quiz 4: Stoichiometry',
    due: '20260903T060000Z',
  },
]);

describe('Blackboard iCalendar sync', () => {
  it('creates tasks on first run with inferred type and derived priority', async () => {
    const now = new Date('2026-08-26T01:00:00Z'); // 09:00 Manila
    const summary = await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(baseFeed),
      now,
    });

    expect(summary).toMatchObject({ seen: 2, created: 2, updated: 0, conflicts: 0 });

    const instance = await db();
    const rows = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    expect(rows).toHaveLength(2);

    const problemSet = rows.find((r) => r.title.includes('Problem Set'))!;
    expect(problemSet.status).toBe('inbox'); // never pre-marked submitted
    expect(problemSet.type).toBe('assignment');
    expect(problemSet.source).toBe('blackboard');
    expect(problemSet.courseId).not.toBeNull(); // matched CHM031
    expect(problemSet.sourceUrl).toContain('/assessment/123');

    const quiz = rows.find((r) => r.title.includes('Quiz 4'))!;
    expect(quiz.type).toBe('quiz');
    // Due 2026-09-03 → 8 calendar days out from 2026-08-26 → medium.
    expect(quiz.priority).toBe('medium');
  });

  it('is idempotent: a repeated sync creates no duplicate tasks or notifications', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    await syncBlackboardAccount(userId, accountId, { trigger: 'manual', fetcher: fetcherFor(baseFeed), now });
    const second = await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(baseFeed),
      now: new Date(now.getTime() + 60_000),
    });

    expect(second).toMatchObject({ seen: 2, created: 0, updated: 0, skipped: 2 });

    const instance = await db();
    expect(await instance.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(2);
    expect(await instance.select().from(externalRecords).where(eq(externalRecords.userId, userId))).toHaveLength(2);

    const events = await instance
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.userId, userId));
    expect(events).toHaveLength(2); // one per new item, not four
    expect(events.every((e) => e.kind === 'blackboard_new_item')).toBe(true);
  });

  it('runs ten times without drift', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    for (let i = 0; i < 10; i += 1) {
      await syncBlackboardAccount(userId, accountId, {
        trigger: 'manual',
        fetcher: fetcherFor(baseFeed),
        now: new Date(now.getTime() + i * 60_000),
      });
    }
    const instance = await db();
    expect(await instance.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(2);
    expect(
      await instance.select().from(notificationEvents).where(eq(notificationEvents.userId, userId)),
    ).toHaveLength(2);
  });

  it('updates a changed deadline, keeps user state, audits it, and notifies once', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    await syncBlackboardAccount(userId, accountId, { trigger: 'manual', fetcher: fetcherFor(baseFeed), now });

    const instance = await db();
    const before = (await instance.select().from(tasks).where(eq(tasks.userId, userId))).find((t) =>
      t.title.includes('Problem Set'),
    )!;

    // The student does their own thing with the task.
    await instance
      .update(tasks)
      .set({
        status: 'submitted',
        submittedAt: new Date(),
        priority: 'low',
        priorityOverridden: true,
        type: 'project',
        typeOverridden: true,
      })
      .where(eq(tasks.id, before.id));

    const movedFeed = icsDocument([
      {
        uid: 'bb-assignment-1@blackboard.example.edu',
        summary: 'CHM031 - Problem Set 3',
        description: 'Submit through Blackboard.',
        due: '20260905T155900Z', // moved
        url: 'https://blackboard.example.edu/ultra/courses/_101_1/outline/assessment/123',
        lastModified: '20260827T090000Z',
      },
      {
        uid: 'bb-quiz-1@blackboard.example.edu',
        summary: 'CHM031 - Quiz 4: Stoichiometry',
        due: '20260903T060000Z',
      },
    ]);

    const later = new Date('2026-08-27T01:00:00Z');
    const result = await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(movedFeed),
      now: later,
    });
    expect(result.updated).toBe(1);

    const after = (await instance.select().from(tasks).where(eq(tasks.id, before.id)))[0]!;
    expect(after.dueAt?.toISOString()).toBe('2026-09-05T15:59:00.000Z'); // source field updated
    expect(after.status).toBe('submitted'); // user state preserved
    expect(after.submittedAt).not.toBeNull();
    expect(after.priority).toBe('low'); // override preserved
    expect(after.type).toBe('project'); // pinned type preserved

    // Field-level audit entry exists.
    const changes = await instance.select().from(syncChanges).where(eq(syncChanges.entityId, before.id));
    const dueChange = changes.find((c) => c.field === 'dueAt')!;
    expect(dueChange.oldValue).toBe('2026-09-01T15:59:00.000Z');
    expect(dueChange.newValue).toBe('2026-09-05T15:59:00.000Z');

    // Exactly one deadline notification, and re-syncing the same change adds none.
    await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(movedFeed),
      now: new Date(later.getTime() + 60_000),
    });
    const dueEvents = await instance
      .select()
      .from(notificationEvents)
      .where(and(eq(notificationEvents.userId, userId), eq(notificationEvents.kind, 'blackboard_due_changed')));
    expect(dueEvents).toHaveLength(1);
  });

  it('never deletes a task that disappears from the feed', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    await syncBlackboardAccount(userId, accountId, { trigger: 'manual', fetcher: fetcherFor(baseFeed), now });

    const shrunk = icsDocument([
      { uid: 'bb-quiz-1@blackboard.example.edu', summary: 'CHM031 - Quiz 4: Stoichiometry', due: '20260903T060000Z' },
    ]);
    const result = await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(shrunk),
      now: new Date(now.getTime() + 60_000),
    });

    expect(result.missing).toBe(1);
    const instance = await db();
    expect(await instance.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(2);
    const flagged = (await instance.select().from(externalRecords).where(eq(externalRecords.userId, userId))).find(
      (r) => r.externalId === 'bb-assignment-1@blackboard.example.edu',
    )!;
    expect(flagged.missingSinceAt).not.toBeNull();
    expect(flagged.reviewReason).toBe('not_in_latest_feed');
  });

  it('raises a reviewable conflict instead of overwriting a locally edited title', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    await syncBlackboardAccount(userId, accountId, { trigger: 'manual', fetcher: fetcherFor(baseFeed), now });

    const instance = await db();
    const task = (await instance.select().from(tasks).where(eq(tasks.userId, userId))).find((t) =>
      t.title.includes('Problem Set'),
    )!;
    await instance.update(tasks).set({ title: 'Problem Set 3 — my working copy' }).where(eq(tasks.id, task.id));

    const renamed = icsDocument([
      {
        uid: 'bb-assignment-1@blackboard.example.edu',
        summary: 'CHM031 - Problem Set 3 (revised)',
        description: 'Submit through Blackboard.',
        due: '20260901T155900Z',
        url: 'https://blackboard.example.edu/ultra/courses/_101_1/outline/assessment/123',
      },
      { uid: 'bb-quiz-1@blackboard.example.edu', summary: 'CHM031 - Quiz 4: Stoichiometry', due: '20260903T060000Z' },
    ]);
    await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(renamed),
      now: new Date(now.getTime() + 60_000),
    });

    const after = (await instance.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    expect(after.title).toBe('Problem Set 3 — my working copy'); // local edit survives

    const open = await instance
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')));
    expect(open).toHaveLength(1);
    expect(open[0]!.field).toBe('title');
    expect(open[0]!.remoteValue).toContain('(revised)');

    // Resolving in favour of the remote applies it and closes the conflict.
    expect(await resolveConflict(userId, open[0]!.id, 'remote')).toBe(true);
    const resolved = (await instance.select().from(tasks).where(eq(tasks.id, task.id)))[0]!;
    expect(resolved.title).toBe('Problem Set 3 (revised)');
    const stillOpen = await instance
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')));
    expect(stillOpen).toHaveLength(0);
  });

  it('re-matches an item whose UID was regenerated instead of duplicating it', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    await syncBlackboardAccount(userId, accountId, { trigger: 'manual', fetcher: fetcherFor(baseFeed), now });

    // Feed drops the old UIDs and issues new ones for the same items.
    const rekeyed = icsDocument([
      {
        uid: 'bb-assignment-1-NEWID@blackboard.example.edu',
        summary: 'CHM031 - Problem Set 3',
        description: 'Submit through Blackboard.',
        due: '20260901T155900Z',
        url: 'https://blackboard.example.edu/ultra/courses/_101_1/outline/assessment/123',
      },
    ]);
    const result = await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(rekeyed),
      now: new Date(now.getTime() + 120_000),
    });

    const instance = await db();
    // Two syncs: the first marks the missing quiz, the assignment is re-matched.
    expect(result.created).toBe(0);
    expect(await instance.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(2);
    const records = await instance.select().from(externalRecords).where(eq(externalRecords.userId, userId));
    expect(records.map((r) => r.externalId)).toContain('bb-assignment-1-NEWID@blackboard.example.edu');
  });

  it('reuses a run for the same idempotency window and records failures safely', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    const failing = async (): Promise<SafeFetchResult> => {
      throw new Error(`getaddrinfo ENOTFOUND for ${FEED}`);
    };
    await expect(
      syncBlackboardAccount(userId, accountId, { trigger: 'manual', fetcher: failing, now }),
    ).rejects.toThrow();

    const instance = await db();
    const runs = await instance.select().from(syncRuns).where(eq(syncRuns.userId, userId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    // The private feed URL must never appear in a stored error.
    expect(runs[0]!.error).not.toContain('abcd1234efgh5678');
    expect(runs[0]!.error).not.toContain(FEED);
  });

  it('skips work entirely when the feed reports 304 Not Modified', async () => {
    const now = new Date('2026-08-26T01:00:00Z');
    await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: fetcherFor(baseFeed, { etag: 'W/"v1"' }),
      now,
    });
    const notModified = async (): Promise<SafeFetchResult> => ({
      finalUrl: FEED,
      status: 304,
      headers: {},
      body: '',
      bytes: 0,
      truncated: false,
    });
    const result = await syncBlackboardAccount(userId, accountId, {
      trigger: 'manual',
      fetcher: notModified,
      now: new Date(now.getTime() + 60_000),
    });
    expect(result.seen).toBe(0);
    expect(result.warnings.join(' ')).toContain('unchanged');
  });
});
