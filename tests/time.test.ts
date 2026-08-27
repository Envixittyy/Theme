import { describe, expect, it } from 'vitest';
import {
  calendarDaysBetween,
  formatMinuteOfDay,
  isWithinQuietHours,
  isoDateIn,
  minutesSinceMidnightIn,
  quietHoursEndAt,
  startOfDayIn,
  startOfWeekIn,
  wallClockIn,
  weekdayIn,
  zonedToUtc,
} from '@/lib/shared/time';

const MNL = 'Asia/Manila';

describe('time zone handling', () => {
  it('converts a Manila wall clock to the right UTC instant', () => {
    // Manila is UTC+8 year-round (no DST).
    const utc = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 23, minute: 59 }, MNL);
    expect(utc.toISOString()).toBe('2026-08-26T15:59:00.000Z');
  });

  it('round-trips through wallClockIn', () => {
    const utc = zonedToUtc({ year: 2026, month: 1, day: 1, hour: 0, minute: 0 }, MNL);
    expect(wallClockIn(utc, MNL)).toMatchObject({ year: 2026, month: 1, day: 1, hour: 0, minute: 0 });
  });

  it('handles a DST spring-forward zone correctly', () => {
    // 2026-03-08 02:30 does not exist in America/New_York; the conversion must
    // still produce a stable instant rather than NaN.
    const utc = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    expect(Number.isNaN(utc.getTime())).toBe(false);
    // 01:30 EST is unambiguous and must map to 06:30Z.
    const before = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 }, 'America/New_York');
    expect(before.toISOString()).toBe('2026-03-08T06:30:00.000Z');
    // 03:30 EDT maps to 07:30Z.
    const after = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, 'America/New_York');
    expect(after.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('counts calendar days in the viewer zone, not 24h buckets', () => {
    // 2026-08-26 23:00 Manila is 15:00Z. A deadline at 2026-08-27 07:00 Manila
    // is 8 hours away and is *tomorrow* locally -- but both instants fall on
    // 2026-08-26 in UTC, which is exactly why deadline maths must not use UTC.
    const now = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 23, minute: 0 }, MNL);
    const due = zonedToUtc({ year: 2026, month: 8, day: 27, hour: 7, minute: 0 }, MNL);
    expect(due.toISOString()).toBe('2026-08-26T23:00:00.000Z');
    expect(calendarDaysBetween(now, due, MNL)).toBe(1);
    expect(calendarDaysBetween(now, due, 'UTC')).toBe(0);
  });

  it('derives the local ISO date across the UTC day boundary', () => {
    const instant = new Date('2026-08-26T16:30:00.000Z'); // 00:30 on the 27th in Manila
    expect(isoDateIn(instant, MNL)).toBe('2026-08-27');
    expect(isoDateIn(instant, 'UTC')).toBe('2026-08-26');
  });

  it('computes start of day and week in zone', () => {
    const instant = new Date('2026-08-26T16:30:00.000Z'); // Thu 27 Aug 00:30 Manila
    expect(startOfDayIn(instant, MNL).toISOString()).toBe('2026-08-26T16:00:00.000Z');
    expect(weekdayIn(instant, MNL)).toBe(4); // Thursday
    // Monday-start week containing Thu 27 Aug 2026 begins Mon 24 Aug.
    expect(isoDateIn(startOfWeekIn(instant, MNL, 1), MNL)).toBe('2026-08-24');
  });

  it('reads minutes since local midnight', () => {
    const instant = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 22, minute: 30 }, MNL);
    expect(minutesSinceMidnightIn(instant, MNL)).toBe(22 * 60 + 30);
  });
});

describe('quiet hours', () => {
  const start = 22 * 60;
  const end = 7 * 60;

  it('matches a window that wraps midnight', () => {
    const at = (h: number, m = 0) => zonedToUtc({ year: 2026, month: 8, day: 26, hour: h, minute: m }, MNL);
    expect(isWithinQuietHours(at(23), MNL, start, end)).toBe(true);
    expect(isWithinQuietHours(at(2), MNL, start, end)).toBe(true);
    expect(isWithinQuietHours(at(6, 59), MNL, start, end)).toBe(true);
    expect(isWithinQuietHours(at(7), MNL, start, end)).toBe(false);
    expect(isWithinQuietHours(at(12), MNL, start, end)).toBe(false);
    expect(isWithinQuietHours(at(21, 59), MNL, start, end)).toBe(false);
  });

  it('matches a same-day window', () => {
    const at = (h: number) => zonedToUtc({ year: 2026, month: 8, day: 26, hour: h }, MNL);
    expect(isWithinQuietHours(at(10), MNL, 9 * 60, 17 * 60)).toBe(true);
    expect(isWithinQuietHours(at(18), MNL, 9 * 60, 17 * 60)).toBe(false);
  });

  it('defers to the end of the window, crossing midnight when needed', () => {
    const late = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 23, minute: 10 }, MNL);
    expect(quietHoursEndAt(late, MNL, start, end).toISOString()).toBe(
      zonedToUtc({ year: 2026, month: 8, day: 27, hour: 7 }, MNL).toISOString(),
    );
    const early = zonedToUtc({ year: 2026, month: 8, day: 27, hour: 3 }, MNL);
    expect(quietHoursEndAt(early, MNL, start, end).toISOString()).toBe(
      zonedToUtc({ year: 2026, month: 8, day: 27, hour: 7 }, MNL).toISOString(),
    );
  });

  it('returns now when not inside quiet hours', () => {
    const noon = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 12 }, MNL);
    expect(quietHoursEndAt(noon, MNL, start, end).getTime()).toBe(noon.getTime());
  });
});

describe('formatMinuteOfDay', () => {
  it('formats 12h and 24h', () => {
    expect(formatMinuteOfDay(0)).toBe('12:00 AM');
    expect(formatMinuteOfDay(13 * 60 + 5)).toBe('1:05 PM');
    expect(formatMinuteOfDay(13 * 60 + 5, 'h24')).toBe('13:05');
    expect(formatMinuteOfDay(23 * 60 + 59)).toBe('11:59 PM');
  });
});
