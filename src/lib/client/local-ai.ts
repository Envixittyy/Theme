'use client';

import {
  EXTRACTION_SYSTEM_PROMPT,
  parseExtractedTask,
  type BridgeGenerateRequest,
  type BridgeScope,
  type ExtractedTask,
} from '@/lib/connectors/localai/protocol';

/**
 * Browser side of the local AI bridge.
 *
 * All of it runs in the page: the server is never in the path, which is what
 * makes "your coursework text stays on your machine" true rather than a policy.
 * Every call is time-boxed, and any failure resolves to `offline` so the caller
 * can fall back rather than hang.
 */

const TOKEN_KEY = 'mos.bridgeToken';

export function getBridgeLocalToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setBridgeLocalToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the token simply will not persist */
  }
}

export function bridgeUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export type BridgeState =
  | { state: 'connected'; model: string; provider: string; scopes: BridgeScope[]; endpointHint: string }
  | { state: 'offline'; reason: string };

export async function bridgeStatus(port = 4319): Promise<BridgeState> {
  try {
    const response = await fetch(`${bridgeUrl(port)}/status`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { state: 'offline', reason: `bridge responded ${response.status}` };
    const payload = (await response.json()) as BridgeState;
    return payload;
  } catch {
    return { state: 'offline', reason: 'no bridge is running on this computer' };
  }
}

export async function bridgeGenerate(
  request: BridgeGenerateRequest,
  port = 4319,
): Promise<{ ok: true; text: string; elapsedMs: number } | { ok: false; error: string }> {
  const token = getBridgeLocalToken();
  if (!token) return { ok: false, error: 'This browser has no bridge token yet. Add it in Settings → Local AI.' };
  try {
    const response = await fetch(`${bridgeUrl(port)}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: payload.error ?? `bridge responded ${response.status}` };
    }
    const payload = (await response.json()) as { text: string; elapsedMs: number };
    return { ok: true, text: payload.text, elapsedMs: payload.elapsedMs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'the bridge did not answer' };
  }
}

/** Builds the exact prompt the UI shows before anything is sent. */
export function buildExtractionPrompt(text: string, courseCodes: string[], nowIso: string, timeZone: string): string {
  return [
    `Today is ${nowIso} (${timeZone}).`,
    courseCodes.length ? `Known course codes: ${courseCodes.join(', ')}.` : 'No course codes are known.',
    '',
    'Coursework text:',
    '"""',
    text.slice(0, 6000),
    '"""',
  ].join('\n');
}

export async function extractTask(
  text: string,
  courseCodes: string[],
  timeZone: string,
  port = 4319,
): Promise<{ ok: true; task: ExtractedTask; prompt: string } | { ok: false; error: string; prompt: string }> {
  const prompt = buildExtractionPrompt(text, courseCodes, new Date().toISOString(), timeZone);
  const result = await bridgeGenerate(
    { scope: 'task.extract', prompt, system: EXTRACTION_SYSTEM_PROMPT, maxTokens: 700, temperature: 0.1 },
    port,
  );
  if (!result.ok) return { ok: false, error: result.error, prompt };
  const task = parseExtractedTask(result.text);
  if (!task) return { ok: false, error: 'The model did not return a usable task.', prompt };
  return { ok: true, task, prompt };
}

export async function summarize(text: string, port = 4319): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const result = await bridgeGenerate(
    {
      scope: 'summarize',
      system: 'Summarise the text in at most four short bullet points. Do not add facts that are not present.',
      prompt: text.slice(0, 8000),
      maxTokens: 400,
      temperature: 0.2,
    },
    port,
  );
  return result.ok ? { ok: true, text: result.text.trim() } : { ok: false, error: result.error };
}

export async function studyPlan(
  tasks: Array<{ title: string; dueAt: string | null; estimateMinutes: number | null; course: string | null }>,
  availableHours: number,
  port = 4319,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const lines = tasks.map(
    (t) =>
      `- ${t.title}${t.course ? ` [${t.course}]` : ''}${t.dueAt ? ` due ${t.dueAt}` : ' (no deadline)'}${
        t.estimateMinutes ? ` ~${t.estimateMinutes}m` : ''
      }`,
  );
  const result = await bridgeGenerate(
    {
      scope: 'plan',
      system:
        'Propose a realistic study plan. Respect the stated deadlines and the available time. Do not invent deadlines. Keep it under 200 words.',
      prompt: [`Available time: ${availableHours} hours.`, 'Tasks:', ...lines].join('\n'),
      maxTokens: 500,
      temperature: 0.3,
    },
    port,
  );
  return result.ok ? { ok: true, text: result.text.trim() } : { ok: false, error: result.error };
}
