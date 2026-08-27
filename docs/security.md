# Security model

What this system is protecting, from what, and the test that keeps each promise
honest. Where a mitigation is partial, it says so.

## The assets

1. **Integration credentials** — a Blackboard feed URL is a bearer token with no
   expiry that exposes a student's whole schedule. A Notion token can read and
   write their workspace.
2. **Coursework** — tasks, notes and attachments, which are personal and
   occasionally sensitive.
3. **The server itself** — it fetches user-supplied URLs, which is the classic
   SSRF shape.

## Threats and mitigations

### SSRF through feed URLs

**The threat.** A user pastes `http://169.254.169.254/latest/meta-data` and the
server fetches its own cloud credentials. Or a hostname that resolves publicly
on the first lookup and privately on the second.

**Mitigations**, layered, in `lib/security/ssrf.ts`:

- Scheme allowlist (`https`, plus `webcal` normalised to it; `http` only behind
  an explicit development flag).
- No embedded credentials; no ports other than 80/443.
- Optional institution host allowlist (`FEED_HOST_ALLOWLIST`).
- DNS resolution, then rejection if **any** resolved address is loopback,
  private, link-local, CGNAT, multicast, reserved, IPv6 ULA, or an IPv4-mapped
  form of those. One public and one private A record is a rejection.
- The socket is **pinned to the address that was validated**, which closes the
  DNS-rebinding window between the check and the connect. TLS still verifies the
  hostname.
- Redirects are followed manually and every hop repeats all of the above.
- Response size and content type are capped while streaming.

**Tested by** `tests/security.test.ts` — every private range, the mixed-records
bypass, rebinding, scheme and port rules, and the allowlist. Plus an end-to-end
test that drives a metadata URL through the real connect form.

### Credential leakage

**The threat.** A feed URL ends up in a log line, an error message shown in the
sync UI, a notification payload, or the client bundle — any of which is a
permanent disclosure to whoever can read it.

**Mitigations.** Secrets are AES-256-GCM envelope-encrypted with a rotatable
keyring and stored only in `integration_secrets`. The single accessor,
`readSecret`, is server-only. Everything that persists an error passes through
`lib/security/redact.ts`, which scrubs known secrets, bearer tokens,
token-shaped query parameters and long opaque path segments while keeping UUIDs
and timestamps readable. The UI receives a redacted hint — host plus a truncated
tail — never the value. Account export deliberately omits secrets and the
calendar feed token.

**Tested by** redaction unit tests, a sync-failure test asserting the feed URL
does not appear in the stored error, and an end-to-end test that scans every
served JavaScript chunk for credential material.

**Partial:** an operator with database *and* keyring access can read secrets.
That is inherent to a server that must use them; the mitigation is key custody,
not code.

### Cross-account access

**The threat.** A user guesses another user's task or attachment id.

**Mitigations.** Every user-owned table carries `user_id`, and every query
filters on it — ownership is a predicate on the row, never an inference from a
parent join. Attachment downloads re-authorize on every request and answer 404,
which does not confirm the id exists. Storage keys are server-generated and
opaque.

**Tested by** `tests/authorization.test.ts`, which takes the adversarial view for
tasks, subtasks, notes, courses, announcements, attachments and dashboards, and
by an end-to-end request for a well-formed foreign attachment id.

### CSRF

Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. Every state-changing
request additionally requires a session-bound double-submit token, and the
`Origin` header is checked when present. **Tested** end-to-end by a same-origin,
fully-authenticated POST with no token, asserting 403.

### Malicious uploads

Content type is allowlisted; size is capped; the storage key is chosen by the
server; filenames are stripped of separators, leading dots, control characters
and bidirectional overrides (the trick that renders `.exe` as `.png`). Uploaded
bytes are inspected: executable signatures are rejected outright, and content
that contradicts its declared type is rejected. Only formats we are confident
about are served inline; everything else downloads, with `nosniff`.

**Partial, and labelled as such in the UI:** this is signature checking, not
antivirus. The attachment badge says "checked", and the detail says no antivirus
is configured, because claiming more would be a lie.

### Notification and webhook abuse

Notification payloads carry no credentials and no more than an excerpt. Event
keys are unique per user, so a replayed sync cannot notify twice. The Notion
OAuth callback verifies a hashed, short-lived `state` cookie. Push subscriptions
are per device and pruned when the push service reports them gone.

### Local AI

The server never contacts the model — see
[ADR 0004](adr/0004-local-ai-bridge.md). Pairing codes are single-use, expire in
ten minutes, and are stored only as hashes. Device tokens are scoped to explicit
capabilities and revocable. The bridge checks the `Origin` of every request and
binds to loopback only, so another web page cannot drive the student's model.

### Rate limiting

Fixed-window, in the database, applied per user per route, and per address on
the two unauthenticated endpoints (magic links, bridge pairing). Magic links are
limited per address *and* per source address, so neither a victim nor the mail
provider can be flooded.

## Practices

- TypeScript strict with `noUncheckedIndexedAccess`; all input validated with
  zod at the boundary, using the same schemas the AI path uses.
- A Content-Security-Policy that permits no remote script origins.
- Notes render through a small Markdown implementation that escapes everything
  first and re-introduces a fixed set of constructs; no raw HTML passes through,
  so there is no XSS surface in user content.
- An append-only audit trail for integration changes, sync mutations, device
  pairing and notification setup.
- Export, disconnect, device revocation and account deletion are all user-facing
  actions, and deletion removes stored objects before rows so nothing is
  orphaned.

## Reporting

Security issues should go to the maintainers privately rather than through a
public issue.
