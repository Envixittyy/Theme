import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ===========================================================================
   Conventions
   ---------------------------------------------------------------------------
   * Every timestamp is `timestamptz` and is stored in UTC. Wall-clock intent is
     preserved separately in `*_tz` columns (IANA zone) so that a 23:59 deadline
     stays 23:59 for the student even if they travel.
   * Every user-owned row carries `user_id` directly. Authorization is a
     predicate on the row, never an inference from a parent join.
   * `source`/`external_*` columns exist on anything an integration can create,
     so a sync can always find "the row I made last time".
   =========================================================================== */

export const taskStatus = pgEnum('task_status', [
  'inbox',
  'planned',
  'in_progress',
  'submitted',
  'done',
  'archived',
]);

export const taskType = pgEnum('task_type', [
  'assignment',
  'quiz',
  'exam',
  'project',
  'lab',
  'reading',
  'admin',
]);

export const taskPriority = pgEnum('task_priority', ['urgent', 'high', 'medium', 'low']);

export const sourceKind = pgEnum('source_kind', ['local', 'blackboard', 'notion', 'ical', 'ai']);

export const providerKind = pgEnum('provider_kind', [
  'blackboard_ics',
  'blackboard_api',
  'blackboard_email',
  'notion',
]);

export const syncRunStatus = pgEnum('sync_run_status', [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
]);

export const conflictState = pgEnum('conflict_state', ['open', 'resolved_local', 'resolved_remote', 'dismissed']);

export const notificationKind = pgEnum('notification_kind', [
  'blackboard_new_item',
  'blackboard_due_changed',
  'announcement',
  'reminder',
  'daily_digest',
  'sync_failure',
]);

export const deliveryChannel = pgEnum('delivery_channel', ['web_push', 'in_app']);

export const deliveryState = pgEnum('delivery_state', [
  'pending',
  'sent',
  'suppressed_quiet_hours',
  'suppressed_preference',
  'failed',
  'expired',
]);

export const jobState = pgEnum('job_state', ['queued', 'running', 'succeeded', 'failed', 'dead']);

/* ========================= Identity ========================= */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull().default(''),
    timeZone: text('time_zone').notNull().default('Asia/Manila'),
    locale: text('locale').notNull().default('en-PH'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the session secret. The raw secret only ever lives in the cookie. */
    tokenHash: text('token_hash').notNull(),
    csrfSecret: text('csrf_secret').notNull(),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestIpHash: text('request_ip_hash'),
  },
  (t) => [uniqueIndex('magic_link_token_hash_key').on(t.tokenHash), index('magic_link_email_idx').on(t.email)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('Device'),
    platform: text('platform').notNull().default('unknown'),
    isStandalonePwa: boolean('is_standalone_pwa').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

/* ========================= Academic structure ========================= */

export const terms = pgTable(
  'terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startsOn: text('starts_on').notNull(), // ISO date, no time component
    endsOn: text('ends_on').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('terms_user_idx').on(t.userId)],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    termId: uuid('term_id').references(() => terms.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    instructor: text('instructor'),
    room: text('room'),
    color: text('color').notNull().default('#8c1d24'),
    icon: text('icon'),
    /** Non-colour redundant identity (WCAG: never colour alone). */
    shortLabel: text('short_label'),
    units: real('units'),
    archived: boolean('archived').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('courses_user_idx').on(t.userId), uniqueIndex('courses_user_code_key').on(t.userId, t.code)],
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    section: text('section'),
    status: text('status').notNull().default('active'),
    externalCourseId: text('external_course_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('enrollments_user_course_key').on(t.userId, t.courseId)],
);

export const courseMeetings = pgTable(
  'course_meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    /** 0=Sunday .. 6=Saturday, in the meeting's own time zone. */
    weekday: integer('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    timeZone: text('time_zone').notNull().default('Asia/Manila'),
    location: text('location'),
    modality: text('modality').notNull().default('onsite'),
    effectiveFrom: text('effective_from'),
    effectiveTo: text('effective_to'),
  },
  (t) => [index('course_meetings_course_idx').on(t.courseId), index('course_meetings_user_idx').on(t.userId)],
);

/* ========================= Tasks ========================= */

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),

    title: text('title').notNull(),
    description: text('description').notNull().default(''),

    status: taskStatus('status').notNull().default('inbox'),
    type: taskType('type').notNull().default('assignment'),
    priority: taskPriority('priority').notNull().default('medium'),

    startAt: timestamp('start_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** IANA zone the due time was authored in; display honours this. */
    dueTimeZone: text('due_time_zone').notNull().default('Asia/Manila'),
    allDay: boolean('all_day').notNull().default(false),
    durationMinutes: integer('duration_minutes'),
    estimateMinutes: integer('estimate_minutes'),

    /** True once the user (not a sync) changed priority; syncs must not clobber. */
    priorityOverridden: boolean('priority_overridden').notNull().default(false),
    /** True once the user pinned the type; keyword inference must not clobber. */
    typeOverridden: boolean('type_overridden').notNull().default(false),

    source: sourceKind('source').notNull().default('local'),
    sourceUrl: text('source_url'),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    /** Monotonic per-row revision; the sync engine compares these, not clocks. */
    revision: integer('revision').notNull().default(1),
    /** Which side wrote the current revision — the loop breaker. */
    lastWriteOrigin: text('last_write_origin').notNull().default('local'),

    recurrenceRuleId: uuid('recurrence_rule_id'),
    recurrenceParentId: uuid('recurrence_parent_id'),

    position: real('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tasks_user_status_idx').on(t.userId, t.status),
    index('tasks_user_due_idx').on(t.userId, t.dueAt),
    index('tasks_course_idx').on(t.courseId),
  ],
);

export const subtasks = pgTable(
  'subtasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    position: real('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subtasks_task_idx').on(t.taskId)],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
  },
  (t) => [uniqueIndex('tags_user_name_key').on(t.userId, t.name)],
);

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })],
);

export const recurrenceRules = pgTable('recurrence_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** RFC 5545 RRULE text, e.g. FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261220T155959Z */
  rrule: text('rrule').notNull(),
  timeZone: text('time_zone').notNull().default('Asia/Manila'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Minutes before due. Negative means after due. */
    offsetMinutes: integer('offset_minutes').notNull().default(60),
    /** Absolute override (snooze writes here; it never edits the academic due date). */
    fireAt: timestamp('fire_at', { withTimezone: true }),
    snoozedFromId: uuid('snoozed_from_id'),
    enabled: boolean('enabled').notNull().default(true),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reminders_task_idx').on(t.taskId), index('reminders_fire_idx').on(t.fireAt)],
);

export const smartLists = pgTable(
  'smart_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    /** Serialized SmartListQuery (see lib/domain/smart-lists.ts). */
    query: jsonb('query').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('smart_lists_user_idx').on(t.userId)],
);

/* ========================= Notes & attachments ========================= */

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    title: text('title').notNull().default('Untitled note'),
    body: text('body').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notes_user_idx').on(t.userId), index('notes_course_idx').on(t.courseId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id').references(() => notes.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id'),
    /** Opaque storage key. Never user-controlled; never a path the client picks. */
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksum: text('checksum'),
    scanState: text('scan_state').notNull().default('skipped'),
    scanDetail: text('scan_detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attachments_storage_key_key').on(t.storageKey),
    index('attachments_user_idx').on(t.userId),
    index('attachments_task_idx').on(t.taskId),
  ],
);

/* ========================= Announcements ========================= */

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    bodyExcerpt: text('body_excerpt').notNull().default(''),
    bodyFull: text('body_full'),
    author: text('author'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    sourceUrl: text('source_url'),
    source: sourceKind('source').notNull().default('blackboard'),
    readAt: timestamp('read_at', { withTimezone: true }),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('announcements_user_published_idx').on(t.userId, t.publishedAt),
    index('announcements_course_idx').on(t.courseId),
  ],
);

/* ========================= Integrations ========================= */

export const integrationAccounts = pgTable(
  'integration_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: providerKind('provider').notNull(),
    label: text('label').notNull().default(''),
    /** Opaque provider-side account identity (workspace id, feed fingerprint...). */
    externalAccountId: text('external_account_id'),
    status: text('status').notNull().default('connected'),
    lastError: text('last_error'),
    /** Non-secret configuration only. Secrets live in integration_secrets. */
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (t) => [index('integration_accounts_user_idx').on(t.userId, t.provider)],
);

export const integrationSecrets = pgTable(
  'integration_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** AES-256-GCM envelope: {v,kid,iv,tag,ct}. Never leaves the server process. */
    ciphertext: text('ciphertext').notNull(),
    keyId: text('key_id').notNull(),
    /** Non-reversible hint for the UI, e.g. "…/feed/abcd1234.ics" host + last 4. */
    displayHint: text('display_hint').notNull().default(''),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('integration_secrets_account_name_key').on(t.accountId, t.name)],
);

/**
 * The bridge between a provider's item and a local row. Dedup happens here:
 * (account, external_id) is unique, which is what makes repeated syncs idempotent.
 */
export const externalRecords = pgTable(
  'external_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    provider: providerKind('provider').notNull(),
    externalId: text('external_id').notNull(),
    entityType: text('entity_type').notNull(), // 'task' | 'announcement' | 'course'
    entityId: uuid('entity_id'),

    courseCode: text('course_code'),
    normalizedTitle: text('normalized_title'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    sourceUrl: text('source_url'),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),

    /** Hash of the provider payload's meaningful fields — cheap change detection. */
    contentHash: text('content_hash').notNull(),
    /** Hash of the fields we last pushed/pulled — the common ancestor for merges. */
    syncedFieldHash: text('synced_field_hash'),
    remoteRevision: text('remote_revision'),
    localRevision: integer('local_revision'),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the item stopped appearing upstream. We never auto-delete. */
    missingSinceAt: timestamp('missing_since_at', { withTimezone: true }),
    reviewReason: text('review_reason'),
    payload: jsonb('payload').notNull().default({}),
  },
  (t) => [
    uniqueIndex('external_records_account_external_key').on(t.accountId, t.externalId),
    index('external_records_entity_idx').on(t.entityType, t.entityId),
    index('external_records_user_idx').on(t.userId),
  ],
);

export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    value: text('value'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sync_cursors_account_name_key').on(t.accountId, t.name)],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull().default('pull'),
    status: syncRunStatus('status').notNull().default('queued'),
    trigger: text('trigger').notNull().default('schedule'),
    /** Same key ⇒ same run. Retries reuse it, so retries can't double-create. */
    idempotencyKey: text('idempotency_key').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsCreated: integer('items_created').notNull().default(0),
    itemsUpdated: integer('items_updated').notNull().default(0),
    itemsSkipped: integer('items_skipped').notNull().default(0),
    conflicts: integer('conflicts').notNull().default(0),
    /** User-safe message. Credential material is redacted before it lands here. */
    error: text('error'),
  },
  (t) => [
    uniqueIndex('sync_runs_idempotency_key').on(t.idempotencyKey),
    index('sync_runs_account_idx').on(t.accountId, t.startedAt),
  ],
);

export const syncChanges = pgTable(
  'sync_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    externalRecordId: uuid('external_record_id').references(() => externalRecords.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(), // created | updated | skipped | conflict | missing
    field: text('field'),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sync_changes_run_idx').on(t.runId), index('sync_changes_entity_idx').on(t.entityId)],
);

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    externalRecordId: uuid('external_record_id').references(() => externalRecords.id, {
      onDelete: 'cascade',
    }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    field: text('field').notNull(),
    localValue: text('local_value'),
    remoteValue: text('remote_value'),
    baseValue: text('base_value'),
    localChangedAt: timestamp('local_changed_at', { withTimezone: true }),
    remoteChangedAt: timestamp('remote_changed_at', { withTimezone: true }),
    state: conflictState('state').notNull().default('open'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sync_conflicts_user_state_idx').on(t.userId, t.state),
    // Partial unique: at most one OPEN conflict per (record, field). Resolved
    // rows accumulate freely as history.
    uniqueIndex('sync_conflicts_open_key')
      .on(t.externalRecordId, t.field)
      .where(sql`${t.state} = 'open'`),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(), // user:<id> | sync:<provider> | system | ai:local
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    detail: jsonb('detail').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_user_idx').on(t.userId, t.createdAt), index('audit_events_entity_idx').on(t.entityId)],
);

/* ========================= Notifications ========================= */

export const notificationEvents = pgTable(
  'notification_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    /** Stable dedup key, e.g. bb:new:<accountId>:<externalId>. Unique per user. */
    eventKey: text('event_key').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** In-app route. Never contains credentials or feed URLs. */
    deepLink: text('deep_link').notNull(),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** When quiet hours defer a notification, this is when it may be delivered. */
    deliverAfter: timestamp('deliver_after', { withTimezone: true }),
    digestedIntoId: uuid('digested_into_id'),
  },
  (t) => [
    uniqueIndex('notification_events_user_key').on(t.userId, t.eventKey),
    index('notification_events_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => notificationEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: deliveryChannel('channel').notNull(),
    subscriptionId: uuid('subscription_id').references(() => pushSubscriptions.id, {
      onDelete: 'cascade',
    }),
    state: deliveryState('state').notNull().default('pending'),
    detail: text('detail'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Per-device uniqueness for push rows.
    uniqueIndex('notification_deliveries_event_target_key').on(t.eventId, t.channel, t.subscriptionId),
    // The in-app row has no subscription, and Postgres treats NULLs as
    // distinct, so it needs its own partial index -- without it a retried
    // delivery job appends a duplicate in-app record on every attempt.
    uniqueIndex('notification_deliveries_event_inapp_key')
      .on(t.eventId, t.channel)
      .where(sql`${t.subscriptionId} is null`),
    index('notification_deliveries_user_idx').on(t.userId),
  ],
);

/* ========================= Presentation & preferences ========================= */

export const themes = pgTable(
  'themes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mode: text('mode').notNull().default('light'), // light | dark
    /** Token overrides: { "--c-brand": "#8c1d24", ... } — validated before use. */
    tokens: jsonb('tokens').notNull().default({}),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('themes_user_idx').on(t.userId)],
);

export const dashboardLayouts = pgTable(
  'dashboard_layouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Layouts are stored per breakpoint so phone ≠ desktop. */
    breakpoint: text('breakpoint').notNull(), // mobile | tablet | desktop
    name: text('name').notNull().default('Default'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dashboard_layouts_user_breakpoint_key').on(t.userId, t.breakpoint)],
);

export const widgetInstances = pgTable(
  'widget_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => dashboardLayouts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    widgetKey: text('widget_key').notNull(),
    position: integer('position').notNull().default(0),
    /** Column span within a 4-column grid (1..4); clamped per breakpoint. */
    span: integer('span').notNull().default(2),
    height: text('height').notNull().default('auto'),
    hidden: boolean('hidden').notNull().default(false),
    settings: jsonb('settings').notNull().default({}),
  },
  (t) => [index('widget_instances_layout_idx').on(t.layoutId, t.position)],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  themeMode: text('theme_mode').notNull().default('system'), // light | dark | system
  themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
  density: text('density').notNull().default('comfortable'),
  defaultView: text('default_view').notNull().default('/today'),
  weekStartsOn: integer('week_starts_on').notNull().default(1),
  timeFormat: text('time_format').notNull().default('h12'),

  quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true),
  quietHoursStartMinute: integer('quiet_hours_start_minute').notNull().default(22 * 60),
  quietHoursEndMinute: integer('quiet_hours_end_minute').notNull().default(7 * 60),

  dailyDigestEnabled: boolean('daily_digest_enabled').notNull().default(false),
  dailyDigestMinute: integer('daily_digest_minute').notNull().default(7 * 60),

  /** { kind: boolean } and { courseId: boolean } opt-outs. */
  notificationKinds: jsonb('notification_kinds').notNull().default({}),
  courseNotificationOptOut: jsonb('course_notification_opt_out').notNull().default({}),

  /** Opaque token for the read-only calendar feed. Rotatable; null = disabled. */
  calendarFeedToken: text('calendar_feed_token'),

  localAiEnabled: boolean('local_ai_enabled').notNull().default(false),
  localAiIndexingEnabled: boolean('local_ai_indexing_enabled').notNull().default(false),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ========================= Local AI bridge ========================= */

export const localAiDevices = pgTable(
  'local_ai_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('My computer'),
    /** Bridge-reported model, e.g. "llama3.1:8b". Display only. */
    modelName: text('model_name'),
    endpointHint: text('endpoint_hint'),
    /** SHA-256 of the bridge session token. */
    tokenHash: text('token_hash').notNull(),
    scopes: jsonb('scopes').notNull().default([]),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('local_ai_devices_token_key').on(t.tokenHash), index('local_ai_devices_user_idx').on(t.userId)],
);

export const localAiPairings = pgTable(
  'local_ai_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the 8-character user-visible pairing code. */
    codeHash: text('code_hash').notNull(),
    state: text('state').notNull().default('pending'), // pending | claimed | expired | cancelled
    deviceId: uuid('device_id').references(() => localAiDevices.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('local_ai_pairings_code_key').on(t.codeHash)],
);

/* ========================= Durable job queue ========================= */

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull().default({}),
    state: jobState('state').notNull().default('queued'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    /** Optional dedup key. A queued job with the same key is never enqueued twice. */
    idempotencyKey: text('idempotency_key'),
    /** Coarse mutex: only one job per lock key runs at a time. */
    lockKey: text('lock_key'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('jobs_idempotency_key').on(t.idempotencyKey),
    index('jobs_state_runat_idx').on(t.state, t.runAt),
    index('jobs_lock_idx').on(t.lockKey, t.state),
  ],
);

/** Simple fixed-window rate limiter backed by the same database. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: text('id').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [index('rate_limits_window_idx').on(t.windowStart)],
);
