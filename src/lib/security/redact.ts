/**
 * Credential redaction.
 *
 * Everything that can reach a log line, an error message shown in the sync
 * health UI, a notification payload, or telemetry passes through here first.
 * The rule the product promises is: a private Blackboard feed URL or an API
 * token must never be readable outside the encrypted column it lives in.
 */

const TOKEN_QUERY_KEYS = /\b(token|auth|key|secret|password|signature|sig|access_token|api_key)\b/i;

/** Long opaque strings that look like credentials even without a key name. */
const OPAQUE = /\b[A-Za-z0-9_-]{24,}\b/g;

const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;

const SECRET_ISH_PATH = /\/(?:[A-Za-z0-9_-]{16,})(?=\/|\.|$)/g;

export const REDACTED = '[redacted]';

/**
 * Reduce a URL to something safe to show a user: scheme, host, and a shortened
 * path. Query strings and long path segments are removed entirely — a
 * Blackboard personal ICS URL carries its credential in exactly those places.
 */
export function safeUrlHint(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const tail = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const shown = tail.length > 8 ? `…${tail.slice(-6)}` : tail;
    return `${u.protocol}//${u.host}/…/${shown}`;
  } catch {
    return REDACTED;
  }
}

/** Full redaction of a single URL — used in logs. */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}/${REDACTED}`;
  } catch {
    return REDACTED;
  }
}

/**
 * Redact free text. `knownSecrets` are exact strings (a decrypted feed URL, a
 * token) that must be scrubbed even if they do not match a heuristic.
 */
export function redact(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(BEARER, (m) => `${m.split(/\s+/)[0]} ${REDACTED}`);
  out = out.replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
    try {
      const u = new URL(url);
      let touched = false;
      for (const key of [...u.searchParams.keys()]) {
        if (TOKEN_QUERY_KEYS.test(key)) {
          u.searchParams.set(key, REDACTED);
          touched = true;
        }
      }
      if (u.username || u.password) {
        u.username = REDACTED;
        u.password = '';
        touched = true;
      }
      const path = u.pathname.replace(SECRET_ISH_PATH, `/${REDACTED}`);
      if (path !== u.pathname) {
        u.pathname = path;
        touched = true;
      }
      return touched ? u.toString() : url;
    } catch {
      return REDACTED;
    }
  });
  out = out.replace(OPAQUE, (m) => (looksLikeWord(m) ? m : REDACTED));
  return out;
}

function looksLikeWord(s: string): boolean {
  // Keep readable identifiers (UUIDs, human words, ISO timestamps) so error
  // messages stay useful; scrub anything with the entropy profile of a token.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return true;
  return /^[A-Za-z][A-Za-z_-]*$/.test(s);
}

/** Wrap an unknown thrown value into a message that is safe to persist. */
export function redactError(err: unknown, knownSecrets: readonly string[] = []): string {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : 'Unknown error';
  return redact(raw, knownSecrets).slice(0, 500);
}
