/**
 * Local AI bridge protocol (v1).
 *
 * The problem: the app is cloud-hosted, the model runs on the student's own
 * machine, and the production server must never try to reach `localhost` — on a
 * server that address means *the server*, which is both useless and a nice SSRF
 * primitive. So the browser is the only party that talks to the bridge, over
 * the loopback interface of the machine the student is sitting at.
 *
 *   ┌────────┐   pairing code    ┌───────────┐
 *   │ Server │◄──────────────────│  Browser  │
 *   └────────┘   scoped token    └───────────┘
 *        ▲                              │ HTTP to 127.0.0.1:4319
 *        │ device registry,             ▼
 *        │ audit, revocation      ┌───────────┐      ┌────────┐
 *        └───────────────────────►│  Bridge   │─────►│ Ollama │
 *                                 └───────────┘      └────────┘
 *
 * Pairing:
 *   1. The student asks the app for a pairing code. The server stores only its
 *      hash and an expiry (10 minutes, single use).
 *   2. They type the code into the bridge running on their computer.
 *   3. The bridge posts the code to the server, which returns a device token
 *      bound to that user and to a narrow scope list. The server never learns
 *      the model endpoint, and the bridge never learns the session cookie.
 *   4. The bridge prints a local URL and token for the browser to use.
 *
 * Every request the browser makes to the bridge carries the device token; the
 * bridge refuses requests whose Origin is not the configured app origin, so a
 * random web page cannot drive the student's model.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_BRIDGE_PORT = 4319;

export type BridgeScope =
  | 'task.extract' // turn pasted text into a proposed task
  | 'summarize' // summarise a note or announcement
  | 'plan' // propose a study plan for selected tasks
  | 'search'; // semantic search over notes the user selected

export const ALL_SCOPES: BridgeScope[] = ['task.extract', 'summarize', 'plan', 'search'];

export const SCOPE_DESCRIPTIONS: Record<BridgeScope, { label: string; sends: string }> = {
  'task.extract': {
    label: 'Turn pasted text into a task',
    sends: 'Only the text you paste into the box, plus your course codes so it can match one.',
  },
  summarize: {
    label: 'Summarise a note or announcement',
    sends: 'The single note or announcement you choose, at the moment you choose it.',
  },
  plan: {
    label: 'Suggest a study plan',
    sends: 'Titles, deadlines and estimates of the tasks you select. No note or attachment contents.',
  },
  search: {
    label: 'Search notes by meaning',
    sends: 'Only notes you have explicitly enabled for local indexing.',
  },
};

/* ----------------------------- wire messages ----------------------------- */

export type BridgeHello = {
  protocol: number;
  bridgeVersion: string;
  provider: 'ollama' | 'openai-compatible';
  model: string;
  /** Never sent to the cloud server; shown in the browser only. */
  endpointHint: string;
  scopes: BridgeScope[];
};

export type BridgeClaimRequest = {
  code: string;
  bridgeVersion: string;
  provider: string;
  model: string;
  scopes: BridgeScope[];
};

export type BridgeClaimResponse = {
  deviceToken: string;
  deviceId: string;
  userLabel: string;
  scopes: BridgeScope[];
};

export type BridgeGenerateRequest = {
  scope: BridgeScope;
  /** The exact text that will be sent to the model — the UI shows this first. */
  prompt: string;
  system?: string;
  /** Hard cap so a runaway generation cannot hang the interface. */
  maxTokens?: number;
  temperature?: number;
};

export type BridgeGenerateResponse = {
  text: string;
  model: string;
  elapsedMs: number;
};

export type BridgeStatus =
  | { state: 'connected'; model: string; provider: string; scopes: BridgeScope[]; endpointHint: string }
  | { state: 'offline'; reason: string };

/* --------------------------- extraction contract -------------------------- */

/**
 * What the model is asked to return for `task.extract`. The response is parsed
 * strictly and shown as a preview; anything malformed falls back to the
 * deterministic parser rather than being half-applied.
 */
export type ExtractedTask = {
  title: string;
  courseCode: string | null;
  type: string | null;
  dueAt: string | null;
  /** The exact substring the date came from, so a wrong date is traceable. */
  dueEvidence: string | null;
  estimateMinutes: number | null;
  checklist: string[];
  confidence: 'high' | 'medium' | 'low';
};

export const EXTRACTION_SYSTEM_PROMPT = [
  'You convert coursework text into one structured task.',
  'Reply with a single JSON object and nothing else.',
  'Keys: title, courseCode, type, dueAt, dueEvidence, estimateMinutes, checklist, confidence.',
  '- title: short imperative phrase.',
  '- courseCode: one of the provided course codes, or null. Never invent one.',
  '- type: assignment | quiz | exam | project | lab | reading | admin, or null.',
  '- dueAt: ISO 8601 with offset, or null. NEVER guess a deadline that is not stated.',
  '- dueEvidence: the exact substring the deadline came from, or null.',
  '- estimateMinutes: integer or null.',
  '- checklist: array of short steps, may be empty.',
  '- confidence: high | medium | low.',
].join('\n');

export function parseExtractedTask(raw: string): ExtractedTask | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 300) : '';
    if (!title) return null;

    const dueAt = typeof parsed.dueAt === 'string' ? parsed.dueAt : null;
    const parsedDate = dueAt ? new Date(dueAt) : null;
    const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;

    return {
      title,
      courseCode: typeof parsed.courseCode === 'string' ? parsed.courseCode.toUpperCase().slice(0, 16) : null,
      type: typeof parsed.type === 'string' ? parsed.type.toLowerCase().slice(0, 16) : null,
      // A deadline with no evidence in the source text is dropped, not shown.
      dueAt: validDate && typeof parsed.dueEvidence === 'string' && parsed.dueEvidence.trim() ? validDate : null,
      dueEvidence: typeof parsed.dueEvidence === 'string' ? parsed.dueEvidence.slice(0, 300) : null,
      estimateMinutes:
        typeof parsed.estimateMinutes === 'number' && Number.isFinite(parsed.estimateMinutes)
          ? Math.max(0, Math.min(6000, Math.round(parsed.estimateMinutes)))
          : null,
      checklist: Array.isArray(parsed.checklist)
        ? parsed.checklist.filter((c): c is string => typeof c === 'string').slice(0, 20).map((c) => c.slice(0, 200))
        : [],
      confidence:
        parsed.confidence === 'high' || parsed.confidence === 'low' || parsed.confidence === 'medium'
          ? parsed.confidence
          : 'low',
    };
  } catch {
    return null;
  }
}
