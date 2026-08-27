import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createCourse, createUser, db, resetDb, setAccountSecret } from './helpers';
import { externalRecords, integrationAccounts, syncConflicts, tasks } from '@/lib/db/schema';
import { mergeFields, syncNotionAccount } from '@/lib/connectors/notion/sync';
import { DEFAULT_MAPPING, proposeMapping } from '@/lib/connectors/notion/mapping';
import type { NotionClient, NotionPage } from '@/lib/connectors/notion/client';
import { resolveConflict } from '@/lib/sync/engine';

/**
 * A fake Notion workspace: an in-memory page store that behaves the way the API
 * does in the ways that matter — ids are opaque, `last_edited_time` advances on
 * every write, and a query returns whatever is currently stored.
 */
class FakeNotion implements NotionClient {
  pages = new Map<string, NotionPage>();
  private clock = Date.parse('2026-08-26T00:00:00Z');
  writes: Array<{ pageId: string; properties: Record<string, unknown> }> = [];
  creates: Array<Record<string, unknown>> = [];

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  seed(id: string, properties: Record<string, unknown>): NotionPage {
    const page: NotionPage = {
      id,
      url: `https://notion.so/${id}`,
      created_time: this.tick(),
      last_edited_time: this.tick(),
      archived: false,
      properties: properties as NotionPage['properties'],
    };
    this.pages.set(id, page);
    return page;
  }

  /** Simulates a human editing the page in Notion. */
  editRemotely(id: string, properties: Record<string, unknown>): void {
    const page = this.pages.get(id)!;
    page.properties = { ...page.properties, ...properties } as NotionPage['properties'];
    page.last_edited_time = this.tick();
  }

  async listDatabases() {
    return [{ id: 'db1', title: 'Academic Tasks' }];
  }
  async getDatabase() {
    return { id: 'db1', title: [{ plain_text: 'Academic Tasks' }], properties: {} };
  }
  async queryDatabase() {
    return { pages: [...this.pages.values()], nextCursor: null };
  }
  async getPage(pageId: string) {
    return this.pages.get(pageId)!;
  }
  async createPage(_databaseId: string, properties: Record<string, unknown>) {
    this.creates.push(properties);
    const id = `page-${this.pages.size + 1}`;
    return this.seed(id, properties);
  }
  async updatePage(pageId: string, properties: Record<string, unknown>) {
    this.writes.push({ pageId, properties });
    const page = this.pages.get(pageId)!;
    page.properties = { ...page.properties, ...properties } as NotionPage['properties'];
    page.last_edited_time = this.tick();
    return page;
  }
  async archivePage(pageId: string) {
    const page = this.pages.get(pageId)!;
    page.archived = true;
    page.last_edited_time = this.tick();
    return page;
  }
}

const title = (text: string) => ({ title: [{ plain_text: text }] });
const select = (name: string | null) => ({ select: name ? { name } : null });
const date = (iso: string | null) => ({ date: iso ? { start: iso } : null });
const checkbox = (value: boolean) => ({ checkbox: value });
const richText = (text: string) => ({ rich_text: text ? [{ plain_text: text }] : [] });

let userId: string;
let accountId: string;
let notion: FakeNotion;

beforeAll(async () => {
  await db();
});

beforeEach(async () => {
  await resetDb();
  const user = await createUser();
  userId = user.id;
  await createCourse(userId, 'CHM031');
  const instance = await db();
  const [account] = await instance
    .insert(integrationAccounts)
    .values({
      userId,
      provider: 'notion',
      label: 'Test workspace',
      config: { databaseId: 'db1', mapping: DEFAULT_MAPPING, timeZone: 'Asia/Manila' },
    })
    .returning();
  accountId = account!.id;
  await setAccountSecret(accountId, 'access_token', 'ntn_testtoken');
  notion = new FakeNotion();
});

const sync = (options: Parameters<typeof syncNotionAccount>[2] = {}) =>
  syncNotionAccount(userId, accountId, { client: notion, trigger: 'manual', ...options });

describe('Notion pull', () => {
  it('creates a task from a Notion page', async () => {
    notion.seed('page-1', {
      Name: title('Reflection paper 2'),
      Status: select('Planned'),
      Priority: select('High'),
      Type: select('Assignment'),
      Due: date('2026-09-05T15:59:00.000Z'),
      Course: select('CHM031'),
      Submitted: checkbox(false),
      Notes: richText('Two pages.'),
    });

    const summary = await sync();
    expect(summary).toMatchObject({ created: 1, updated: 0 });

    const instance = await db();
    const rows = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Reflection paper 2',
      status: 'planned',
      priority: 'high',
      type: 'assignment',
      source: 'notion',
    });
    expect(rows[0]!.dueAt?.toISOString()).toBe('2026-09-05T15:59:00.000Z');
    expect(rows[0]!.courseId).not.toBeNull();
  });

  it('never invents Done or Submitted from an unrecognised status', async () => {
    notion.seed('page-1', {
      Name: title('Mystery status'),
      Status: select('Waiting on prof'), // not in the mapping
      Due: date('2026-09-05T15:59:00.000Z'),
    });
    await sync();

    const instance = await db();
    const [task] = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    expect(task!.status).toBe('inbox'); // not done, not submitted
    expect(task!.submittedAt).toBeNull();

    const [record] = await instance.select().from(externalRecords).where(eq(externalRecords.userId, userId));
    expect(record!.reviewReason).toContain('unmapped');
    expect(record!.reviewReason).toContain('Waiting on prof');
  });

  it('is idempotent — a repeated pull with no changes writes nothing', async () => {
    notion.seed('page-1', { Name: title('Stable'), Due: date('2026-09-05T15:59:00.000Z') });
    await sync();
    const second = await sync();
    const third = await sync();

    expect(second).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(third).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    const instance = await db();
    expect(await instance.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(1);
  });

  it('marks an archived page for review instead of deleting the task', async () => {
    notion.seed('page-1', { Name: title('Archived later'), Due: date('2026-09-05T15:59:00.000Z') });
    await sync();
    await notion.archivePage('page-1');
    const summary = await sync();

    expect(summary.missing).toBe(1);
    const instance = await db();
    expect(await instance.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(1);
    const [record] = await instance.select().from(externalRecords).where(eq(externalRecords.userId, userId));
    expect(record!.missingSinceAt).not.toBeNull();
    expect(record!.reviewReason).toBe('archived_in_notion');
  });
});

describe('Notion push', () => {
  it('creates a Notion page for a local task and does not re-create it', async () => {
    const instance = await db();
    await instance.insert(tasks).values({
      userId,
      title: 'Local only task',
      dueAt: new Date('2026-09-10T15:59:00.000Z'),
      status: 'planned',
    });

    await sync();
    expect(notion.creates).toHaveLength(1);
    await sync();
    expect(notion.creates).toHaveLength(1); // still one
  });

  it('pushes a local edit and then stops', async () => {
    notion.seed('page-1', { Name: title('Original'), Due: date('2026-09-05T15:59:00.000Z') });
    await sync();

    const instance = await db();
    const [task] = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    await instance
      .update(tasks)
      .set({ title: 'Renamed locally', revision: task!.revision + 1, lastWriteOrigin: 'local' })
      .where(eq(tasks.id, task!.id));

    await sync();
    expect(notion.writes).toHaveLength(1);
    expect(notion.writes[0]!.properties).toHaveProperty('Name');

    // The write echoes back as a remote change; it must not bounce.
    await sync();
    await sync();
    expect(notion.writes).toHaveLength(1);

    const [after] = await instance.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(after!.title).toBe('Renamed locally');
  });

  it('does not push a change that came from Notion in the first place', async () => {
    notion.seed('page-1', { Name: title('From Notion'), Due: date('2026-09-05T15:59:00.000Z') });
    await sync();
    notion.editRemotely('page-1', { Name: title('Edited in Notion') });
    await sync();

    const instance = await db();
    const [task] = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    expect(task!.title).toBe('Edited in Notion');
    expect(task!.lastWriteOrigin).toBe('notion');
    // No write back to Notion for a change Notion made.
    expect(notion.writes).toHaveLength(0);
  });
});

describe('Notion conflicts', () => {
  it('raises a conflict when both sides change the same field', async () => {
    notion.seed('page-1', { Name: title('Shared title'), Due: date('2026-09-05T15:59:00.000Z') });
    await sync();

    const instance = await db();
    const [task] = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    await instance
      .update(tasks)
      .set({ title: 'My local title', revision: task!.revision + 1, lastWriteOrigin: 'local' })
      .where(eq(tasks.id, task!.id));
    notion.editRemotely('page-1', { Name: title('Their Notion title') });

    const summary = await sync();
    expect(summary.conflicts).toBe(1);

    const open = await instance
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      field: 'title',
      localValue: 'My local title',
      remoteValue: 'Their Notion title',
      baseValue: 'Shared title',
    });

    // The local value stands until a human chooses.
    const [held] = await instance.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(held!.title).toBe('My local title');

    // Resolving in favour of Notion applies it and closes the conflict.
    await resolveConflict(userId, open[0]!.id, 'remote');
    const [resolved] = await instance.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(resolved!.title).toBe('Their Notion title');
    const stillOpen = await instance
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.state, 'open')));
    expect(stillOpen).toHaveLength(0);
  });

  it('merges non-overlapping changes from both sides without a conflict', async () => {
    notion.seed('page-1', {
      Name: title('Shared'),
      Due: date('2026-09-05T15:59:00.000Z'),
      Priority: select('Medium'),
    });
    await sync();

    const instance = await db();
    const [task] = await instance.select().from(tasks).where(eq(tasks.userId, userId));
    // Local changes the title; Notion changes the priority.
    await instance
      .update(tasks)
      .set({ title: 'Local title', revision: task!.revision + 1, lastWriteOrigin: 'local' })
      .where(eq(tasks.id, task!.id));
    notion.editRemotely('page-1', { Priority: select('Urgent') });

    const summary = await sync();
    expect(summary.conflicts).toBe(0);

    const [after] = await instance.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(after!.title).toBe('Local title'); // local kept
    expect(after!.priority).toBe('urgent'); // remote applied
    expect(notion.writes.length).toBeGreaterThan(0); // and the title went out
  });
});

describe('three-way merge', () => {
  const base = { title: 'A', dueAt: '2026-09-01T00:00:00.000Z', status: 'planned' };

  it('applies a remote-only change', () => {
    const result = mergeFields({ ...base }, { ...base, title: 'B' }, base);
    expect(result.apply).toEqual({ title: 'B' });
    expect(result.conflicts).toHaveLength(0);
  });

  it('pushes a local-only change', () => {
    const result = mergeFields({ ...base, title: 'C' }, { ...base }, base);
    expect(result.push).toEqual({ title: 'C' });
    expect(result.apply).toEqual({});
  });

  it('reports a conflict when both moved differently', () => {
    const result = mergeFields({ ...base, title: 'C' }, { ...base, title: 'B' }, base);
    expect(result.conflicts).toEqual([{ field: 'title', local: 'C', remote: 'B', base: 'A' }]);
  });

  it('says nothing when both moved to the same value', () => {
    const result = mergeFields({ ...base, title: 'Same' }, { ...base, title: 'Same' }, base);
    expect(result.conflicts).toHaveLength(0);
    expect(result.apply).toEqual({});
    expect(result.push).toEqual({});
  });

  it('ignores a field the mapping does not cover', () => {
    // `notes` is undefined on the remote side: not mapped, so out of scope.
    const result = mergeFields({ ...base, notes: 'local note' }, { ...base }, base);
    expect(result.push).toEqual({});
    expect(result.conflicts).toHaveLength(0);
  });

  it('treats empty string and null as the same absence', () => {
    const result = mergeFields({ ...base, notes: '' }, { ...base, notes: null }, { ...base, notes: null });
    expect(result.conflicts).toHaveLength(0);
    expect(result.apply).toEqual({});
  });
});

describe('mapping proposal', () => {
  it('matches properties by name and type, and admits what it cannot match', () => {
    const { mapping, matched, unmatched } = proposeMapping({
      Name: { name: 'Name', type: 'title' },
      Course: { name: 'Course', type: 'select' },
      'Due date': { name: 'Due date', type: 'date' },
      Status: { name: 'Status', type: 'status' },
      Vibes: { name: 'Vibes', type: 'select' },
    });
    expect(mapping.title).toBe('Name');
    expect(mapping.course).toBe('Course');
    expect(mapping.dueDate).toBe('Due date');
    expect(mapping.status).toBe('Status');
    expect(matched).toContain('dueDate');
    // Nothing sensible for these, so they are left alone rather than guessed.
    expect(unmatched).toContain('submitted');
    expect(unmatched).toContain('sourceUrl');
  });
});
