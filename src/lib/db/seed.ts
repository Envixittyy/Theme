/**
 * Demo seed.
 *
 * Produces a term's worth of realistic data anchored to *today*, so the Today
 * screen, calendar and priority ladder all have something meaningful to show
 * whenever the script is run. The Blackboard portion is generated as a genuine
 * iCalendar document and pushed through the real connector, so the seeded
 * external records, sync run, audit rows and notifications are the ones the
 * production pipeline would have produced — nothing is hand-faked.
 */
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from './index';
import { runMigrations } from './migrate';
import {
  announcements,
  courseMeetings,
  courses,
  enrollments,
  integrationAccounts,
  notes,
  reminders,
  smartLists,
  subtasks,
  tags as tagsTable,
  taskTags,
  tasks,
  terms,
  themes,
  userPreferences,
  users,
} from './schema';
import { encryptSecret } from '../security/crypto';
import { integrationSecrets } from './schema';
import { addDaysIn, DEFAULT_TIME_ZONE, startOfDayIn, wallClockIn, zonedToUtc } from '../shared/time';
import { SYSTEM_SMART_LISTS } from '../domain/smart-lists';
import { defaultWidgets } from '../domain/dashboard';
import { dashboardLayouts, widgetInstances } from './schema';
import { syncBlackboardAccount } from '../connectors/blackboard';
import { buildIcs } from '../shared/ics';

const TZ = DEFAULT_TIME_ZONE;
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@school.local';

type CourseSpec = {
  code: string;
  title: string;
  instructor: string;
  room: string;
  color: string;
  icon: string;
  units: number;
  meetings: Array<{ weekday: number; start: number; end: number; modality?: string }>;
};

const COURSES: CourseSpec[] = [
  {
    code: 'CHM031',
    title: 'Chemistry for Engineers',
    instructor: 'Prof. R. Villanueva',
    room: 'Sci 402',
    color: '#8c1d24',
    icon: '⚗',
    units: 3,
    meetings: [
      { weekday: 1, start: 7 * 60 + 30, end: 9 * 60 },
      { weekday: 3, start: 7 * 60 + 30, end: 9 * 60 },
      { weekday: 5, start: 7 * 60 + 30, end: 9 * 60 },
    ],
  },
  {
    code: 'MATH30',
    title: 'Differential Equations',
    instructor: 'Prof. A. Salcedo',
    room: 'Rm 610',
    color: '#1f6f8b',
    icon: '∑',
    units: 3,
    meetings: [
      { weekday: 2, start: 9 * 60, end: 10 * 60 + 30 },
      { weekday: 4, start: 9 * 60, end: 10 * 60 + 30 },
    ],
  },
  {
    code: 'PHY102',
    title: 'Physics for Engineers II',
    instructor: 'Dr. M. Ocampo',
    room: 'Phys Lab 2',
    color: '#b8860b',
    icon: '◎',
    units: 4,
    meetings: [
      { weekday: 1, start: 10 * 60 + 30, end: 12 * 60 },
      { weekday: 3, start: 10 * 60 + 30, end: 12 * 60 },
      { weekday: 5, start: 13 * 60, end: 16 * 60, modality: 'onsite' },
    ],
  },
  {
    code: 'CPE103',
    title: 'Data Structures and Algorithms',
    instructor: 'Engr. J. Ramos',
    room: 'CS Lab 1',
    color: '#1f6d4a',
    icon: '◆',
    units: 3,
    meetings: [
      { weekday: 2, start: 13 * 60, end: 15 * 60 },
      { weekday: 4, start: 13 * 60, end: 15 * 60 },
    ],
  },
  {
    code: 'ENG20',
    title: 'Technical Communication',
    instructor: 'Prof. L. Dizon',
    room: 'Rm 218',
    color: '#6b4b9a',
    icon: '✎',
    units: 2,
    meetings: [{ weekday: 5, start: 9 * 60 + 30, end: 11 * 60 + 30, modality: 'online' }],
  },
  {
    code: 'SOC10',
    title: 'Society and Technology',
    instructor: 'Prof. K. Bautista',
    room: 'Rm 105',
    color: '#a8531f',
    icon: '◍',
    units: 3,
    meetings: [{ weekday: 3, start: 15 * 60 + 30, end: 17 * 60 }],
  },
];

function at(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const day = addDaysIn(now, dayOffset, TZ);
  const wc = wallClockIn(day, TZ);
  return zonedToUtc({ year: wc.year, month: wc.month, day: wc.day, hour, minute }, TZ);
}

export async function seed(options: { quiet?: boolean } = {}): Promise<{ userId: string; email: string }> {
  const log = (msg: string) => {
    if (!options.quiet) console.log(`[seed] ${msg}`);
  };
  const db = await getDb();
  const now = new Date();

  /* ------------------------------- user ------------------------------- */
  let user = (await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1))[0];
  if (user) {
    log(`resetting existing demo account ${DEMO_EMAIL}`);
    await db.delete(users).where(eq(users.id, user.id)); // cascades everywhere
  }
  const inserted = await db
    .insert(users)
    .values({ email: DEMO_EMAIL, displayName: 'Demo Student', timeZone: TZ })
    .returning();
  user = inserted[0]!;
  const userId = user.id;

  await db.insert(userPreferences).values({
    userId,
    themeMode: 'system',
    density: 'comfortable',
    defaultView: '/today',
    dailyDigestEnabled: false,
  });

  await db.insert(themes).values([
    {
      userId,
      name: 'Mapua Warm (built-in)',
      mode: 'light',
      isBuiltIn: true,
      tokens: { '--c-brand': '#8c1d24', '--c-accent': '#b8860b', '--c-canvas': '#faf6f2' },
    },
    {
      userId,
      name: 'Late Library',
      mode: 'dark',
      isBuiltIn: false,
      tokens: { '--c-brand': '#e2727a', '--c-accent': '#e6b455', '--c-canvas': '#16110f' },
    },
  ]);

  /* ------------------------------- term ------------------------------- */
  const termStart = addDaysIn(now, -35, TZ);
  const termEnd = addDaysIn(now, 60, TZ);
  const [term] = await db
    .insert(terms)
    .values({
      userId,
      name: 'First Term SY 2026–2027',
      startsOn: termStart.toISOString().slice(0, 10),
      endsOn: termEnd.toISOString().slice(0, 10),
      isActive: true,
    })
    .returning();

  /* ------------------------------ courses ----------------------------- */
  const courseIds = new Map<string, string>();
  for (const [index, spec] of COURSES.entries()) {
    const [course] = await db
      .insert(courses)
      .values({
        userId,
        termId: term!.id,
        code: spec.code,
        title: spec.title,
        instructor: spec.instructor,
        room: spec.room,
        color: spec.color,
        icon: spec.icon,
        shortLabel: spec.code.slice(0, 4),
        units: spec.units,
        position: index,
      })
      .returning();
    courseIds.set(spec.code, course!.id);
    await db.insert(enrollments).values({ userId, courseId: course!.id, section: 'B1' });
    await db.insert(courseMeetings).values(
      spec.meetings.map((m) => ({
        userId,
        courseId: course!.id,
        weekday: m.weekday,
        startMinute: m.start,
        endMinute: m.end,
        timeZone: TZ,
        location: spec.room,
        modality: m.modality ?? 'onsite',
      })),
    );
  }
  log(`created ${COURSES.length} courses with meetings`);

  /* -------------------------------- tags ------------------------------- */
  const tagIds = new Map<string, string>();
  for (const name of ['group', 'graded', 'reading', 'lab', 'finals']) {
    const [tag] = await db.insert(tagsTable).values({ userId, name }).returning();
    tagIds.set(name, tag!.id);
  }

  /* ------------------------------- tasks ------------------------------- */
  type Spec = {
    title: string;
    course: string;
    type: 'assignment' | 'quiz' | 'exam' | 'project' | 'lab' | 'reading' | 'admin';
    status?: 'inbox' | 'planned' | 'in_progress' | 'submitted' | 'done';
    dayOffset: number | null;
    hour?: number;
    minute?: number;
    priority?: 'urgent' | 'high' | 'medium' | 'low';
    description?: string;
    estimate?: number;
    tags?: string[];
    subtasks?: string[];
    reminders?: number[];
  };

  const specs: Spec[] = [
    { title: 'Problem Set 5 — Exact Equations', course: 'MATH30', type: 'assignment', status: 'in_progress', dayOffset: 0, hour: 23, minute: 59, estimate: 90, subtasks: ['Items 1–6', 'Items 7–12', 'Check answers'], reminders: [120] },
    { title: 'Reading: Chapter 12 — Electromagnetic Induction', course: 'PHY102', type: 'reading', status: 'planned', dayOffset: 0, hour: 22, estimate: 45, tags: ['reading'] },
    { title: 'Peer review feedback form', course: 'ENG20', type: 'admin', status: 'inbox', dayOffset: 0, hour: 17 },
    { title: 'Laboratory Report 4 — Titration', course: 'CHM031', type: 'lab', status: 'planned', dayOffset: 1, hour: 23, minute: 59, estimate: 150, tags: ['lab', 'graded'], subtasks: ['Plot the curve', 'Error analysis', 'Conclusion'], reminders: [1440, 120] },
    { title: 'Quiz 4: Stoichiometry', course: 'CHM031', type: 'quiz', status: 'planned', dayOffset: 2, hour: 8 },
    { title: 'Machine Problem 2 — Balanced BST', course: 'CPE103', type: 'project', status: 'in_progress', dayOffset: 3, hour: 23, minute: 59, estimate: 300, tags: ['graded'], subtasks: ['Insert + rotate', 'Delete', 'Unit tests', 'Write-up'] },
    { title: 'Essay draft: Technology and inequality', course: 'SOC10', type: 'assignment', status: 'planned', dayOffset: 4, hour: 20, estimate: 120 },
    { title: 'Group presentation outline', course: 'ENG20', type: 'project', status: 'inbox', dayOffset: 5, hour: 12, tags: ['group'] },
    { title: 'Problem Set 6 — Laplace Transforms', course: 'MATH30', type: 'assignment', status: 'inbox', dayOffset: 7, hour: 23, minute: 59, estimate: 120 },
    { title: 'Physics Lab 5 — RC Circuits', course: 'PHY102', type: 'lab', status: 'inbox', dayOffset: 8, hour: 16, tags: ['lab'] },
    { title: 'Long Test 2', course: 'CPE103', type: 'exam', status: 'planned', dayOffset: 11, hour: 13, priority: 'high' },
    { title: 'Midterm Examination', course: 'CHM031', type: 'exam', status: 'planned', dayOffset: 18, hour: 7, minute: 30, tags: ['finals'], estimate: 480, subtasks: ['Review modules 1–4', 'Past papers', 'Formula sheet'] },
    { title: 'Midterm Examination', course: 'MATH30', type: 'exam', status: 'planned', dayOffset: 19, hour: 9, tags: ['finals'] },
    { title: 'Research paper — literature review', course: 'SOC10', type: 'project', status: 'inbox', dayOffset: 24, hour: 23, minute: 59, estimate: 600 },
    { title: 'Capstone proposal defence slides', course: 'CPE103', type: 'project', status: 'inbox', dayOffset: 30, hour: 13 },

    // Overdue and completed history, so every list has content.
    { title: 'Problem Set 4 — Linear Equations', course: 'MATH30', type: 'assignment', status: 'submitted', dayOffset: -3, hour: 23, minute: 59 },
    { title: 'Laboratory Report 3 — Gas Laws', course: 'CHM031', type: 'lab', status: 'done', dayOffset: -6, hour: 23, minute: 59, tags: ['lab'] },
    { title: 'Reading: Chapter 11 — Magnetism', course: 'PHY102', type: 'reading', status: 'done', dayOffset: -4, hour: 22 },
    { title: 'Reflection paper 1', course: 'SOC10', type: 'assignment', status: 'submitted', dayOffset: -8, hour: 20 },
    { title: 'Course evaluation form', course: 'ENG20', type: 'admin', status: 'inbox', dayOffset: -2, hour: 17, description: 'Registrar reminder — still open.' },
    { title: 'Machine Problem 1 — Linked Lists', course: 'CPE103', type: 'project', status: 'done', dayOffset: -10, hour: 23, minute: 59 },
    { title: 'Quiz 3: Thermochemistry', course: 'CHM031', type: 'quiz', status: 'done', dayOffset: -9, hour: 8 },

    // No-deadline capture, to exercise the "no deadline" smart list.
    { title: 'Ask about the scholarship renewal window', course: 'ENG20', type: 'admin', status: 'inbox', dayOffset: null },
    { title: 'Rewrite CPE103 notes into flashcards', course: 'CPE103', type: 'reading', status: 'inbox', dayOffset: null, estimate: 60 },
  ];

  let created = 0;
  for (const spec of specs) {
    const dueAt = spec.dayOffset === null ? null : at(now, spec.dayOffset, spec.hour ?? 23, spec.minute ?? 59);
    const status = spec.status ?? 'inbox';
    const [task] = await db
      .insert(tasks)
      .values({
        userId,
        courseId: courseIds.get(spec.course) ?? null,
        title: spec.title,
        description: spec.description ?? '',
        status,
        type: spec.type,
        priority:
          spec.priority ??
          (dueAt === null
            ? 'medium'
            : dueAt.getTime() < now.getTime()
              ? 'urgent'
              : dueAt.getTime() - now.getTime() < 3 * 86_400_000
                ? 'high'
                : dueAt.getTime() - now.getTime() < 14 * 86_400_000
                  ? 'medium'
                  : 'low'),
        priorityOverridden: !!spec.priority,
        dueAt,
        dueTimeZone: TZ,
        allDay: false,
        estimateMinutes: spec.estimate ?? null,
        completedAt: status === 'done' ? addDaysIn(now, (spec.dayOffset ?? 0) + 1, TZ) : null,
        submittedAt: status === 'submitted' || status === 'done' ? addDaysIn(now, spec.dayOffset ?? 0, TZ) : null,
        position: created,
      })
      .returning();
    created += 1;

    if (spec.subtasks?.length) {
      await db.insert(subtasks).values(
        spec.subtasks.map((title, i) => ({
          userId,
          taskId: task!.id,
          title,
          position: i,
          done: status === 'done' || (status === 'in_progress' && i === 0),
        })),
      );
    }
    if (spec.tags?.length) {
      await db
        .insert(taskTags)
        .values(spec.tags.filter((t) => tagIds.has(t)).map((t) => ({ taskId: task!.id, tagId: tagIds.get(t)! })))
        .onConflictDoNothing();
    }
    if (spec.reminders?.length) {
      await db.insert(reminders).values(
        spec.reminders.map((offsetMinutes) => ({ userId, taskId: task!.id, offsetMinutes })),
      );
    }
  }
  log(`created ${created} tasks`);

  /* ---------------------------- smart lists ---------------------------- */
  await db.insert(smartLists).values(
    SYSTEM_SMART_LISTS.map((list, index) => ({
      userId,
      name: list.name,
      icon: list.icon,
      query: list.query,
      isSystem: true,
      position: index,
    })),
  );
  await db.insert(smartLists).values({
    userId,
    name: 'This week, graded only',
    icon: 'star',
    query: { dueWithinDays: 7, tags: ['graded'], includeCompleted: false, sort: 'due', direction: 'asc' },
    isSystem: false,
    position: SYSTEM_SMART_LISTS.length,
  });

  /* ------------------------------- notes ------------------------------- */
  await db.insert(notes).values([
    {
      userId,
      courseId: courseIds.get('CHM031')!,
      title: 'Titration lab — working notes',
      body: [
        '# Titration lab',
        '',
        '## Setup',
        '- Burette rinsed with titrant, not water',
        '- Record initial volume to 2 dp',
        '',
        '## Checklist',
        '- [x] Standardise NaOH',
        '- [ ] Three concordant trials',
        '- [ ] Plot pH curve',
        '',
        'See [[Quiz 4 revision]] for the stoichiometry recap.',
      ].join('\n'),
      pinned: true,
    },
    {
      userId,
      courseId: courseIds.get('CHM031')!,
      title: 'Quiz 4 revision',
      body: '# Quiz 4 revision\n\nLimiting reagent → always convert to moles first.\n\n- Percent yield = actual / theoretical × 100\n- Watch significant figures.',
    },
    {
      userId,
      courseId: courseIds.get('CPE103')!,
      title: 'AVL rotations cheat sheet',
      body: '# AVL rotations\n\n| Case | Fix |\n| --- | --- |\n| LL | right rotate |\n| RR | left rotate |\n| LR | left, then right |\n| RL | right, then left |\n\nRebalance from the inserted node upward.',
    },
    {
      userId,
      title: 'Term admin',
      body: '- Scholarship renewal opens in November\n- Library fines cleared\n- [ ] Book study room for finals week',
    },
  ]);

  /* --------------------------- announcements --------------------------- */
  await db.insert(announcements).values([
    {
      userId,
      courseId: courseIds.get('CHM031')!,
      title: 'Quiz 4 coverage finalised',
      bodyExcerpt: 'Quiz 4 covers modules 3 and 4 only. Bring a scientific calculator; phones are not allowed.',
      bodyFull:
        'Quiz 4 covers modules 3 and 4 only. Bring a scientific calculator; phones are not allowed.\n\nThe quiz runs for 45 minutes at the start of the session.',
      author: 'Prof. R. Villanueva',
      publishedAt: at(now, -1, 16, 20),
      source: 'blackboard',
      contentHash: 'seed-ann-1',
      sourceUrl: 'https://blackboard.example.edu/ultra/courses/_101_1/announcements',
    },
    {
      userId,
      courseId: courseIds.get('CPE103')!,
      title: 'Machine Problem 2 deadline extended',
      bodyExcerpt: 'MP2 is now due Sunday 23:59 to give everyone time after the long test.',
      bodyFull: 'MP2 is now due Sunday 23:59 to give everyone time after the long test. The rubric is unchanged.',
      author: 'Engr. J. Ramos',
      publishedAt: at(now, -2, 9, 5),
      source: 'blackboard',
      contentHash: 'seed-ann-2',
      readAt: at(now, -2, 12, 0),
    },
    {
      userId,
      courseId: courseIds.get('PHY102')!,
      title: 'Lab section moved to Physics Lab 2',
      bodyExcerpt: 'Friday sessions move to Physics Lab 2 for the rest of the term.',
      bodyFull: 'Friday sessions move to Physics Lab 2 for the rest of the term. Bring your lab manual.',
      author: 'Dr. M. Ocampo',
      publishedAt: at(now, -4, 14, 40),
      source: 'blackboard',
      contentHash: 'seed-ann-3',
    },
  ]);

  /* --------------------------- dashboard layouts ------------------------ */
  for (const breakpoint of ['mobile', 'tablet', 'desktop'] as const) {
    const [layout] = await db.insert(dashboardLayouts).values({ userId, breakpoint }).returning();
    await db
      .insert(widgetInstances)
      .values(defaultWidgets(breakpoint).map((w) => ({ ...w, layoutId: layout!.id, userId })));
  }

  /* --------------------- demo Blackboard integration -------------------- */
  // A demo-mode account: clearly labelled, no network access, and the feed is
  // pushed through the real connector so the sync history is genuine.
  const [account] = await db
    .insert(integrationAccounts)
    .values({
      userId,
      provider: 'blackboard_ics',
      label: 'Demo Blackboard feed',
      config: { timeZone: TZ, demo: true },
      status: 'connected',
    })
    .returning();
  const { ciphertext, keyId } = encryptSecret('https://blackboard.demo.invalid/feed/demo-only.ics');
  await db.insert(integrationSecrets).values({
    accountId: account!.id,
    name: 'ics_url',
    ciphertext,
    keyId,
    displayHint: 'https://blackboard.demo.invalid/…/demo-only.ics',
  });

  const feed = buildIcs(
    [
      {
        uid: 'demo-bb-1@school.local',
        summary: 'PHY102 - Laboratory Report 5: RC Circuits',
        description: 'Upload the PDF through the Blackboard assignment link.',
        start: at(now, 9, 16, 0),
        url: 'https://blackboard.demo.invalid/ultra/courses/_202_1/outline/assessment/551',
        categories: ['PHY102'],
        lastModified: at(now, -1, 8, 0),
      },
      {
        uid: 'demo-bb-2@school.local',
        summary: 'SOC10 - Reflection paper 2',
        description: 'Two pages, double spaced.',
        start: at(now, 6, 20, 0),
        url: 'https://blackboard.demo.invalid/ultra/courses/_303_1/outline/assessment/77',
        categories: ['SOC10'],
      },
      {
        uid: 'demo-bb-3@school.local',
        summary: 'MATH30 - Quiz 5: Series Solutions',
        start: at(now, 5, 9, 0),
        categories: ['MATH30'],
      },
    ],
    'Demo Blackboard feed',
  );

  const summary = await syncBlackboardAccount(userId, account!.id, {
    trigger: 'connect',
    icsText: feed,
    now,
    notify: true,
  });
  log(`demo Blackboard sync: ${summary.created} created, ${summary.skipped} unchanged`);

  log(`done. Sign in as ${DEMO_EMAIL}`);
  return { userId, email: DEMO_EMAIL };
}

const isDirect = process.argv[1]?.includes('seed');
if (isDirect) {
  runMigrations()
    .then(() => seed())
    .then(async () => closeDb())
    .catch(async (err) => {
      console.error('[seed] failed:', err);
      await closeDb();
      process.exit(1);
    });
}
