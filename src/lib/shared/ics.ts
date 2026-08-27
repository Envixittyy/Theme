import { isValidTimeZone, zonedToUtc } from './time';

/**
 * A small, strict iCalendar (RFC 5545) reader and writer.
 *
 * Written rather than pulled from npm because the input is untrusted: a feed
 * URL is user-supplied, so the parser needs hard caps on line count, property
 * size and event count, and must never evaluate anything it reads. It covers
 * the subset Blackboard and university feeds actually emit.
 */

export type IcsEvent = {
  uid: string | null;
  summary: string;
  description: string;
  location: string | null;
  url: string | null;
  /** Deadline: DUE if present, else DTSTART (Blackboard emits both shapes). */
  dueAt: Date | null;
  startAt: Date | null;
  endAt: Date | null;
  allDay: boolean;
  /** IANA zone the feed authored the time in, when it says. */
  timeZone: string | null;
  lastModified: Date | null;
  created: Date | null;
  sequence: number | null;
  categories: string[];
  status: string | null;
  raw: Record<string, string>;
};

export type IcsParseResult = {
  events: IcsEvent[];
  calendarName: string | null;
  /** Non-fatal problems, surfaced in the sync report instead of thrown away. */
  warnings: string[];
};

export class IcsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsParseError';
  }
}

const LIMITS = {
  maxBytes: 5_000_000,
  maxLines: 200_000,
  maxEvents: 5_000,
  maxPropertyLength: 20_000,
};

/** RFC 5545 §3.1: continuation lines begin with a space or tab. */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length > LIMITS.maxLines) throw new IcsParseError('calendar has too many lines');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\');
}

type ParsedLine = { name: string; params: Record<string, string>; value: string };

function parseLine(line: string): ParsedLine | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  if (value.length > LIMITS.maxPropertyLength) throw new IcsParseError('property value too long');

  const segments = splitUnquoted(head, ';');
  const name = (segments.shift() ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const seg of segments) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** The first colon that is not inside a quoted parameter value. */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) return i;
  }
  return -1;
}

function splitUnquoted(text: string, sep: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

export function parseIcsDate(value: string, params: Record<string, string>): { date: Date | null; allDay: boolean; timeZone: string | null } {
  const tzid = params['TZID'] && isValidTimeZone(params['TZID']) ? params['TZID'] : null;

  // DATE form: 20260826
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly as unknown as [string, string, string, string];
    const zone = tzid ?? 'UTC';
    return {
      date: zonedToUtc({ year: Number(y), month: Number(m), day: Number(d) }, zone),
      allDay: true,
      timeZone: tzid,
    };
  }

  // DATE-TIME form: 20260826T155900Z or 20260826T235900
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dt) return { date: null, allDay: false, timeZone: tzid };
  const [, y, mo, d, h, mi, s, z] = dt as unknown as [string, string, string, string, string, string, string, string | undefined];
  const wc = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  if (z) return { date: zonedToUtc(wc, 'UTC'), allDay: false, timeZone: 'UTC' };
  // Floating time with no TZID: interpret in the zone the caller supplies later.
  return { date: zonedToUtc(wc, tzid ?? 'UTC'), allDay: false, timeZone: tzid };
}

export function parseIcs(text: string): IcsParseResult {
  if (text.length > LIMITS.maxBytes) throw new IcsParseError('calendar exceeds the size limit');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new IcsParseError('not an iCalendar document');

  const warnings: string[] = [];
  const events: IcsEvent[] = [];
  let calendarName: string | null = null;

  let inEvent = false;
  let inOtherComponent: string | null = null;
  let current: Partial<IcsEvent> & { raw: Record<string, string> } = { raw: {} };

  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === 'BEGIN') {
      const component = value.toUpperCase();
      if (component === 'VEVENT') {
        inEvent = true;
        current = { raw: {}, categories: [] };
      } else if (component === 'VCALENDAR') {
        // The root container: its own properties (X-WR-CALNAME) are wanted.
      } else if (!inEvent) {
        // VTIMEZONE / VALARM bodies are skipped wholesale rather than
        // half-interpreted; TZID names carry the information we need.
        inOtherComponent = component;
      }
      continue;
    }
    if (name === 'END') {
      const component = value.toUpperCase();
      if (component === 'VEVENT' && inEvent) {
        inEvent = false;
        const built = finalizeEvent(current);
        if (built) {
          if (events.length >= LIMITS.maxEvents) throw new IcsParseError('calendar has too many events');
          events.push(built);
        } else {
          warnings.push('skipped a VEVENT with no usable summary or date');
        }
      } else if (component === inOtherComponent) {
        inOtherComponent = null;
      }
      continue;
    }

    if (inOtherComponent) continue;

    if (!inEvent) {
      if (name === 'X-WR-CALNAME') calendarName = unescapeText(value).slice(0, 200);
      continue;
    }

    current.raw[name] = value;

    switch (name) {
      case 'UID':
        current.uid = value.trim().slice(0, 500) || null;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value).trim().slice(0, 500);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(value).trim().slice(0, 10_000);
        break;
      case 'LOCATION':
        current.location = unescapeText(value).trim().slice(0, 300) || null;
        break;
      case 'URL':
        current.url = sanitizeUrl(value.trim());
        break;
      case 'DTSTART': {
        const r = parseIcsDate(value, params);
        current.startAt = r.date;
        current.allDay = r.allDay;
        current.timeZone = r.timeZone ?? current.timeZone ?? null;
        break;
      }
      case 'DTEND': {
        current.endAt = parseIcsDate(value, params).date;
        break;
      }
      case 'DUE': {
        const r = parseIcsDate(value, params);
        current.dueAt = r.date;
        current.allDay = r.allDay;
        current.timeZone = r.timeZone ?? current.timeZone ?? null;
        break;
      }
      case 'LAST-MODIFIED':
        current.lastModified = parseIcsDate(value, params).date;
        break;
      case 'CREATED':
        current.created = parseIcsDate(value, params).date;
        break;
      case 'SEQUENCE':
        current.sequence = Number.isFinite(Number(value)) ? Number(value) : null;
        break;
      case 'STATUS':
        current.status = value.trim().toUpperCase().slice(0, 32);
        break;
      case 'CATEGORIES':
        current.categories = splitUnquoted(value, ',').map((c) => unescapeText(c).trim()).filter(Boolean).slice(0, 20);
        break;
      default:
        break;
    }
  }

  if (inEvent) warnings.push('calendar ended inside a VEVENT; the last event was ignored');
  return { events, calendarName, warnings };
}

function finalizeEvent(draft: Partial<IcsEvent> & { raw: Record<string, string> }): IcsEvent | null {
  const summary = draft.summary?.trim();
  const due = draft.dueAt ?? draft.startAt ?? null;
  if (!summary && !due) return null;
  return {
    uid: draft.uid ?? null,
    summary: summary || 'Untitled item',
    description: draft.description ?? '',
    location: draft.location ?? null,
    url: draft.url ?? null,
    dueAt: due,
    startAt: draft.startAt ?? null,
    endAt: draft.endAt ?? null,
    allDay: draft.allDay ?? false,
    timeZone: draft.timeZone ?? null,
    lastModified: draft.lastModified ?? null,
    created: draft.created ?? null,
    sequence: draft.sequence ?? null,
    categories: draft.categories ?? [],
    status: draft.status ?? null,
    raw: draft.raw,
  };
}

/** Only http(s) links survive; `javascript:` and friends are dropped. */
function sanitizeUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/* ------------------------------ serializing ------------------------------ */

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** RFC 5545 §3.1: lines are folded at 75 octets. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    parts.push(rest.slice(0, 73));
    rest = rest.slice(73);
  }
  parts.push(rest);
  return parts.join('\r\n ');
}

function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export type IcsExportEvent = {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  url?: string | null;
  categories?: string[];
  lastModified?: Date;
};

export function buildIcs(events: IcsExportEvent[], calendarName: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mapua School OS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${formatUtc(new Date())}`);
    lines.push(`DTSTART:${formatUtc(event.start)}`);
    if (event.end) lines.push(`DTEND:${formatUtc(event.end)}`);
    lines.push(fold(`SUMMARY:${escapeText(event.summary)}`));
    if (event.description) lines.push(fold(`DESCRIPTION:${escapeText(event.description)}`));
    if (event.url) lines.push(fold(`URL:${event.url}`));
    if (event.categories?.length) lines.push(fold(`CATEGORIES:${event.categories.map(escapeText).join(',')}`));
    if (event.lastModified) lines.push(`LAST-MODIFIED:${formatUtc(event.lastModified)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
