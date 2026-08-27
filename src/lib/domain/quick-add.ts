import {
  addDaysIn,
  DEFAULT_TIME_ZONE,
  startOfDayIn,
  startOfWeekIn,
  wallClockIn,
  weekdayIn,
  zonedToUtc,
} from '../shared/time';
import { inferTaskType, type TaskType } from './task-type';
import type { Priority } from './priority';

/**
 * Deterministic quick-add parser.
 *
 * This is the fast path for capture *and* the fallback whenever local AI is
 * offline, so it must never guess silently: every token it consumes is reported
 * back in `tokens` and the UI echoes the interpretation before saving. Anything
 * it cannot parse stays in the title rather than being dropped.
 *
 * Syntax:
 *   #CHM031        course code
 *   !urgent        priority (urgent|high|med|medium|low)
 *   @quiz          explicit type
 *   +lab +group    tags
 *   ~90m  ~2h      estimate
 *   dates          today, tomorrow, tom, mon…sun, next friday, aug 30, 30 aug,
 *                  8/30, 2026-08-30, in 3 days, next week, eod, tonight
 *   times          5pm, 5:30pm, 17:00, noon, midnight, 11:59pm
 */

export type ParsedToken = {
  kind: 'course' | 'priority' | 'type' | 'tag' | 'estimate' | 'date' | 'time';
  text: string;
  value: string;
};

export type QuickAddResult = {
  title: string;
  courseCode: string | null;
  priority: Priority | null;
  type: TaskType;
  typeExplicit: boolean;
  tags: string[];
  estimateMinutes: number | null;
  dueAt: Date | null;
  allDay: boolean;
  tokens: ParsedToken[];
};

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: 'urgent',
  u: 'urgent',
  high: 'high',
  h: 'high',
  med: 'medium',
  medium: 'medium',
  m: 'medium',
  low: 'low',
  l: 'low',
};

const TYPE_WORDS: Record<string, TaskType> = {
  assignment: 'assignment',
  hw: 'assignment',
  homework: 'assignment',
  quiz: 'quiz',
  exam: 'exam',
  project: 'project',
  lab: 'lab',
  reading: 'reading',
  read: 'reading',
  admin: 'admin',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function parseQuickAdd(
  input: string,
  options: { now?: Date; timeZone?: string; defaultDueMinute?: number } = {},
): QuickAddResult {
  const now = options.now ?? new Date();
  const tz = options.timeZone ?? DEFAULT_TIME_ZONE;
  const defaultMinute = options.defaultDueMinute ?? 23 * 60 + 59;

  const tokens: ParsedToken[] = [];
  let rest = ` ${input.trim()} `;

  const take = (re: RegExp, handler: (m: RegExpExecArray) => ParsedToken | null): void => {
    const m = re.exec(rest);
    if (!m) return;
    const token = handler(m);
    if (!token) return;
    tokens.push(token);
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
  };

  take(/\s#([A-Za-z][A-Za-z0-9._-]{1,15})\b/, (m) => ({
    kind: 'course',
    text: m[0].trim(),
    value: m[1]!.toUpperCase(),
  }));

  take(/\s!([A-Za-z]+)\b/, (m) => {
    const p = PRIORITY_WORDS[m[1]!.toLowerCase()];
    return p ? { kind: 'priority', text: m[0].trim(), value: p } : null;
  });

  take(/\s@([A-Za-z]+)\b/, (m) => {
    const t = TYPE_WORDS[m[1]!.toLowerCase()];
    return t ? { kind: 'type', text: m[0].trim(), value: t } : null;
  });

  take(/\s~(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i, (m) => {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    const minutes = unit.startsWith('h') ? Math.round(n * 60) : Math.round(n);
    return { kind: 'estimate', text: m[0].trim(), value: String(minutes) };
  });

  // Tags can repeat.
  for (;;) {
    const before = tokens.length;
    take(/\s\+([A-Za-z0-9][A-Za-z0-9_-]{0,23})\b/, (m) => ({
      kind: 'tag',
      text: m[0].trim(),
      value: m[1]!.toLowerCase(),
    }));
    if (tokens.length === before) break;
  }

  /* ------------------------------- time ------------------------------- */
  let timeMinute: number | null = null;
  take(/\s(?:\bat\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => {
    let h = Number(m[1]) % 12;
    if (m[3]!.toLowerCase() === 'pm') h += 12;
    timeMinute = h * 60 + Number(m[2] ?? 0);
    return { kind: 'time', text: m[0].trim(), value: String(timeMinute) };
  });
  if (timeMinute === null) {
    take(/\s(?:\bat\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => {
      timeMinute = Number(m[1]) * 60 + Number(m[2]);
      return { kind: 'time', text: m[0].trim(), value: String(timeMinute) };
    });
  }
  if (timeMinute === null) {
    take(/\s\b(noon|midnight|tonight|eod)\b/i, (m) => {
      const w = m[1]!.toLowerCase();
      timeMinute = w === 'noon' ? 12 * 60 : w === 'midnight' ? 0 : w === 'tonight' ? 20 * 60 : 23 * 60 + 59;
      return { kind: 'time', text: m[0].trim(), value: String(timeMinute) };
    });
  }

  /* ------------------------------- date ------------------------------- */
  let dayAnchor: Date | null = null;

  const setAnchor = (d: Date): void => {
    dayAnchor = d;
  };

  take(/\s\b(today|tonight)\b/i, (m) => {
    setAnchor(startOfDayIn(now, tz));
    return { kind: 'date', text: m[0].trim(), value: 'today' };
  });

  if (!dayAnchor) {
    take(/\s\b(tomorrow|tmrw|tom)\b/i, (m) => {
      setAnchor(startOfDayIn(addDaysIn(now, 1, tz), tz));
      return { kind: 'date', text: m[0].trim(), value: 'tomorrow' };
    });
  }

  if (!dayAnchor) {
    take(/\s\bin\s+(\d{1,3})\s+(day|days|week|weeks)\b/i, (m) => {
      const n = Number(m[1]) * (m[2]!.toLowerCase().startsWith('week') ? 7 : 1);
      setAnchor(startOfDayIn(addDaysIn(now, n, tz), tz));
      return { kind: 'date', text: m[0].trim(), value: `+${n}d` };
    });
  }

  if (!dayAnchor) {
    take(/\s\b(?:(next)\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|day)?\b/i, (m) => {
      const target = DAYS.indexOf(m[2]!.toLowerCase().slice(0, 3));
      if (target < 0) return null;
      const current = weekdayIn(now, tz);
      // A bare weekday always means the *next* one: "mon" said on a Monday is
      // seven days out, not zero.
      let delta = (target - current + 7) % 7 || 7;
      if (m[1]) {
        // "next friday" adds a week only when the plain match still falls in
        // the current Monday-start week, which is how the phrase reads in
        // English ("next monday" said on a Saturday is two days away).
        const plain = addDaysIn(now, delta, tz);
        const sameWeek =
          startOfWeekIn(plain, tz, 1).getTime() === startOfWeekIn(now, tz, 1).getTime();
        if (sameWeek) delta += 7;
      }
      setAnchor(startOfDayIn(addDaysIn(now, delta, tz), tz));
      return { kind: 'date', text: m[0].trim(), value: DAYS[target]! };
    });
  }

  if (!dayAnchor) {
    take(/\s(\d{4})-(\d{2})-(\d{2})\b/, (m) => {
      setAnchor(zonedToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, tz));
      return { kind: 'date', text: m[0].trim(), value: `${m[1]}-${m[2]}-${m[3]}` };
    });
  }

  if (!dayAnchor) {
    take(/\s\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => {
      const mi = MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3));
      if (mi < 0) return null;
      setAnchor(resolveMonthDay(mi + 1, Number(m[2]), now, tz));
      return { kind: 'date', text: m[0].trim(), value: `${MONTHS[mi]} ${m[2]}` };
    });
  }

  if (!dayAnchor) {
    take(/\s\b(\d{1,2})\s+([a-z]{3,9})\b/i, (m) => {
      const mi = MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3));
      if (mi < 0) return null;
      setAnchor(resolveMonthDay(mi + 1, Number(m[1]), now, tz));
      return { kind: 'date', text: m[0].trim(), value: `${MONTHS[mi]} ${m[1]}` };
    });
  }

  if (!dayAnchor) {
    take(/\s\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      setAnchor(year ? zonedToUtc({ year, month, day }, tz) : resolveMonthDay(month, day, now, tz));
      return { kind: 'date', text: m[0].trim(), value: `${month}/${day}` };
    });
  }

  /* ----------------------------- assemble ----------------------------- */
  const title = rest.replace(/\s+/g, ' ').trim();

  const courseCode = tokens.find((t) => t.kind === 'course')?.value ?? null;
  const priority = (tokens.find((t) => t.kind === 'priority')?.value as Priority | undefined) ?? null;
  const explicitType = tokens.find((t) => t.kind === 'type')?.value as TaskType | undefined;
  const tags = tokens.filter((t) => t.kind === 'tag').map((t) => t.value);
  const estimateToken = tokens.find((t) => t.kind === 'estimate');

  let dueAt: Date | null = null;
  let allDay = false;
  if (dayAnchor) {
    const base = dayAnchor as Date;
    const wc = wallClockIn(base, tz);
    const minute = timeMinute ?? defaultMinute;
    allDay = timeMinute === null;
    dueAt = zonedToUtc(
      { year: wc.year, month: wc.month, day: wc.day, hour: Math.floor(minute / 60), minute: minute % 60 },
      tz,
    );
  } else if (timeMinute !== null) {
    // A bare time means today if still ahead, otherwise tomorrow.
    const todayStart = startOfDayIn(now, tz);
    const wc = wallClockIn(todayStart, tz);
    const candidate = zonedToUtc(
      {
        year: wc.year,
        month: wc.month,
        day: wc.day,
        hour: Math.floor(timeMinute / 60),
        minute: timeMinute % 60,
      },
      tz,
    );
    dueAt = candidate.getTime() > now.getTime() ? candidate : addDaysIn(candidate, 1, tz);
  }

  return {
    title,
    courseCode,
    priority,
    type: explicitType ?? inferTaskType(title).type,
    typeExplicit: !!explicitType,
    tags,
    estimateMinutes: estimateToken ? Number(estimateToken.value) : null,
    dueAt,
    allDay,
    tokens,
  };
}

/** "aug 30" means the next 30 August that has not already passed. */
function resolveMonthDay(month: number, day: number, now: Date, tz: string): Date {
  const wc = wallClockIn(now, tz);
  const thisYear = zonedToUtc({ year: wc.year, month, day }, tz);
  if (thisYear.getTime() >= startOfDayIn(now, tz).getTime()) return thisYear;
  return zonedToUtc({ year: wc.year + 1, month, day }, tz);
}
