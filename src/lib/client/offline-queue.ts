'use client';

import { openDB, type IDBPDatabase } from 'idb';

/**
 * Offline mutation queue.
 *
 * Mutations made without a network are appended here and replayed, in order,
 * when connectivity returns. The queue lives in IndexedDB rather than in the
 * service worker's Background Sync so that its contents are *visible*: the UI
 * can show "3 changes pending" and let the student inspect or discard them,
 * which is the difference between trustworthy offline support and silent
 * data loss.
 */

export type QueuedMutation = {
  id?: number;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body: unknown;
  /** Client-generated; the server uses it to reject a replayed duplicate. */
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  state: 'pending' | 'failed' | 'conflict';
  /** Short human label so the pending list reads like actions, not requests. */
  label: string;
};

const DB_NAME = 'mapua-school-os';
const DB_VERSION = 1;
const STORE = 'mutations';
const SNAPSHOT = 'snapshots';

let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('state', 'state');
      }
      if (!db.objectStoreNames.contains(SNAPSHOT)) {
        db.createObjectStore(SNAPSHOT, { keyPath: 'key' });
      }
    },
  });
  return dbPromise;
}

export async function enqueueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'attempts' | 'state'>): Promise<number> {
  const db = await database();
  return (await db.add(STORE, {
    ...mutation,
    createdAt: Date.now(),
    attempts: 0,
    state: 'pending' as const,
  })) as number;
}

export async function listMutations(): Promise<QueuedMutation[]> {
  const db = await database();
  const all = (await db.getAll(STORE)) as QueuedMutation[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  return (await listMutations()).filter((m) => m.state === 'pending').length;
}

export async function discardMutation(id: number): Promise<void> {
  const db = await database();
  await db.delete(STORE, id);
}

export async function clearFailed(): Promise<void> {
  const db = await database();
  for (const m of await listMutations()) {
    if (m.state !== 'pending' && m.id !== undefined) await db.delete(STORE, m.id);
  }
}

export type FlushResult = { sent: number; failed: number; remaining: number };

/**
 * Replay pending mutations oldest-first.
 *
 * Stops at the first *network* failure (the connection went away again) but
 * keeps going past a *rejection*: a 409/422 is a permanent answer about that
 * one change and is parked as `failed`/`conflict` for the student to look at,
 * rather than blocking everything behind it.
 */
export async function flushQueue(csrfToken: string | null): Promise<FlushResult> {
  const db = await database();
  const queue = (await listMutations()).filter((m) => m.state === 'pending');
  let sent = 0;
  let failed = 0;

  for (const mutation of queue) {
    try {
      const response = await fetch(mutation.path, {
        method: mutation.method,
        headers: {
          'content-type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          'x-idempotency-key': mutation.idempotencyKey,
        },
        body: mutation.body === undefined ? undefined : JSON.stringify(mutation.body),
      });

      if (response.ok || response.status === 409) {
        // 409 means the server already applied this idempotency key.
        if (mutation.id !== undefined) await db.delete(STORE, mutation.id);
        sent += 1;
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        const detail = await response.text();
        await db.put(STORE, {
          ...mutation,
          state: response.status === 422 ? 'conflict' : 'failed',
          attempts: mutation.attempts + 1,
          lastError: detail.slice(0, 300),
        });
        failed += 1;
        continue;
      }

      // 5xx: keep it pending and stop; the server is unwell, not the change.
      await db.put(STORE, { ...mutation, attempts: mutation.attempts + 1, lastError: `server ${response.status}` });
      break;
    } catch {
      // Network died mid-flush; leave the rest queued.
      break;
    }
  }

  const remaining = (await listMutations()).filter((m) => m.state === 'pending').length;
  return { sent, failed, remaining };
}

/* -------------------------- offline read snapshots ------------------------- */

export async function putSnapshot(key: string, value: unknown): Promise<void> {
  const db = await database();
  await db.put(SNAPSHOT, { key, value, savedAt: Date.now() });
}

export async function getSnapshot<T>(key: string): Promise<{ value: T; savedAt: number } | null> {
  const db = await database();
  const row = (await db.get(SNAPSHOT, key)) as { value: T; savedAt: number } | undefined;
  return row ?? null;
}
