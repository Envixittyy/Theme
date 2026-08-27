import { lookup as dnsLookup } from 'node:dns/promises';

export type LookupAddress = { address: string; family: number };
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { assertServerOnly } from '../server-guard';
import { redactUrl } from './redact';

assertServerOnly('lib/security/ssrf');

/**
 * SSRF defence for user-supplied feed URLs.
 *
 * A student pastes an arbitrary URL and the server fetches it. That is the
 * classic SSRF shape, so the guard is layered:
 *
 *   1. Scheme allowlist (https; http only when explicitly enabled for dev).
 *   2. No embedded credentials, no non-standard ports.
 *   3. Optional host allowlist (institutions can pin this in production).
 *   4. DNS resolution, then rejection of every non-public address family —
 *      loopback, private, link-local, CGNAT, multicast, reserved, IPv6 ULA,
 *      and IPv4-mapped IPv6 forms of all of the above.
 *   5. The connection is *pinned* to the address we validated, which closes the
 *      DNS-rebinding window between check and connect.
 *   6. Redirects are followed manually, and every hop repeats steps 1-5.
 *   7. Response size and content type are capped while streaming.
 */

export class UnsafeUrlError extends Error {
  readonly reason: string;
  constructor(reason: string, url?: string) {
    super(url ? `Refused to fetch ${redactUrl(url)}: ${reason}` : `Refused to fetch URL: ${reason}`);
    this.name = 'UnsafeUrlError';
    this.reason = reason;
  }
}

export type SsrfPolicy = {
  allowHttp: boolean;
  allowedPorts: number[];
  hostAllowlist: string[] | null;
  maxRedirects: number;
  maxBytes: number;
  timeoutMs: number;
  allowedContentTypes: string[];
};

export function defaultPolicy(): SsrfPolicy {
  const allowlist = (process.env.FEED_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    allowHttp: process.env.ALLOW_INSECURE_FEED_URLS === 'true',
    allowedPorts: [80, 443],
    hostAllowlist: allowlist.length ? allowlist : null,
    maxRedirects: 3,
    maxBytes: Number(process.env.FEED_MAX_BYTES ?? 5_000_000),
    timeoutMs: Number(process.env.FEED_TIMEOUT_MS ?? 15_000),
    allowedContentTypes: ['text/calendar', 'text/plain', 'application/octet-stream', 'application/ics'],
  };
}

/* ------------------------------- IP policy ------------------------------- */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function isPublicIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (cidr: string): boolean => {
    const [base, bitsRaw] = cidr.split('/') as [string, string];
    const bits = Number(bitsRaw);
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (baseInt & mask);
  };
  const blocked = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10', // CGNAT
    '127.0.0.0/8',
    '169.254.0.0/16', // link-local, incl. cloud metadata 169.254.169.254
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.88.99.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4', // multicast
    '240.0.0.0/4', // reserved incl. 255.255.255.255
  ];
  return !blocked.some(inRange);
}

export function isPublicIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0] ?? '';
  if (lower === '::' || lower === '::1') return false;
  // IPv4-mapped / IPv4-compatible forms must be judged as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPublicIpv4(mapped[1]);
  if (/^::\d+\.\d+\.\d+\.\d+$/.test(lower)) return false;
  if (/^fe[89ab]/.test(lower)) return false; // link-local fe80::/10
  if (/^f[cd]/.test(lower)) return false; // unique local fc00::/7
  if (/^ff/.test(lower)) return false; // multicast
  if (lower.startsWith('2001:db8')) return false; // documentation
  if (lower.startsWith('64:ff9b')) return false; // NAT64
  return true;
}

export function isPublicAddress(address: string, family: number): boolean {
  return family === 6 ? isPublicIpv6(address) : isPublicIpv4(address);
}

/* ------------------------------ URL policy ------------------------------ */

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const realResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export type ValidatedTarget = {
  url: URL;
  addresses: LookupAddress[];
};

export async function assertSafeUrl(
  rawUrl: string,
  policy: SsrfPolicy = defaultPolicy(),
  resolver: Resolver = realResolver,
): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('not a valid absolute URL');
  }

  // Blackboard publishes personal feeds as webcal:// links; normalise, don't reject.
  if (url.protocol === 'webcal:') url.protocol = 'https:';

  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError(`scheme "${url.protocol}" is not allowed`, rawUrl);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!policy.allowedPorts.includes(port)) {
    throw new UnsafeUrlError(`port ${port} is not allowed`, rawUrl);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new UnsafeUrlError('missing host');
  if (policy.hostAllowlist && !policy.hostAllowlist.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new UnsafeUrlError('host is not on the institution allowlist', rawUrl);
  }

  // A literal IP still has to pass the address policy.
  const literal = host.replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(literal)) {
    if (!isPublicIpv4(literal)) throw new UnsafeUrlError('resolves to a non-public address', rawUrl);
    return { url, addresses: [{ address: literal, family: 4 }] };
  }
  if (literal.includes(':')) {
    if (!isPublicIpv6(literal)) throw new UnsafeUrlError('resolves to a non-public address', rawUrl);
    return { url, addresses: [{ address: literal, family: 6 }] };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new UnsafeUrlError('host could not be resolved', rawUrl);
  }
  if (!addresses.length) throw new UnsafeUrlError('host has no addresses', rawUrl);
  for (const a of addresses) {
    if (!isPublicAddress(a.address, a.family)) {
      throw new UnsafeUrlError('resolves to a non-public address', rawUrl);
    }
  }
  return { url, addresses };
}

/* ------------------------------- safe fetch ------------------------------ */

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
};

export type SafeFetchOptions = {
  policy?: SsrfPolicy;
  resolver?: Resolver;
  headers?: Record<string, string>;
  /** Conditional-GET support so unchanged feeds cost nothing. */
  etag?: string | null;
  lastModified?: string | null;
  /** Content-type enforcement can be relaxed for JSON APIs. */
  contentTypes?: string[];
};

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const policy = options.policy ?? defaultPolicy();
  const resolver = options.resolver ?? realResolver;
  const allowedTypes = options.contentTypes ?? policy.allowedContentTypes;

  let current = rawUrl;
  for (let hop = 0; hop <= policy.maxRedirects; hop += 1) {
    const target = await assertSafeUrl(current, policy, resolver);
    const res = await requestPinned(target, policy, {
      ...options.headers,
      ...(hop === 0 && options.etag ? { 'if-none-match': options.etag } : {}),
      ...(hop === 0 && options.lastModified ? { 'if-modified-since': options.lastModified } : {}),
    }, allowedTypes);

    if (res.status >= 300 && res.status < 400 && res.headers['location']) {
      // Resolve relative redirects against the *validated* current URL.
      current = new URL(res.headers['location'], target.url).toString();
      continue;
    }
    return { ...res, finalUrl: target.url.toString() };
  }
  throw new UnsafeUrlError('too many redirects', rawUrl);
}

function requestPinned(
  target: ValidatedTarget,
  policy: SsrfPolicy,
  headers: Record<string, string>,
  allowedTypes: string[],
): Promise<Omit<SafeFetchResult, 'finalUrl'>> {
  const { url, addresses } = target;
  const pinned = addresses[0]!;
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // Pin to the address we validated. TLS still verifies against the
        // hostname via `servername`, so this is not a downgrade.
        lookup: (_hostname, _opts, cb) => cb(null, pinned.address, pinned.family),
        servername: isHttps ? url.hostname : undefined,
        headers: {
          accept: allowedTypes.join(', '),
          'user-agent': 'MapuaSchoolOS/1.0 (+feed-sync)',
          'accept-encoding': 'identity',
          ...headers,
        },
        timeout: policy.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const outHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') outHeaders[k] = v;
          else if (Array.isArray(v)) outHeaders[k] = v.join(', ');
        }

        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: outHeaders, body: '', bytes: 0, truncated: false });
          return;
        }
        if (status === 304) {
          res.resume();
          resolve({ status, headers: outHeaders, body: '', bytes: 0, truncated: false });
          return;
        }

        const contentType = (outHeaders['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        if (status === 200 && contentType && !allowedTypes.includes(contentType)) {
          res.destroy();
          reject(new UnsafeUrlError(`unexpected content type "${contentType}"`));
          return;
        }
        const declared = Number(outHeaders['content-length'] ?? '0');
        if (declared > policy.maxBytes) {
          res.destroy();
          reject(new UnsafeUrlError(`response too large (${declared} bytes)`));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > policy.maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('close', () => {
          if (truncated) {
            reject(new UnsafeUrlError(`response exceeded ${policy.maxBytes} bytes`));
            return;
          }
          resolve({
            status,
            headers: outHeaders,
            body: Buffer.concat(chunks).toString('utf8'),
            bytes,
            truncated,
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new UnsafeUrlError('request timed out'));
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}
