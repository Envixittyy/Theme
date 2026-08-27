import { z } from 'zod';
import { readJson, withUser } from '@/lib/api/handler';
import { getLayout, resetLayout, saveLayout } from '@/lib/domain/dashboard';
import { widgetLayoutSchema } from '@/lib/domain/validation';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ request, user }) => {
  const bp = new URL(request.url).searchParams.get('breakpoint');
  const breakpoint = z.enum(['mobile', 'tablet', 'desktop']).parse(bp ?? 'desktop');
  return { widgets: await getLayout(user.id, breakpoint) };
});

export const PUT = withUser(async ({ request, user }) => {
  const body = widgetLayoutSchema.parse(await readJson(request));
  const widgets = await saveLayout(user.id, body.breakpoint, body.widgets);
  return { widgets };
});

export const POST = withUser(async ({ request, user }) => {
  const body = z
    .object({ breakpoint: z.enum(['mobile', 'tablet', 'desktop']), action: z.literal('reset') })
    .parse(await readJson(request));
  return { widgets: await resetLayout(user.id, body.breakpoint) };
});
