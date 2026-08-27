import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getCurrentUser, getPreferences } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { themes } from '@/lib/db/schema';
import { Card, CardHeader } from '@/components/ui/primitives';
import { AppearanceControls } from '@/components/settings/AppearanceControls';

export const metadata: Metadata = { title: 'Appearance' };
export const dynamic = 'force-dynamic';

export default async function AppearancePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const prefs = await getPreferences(user.id);
  const db = await getDb();
  const userThemes = await db.select().from(themes).where(eq(themes.userId, user.id));

  return (
    <Card>
      <CardHeader title="Appearance" subtitle="Theme, density and course colours" />
      <div className="p-4">
        <AppearanceControls
          themeMode={prefs.themeMode as 'light' | 'dark' | 'system'}
          density={prefs.density as 'compact' | 'comfortable'}
          themes={userThemes.map((t) => ({
            id: t.id,
            name: t.name,
            mode: t.mode,
            tokens: t.tokens as Record<string, string>,
            isBuiltIn: t.isBuiltIn,
          }))}
          activeThemeId={prefs.themeId}
        />
      </div>
    </Card>
  );
}
