/**
 * Time-zone arithmetic.
 *
 * Rules for the whole codebase:
 *  1. Instants are `Date` objects and are always UTC in the database.
 *  2. A *wall-clock intent* ("this quiz is due 23:59") is stored as an instant
 *     PLUS the IANA zone it was authored in, so the intent survives travel and
 *     DST. Never re-derive the zone from the viewer's browser.
 *  3. All formatting goes through here so a single `Intl` configuration governs
 *     the whole product.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Manila';

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
};

/** The wall-clock reading of `instant` in `timeZone`. */
export function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // `hour: '2-digit'` with hour12:false renders midnight as "24" in some ICU
  // versions; normalise it.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset in milliseconds that `timeZone` is ahead of UTC at `instant`. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wc = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  // Millisecond component is not exposed by formatToParts; add it back.
  return asUtc - (instant.getTime() - (instant.getTime() % 1000)) - 0;
}

/**
 * Convert a wall-clock reading in `timeZone` to the UTC instant it denotes.
 * Two passes so that DST transitions resolve correctly (the first guess uses the
 * offset at the wrong instant when the conversion crosses a transition).
 */
export function zonedToUtc(wc: Partial<WallClock> & { year: number; month: number; day: number }, timeZone: string): Date {
  const target = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour ?? 0, wc.minute ?? 0, wc.second ?? 0);
  let guess = target - zoneOffsetMs(new Date(target), timeZone);
  guess = target - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** ISO calendar date ("2026-08-26") of `instant` as seen in `timeZone`. */
export function isoDateIn(instant: Date, timeZone: string): string {
  const wc = wallClockIn(instant, timeZone);
  return `${wc.year.toString().padStart(4, '0')}-${wc.month.toString().padStart(2, '0')}-${wc.day
    .toString()
    .padStart(2, '0')}`;
}

/** Midnight at the start of `instant`'s day in `timeZone`, as a UTC instant. */
export function startOfDayIn(instant: Date, timeZone: string): Date {
  const wc = wallClockIn(instant, timeZone);
  return zonedToUtc({ year: wc.year, month: wc.month, day: wc.day, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function endOfDayIn(instant: Date, timeZone: string): Date {
  return new Date(startOfDayIn(instant, timeZone).getTime() + 24 * 3600_000 - 1);
}

export function addDaysIn(instant: Date, days: number, timeZone: string): Date {
  const wc = wallClockIn(instant, timeZone);
  return zonedToUtc(
    { year: wc.year, month: wc.month, day: wc.day + days, hour: wc.hour, minute: wc.minute, second: wc.second },
    timeZone,
  );
}

/** Whole calendar days between two instants as counted in `timeZone`. */
export function calendarDaysBetween(a: Date, b: Date, timeZone: string): number {
  const aStart = startOfDayIn(a, timeZone).getTime();
  const bStart = startOfDayIn(b, timeZone).getTime();
  return Math.round((bStart - aStart) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, in `timeZone`. */
export function weekdayIn(instant: Date, timeZone: string): number {
  const wc = wallClockIn(instant, timeZone);
  return new Date(Date.UTC(wc.year, wc.month - 1, wc.day)).getUTCDay();
}

export function startOfWeekIn(instant: Date, timeZone: string, weekStartsOn = 1): Date {
  const dow = weekdayIn(instant, timeZone);
  const delta = (dow - weekStartsOn + 7) % 7;
  return startOfDayIn(addDaysIn(instant, -delta, timeZone), timeZone);
}

export function startOfMonthIn(instant: Date, timeZone: string): Date {
  const wc = wallClockIn(instant, timeZone);
  return zonedToUtc({ year: wc.year, month: wc.month, day: 1 }, timeZone);
}

/** Minutes since local midnight — the unit used for meetings and quiet hours. */
export function minutesSinceMidnightIn(instant: Date, timeZone: string): number {
  const wc = wallClockIn(instant, timeZone);
  return wc.hour * 60 + wc.minute;
}

export function formatMinuteOfDay(minute: number, timeFormat: 'h12' | 'h24' = 'h12'): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, '0');
  if (timeFormat === 'h24') return `${h.toString().padStart(2, '0')}:${mm}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

export type FormatOptions = {
  timeZone?: string;
  timeFormat?: 'h12' | 'h24';
};

export function formatDateTime(instant: Date, opts: FormatOptions = {}): string {
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: opts.timeFormat !== 'h24',
  }).format(instant);
}

export function formatDate(instant: Date, opts: FormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: opts.timeZone ?? DEFAULT_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(instant);
}

export function formatTime(instant: Date, opts: FormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: opts.timeZone ?? DEFAULT_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: opts.timeFormat !== 'h24',
  }).format(instant);
}

/** "in 3 days" / "2 hours ago" — used for deadlines and sync health. */
export function formatRelative(instant: Date, now: Date = new Date()): string {
  const diffMs = instant.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return 'just now';
}

/**
 * Quiet hours may wrap midnight (22:00 → 07:00). `start === end` means the whole
 * day is quiet, which we treat as "notifications paused".
 */
export function isWithinQuietHours(now: Date, timeZone: string, startMinute: number, endMinute: number): boolean {
  const m = minutesSinceMidnightIn(now, timeZone);
  if (startMinute === endMinute) return true;
  if (startMinute < endMinute) return m >= startMinute && m < endMinute;
  return m >= startMinute || m < endMinute;
}

/** Next instant at which quiet hours end, for deferring a notification. */
export function quietHoursEndAt(now: Date, timeZone: string, startMinute: number, endMinute: number): Date {
  if (!isWithinQuietHours(now, timeZone, startMinute, endMinute)) return now;
  const m = minutesSinceMidnightIn(now, timeZone);
  const wc = wallClockIn(now, timeZone);
  const crossesMidnight = startMinute > endMinute && m >= startMinute;
  return zonedToUtc(
    {
      year: wc.year,
      month: wc.month,
      day: wc.day + (crossesMidnight ? 1 : 0),
      hour: Math.floor(endMinute / 60),
      minute: endMinute % 60,
      second: 0,
    },
    timeZone,
  );
}
