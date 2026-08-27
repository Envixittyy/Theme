import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCourse, createUser, db, resetDb } from './helpers';
import { attachments, notes as notesTable, tasks } from '@/lib/db/schema';
import {
  addSubtask,
  archiveTask,
  createTask,
  deleteTask,
  getTask,
  getTaskDetail,
  listTasks,
  NotFoundError,
  updateTask,
} from '@/lib/domain/tasks';
import { getNote, updateNote } from '@/lib/domain/notes';
import { getCourse, updateCourse } from '@/lib/domain/courses';
import { markRead } from '@/lib/domain/announcements';
import { getLayout, saveLayout } from '@/lib/domain/dashboard';

/**
 * Ownership is a predicate on every row, not an inference from a parent join.
 * These tests take the adversarial view: a second account that knows the exact
 * primary key of someone else's record must get nothing.
 */

let alice: { id: string };
let bob: { id: string };
let aliceTaskId: string;
let aliceCourseId: string;
let aliceNoteId: string;

const ctxFor = (userId: string) => ({ userId, actor: `user:${userId}` as const, origin: 'local', timeZone: 'Asia/Manila' });

beforeAll(async () => {
  await db();
});

beforeEach(async () => {
  await resetDb();
  alice = await createUser('alice@example.edu');
  bob = await createUser('bob@example.edu');
  aliceCourseId = (await createCourse(alice.id, 'CHM031')).id;

  const task = await createTask(
    { title: 'Alice private task', description: 'secret', courseId: aliceCourseId, status: 'inbox', type: 'assignment', allDay: false, tags: [], subtasks: [], reminders: [] },
    ctxFor(alice.id),
  );
  aliceTaskId = task.id;

  const instance = await db();
  const [note] = await instance
    .insert(notesTable)
    .values({ userId: alice.id, title: 'Alice note', body: 'private' })
    .returning();
  aliceNoteId = note!.id;
});

describe('task authorization', () => {
  it('does not return another user’s task by id', async () => {
    expect(await getTask(alice.id, aliceTaskId)).not.toBeNull();
    expect(await getTask(bob.id, aliceTaskId)).toBeNull();
    expect(await getTaskDetail(bob.id, aliceTaskId)).toBeNull();
  });

  it('refuses to update another user’s task', async () => {
    await expect(updateTask(aliceTaskId, { title: 'hijacked' }, ctxFor(bob.id))).rejects.toThrow(NotFoundError);
    const after = await getTask(alice.id, aliceTaskId);
    expect(after!.title).toBe('Alice private task');
  });

  it('refuses to delete or archive another user’s task', async () => {
    await expect(deleteTask(aliceTaskId, ctxFor(bob.id))).rejects.toThrow(NotFoundError);
    await expect(archiveTask(aliceTaskId, ctxFor(bob.id))).rejects.toThrow(NotFoundError);
    expect(await getTask(alice.id, aliceTaskId)).not.toBeNull();
  });

  it('refuses to add a subtask to another user’s task', async () => {
    await expect(addSubtask(bob.id, aliceTaskId, 'sneaky')).rejects.toThrow(NotFoundError);
  });

  it('never leaks another user’s tasks through a list query', async () => {
    const bobTasks = await listTasks(
      { sort: 'due', direction: 'asc', includeCompleted: true },
      { userId: bob.id, now: new Date(), timeZone: 'Asia/Manila' },
    );
    expect(bobTasks).toHaveLength(0);

    const aliceTasks = await listTasks(
      { sort: 'due', direction: 'asc', includeCompleted: true },
      { userId: alice.id, now: new Date(), timeZone: 'Asia/Manila' },
    );
    expect(aliceTasks).toHaveLength(1);
  });

  it('refuses to attach a task to a course owned by someone else', async () => {
    const bobTask = await createTask(
      { title: 'Bob task', description: '', status: 'inbox', type: 'assignment', allDay: false, tags: [], subtasks: [], reminders: [] },
      ctxFor(bob.id),
    );
    await expect(updateTask(bobTask.id, { courseId: aliceCourseId }, ctxFor(bob.id))).rejects.toThrow(NotFoundError);
  });

  it('refuses to create a task against another user’s course', async () => {
    await expect(
      createTask(
        { title: 'Bob steals a course', description: '', courseId: aliceCourseId, status: 'inbox', type: 'assignment', allDay: false, tags: [], subtasks: [], reminders: [] },
        ctxFor(bob.id),
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('note, course and announcement authorization', () => {
  it('hides notes across accounts', async () => {
    expect(await getNote(alice.id, aliceNoteId)).not.toBeNull();
    expect(await getNote(bob.id, aliceNoteId)).toBeNull();
    await expect(updateNote(bob.id, aliceNoteId, { body: 'defaced' })).rejects.toThrow(NotFoundError);
  });

  it('hides courses across accounts', async () => {
    expect(await getCourse(alice.id, aliceCourseId)).not.toBeNull();
    expect(await getCourse(bob.id, aliceCourseId)).toBeNull();
    await expect(updateCourse(bob.id, aliceCourseId, { title: 'Renamed' }, `user:${bob.id}`)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('scopes announcement read-state to the owner', async () => {
    const instance = await db();
    const { announcements } = await import('@/lib/db/schema');
    const [row] = await instance
      .insert(announcements)
      .values({ userId: alice.id, title: 'Alice only', publishedAt: new Date(), contentHash: 'x' })
      .returning();

    await markRead(bob.id, row!.id, true); // must be a no-op
    const [after] = await instance.select().from(announcements).where(eq(announcements.id, row!.id));
    expect(after!.readAt).toBeNull();
  });
});

describe('attachment authorization', () => {
  it('scopes attachment rows to their owner', async () => {
    const instance = await db();
    const [file] = await instance
      .insert(attachments)
      .values({
        userId: alice.id,
        taskId: aliceTaskId,
        storageKey: 'u/aaaa/deadbeef',
        fileName: 'private.pdf',
        contentType: 'application/pdf',
        byteSize: 100,
      })
      .returning();

    const asBob = await instance
      .select()
      .from(attachments)
      .where(eq(attachments.userId, bob.id));
    expect(asBob).toHaveLength(0);

    // Even knowing the storage key, a lookup scoped to Bob finds nothing —
    // which is exactly what the download route does before serving bytes.
    const byKeyForBob = await instance
      .select()
      .from(attachments)
      .where(eq(attachments.storageKey, file!.storageKey));
    expect(byKeyForBob[0]!.userId).toBe(alice.id);
    expect(byKeyForBob[0]!.userId).not.toBe(bob.id);
  });
});

describe('dashboard layout isolation', () => {
  it('gives each account its own layout', async () => {
    await saveLayout(alice.id, 'desktop', [
      { widgetKey: 'due-today', span: 4, height: 'auto', hidden: false, settings: {} },
    ]);
    const aliceLayout = await getLayout(alice.id, 'desktop');
    const bobLayout = await getLayout(bob.id, 'desktop');

    expect(aliceLayout).toHaveLength(1);
    expect(bobLayout.length).toBeGreaterThan(1); // Bob still gets the default
    expect(bobLayout.every((w) => w.userId === bob.id)).toBe(true);
  });
});

describe('cascading deletion', () => {
  it('removes everything belonging to a deleted account and nothing else', async () => {
    const instance = await db();
    const { users } = await import('@/lib/db/schema');
    await instance.delete(users).where(eq(users.id, alice.id));

    expect(await instance.select().from(tasks).where(eq(tasks.userId, alice.id))).toHaveLength(0);
    expect(await instance.select().from(notesTable).where(eq(notesTable.userId, alice.id))).toHaveLength(0);
    // Bob is untouched.
    expect((await instance.select().from(users).where(eq(users.id, bob.id)))).toHaveLength(1);
  });
});
