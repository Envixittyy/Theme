'use client';

import { enqueueMutation, flushQueue } from './offline-queue';

/**
 * The single client-side write path.
 *
 * Every mutation carries the session CSRF token and a client-generated
 * idempotency key, and degrades to the offline queue when the network is
 * unavailable. Callers get a discriminated result and are expected to reflect
 * `queued` in the UI rather than pretending the write landed.
 */

export type MutateResult<T> =
  | { ok: true; data: T; queued: false }
  | { ok: true; data: null; queued: true; label: string }
  | { ok: false; error: string; status: number; queued: false };

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function mutate<T = unknown>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  options: { label?: string; queueOffline?: boolean } = {},
): Promise<MutateResult<T>> {
  const idempotencyKey = newIdempotencyKey();
  const label = options.label ?? `${method} ${path}`;
  const queueOffline = options.queueOffline !== false;

  if (queueOffline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueueMutation({ method, path, body, idempotencyKey, label });
    return { ok: true, data: null, queued: true, label };
  }

  try {
    const response = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        'x-idempotency-key': idempotencyKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const payload = (await response.json()) as { error?: string; message?: string };
        message = payload.error ?? payload.message ?? message;
      } catch {
        /* keep the default */
      }
      return { ok: false, error: message, status: response.status, queued: false };
    }

    const data = response.status === 204 ? (null as T) : ((await response.json()) as T);
    return { ok: true, data, queued: false };
  } catch {
    if (!queueOffline) return { ok: false, error: 'Network unavailable', status: 0, queued: false };
    await enqueueMutation({ method, path, body, idempotencyKey, label });
    return { ok: true, data: null, queued: true, label };
  }
}

export async function replayQueue() {
  return flushQueue(csrfToken);
}

export async function apiGet<T>(path: string): Promise<{ data: T | null; offline: boolean }> {
  try {
    const response = await fetch(path, { headers: { accept: 'application/json' } });
    const offline = response.headers.get('x-mos-offline') === '1';
    if (!response.ok && !offline) return { data: null, offline: false };
    return { data: (await response.json()) as T, offline };
  } catch {
    return { data: null, offline: true };
  }
}
