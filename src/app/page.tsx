import { redirect } from 'next/navigation';
import { getCurrentUser, getPreferences } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const prefs = await getPreferences(user.id);
  redirect(prefs.defaultView || '/today');
}
