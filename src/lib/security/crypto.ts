import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertServerOnly } from '../server-guard';

assertServerOnly('lib/security/crypto');

/**
 * Envelope encryption for integration secrets (Blackboard feed URLs, Notion
 * tokens, bridge tokens).
 *
 * Keys come from the environment as `kid:base64key` pairs so that rotation is a
 * deploy, not a migration: add a new key, point ACTIVE_KEY_ID at it, and old
 * ciphertexts keep decrypting under their own `kid` until re-encrypted.
 *
 * Ciphertext format:  v1.<kid>.<iv b64url>.<tag b64url>.<ct b64url>
 */

const FORMAT = 'v1';

export class MissingEncryptionKeyError extends Error {
  constructor(kid: string) {
    super(`No encryption key configured for key id "${kid}"`);
    this.name = 'MissingEncryptionKeyError';
  }
}

function parseKeyring(): Map<string, Buffer> {
  const raw = process.env.SECRET_ENCRYPTION_KEYS ?? '';
  const ring = new Map<string, Buffer>();
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':');
    if (idx <= 0) continue;
    const kid = entry.slice(0, idx);
    const key = Buffer.from(entry.slice(idx + 1), 'base64');
    if (key.length !== 32) {
      throw new Error(`[security] encryption key "${kid}" must be 32 bytes (base64 of 32 raw bytes)`);
    }
    ring.set(kid, key);
  }
  if (ring.size === 0 && process.env.NODE_ENV !== 'production') {
    // Development convenience only. Production start-up fails instead (below),
    // because a hard-coded key would make "encrypted at rest" a lie.
    ring.set('dev', createHash('sha256').update('mapua-school-os-development-key').digest());
  }
  return ring;
}

export function activeKeyId(): string {
  const configured = process.env.SECRET_ENCRYPTION_ACTIVE_KEY_ID;
  if (configured) return configured;
  const first = parseKeyring().keys().next();
  if (first.done) throw new Error('[security] no encryption keys configured');
  return first.value;
}

function keyFor(kid: string): Buffer {
  const key = parseKeyring().get(kid);
  if (!key) throw new MissingEncryptionKeyError(kid);
  return key;
}

export function assertEncryptionConfigured(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.SECRET_ENCRYPTION_KEYS) {
    throw new Error(
      '[security] SECRET_ENCRYPTION_KEYS is required in production. Integration secrets cannot be stored without it.',
    );
  }
}

export function encryptSecret(plaintext: string, kid = activeKeyId()): { ciphertext: string; keyId: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(kid), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [FORMAT, kid, b64u(iv), b64u(tag), b64u(ct)].join('.'),
    keyId: kid,
  };
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 5 || parts[0] !== FORMAT) throw new Error('[security] malformed secret ciphertext');
  const [, kid, ivs, tags, cts] = parts as [string, string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', keyFor(kid), unb64u(ivs));
  decipher.setAuthTag(unb64u(tags));
  return Buffer.concat([decipher.update(unb64u(cts)), decipher.final()]).toString('utf8');
}

/** True when a stored ciphertext is not under the current active key. */
export function needsRotation(ciphertext: string): boolean {
  const kid = ciphertext.split('.')[1];
  return !!kid && kid !== activeKeyId();
}

export function rotateSecret(ciphertext: string): { ciphertext: string; keyId: string } {
  return encryptSecret(decryptSecret(ciphertext));
}

/* --------------------------- tokens & hashing --------------------------- */

export function randomToken(bytes = 32): string {
  return b64u(randomBytes(bytes));
}

/** Human-typable pairing code: unambiguous alphabet, 8 chars, ~41 bits. */
export function randomPairingCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(8);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join('');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn a comparison so timing does not leak length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Stable content hash used by the sync engine for change detection. */
export function contentHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}
function unb64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
