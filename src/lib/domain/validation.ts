import { z } from 'zod';
import { isValidTimeZone } from '../shared/time';

/**
 * One schema module shared by route handlers, server actions, the sync engine
 * and the AI preview flow. Validation lives here so that "the AI proposed it"
 * and "the user typed it" go through identical checks.
 */

export const taskStatusSchema = z.enum(['inbox', 'planned', 'in_progress', 'submitted', 'done', 'archived']);
export const taskTypeSchema = z.enum(['assignment', 'quiz', 'exam', 'project', 'lab', 'reading', 'admin']);
export const prioritySchema = z.enum(['urgent', 'high', 'medium', 'low']);

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: 'Unknown IANA time zone' });

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a 6-digit hex value like #8c1d24');

const isoDateTime = z.union([z.string().datetime({ offset: true }), z.string().datetime()]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(500),
  description: z.string().max(20_000).default(''),
  courseId: z.uuid().nullable().optional(),
  status: taskStatusSchema.default('inbox'),
  type: taskTypeSchema.default('assignment'),
  priority: prioritySchema.optional(),
  startAt: isoDateTime.nullable().optional(),
  dueAt: isoDateTime.nullable().optional(),
  dueTimeZone: timeZoneSchema.optional(),
  allDay: z.boolean().default(false),
  durationMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
  subtasks: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  reminders: z.array(z.number().int().min(-10_080).max(43_200)).max(10).default([]),
  sourceUrl: z.url().max(2000).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .extend({
    // Explicit override flags let the client say "the user chose this", which is
    // what stops the next sync from recomputing it.
    priorityOverridden: z.boolean().optional(),
    typeOverridden: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const bulkTaskUpdateSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
  patch: z.object({
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    type: taskTypeSchema.optional(),
    courseId: z.uuid().nullable().optional(),
    dueAt: isoDateTime.nullable().optional(),
    addTags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
    removeTags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  }),
});

export const createCourseSchema = z.object({
  code: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(200),
  instructor: z.string().trim().max(120).nullable().optional(),
  room: z.string().trim().max(80).nullable().optional(),
  color: hexColorSchema.default('#8c1d24'),
  icon: z.string().trim().max(8).nullable().optional(),
  shortLabel: z.string().trim().max(8).nullable().optional(),
  units: z.number().min(0).max(20).nullable().optional(),
  termId: z.uuid().nullable().optional(),
  meetings: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
        location: z.string().trim().max(80).nullable().optional(),
        modality: z.enum(['onsite', 'online', 'hybrid']).default('onsite'),
        timeZone: timeZoneSchema.optional(),
      }),
    )
    .max(14)
    .default([]),
});

export const noteSchema = z.object({
  title: z.string().trim().max(200).default('Untitled note'),
  body: z.string().max(200_000).default(''),
  courseId: z.uuid().nullable().optional(),
  taskId: z.uuid().nullable().optional(),
  pinned: z.boolean().optional(),
});

export const smartListQuerySchema = z.object({
  statuses: z.array(taskStatusSchema).optional(),
  types: z.array(taskTypeSchema).optional(),
  priorities: z.array(prioritySchema).optional(),
  courseIds: z.array(z.uuid()).optional(),
  tags: z.array(z.string()).optional(),
  sources: z.array(z.enum(['local', 'blackboard', 'notion', 'ical', 'ai'])).optional(),
  /** Relative windows are stored, not absolute dates, so a list stays true tomorrow. */
  dueWithinDays: z.number().int().min(0).max(365).nullable().optional(),
  dueAfterDays: z.number().int().min(-365).max(365).nullable().optional(),
  overdueOnly: z.boolean().optional(),
  hasNoDueDate: z.boolean().optional(),
  includeCompleted: z.boolean().optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['due', 'priority', 'created', 'title', 'manual']).default('due'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export const createSmartListSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(8).nullable().optional(),
  query: smartListQuerySchema,
});

export const widgetLayoutSchema = z.object({
  breakpoint: z.enum(['mobile', 'tablet', 'desktop']),
  widgets: z
    .array(
      z.object({
        widgetKey: z.string().min(1).max(48),
        span: z.number().int().min(1).max(4),
        height: z.enum(['auto', 'short', 'tall']).default('auto'),
        hidden: z.boolean().default(false),
        settings: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(40),
});

export const preferencesSchema = z.object({
  themeMode: z.enum(['light', 'dark', 'system']).optional(),
  themeId: z.uuid().nullable().optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
  defaultView: z.string().max(64).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  timeFormat: z.enum(['h12', 'h24']).optional(),
  timeZone: timeZoneSchema.optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStartMinute: z.number().int().min(0).max(1439).optional(),
  quietHoursEndMinute: z.number().int().min(0).max(1439).optional(),
  dailyDigestEnabled: z.boolean().optional(),
  dailyDigestMinute: z.number().int().min(0).max(1439).optional(),
  notificationKinds: z.record(z.string(), z.boolean()).optional(),
  courseNotificationOptOut: z.record(z.string(), z.boolean()).optional(),
  localAiEnabled: z.boolean().optional(),
  localAiIndexingEnabled: z.boolean().optional(),
});

export const themeSchema = z.object({
  name: z.string().trim().min(1).max(48),
  mode: z.enum(['light', 'dark']),
  tokens: z.record(
    z.string().regex(/^--c-[a-z0-9-]+$/, 'Only colour tokens may be overridden'),
    hexColorSchema,
  ),
});

/** Attachment intake: the client never chooses the storage key or trusts the name. */
export const attachmentInitSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().min(1),
  taskId: z.uuid().nullable().optional(),
  noteId: z.uuid().nullable().optional(),
  courseId: z.uuid().nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type SmartListQuery = z.infer<typeof smartListQuerySchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
