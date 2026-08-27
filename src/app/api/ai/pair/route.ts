import { withUser } from '@/lib/api/handler';
import { createPairingCode, listDevices } from '@/lib/connectors/localai/pairing';
import { DEFAULT_BRIDGE_PORT, SCOPE_DESCRIPTIONS } from '@/lib/connectors/localai/protocol';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => ({
  devices: (await listDevices(user.id)).map((d) => ({
    id: d.id,
    label: d.label,
    modelName: d.modelName,
    endpointHint: d.endpointHint,
    scopes: d.scopes,
    lastSeenAt: d.lastSeenAt,
    createdAt: d.createdAt,
  })),
  bridgePort: DEFAULT_BRIDGE_PORT,
  scopes: SCOPE_DESCRIPTIONS,
}));

/** Issue a short-lived pairing code. Rate limited so codes cannot be farmed. */
export const POST = withUser(
  async ({ user }) => {
    const { code, expiresAt } = await createPairingCode(user.id);
    return { code, expiresAt };
  },
  { limit: 10, windowMs: 10 * 60_000 },
);
