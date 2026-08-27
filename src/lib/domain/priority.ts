import { calendarDaysBetween, DEFAULT_TIME_ZONE } from '../shared/time';

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

/**
 * Initial priority derived from a deadline, per the product rule:
 *
 *   overdue or due today → urgent
 *   within 3 days        → high
 *   within 14 days       → medium
 *   otherwise            → low
 *
 * "Days" are *calendar* days in the user's zone, not 24-hour buckets: a task due
 * at 08:00 tomorrow is one day away even if that is 14 hours from now. Tasks
 * with no deadline are `medium`, never `urgent`.
 */
export function derivePriority(
  dueAt: Date | null | undefined,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): Priority {
  if (!dueAt) return 'medium';
  const days = calendarDaysBetween(now, dueAt, timeZone);
  if (days <= 0) return 'urgent';
  if (days <= 3) return 'high';
  if (days <= 14) return 'medium';
  return 'low';
}

/**
 * A sync may only set priority when the user has never overridden it. This is
 * the single place that decision is made, so no connector can bypass it.
 */
export function priorityForSync(args: {
  currentPriority: Priority;
  priorityOverridden: boolean;
  dueAt: Date | null;
  now?: Date;
  timeZone?: string;
}): { priority: Priority; changed: boolean; reason: string } {
  if (args.priorityOverridden) {
    return { priority: args.currentPriority, changed: false, reason: 'user override preserved' };
  }
  const next = derivePriority(args.dueAt, args.now ?? new Date(), args.timeZone ?? DEFAULT_TIME_ZONE);
  return {
    priority: next,
    changed: next !== args.currentPriority,
    reason: next !== args.currentPriority ? 'recomputed from due date' : 'unchanged',
  };
}

export const PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
