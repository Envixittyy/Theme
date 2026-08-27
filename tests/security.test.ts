import { describe, expect, it } from 'vitest';
import {
  assertSafeUrl,
  defaultPolicy,
  isPublicIpv4,
  isPublicIpv6,
  UnsafeUrlError,
  type LookupAddress,
} from '@/lib/security/ssrf';
import {
  contentHash,
  decryptSecret,
  encryptSecret,
  needsRotation,
  rotateSecret,
  stableStringify,
} from '@/lib/security/crypto';
import { redact, redactError, redactUrl, safeUrlHint } from '@/lib/security/redact';

const resolver = (map: Record<string, LookupAddress[]>) => async (host: string) => {
  const found = map[host];
  if (!found) throw new Error('NXDOMAIN');
  return found;
};

const publicDns = resolver({ 'blackboard.example.edu': [{ address: '93.184.216.34', family: 4 }] });

describe('SSRF address policy', () => {
  it('rejects every private and reserved IPv4 range', () => {
    for (const ip of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '192.0.2.5',
    ]) {
      expect(isPublicIpv4(ip), ip).toBe(false);
    }
  });

  it('accepts ordinary public IPv4', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '203.177.1.1']) {
      expect(isPublicIpv4(ip), ip).toBe(true);
    }
  });

  it('rejects loopback, link-local, ULA and IPv4-mapped IPv6', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1']) {
      expect(isPublicIpv6(ip), ip).toBe(false);
    }
    expect(isPublicIpv6('2606:4700:4700::1111')).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  const policy = { ...defaultPolicy(), allowHttp: false, hostAllowlist: null };

  it('accepts a normal https feed', async () => {
    const result = await assertSafeUrl('https://blackboard.example.edu/feed/abc.ics', policy, publicDns);
    expect(result.url.host).toBe('blackboard.example.edu');
  });

  it('normalises webcal:// rather than rejecting it', async () => {
    const result = await assertSafeUrl('webcal://blackboard.example.edu/feed/abc.ics', policy, publicDns);
    expect(result.url.protocol).toBe('https:');
  });

  it('rejects non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://x/1', 'ftp://example.edu/a.ics', 'data:text/calendar,x']) {
      await expect(assertSafeUrl(url, policy, publicDns)).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('rejects plain http unless explicitly allowed', async () => {
    await expect(assertSafeUrl('http://blackboard.example.edu/a.ics', policy, publicDns)).rejects.toThrow(
      /scheme/,
    );
    const permissive = { ...policy, allowHttp: true };
    await expect(assertSafeUrl('http://blackboard.example.edu/a.ics', permissive, publicDns)).resolves.toBeTruthy();
  });

  it('rejects embedded credentials', async () => {
    await expect(
      assertSafeUrl('https://user:pass@blackboard.example.edu/a.ics', policy, publicDns),
    ).rejects.toThrow(/credentials/);
  });

  it('rejects unusual ports', async () => {
    await expect(assertSafeUrl('https://blackboard.example.edu:8443/a.ics', policy, publicDns)).rejects.toThrow(
      /port/,
    );
  });

  it('rejects literal private addresses', async () => {
    for (const url of [
      'https://127.0.0.1/a.ics',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/a.ics',
      'https://[::1]/a.ics',
      'https://[fd00::1]/a.ics',
    ]) {
      await expect(assertSafeUrl(url, policy, publicDns), url).rejects.toThrow(/non-public|not allowed/);
    }
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const evil = resolver({ 'evil.example.com': [{ address: '169.254.169.254', family: 4 }] });
    await expect(assertSafeUrl('https://evil.example.com/a.ics', policy, evil)).rejects.toThrow(/non-public/);
  });

  it('rejects when ANY resolved address is private', async () => {
    // The classic bypass: one public A record and one private one.
    const mixed = resolver({
      'mixed.example.com': [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    });
    await expect(assertSafeUrl('https://mixed.example.com/a.ics', policy, mixed)).rejects.toThrow(/non-public/);
  });

  it('enforces an institution host allowlist', async () => {
    const pinned = { ...policy, hostAllowlist: ['example.edu'] };
    await expect(assertSafeUrl('https://blackboard.example.edu/a.ics', pinned, publicDns)).resolves.toBeTruthy();
    const other = resolver({ 'evil.com': [{ address: '93.184.216.34', family: 4 }] });
    await expect(assertSafeUrl('https://evil.com/a.ics', pinned, other)).rejects.toThrow(/allowlist/);
  });

  it('rejects an unresolvable host', async () => {
    await expect(assertSafeUrl('https://nope.example.com/a.ics', policy, publicDns)).rejects.toThrow(/resolved/);
  });

  it('rejects malformed input', async () => {
    await expect(assertSafeUrl('not a url', policy, publicDns)).rejects.toThrow(/absolute URL/);
  });
});

describe('secret encryption', () => {
  it('round-trips and produces different ciphertext each time', () => {
    const secret = 'https://blackboard.example.edu/feed/abcd1234efgh5678/learn.ics';
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a.ciphertext).not.toBe(b.ciphertext); // random IV
    expect(decryptSecret(a.ciphertext)).toBe(secret);
    expect(decryptSecret(b.ciphertext)).toBe(secret);
  });

  it('detects tampering', () => {
    const { ciphertext } = encryptSecret('token-value');
    const parts = ciphertext.split('.');
    const flipped = Buffer.from(parts[4]!, 'base64url');
    flipped[0] = flipped[0]! ^ 0xff;
    parts[4] = flipped.toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('supports key rotation without losing old ciphertexts', () => {
    const original = process.env.SECRET_ENCRYPTION_KEYS;
    const keyA = `k1:${Buffer.alloc(32, 1).toString('base64')}`;
    const keyB = `k2:${Buffer.alloc(32, 2).toString('base64')}`;

    process.env.SECRET_ENCRYPTION_KEYS = keyA;
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY_ID = 'k1';
    const old = encryptSecret('feed-url');

    // New key added, active key switched: the old ciphertext still decrypts.
    process.env.SECRET_ENCRYPTION_KEYS = `${keyA},${keyB}`;
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY_ID = 'k2';
    expect(decryptSecret(old.ciphertext)).toBe('feed-url');
    expect(needsRotation(old.ciphertext)).toBe(true);

    const rotated = rotateSecret(old.ciphertext);
    expect(rotated.keyId).toBe('k2');
    expect(needsRotation(rotated.ciphertext)).toBe(false);
    expect(decryptSecret(rotated.ciphertext)).toBe('feed-url');

    process.env.SECRET_ENCRYPTION_KEYS = original;
    process.env.SECRET_ENCRYPTION_ACTIVE_KEY_ID = 'test';
  });
});

describe('content hashing', () => {
  it('is stable across key order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('changes when a value changes', () => {
    expect(contentHash({ due: '2026-09-01' })).not.toBe(contentHash({ due: '2026-09-05' }));
  });

  it('ignores undefined members so an absent field equals a missing one', () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });
});

describe('redaction', () => {
  const feed = 'https://blackboard.example.edu/webapps/calendar/feed/abcd1234efgh5678ijkl/learn.ics';

  it('never leaves a known secret in text', () => {
    const message = `Failed to fetch ${feed} after 3 tries`;
    const clean = redact(message, [feed]);
    expect(clean).not.toContain('abcd1234efgh5678ijkl');
    expect(clean).not.toContain(feed);
  });

  it('scrubs token-like query parameters even for unknown URLs', () => {
    const clean = redact('GET https://api.example.com/x?token=SECRETVALUE123456&page=2');
    expect(clean).not.toContain('SECRETVALUE123456');
    expect(clean).toContain('page=2');
  });

  it('scrubs long opaque path segments', () => {
    const clean = redact(`fetching ${feed}`);
    expect(clean).not.toContain('abcd1234efgh5678ijkl');
  });

  it('scrubs bearer tokens', () => {
    const clean = redact('authorization: Bearer ntn_5f8a2b9c0d1e2f3a4b5c6d7e8f90');
    expect(clean).not.toContain('ntn_5f8a2b9c0d1e2f3a4b5c6d7e8f90');
    expect(clean.toLowerCase()).toContain('bearer');
  });

  it('keeps readable identifiers so errors stay useful', () => {
    const clean = redact('task 550e8400-e29b-41d4-a716-446655440000 failed at 2026-08-26T10:00:00Z');
    expect(clean).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(clean).toContain('2026-08-26T10:00:00Z');
  });

  it('produces a recognisable but useless hint for the UI', () => {
    const hint = safeUrlHint(feed);
    expect(hint).toContain('blackboard.example.edu');
    expect(hint).not.toContain('abcd1234efgh5678ijkl');
  });

  it('redacts an entire URL for logs', () => {
    expect(redactUrl(feed)).toBe('https://blackboard.example.edu/[redacted]');
  });

  it('wraps thrown values safely', () => {
    const message = redactError(new Error(`ENOTFOUND ${feed}`), [feed]);
    expect(message).not.toContain('abcd1234efgh5678ijkl');
    expect(message).toContain('Error');
  });
});
