import type { NotionPropertyValue } from './client';
import type { Priority } from '../../domain/priority';
import type { TaskType } from '../../domain/task-type';

/**
 * Field mapping between the app's task model and a Notion database.
 *
 * The mapping is data, stored on the integration account, so a student can
 * point the sync at whatever their Academic Tasks database already looks like.
 * A tested default is offered for the common shape; anything unmapped is simply
 * not synchronised, which is safer than guessing.
 */
export type FieldMapping = {
  /** Notion property names, or null when the field is not synchronised. */
  title: string;
  course: string | null;
  type: string | null;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  source: string | null;
  sourceUrl: string | null;
  submitted: string | null;
  notes: string | null;
  /** Value translation for select-style properties. */
  statusValues: Record<string, string>;
  typeValues: Record<string, string>;
  priorityValues: Record<string, string>;
};

export const DEFAULT_MAPPING: FieldMapping = {
  title: 'Name',
  course: 'Course',
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  dueDate: 'Due',
  source: 'Source',
  sourceUrl: 'Source URL',
  submitted: 'Submitted',
  notes: 'Notes',
  statusValues: {
    inbox: 'Inbox',
    planned: 'Planned',
    in_progress: 'In progress',
    submitted: 'Submitted',
    done: 'Done',
    archived: 'Archived',
  },
  typeValues: {
    assignment: 'Assignment',
    quiz: 'Quiz',
    exam: 'Exam',
    project: 'Project',
    lab: 'Lab',
    reading: 'Reading',
    admin: 'Admin',
  },
  priorityValues: { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' },
};

/**
 * Propose a mapping by matching the database's real property names against the
 * names this product uses. Anything it cannot match confidently is left null
 * rather than guessed, and the UI shows exactly what was and was not matched.
 */
export function proposeMapping(properties: Record<string, { name: string; type: string }>): {
  mapping: FieldMapping;
  matched: string[];
  unmatched: string[];
} {
  const byType = (types: string[]) =>
    Object.values(properties).filter((p) => types.includes(p.type));
  const findNamed = (candidates: string[], types: string[]): string | null => {
    const pool = byType(types);
    for (const candidate of candidates) {
      const hit = pool.find((p) => p.name.toLowerCase() === candidate.toLowerCase());
      if (hit) return hit.name;
    }
    for (const candidate of candidates) {
      const hit = pool.find((p) => p.name.toLowerCase().includes(candidate.toLowerCase()));
      if (hit) return hit.name;
    }
    return null;
  };

  const titleProp = Object.values(properties).find((p) => p.type === 'title');
  const mapping: FieldMapping = {
    ...DEFAULT_MAPPING,
    title: titleProp?.name ?? 'Name',
    course: findNamed(['course', 'subject', 'class'], ['select', 'multi_select', 'relation', 'rich_text']),
    type: findNamed(['type', 'category', 'kind'], ['select', 'multi_select']),
    status: findNamed(['status', 'state'], ['status', 'select']),
    priority: findNamed(['priority', 'importance'], ['select', 'status']),
    dueDate: findNamed(['due', 'deadline', 'date'], ['date']),
    source: findNamed(['source', 'origin'], ['select', 'rich_text']),
    sourceUrl: findNamed(['source url', 'link', 'url'], ['url', 'rich_text']),
    submitted: findNamed(['submitted', 'handed in'], ['checkbox']),
    notes: findNamed(['notes', 'note', 'description'], ['rich_text', 'url']),
  };

  const fields: Array<keyof FieldMapping> = [
    'title',
    'course',
    'type',
    'status',
    'priority',
    'dueDate',
    'source',
    'sourceUrl',
    'submitted',
    'notes',
  ];
  const matched = fields.filter((f) => typeof mapping[f] === 'string' && mapping[f]);
  const unmatched = fields.filter((f) => !mapping[f]);
  return { mapping, matched: matched as string[], unmatched: unmatched as string[] };
}

/* ----------------------------- value readers ----------------------------- */

export function readTitle(value: NotionPropertyValue | undefined): string {
  const parts = (value?.title ?? []) as Array<{ plain_text?: string }>;
  return parts.map((p) => p.plain_text ?? '').join('').trim();
}

export function readRichText(value: NotionPropertyValue | undefined): string {
  const parts = (value?.rich_text ?? []) as Array<{ plain_text?: string }>;
  return parts.map((p) => p.plain_text ?? '').join('').trim();
}

export function readSelect(value: NotionPropertyValue | undefined): string | null {
  const select = (value?.select ?? value?.status) as { name?: string } | null | undefined;
  if (select?.name) return select.name;
  const multi = (value?.multi_select ?? []) as Array<{ name?: string }>;
  return multi[0]?.name ?? null;
}

export function readDate(value: NotionPropertyValue | undefined): { start: Date | null; hasTime: boolean } {
  const date = value?.date as { start?: string } | null | undefined;
  if (!date?.start) return { start: null, hasTime: false };
  return { start: new Date(date.start), hasTime: date.start.includes('T') };
}

export function readCheckbox(value: NotionPropertyValue | undefined): boolean {
  return value?.checkbox === true;
}

export function readUrl(value: NotionPropertyValue | undefined): string | null {
  const url = value?.url;
  return typeof url === 'string' && url ? url : null;
}

export function readRelationOrText(value: NotionPropertyValue | undefined): string | null {
  return readSelect(value) ?? (readRichText(value) || null);
}

/* ----------------------------- value writers ----------------------------- */

export function writeTitle(text: string): NotionPropertyValue {
  return { title: [{ type: 'text', text: { content: text.slice(0, 2000) } }] };
}

export function writeRichText(text: string): NotionPropertyValue {
  return { rich_text: text ? [{ type: 'text', text: { content: text.slice(0, 2000) } }] : [] };
}

export function writeSelect(name: string | null, propertyType: 'select' | 'status' = 'select'): NotionPropertyValue {
  if (!name) return propertyType === 'status' ? { status: null } : { select: null };
  return propertyType === 'status' ? { status: { name } } : { select: { name } };
}

export function writeDate(date: Date | null, allDay: boolean): NotionPropertyValue {
  if (!date) return { date: null };
  return { date: { start: allDay ? date.toISOString().slice(0, 10) : date.toISOString() } };
}

export function writeCheckbox(value: boolean): NotionPropertyValue {
  return { checkbox: value };
}

export function writeUrl(value: string | null): NotionPropertyValue {
  return { url: value || null };
}

/* --------------------------- value translation --------------------------- */

export function toLocalStatus(
  remote: string | null,
  mapping: FieldMapping,
): { status: string | null; confident: boolean } {
  if (!remote) return { status: null, confident: false };
  const entry = Object.entries(mapping.statusValues).find(
    ([, label]) => label.toLowerCase() === remote.toLowerCase(),
  );
  if (entry) return { status: entry[0], confident: true };

  // A value we do not recognise must never silently become Done or Submitted.
  // It is reported as unmapped and the local status is left alone.
  return { status: null, confident: false };
}

export function toLocalType(remote: string | null, mapping: FieldMapping): TaskType | null {
  if (!remote) return null;
  const entry = Object.entries(mapping.typeValues).find(([, l]) => l.toLowerCase() === remote.toLowerCase());
  return (entry?.[0] as TaskType | undefined) ?? null;
}

export function toLocalPriority(remote: string | null, mapping: FieldMapping): Priority | null {
  if (!remote) return null;
  const entry = Object.entries(mapping.priorityValues).find(([, l]) => l.toLowerCase() === remote.toLowerCase());
  return (entry?.[0] as Priority | undefined) ?? null;
}
