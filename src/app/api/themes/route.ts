import { eq } from 'drizzle-orm';
import { readJson, withUser } from '@/lib/api/handler';
import { getDb } from '@/lib/db';
import { themes } from '@/lib/db/schema';
import { themeSchema } from '@/lib/domain/validation';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => {
  const db = await getDb();
  return { themes: await db.select().from(themes).where(eq(themes.userId, user.id)) };
});

export const POST = withUser(async ({ request, user }) => {
  // The schema allows only `--c-*` keys with 6-digit hex values, so a theme can
  // never inject arbitrary CSS through the token map.
  const input = themeSchema.parse(await readJson(request));
  const db = await getDb();
  const [row] = await db
    .insert(themes)
    .values({ userId: user.id, name: input.name, mode: input.mode, tokens: input.tokens })
    .returning();
  return { theme: row };
});
