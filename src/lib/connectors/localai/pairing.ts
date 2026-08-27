import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { localAiDevices, localAiPairings, users } from '../../db/schema';
import { randomPairingCode, randomToken, sha256 } from '../../security/crypto';
import { recordAudit } from '../../domain/audit';
import { assertServerOnly } from '../../server-guard';
import { ALL_SCOPES, type BridgeScope } from './protocol';

assertServerOnly('lib/connectors/localai/pairing');

const PAIRING_TTL_MS = 10 * 60_000;

export async function createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const db = await getDb();
  const code = randomPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await db.insert(localAiPairings).values({ userId, codeHash: sha256(code), expiresAt });
  await recordAudit({ userId, actor: `user:${userId}`, action: 'localai.pairing_started' });
  // The plaintext code is returned exactly once, to the browser that asked.
  return { code, expiresAt };
}

export type ClaimResult =
  | { ok: true; deviceToken: string; deviceId: string; userLabel: string; scopes: BridgeScope[] }
  | { ok: false; reason: 'unknown_code' | 'expired' | 'already_claimed' };

/**
 * Claim a pairing code. Called by the bridge, unauthenticated apart from the
 * code itself — which is why the code is short-lived, single-use, and rate
 * limited at the route.
 */
export async function claimPairingCode(
  code: string,
  bridge: { version: string; provider: string; model: string; scopes: BridgeScope[]; endpointHint?: string },
): Promise<ClaimResult> {
  const db = await getDb();
  const hash = sha256(code.trim().toUpperCase());

  const rows = await db.select().from(localAiPairings).where(eq(localAiPairings.codeHash, hash)).limit(1);
  const pairing = rows[0];
  if (!pairing) return { ok: false, reason: 'unknown_code' };
  if (pairing.state !== 'pending') return { ok: false, reason: 'already_claimed' };
  if (pairing.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  // The UPDATE is the lock: two bridges racing on one code cannot both win.
  const claimed = await db
    .update(localAiPairings)
    .set({ state: 'claimed', claimedAt: new Date() })
    .where(and(eq(localAiPairings.id, pairing.id), eq(localAiPairings.state, 'pending'), gt(localAiPairings.expiresAt, new Date())))
    .returning({ id: localAiPairings.id });
  if (!claimed[0]) return { ok: false, reason: 'already_claimed' };

  const deviceToken = randomToken(32);
  const scopes = bridge.scopes.filter((s): s is BridgeScope => ALL_SCOPES.includes(s));

  const [device] = await db
    .insert(localAiDevices)
    .values({
      userId: pairing.userId,
      label: `${bridge.provider} · ${bridge.model}`,
      modelName: bridge.model.slice(0, 120),
      endpointHint: bridge.endpointHint?.slice(0, 120) ?? null,
      tokenHash: sha256(deviceToken),
      scopes,
    })
    .returning();

  await db.update(localAiPairings).set({ deviceId: device!.id }).where(eq(localAiPairings.id, pairing.id));

  const userRows = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, pairing.userId))
    .limit(1);

  await recordAudit({
    userId: pairing.userId,
    actor: 'system',
    action: 'localai.device_paired',
    entityType: 'local_ai_device',
    entityId: device!.id,
    detail: { provider: bridge.provider, model: bridge.model, scopes },
  });

  return {
    ok: true,
    deviceToken,
    deviceId: device!.id,
    userLabel: userRows[0]?.displayName || userRows[0]?.email || 'Student',
    scopes,
  };
}

export async function listDevices(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(localAiDevices)
    .where(and(eq(localAiDevices.userId, userId), isNull(localAiDevices.revokedAt)));
}

export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(localAiDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(localAiDevices.id, deviceId), eq(localAiDevices.userId, userId)))
    .returning({ id: localAiDevices.id });
  if (rows[0]) {
    await recordAudit({
      userId,
      actor: `user:${userId}`,
      action: 'localai.device_revoked',
      entityType: 'local_ai_device',
      entityId: deviceId,
    });
  }
  return rows.length > 0;
}

/** Verify a bridge device token (used when the bridge calls back in). */
export async function verifyDeviceToken(token: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(localAiDevices)
    .where(and(eq(localAiDevices.tokenHash, sha256(token)), isNull(localAiDevices.revokedAt)))
    .limit(1);
  const device = rows[0];
  if (!device) return null;
  await db.update(localAiDevices).set({ lastSeenAt: new Date() }).where(eq(localAiDevices.id, device.id));
  return device;
}
