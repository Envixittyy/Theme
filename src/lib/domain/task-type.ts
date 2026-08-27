export type TaskType = 'assignment' | 'quiz' | 'exam' | 'project' | 'lab' | 'reading' | 'admin';

/**
 * Keyword inference for imported items. Ordered most-specific first, because
 * "final exam project proposal" should read as a project only if no exam-ish
 * token outranks it — the first match wins by design so the behaviour is
 * predictable and explainable in the UI ("inferred from: 'exam'").
 */
const RULES: Array<{ type: TaskType; patterns: RegExp[] }> = [
  { type: 'exam', patterns: [/\b(final|midterm|prelim|departmental)\s+exam(ination)?s?\b/i, /\bexam(ination)?s?\b/i, /\bfinals?\b/i] },
  { type: 'quiz', patterns: [/\bquiz(zes)?\b/i, /\bseatwork\b/i, /\blong test\b/i, /\bshort test\b/i] },
  { type: 'lab', patterns: [/\blab(oratory)?\s*(report|activity|exercise|experiment|work)?\b/i, /\bpractical\b/i] },
  { type: 'project', patterns: [/\bproject\b/i, /\bcapstone\b/i, /\bthesis\b/i, /\bdesign\s+challenge\b/i, /\bprototype\b/i] },
  { type: 'reading', patterns: [/\bread(ing)?s?\b/i, /\bchapter\s+\d+/i, /\bmodule\s+\d+\s+reading\b/i, /\bwatch\b/i] },
  { type: 'admin', patterns: [/\benroll?ment\b/i, /\bregistration\b/i, /\btuition\b/i, /\bclearance\b/i, /\bform\b/i, /\bsurvey\b/i, /\bevaluation\b/i] },
  { type: 'assignment', patterns: [/\bassignment\b/i, /\bhomework\b/i, /\bproblem set\b/i, /\bexercise\b/i, /\bessay\b/i, /\bpaper\b/i, /\bsubmission\b/i, /\bactivity\b/i] },
];

export type TypeInference = { type: TaskType; matched: string | null };

export function inferTaskType(title: string, description = ''): TypeInference {
  const haystack = `${title}\n${description}`;
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(haystack);
      if (m) return { type: rule.type, matched: m[0] };
    }
  }
  return { type: 'assignment', matched: null };
}

/** Sync may refine the type only while the user has not pinned it. */
export function typeForSync(args: {
  currentType: TaskType;
  typeOverridden: boolean;
  title: string;
  description?: string;
}): { type: TaskType; changed: boolean; matched: string | null } {
  if (args.typeOverridden) return { type: args.currentType, changed: false, matched: null };
  const inferred = inferTaskType(args.title, args.description ?? '');
  return { type: inferred.type, changed: inferred.type !== args.currentType, matched: inferred.matched };
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  assignment: 'Assignment',
  quiz: 'Quiz',
  exam: 'Exam',
  project: 'Project',
  lab: 'Lab',
  reading: 'Reading',
  admin: 'Admin',
};

/** Non-colour glyph so type is distinguishable without relying on hue. */
export const TASK_TYPE_GLYPH: Record<TaskType, string> = {
  assignment: '✎',
  quiz: '◷',
  exam: '★',
  project: '◆',
  lab: '⚗',
  reading: '▤',
  admin: '⚙',
};
