import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/lib/domain/quick-add';
import { derivePriority, priorityForSync } from '@/lib/domain/priority';
import { inferTaskType, typeForSync } from '@/lib/domain/task-type';
import { isoDateIn, zonedToUtc } from '@/lib/shared/time';

const MNL = 'Asia/Manila';
// Wednesday, 26 August 2026, 09:00 Manila.
const NOW = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 9 }, MNL);

const parse = (input: string) => parseQuickAdd(input, { now: NOW, timeZone: MNL });

describe('quick-add parser', () => {
  it('extracts course, priority, type, tags and estimate', () => {
    const r = parse('Finish lab report #CHM031 !high @lab +group ~90m');
    expect(r.title).toBe('Finish lab report');
    expect(r.courseCode).toBe('CHM031');
    expect(r.priority).toBe('high');
    expect(r.type).toBe('lab');
    expect(r.typeExplicit).toBe(true);
    expect(r.tags).toEqual(['group']);
    expect(r.estimateMinutes).toBe(90);
  });

  it('accepts hour estimates', () => {
    expect(parse('Read chapter 4 ~2h').estimateMinutes).toBe(120);
    expect(parse('Read chapter 4 ~1.5h').estimateMinutes).toBe(90);
  });

  it('parses "tomorrow 5pm" in the user zone', () => {
    const r = parse('Submit essay tomorrow 5pm');
    expect(r.title).toBe('Submit essay');
    expect(r.allDay).toBe(false);
    expect(r.dueAt!.toISOString()).toBe(
      zonedToUtc({ year: 2026, month: 8, day: 27, hour: 17 }, MNL).toISOString(),
    );
  });

  it('defaults a date-only capture to end of day, flagged all-day', () => {
    const r = parse('Peer review due friday');
    expect(r.allDay).toBe(true);
    expect(isoDateIn(r.dueAt!, MNL)).toBe('2026-08-28'); // the coming Friday
    expect(r.dueAt!.toISOString()).toBe(
      zonedToUtc({ year: 2026, month: 8, day: 28, hour: 23, minute: 59 }, MNL).toISOString(),
    );
  });

  it('treats a bare weekday as the next one, never today', () => {
    // NOW is a Wednesday.
    expect(isoDateIn(parse('standup wed')!.dueAt!, MNL)).toBe('2026-09-02');
  });

  it('reads "next friday" as the following week when the plain match is this week', () => {
    expect(isoDateIn(parse('demo next friday')!.dueAt!, MNL)).toBe('2026-09-04');
  });

  it('parses relative and absolute dates', () => {
    expect(isoDateIn(parse('quiz in 3 days')!.dueAt!, MNL)).toBe('2026-08-29');
    expect(isoDateIn(parse('exam sep 14')!.dueAt!, MNL)).toBe('2026-09-14');
    expect(isoDateIn(parse('exam 14 sep')!.dueAt!, MNL)).toBe('2026-09-14');
    expect(isoDateIn(parse('exam 9/14')!.dueAt!, MNL)).toBe('2026-09-14');
    expect(isoDateIn(parse('exam 2026-12-01')!.dueAt!, MNL)).toBe('2026-12-01');
  });

  it('rolls a past month/day forward to next year', () => {
    expect(isoDateIn(parse('reg jan 5')!.dueAt!, MNL)).toBe('2027-01-05');
  });

  it('interprets a bare time as today when still ahead, else tomorrow', () => {
    expect(isoDateIn(parse('gym at 6pm')!.dueAt!, MNL)).toBe('2026-08-26');
    expect(isoDateIn(parse('gym at 7am')!.dueAt!, MNL)).toBe('2026-08-27');
  });

  it('leaves unparsed text in the title and reports every consumed token', () => {
    const r = parse('Email registrar about !bogus token');
    expect(r.title).toBe('Email registrar about !bogus token');
    expect(r.tokens).toHaveLength(0);
    expect(r.dueAt).toBeNull();
  });

  it('infers a type from wording when none is given', () => {
    expect(parse('Midterm exam review').type).toBe('exam');
    expect(parse('Problem set 3').type).toBe('assignment');
  });

  it('handles 24-hour times and keywords', () => {
    const r = parse('Upload deliverable today 23:59');
    expect(r.dueAt!.toISOString()).toBe(
      zonedToUtc({ year: 2026, month: 8, day: 26, hour: 23, minute: 59 }, MNL).toISOString(),
    );
    expect(parse('Sleep tonight').dueAt).not.toBeNull();
  });
});

describe('priority rules', () => {
  const due = (d: number, h = 23, m = 59) =>
    zonedToUtc({ year: 2026, month: 8, day: d, hour: h, minute: m }, MNL);

  it('applies the overdue/today/3-day/14-day ladder', () => {
    expect(derivePriority(due(25), NOW, MNL)).toBe('urgent'); // yesterday
    expect(derivePriority(due(26), NOW, MNL)).toBe('urgent'); // today
    expect(derivePriority(due(27), NOW, MNL)).toBe('high');
    expect(derivePriority(due(29), NOW, MNL)).toBe('high'); // +3 days
    expect(derivePriority(due(30), NOW, MNL)).toBe('medium'); // +4 days
    expect(derivePriority(due(9 + 0), NOW, MNL)).toBe('urgent'); // 9 Aug, past
    expect(derivePriority(zonedToUtc({ year: 2026, month: 9, day: 9 }, MNL), NOW, MNL)).toBe('medium'); // +14
    expect(derivePriority(zonedToUtc({ year: 2026, month: 9, day: 10 }, MNL), NOW, MNL)).toBe('low'); // +15
  });

  it('treats a task with no deadline as medium', () => {
    expect(derivePriority(null, NOW, MNL)).toBe('medium');
  });

  it('judges "due today" by the local calendar, not by hours remaining', () => {
    // 23:00 Manila, deadline 23:59 the same local day → urgent, 59 minutes out.
    const late = zonedToUtc({ year: 2026, month: 8, day: 26, hour: 23 }, MNL);
    expect(derivePriority(due(26), late, MNL)).toBe('urgent');
    // Same instant, deadline 00:30 the next local day → high, 90 minutes out.
    expect(derivePriority(due(27, 0, 30), late, MNL)).toBe('high');
  });

  it('never lets a sync overwrite a user priority override', () => {
    const overridden = priorityForSync({
      currentPriority: 'low',
      priorityOverridden: true,
      dueAt: due(26),
      now: NOW,
      timeZone: MNL,
    });
    expect(overridden).toMatchObject({ priority: 'low', changed: false });

    const free = priorityForSync({
      currentPriority: 'low',
      priorityOverridden: false,
      dueAt: due(26),
      now: NOW,
      timeZone: MNL,
    });
    expect(free).toMatchObject({ priority: 'urgent', changed: true });
  });
});

describe('type inference', () => {
  it('picks the most specific keyword', () => {
    expect(inferTaskType('Final Examination — Thermodynamics').type).toBe('exam');
    expect(inferTaskType('Quiz 4: Stoichiometry').type).toBe('quiz');
    expect(inferTaskType('Laboratory Report 2').type).toBe('lab');
    expect(inferTaskType('Capstone Project Proposal').type).toBe('project');
    expect(inferTaskType('Reading: Chapter 12').type).toBe('reading');
    expect(inferTaskType('Enrollment clearance form').type).toBe('admin');
    expect(inferTaskType('Untitled item').type).toBe('assignment');
  });

  it('reports the matched keyword so the UI can explain itself', () => {
    expect(inferTaskType('Quiz 4').matched?.toLowerCase()).toBe('quiz');
    expect(inferTaskType('Untitled item').matched).toBeNull();
  });

  it('respects a pinned type on later syncs', () => {
    expect(
      typeForSync({ currentType: 'admin', typeOverridden: true, title: 'Quiz 5' }),
    ).toMatchObject({ type: 'admin', changed: false });
    expect(
      typeForSync({ currentType: 'assignment', typeOverridden: false, title: 'Quiz 5' }),
    ).toMatchObject({ type: 'quiz', changed: true });
  });
});
