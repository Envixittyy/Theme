import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { dashboardLayouts, widgetInstances } from '../db/schema';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export type WidgetDefinition = {
  key: string;
  name: string;
  description: string;
  /** Column span allowed per breakpoint; mobile is always a single column. */
  defaultSpan: Record<Breakpoint, number>;
  maxSpan: number;
};

/**
 * The widget catalogue is data, not components, so the editor, the renderer and
 * the persistence layer all agree on what exists without importing React.
 */
export const WIDGET_CATALOG: WidgetDefinition[] = [
  {
    key: 'today-schedule',
    name: "Today's schedule",
    description: 'Class meetings happening today, in order.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'due-today',
    name: 'Due today',
    description: 'Everything with a deadline in the current local day.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'overdue',
    name: 'Overdue',
    description: 'Past-deadline work that is not submitted or done.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'upcoming-7',
    name: 'Next 7 days',
    description: 'Deadlines grouped by day for the coming week.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'recent-blackboard',
    name: 'Recently posted',
    description: 'Items the Blackboard sync discovered most recently.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'latest-announcements',
    name: 'Latest announcements',
    description: 'Newest announcements with unread state.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'course-workload',
    name: 'Course workload',
    description: 'Open, overdue and submitted counts per course.',
    defaultSpan: { mobile: 1, tablet: 4, desktop: 2 },
    maxSpan: 4,
  },
  {
    key: 'quick-note',
    name: 'Quick note',
    description: 'A scratch pad that saves to Notes.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 1 },
    maxSpan: 4,
  },
  {
    key: 'calendar-preview',
    name: 'Calendar preview',
    description: 'A compact month grid with deadline density.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 1 },
    maxSpan: 4,
  },
  {
    key: 'sync-health',
    name: 'Sync health',
    description: 'Last successful sync, errors and items needing review.',
    defaultSpan: { mobile: 1, tablet: 2, desktop: 2 },
    maxSpan: 4,
  },
];

export const WIDGET_KEYS = new Set(WIDGET_CATALOG.map((w) => w.key));

const DEFAULT_ORDER: Record<Breakpoint, string[]> = {
  mobile: ['due-today', 'today-schedule', 'overdue', 'upcoming-7', 'latest-announcements', 'sync-health'],
  tablet: ['today-schedule', 'due-today', 'overdue', 'upcoming-7', 'course-workload', 'latest-announcements', 'sync-health'],
  desktop: [
    'today-schedule',
    'due-today',
    'overdue',
    'upcoming-7',
    'course-workload',
    'latest-announcements',
    'recent-blackboard',
    'calendar-preview',
    'quick-note',
    'sync-health',
  ],
};

export type WidgetInstanceRow = typeof widgetInstances.$inferSelect;

export function defaultWidgets(breakpoint: Breakpoint) {
  return DEFAULT_ORDER[breakpoint].map((key, index) => {
    const def = WIDGET_CATALOG.find((w) => w.key === key)!;
    return {
      widgetKey: key,
      position: index,
      span: breakpoint === 'mobile' ? 1 : def.defaultSpan[breakpoint],
      height: 'auto' as const,
      hidden: false,
      settings: {} as Record<string, unknown>,
    };
  });
}

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
