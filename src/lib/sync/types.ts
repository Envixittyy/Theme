/** Provider-agnostic shape every connector normalizes into. */
export type NormalizedItem = {
  /** Stable provider identity. For ICS this is the VEVENT UID. */
  externalId: string;
  entityType: 'task' | 'announcement';
  title: string;
  description: string;
  courseCode: string | null;
  dueAt: Date | null;
  allDay: boolean;
  timeZone: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: Date | null;
  publishedAt?: Date | null;
  author?: string | null;
  /** Everything the provider sent, kept for review and for re-normalization. */
  payload: Record<string, unknown>;
};

export type SyncAction = 'created' | 'updated' | 'skipped' | 'conflict' | 'missing' | 'rekeyed' | 'needs_review';

export type FieldChange = { field: string; from: unknown; to: unknown; reason?: string };

export type ItemOutcome = {
  action: SyncAction;
  entityId: string | null;
  externalRecordId: string;
  changes: FieldChange[];
  conflicts: FieldChange[];
};

export type SyncSummary = {
  runId: string;
  seen: number;
  created: number;
  updated: number;
  skipped: number;
  conflicts: number;
  missing: number;
  warnings: string[];
};
