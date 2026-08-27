import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCourse, createUser, db, resetDb } from './helpers';
import { jobs, tasks } from '@/lib/db/schema';
import { backoffMs, claimNext, completeJob, enqueue, failJob, listDeadLetters, reclaimStalled, retryJob } from '@/lib/jobs/queue';
import {
  completeTask,
  createTask,
  duplicateTask,
  reopenTask,
  statusTimestamps,
  submitTask,
  updateTask,
} from '@/lib/domain/tasks';
import {
  ALLOWED_CONTENT_TYPES,
  assertAcceptableUpload,
  AttachmentRejected,
  inspectBytes,
  newStorageKey,
  sanitizeFileName,
} from '@/lib/connectors/storage';

let userId: string;
const ctx = () => ({ userId, actor: `user:${userId}` as const, origin: 'local', timeZone: 'Asia/Manila' });

beforeAll(async () => {
  await db();
});

beforeEach(async () => {
  await resetDb();
  userId = (await createUser()).id;
  await createCourse(userId, 'CHM031');
});

describe('job queue', () => {
  it('does not enqueue the same idempotency key twice', async () => {
    const first = await enqueue('blackboard.sync', { accountId: 'a' }, { userId, idempotencyKey: 'poll:1' });
    const second = await enqueue('blackboard.sync', { accountId: 'a' }, { userId, idempotencyKey: 'poll:1' });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    const instance = await db();
    expect(await instance.select().from(jobs)).toHaveLength(1);
  });

  it('claims one job at a time and marks it running', async () => {
    await enqueue('maintenance.prune', {}, { userId });
    const claimed = await claimNext('worker-1');
    expect(claimed?.state).toBe('running');
    expect(claimed?.attempts).toBe(1);
    // Nothing left to claim.
    expect(await claimNext('worker-2')).toBeNull();
  });

  it('serialises jobs that share a lock key', async () => {
    await enqueue('blackboard.sync', { accountId: 'a' }, { userId, lockKey: 'bb:a', idempotencyKey: 'k1' });
    await enqueue('blackboard.sync', { accountId: 'a' }, { userId, lockKey: 'bb:a', idempotencyKey: 'k2' });
    await enqueue('notion.pull', { accountId: 'b' }, { userId, lockKey: 'notion:b', idempotencyKey: 'k3' });

    const first = await claimNext('worker-1');
    expect(first?.lockKey).toBe('bb:a');

    // The second bb job is blocked, but the notion job is free to run.
    const second = await claimNext('worker-2');
    expect(second?.lockKey).toBe('notion:b');
    expect(await claimNext('worker-3')).toBeNull();

    await completeJob(first!.id);
    const third = await claimNext('worker-4');
    expect(third?.lockKey).toBe('bb:a');
  });

  it('retries with backoff, then dead-letters', async () => {
    await enqueue('maintenance.prune', {}, { userId, maxAttempts: 2 });

    const first = await claimNext('w');
    await failJob(first!, new Error('boom'));
    const instance = await db();
    let row = (await instance.select().from(jobs).where(eq(jobs.id, first!.id)))[0]!;
    expect(row.state).toBe('queued');
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now()); // backed off
    expect(row.lastError).toContain('boom');

    // Force it runnable again and exhaust the attempts.
    await instance.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, first!.id));
    const second = await claimNext('w');
    await failJob(second!, new Error('boom again'));
    row = (await instance.select().from(jobs).where(eq(jobs.id, first!.id)))[0]!;
    expect(row.state).toBe('dead');

    const dead = await listDeadLetters(userId);
    expect(dead).toHaveLength(1);
    expect(await retryJob(userId, dead[0]!.id)).toBe(true);
    row = (await instance.select().from(jobs).where(eq(jobs.id, first!.id)))[0]!;
    expect(row.state).toBe('queued');
    expect(row.attempts).toBe(0);
  });

  it('grows the backoff and keeps it bounded', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(5));
    expect(backoffMs(20)).toBeLessThanOrEqual(15 * 60_000 * 1.25);
  });

  it('returns a stalled job to the queue', async () => {
    await enqueue('maintenance.prune', {}, { userId });
    const claimed = await claimNext('crashed-worker');
    const instance = await db();
    await instance
      .update(jobs)
      .set({ lockedAt: new Date(Date.now() - 3600_000) })
      .where(eq(jobs.id, claimed!.id));

    expect(await reclaimStalled(60_000)).toBe(1);
    expect((await claimNext('healthy-worker'))?.id).toBe(claimed!.id);
  });

  it('never lets one user retry another user’s dead job', async () => {
    const other = await createUser('other@example.edu');
    await enqueue('maintenance.prune', {}, { userId, maxAttempts: 1 });
    const claimed = await claimNext('w');
    await failJob(claimed!, new Error('nope'));
    expect(await retryJob(other.id, claimed!.id)).toBe(false);
  });
});

describe('task status semantics', () => {
  const base = { completedAt: null, submittedAt: null, archivedAt: null };
  const now = new Date('2026-08-26T00:00:00Z');

  it('treats submitted and done as different facts', () => {
    const submitted = statusTimestamps('submitted', base, now);
    expect(submitted.submittedAt).toEqual(now);
    expect(submitted.completedAt).toBeNull();

    const done = statusTimestamps('done', base, now);
    expect(done.completedAt).toEqual(now);
    expect(done.submittedAt).toBeNull();
  });

  it('keeps the submission record when work is reopened', () => {
    const afterSubmit = statusTimestamps('submitted', base, now);
    const reopened = statusTimestamps('planned', afterSubmit, now);
    expect(reopened.submittedAt).toEqual(now); // the work really was handed in
    expect(reopened.completedAt).toBeNull();
  });

  it('does not overwrite an existing completion timestamp', () => {
    const earlier = new Date('2026-08-01T00:00:00Z');
    const result = statusTimestamps('done', { ...base, completedAt: earlier }, now);
    expect(result.completedAt).toEqual(earlier);
  });

  it('records the transition through the real service', async () => {
    const task = await createTask(
      { title: 'Essay', description: '', status: 'inbox', type: 'assignment', allDay: false, tags: [], subtasks: [], reminders: [] },
      ctx(),
    );

    const submitted = await submitTask(task.id, ctx());
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.completedAt).toBeNull();

    const done = await completeTask(task.id, ctx());
    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();

    const reopened = await reopenTask(task.id, ctx());
    expect(reopened.status).toBe('planned');
    expect(reopened.completedAt).toBeNull();
    expect(reopened.submittedAt).not.toBeNull();
  });

  it('marks priority as overridden only when the user sets it', async () => {
    const task = await createTask(
      {
        title: 'Auto priority',
        description: '',
        status: 'inbox',
        type: 'assignment',
        allDay: false,
        dueAt: new Date('2026-12-01T00:00:00Z').toISOString(),
        tags: [],
        subtasks: [],
        reminders: [],
      },
      ctx(),
    );
    expect(task.priorityOverridden).toBe(false);

    const edited = await updateTask(task.id, { priority: 'urgent' }, ctx());
    expect(edited.priorityOverridden).toBe(true);
    expect(edited.priority).toBe('urgent');
  });

  it('recomputes priority from a new deadline unless the user pinned it', async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + 2 * 86_400_000).toISOString();
    const far = new Date(now.getTime() + 40 * 86_400_000).toISOString();

    const task = await createTask(
      { title: 'Moving deadline', description: '', status: 'inbox', type: 'assignment', allDay: false, dueAt: far, tags: [], subtasks: [], reminders: [] },
      ctx(),
    );
    expect(task.priority).toBe('low');

    const moved = await updateTask(task.id, { dueAt: soon }, ctx());
    expect(moved.priority).toBe('high');

    const pinned = await updateTask(moved.id, { priority: 'low' }, ctx());
    const movedAgain = await updateTask(pinned.id, { dueAt: far }, ctx());
    expect(movedAgain.priority).toBe('low'); // the pin holds
  });

  it('duplicates a task into the inbox without its reminders', async () => {
    const original = await createTask(
      {
        title: 'Group project',
        description: 'notes',
        status: 'in_progress',
        type: 'project',
        allDay: false,
        tags: ['group'],
        subtasks: ['Outline', 'Draft'],
        reminders: [60],
      },
      ctx(),
    );
    const copy = await duplicateTask(original.id, ctx());
    expect(copy.title).toBe('Group project (copy)');
    expect(copy.status).toBe('inbox');
    expect(copy.id).not.toBe(original.id);

    const instance = await db();
    const all = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    expect(all).toHaveLength(2);
  });
});

describe('attachment validation', () => {
  it('accepts the documented types and rejects everything else', () => {
    expect(() => assertAcceptableUpload('application/pdf', 1000)).not.toThrow();
    expect(() => assertAcceptableUpload('application/x-msdownload', 1000)).toThrow(AttachmentRejected);
    expect(() => assertAcceptableUpload('text/html', 1000)).toThrow(AttachmentRejected);
    expect(ALLOWED_CONTENT_TYPES.has('image/png')).toBe(true);
  });

  it('rejects empty and oversized files', () => {
    expect(() => assertAcceptableUpload('application/pdf', 0)).toThrow(/empty/);
    expect(() => assertAcceptableUpload('application/pdf', 999_000_000)).toThrow(/under/);
  });

  it('neutralises hostile filenames', () => {
    expect(sanitizeFileName('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFileName('..\\..\\windows\\system32')).not.toContain('\\');
    expect(sanitizeFileName('.hidden')).not.toMatch(/^\./);
    // A right-to-left override makes ".exe" look like ".png" in a file list.
    const spoofed = `report${String.fromCharCode(0x202e)}gnp.exe`;
    expect(sanitizeFileName(spoofed)).toBe('reportgnp.exe');
    expect(sanitizeFileName(`a${String.fromCharCode(0)}b.pdf`)).toBe('ab.pdf');
    expect(sanitizeFileName('')).toBe('attachment');
    expect(sanitizeFileName('x'.repeat(400)).length).toBeLessThanOrEqual(121);
  });

  it('generates opaque, unguessable storage keys', () => {
    const a = newStorageKey('user-1');
    const b = newStorageKey('user-1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^u\/[0-9a-f]{4}\/[0-9a-f]{48}$/);
    expect(a).not.toContain('user-1');
  });

  it('rejects executables however they are labelled', () => {
    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(inspectBytes(mz, 'application/pdf').state).toBe('rejected');
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(inspectBytes(elf, 'image/png').state).toBe('rejected');
  });

  it('rejects content that contradicts its declared type', () => {
    const notAPdf = Buffer.from('<html><script>alert(1)</script>', 'utf8');
    expect(inspectBytes(notAPdf, 'application/pdf').state).toBe('rejected');
  });

  it('accepts genuine files and says scanning is signature-only', () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);
    const verdict = inspectBytes(pdf, 'application/pdf');
    expect(verdict.state).toBe('clean');
    expect(verdict.detail).toMatch(/no antivirus/i);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectBytes(png, 'image/png').state).toBe('clean');
  });
});
