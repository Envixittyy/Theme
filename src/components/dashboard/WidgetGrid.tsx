import { WidgetCard } from './Widgets';
import type { TodayData } from '@/lib/domain/today';
import type { Breakpoint } from '@/lib/domain/widget-catalog';

export type LayoutWidget = {
  widgetKey: string;
  position: number;
  span: number;
  height: string;
  hidden: boolean;
};

export type Layouts = Record<Breakpoint, LayoutWidget[]>;

const WIDGET_LINKS: Record<string, string> = {
  'due-today': '/tasks?list=today',
  overdue: '/tasks?list=overdue',
  'upcoming-7': '/tasks?list=upcoming',
  'today-schedule': '/calendar?view=timetable',
  'latest-announcements': '/announcements',
  'recent-blackboard': '/tasks?source=blackboard',
  'course-workload': '/courses',
  'calendar-preview': '/calendar',
  'sync-health': '/settings/sync',
  'quick-note': '/notes',
};

/**
 * Per-breakpoint layouts without a client round trip.
 *
 * Order, span and visibility differ per breakpoint, so instead of picking a
 * layout in JavaScript after mount (which flashes the wrong arrangement on a
 * phone) the server emits one stylesheet with three media-query blocks. The
 * markup is a single list; CSS decides where each card sits. That keeps the
 * first paint correct at any width and makes the whole grid work with
 * JavaScript disabled.
 */
function layoutCss(layouts: Layouts, allKeys: string[]): string {
  const block = (widgets: LayoutWidget[], sized: boolean): string => {
    const present = new Map(widgets.map((w) => [w.widgetKey, w]));
    return allKeys
      .map((key) => {
        const w = present.get(key);
        // A widget absent from this breakpoint's layout is hidden at this
        // width. Without an explicit rule it would inherit `order: 0` and jump
        // to the top of every smaller layout.
        if (!w) return `#dashboard [data-w="${key}"]{display:none}`;
        const rules = [`order:${w.position}`, w.hidden ? 'display:none' : 'display:flex'];
        if (sized) rules.push(`grid-column:span ${Math.min(Math.max(w.span, 1), 4)}`);
        if (w.height === 'short') rules.push('max-height:20rem');
        if (w.height === 'tall') rules.push('min-height:26rem');
        return `#dashboard [data-w="${key}"]{${rules.join(';')}}`;
      })
      .join('');
  };

  return [
    // Mobile first: one column, mobile order.
    block(layouts.mobile, false),
    `@media (min-width:768px){${block(layouts.tablet, true)}}`,
    `@media (min-width:1280px){${block(layouts.desktop, true)}}`,
  ].join('');
}

export function WidgetGrid({ layouts, data }: { layouts: Layouts; data: TodayData }) {
  const keys = [
    ...new Set([
      ...layouts.mobile.map((w) => w.widgetKey),
      ...layouts.tablet.map((w) => w.widgetKey),
      ...layouts.desktop.map((w) => w.widgetKey),
    ]),
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: layoutCss(layouts, keys) }} />
      <div
        id="dashboard"
        className="grid grid-cols-1 items-start gap-3 md:grid-cols-4"
        role="region"
        aria-label="Dashboard widgets"
      >
        {keys.map((key) => (
          <div key={key} data-w={key} className="flex min-w-0 flex-col">
            <WidgetCard widgetKey={key} data={data} href={WIDGET_LINKS[key]} />
          </div>
        ))}
      </div>
    </>
  );
}
