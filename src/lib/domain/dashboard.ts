import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { dashboardLayouts, widgetInstances } from '../db/schema';
import { defaultWidgets, WIDGET_KEYS, type Breakpoint } from './widget-catalog';

export * from './widget-catalog';

export type WidgetInstanceRow = typeof widgetInstances.$inferSelect;

/** Reads a layout, materialising the default on first use. */
export async function getLayout(userId: string, breakpoint: Breakpoint): Promise<WidgetInstanceRow[]> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(dashboardLayouts)
    .where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.breakpoint, breakpoint)))
    .limit(1);

  if (existing[0]) {
    return db
      .select()
      .from(widgetInstances)
      .where(eq(widgetInstances.layoutId, existing[0].id))
      .orderBy(asc(widgetInstances.position));
  }

  const [layout] = await db.insert(dashboardLayouts).values({ userId, breakpoint }).returning();
  const rows = defaultWidgets(breakpoint).map((w) => ({ ...w, layoutId: layout!.id, userId }));
  return db.insert(widgetInstances).values(rows).returning();
}

export async function saveLayout(
  userId: string,
  breakpoint: Breakpoint,
  widgets: Array<{ widgetKey: string; span: number; height: string; hidden: boolean; settings: Record<string, unknown> }>,
): Promise<WidgetInstanceRow[]> {
  const db = await getDb();
  await getLayout(userId, breakpoint); // ensure the layout row exists
  const [layout] = await db
    .select()
    .from(dashboardLayouts)
    .where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.breakpoint, breakpoint)))
    .limit(1);

  const clean = widgets
    .filter((w) => WIDGET_KEYS.has(w.widgetKey))
    .slice(0, 40)
    .map((w, index) => ({
      layoutId: layout!.id,
      userId,
      widgetKey: w.widgetKey,
      position: index,
      // Mobile is a single column by construction; clamping here means a phone
      // can never inherit a desktop span and overflow the viewport.
      span: breakpoint === 'mobile' ? 1 : Math.min(Math.max(1, w.span), 4),
      height: ['auto', 'short', 'tall'].includes(w.height) ? w.height : 'auto',
      hidden: !!w.hidden,
      settings: w.settings ?? {},
    }));

  await db.delete(widgetInstances).where(eq(widgetInstances.layoutId, layout!.id));
  await db.update(dashboardLayouts).set({ updatedAt: new Date() }).where(eq(dashboardLayouts.id, layout!.id));
  if (!clean.length) return [];
  return db.insert(widgetInstances).values(clean).returning();
}

export async function resetLayout(userId: string, breakpoint: Breakpoint): Promise<WidgetInstanceRow[]> {
  return saveLayout(userId, breakpoint, defaultWidgets(breakpoint));
}
