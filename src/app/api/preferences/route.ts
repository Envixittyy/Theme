import { eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getPreferences } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { userPreferences, users } from '@/lib/db/schema';
import { preferencesSchema } from '@/lib/domain/validation';
import { recordAudit } from '@/lib/domain/audit';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => ({ preferences: await getPreferences(user.id) }));

export const PATCH = withUser(async ({ request, user }) => {
  const input = preferencesSchema.parse(await readJson(request));
  const db = await getDb();
  await getPreferences(user.id); // ensure the row exists

  const { timeZone, ...prefs } = input;
  if (timeZone) {
    // The user's zone lives on the user record because everything from
    // deadline maths to quiet hours reads it, not just the UI.
    await db.update(users).set({ timeZone, updatedAt: new Date() }).where(eq(users.id, user.id));
  }
  if (Object.keys(prefs).length) {
    await db
      .update(userPreferences)
      .set({ ...prefs, updatedAt: new Date() })
      .where(eq(userPreferences.userId, user.id));
  }
  await recordAudit({
    userId: user.id,
    actor: `user:${user.id}`,
    action: 'preferences.updated',
    detail: { fields: Object.keys(input) },
  });
  return { preferences: await getPreferences(user.id) };
});
