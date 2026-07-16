import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["owner", "hr_admin", "employee"]);
export const userStatus = pgEnum("user_status", ["pending_setup", "active", "disabled"]);
export const employeeStatus = pgEnum("employee_status", [
  "scheduled",
  "active",
  "on_leave",
  "terminated",
]);
export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "other",
]);
export const attendanceEventType = pgEnum("attendance_event_type", [
  "clock_in",
  "clock_out",
  "break_start",
  "break_end",
]);
export const attendanceDayStatus = pgEnum("attendance_day_status", ["open", "complete"]);
export const attendanceCorrectionStatus = pgEnum("attendance_correction_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const attendanceCorrectionEntryKind = pgEnum("attendance_correction_entry_kind", [
  "original",
  "requested",
]);
export const attendanceMonthStatus = pgEnum("attendance_month_status", ["open", "closed"]);
export const auditAction = pgEnum("audit_action", [
  "setup_completed",
  "login_succeeded",
  "login_failed",
  "logout",
  "user_created",
  "user_disabled",
  "user_enabled",
  "role_changed",
  "department_changed",
  "employee_created",
  "employee_updated",
  "employee_status_changed",
  "work_rule_changed",
  "attendance_punched",
  "attendance_correction_requested",
  "attendance_correction_cancelled",
  "attendance_correction_approved",
  "attendance_correction_rejected",
  "attendance_correction_applied",
  "attendance_month_closed",
  "attendance_month_reopened",
  "attendance_month_reclosed",
  "csv_imported",
  "csv_exported",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: userRole("role").notNull().default("employee"),
    status: userStatus("status").notNull().default("pending_setup"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_organization_email_unique").on(table.organizationId, table.email),
    index("users_organization_status_index").on(table.organizationId, table.status),
  ],
);

export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const initialSetupLinks = pgTable(
  "initial_setup_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("initial_setup_links_token_hash_unique").on(table.tokenHash),
    index("initial_setup_links_user_index").on(table.userId),
  ],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_sessions_token_hash_unique").on(table.tokenHash),
    index("user_sessions_user_index").on(table.userId),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("departments_organization_code_unique").on(table.organizationId, table.code),
    uniqueIndex("departments_organization_name_unique").on(table.organizationId, table.name),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    employeeNumber: text("employee_number").notNull(),
    familyName: text("family_name").notNull(),
    givenName: text("given_name").notNull(),
    displayName: text("display_name").notNull().default(""),
    contactEmail: text("contact_email"),
    phoneNumber: text("phone_number"),
    employmentType: employmentType("employment_type").notNull().default("full_time"),
    status: employeeStatus("status").notNull().default("scheduled"),
    joinedOn: date("joined_on"),
    leftOn: date("left_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("employees_organization_number_unique").on(
      table.organizationId,
      table.employeeNumber,
    ),
    uniqueIndex("employees_user_unique").on(table.userId),
    index("employees_organization_status_index").on(table.organizationId, table.status),
  ],
);

export const employeeDepartments = pgTable(
  "employee_departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(true),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_departments_employee_index").on(table.employeeId),
    index("employee_departments_department_index").on(table.departmentId),
  ],
);

export const employeeStatusHistory = pgTable(
  "employee_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    status: employeeStatus("status").notNull(),
    effectiveOn: date("effective_on").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_status_history_employee_date_index").on(table.employeeId, table.effectiveOn),
  ],
);

export const workRules = pgTable(
  "work_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    scheduledStartTime: text("scheduled_start_time").notNull(),
    scheduledEndTime: text("scheduled_end_time").notNull(),
    scheduledBreakMinutes: integer("scheduled_break_minutes").notNull().default(60),
    dailyStandardMinutes: integer("daily_standard_minutes").notNull().default(480),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_rules_organization_effective_index").on(table.organizationId, table.effectiveFrom),
    index("work_rules_employee_effective_index").on(table.employeeId, table.effectiveFrom),
  ],
);

export const attendanceDays = pgTable(
  "attendance_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workRuleId: uuid("work_rule_id").references(() => workRules.id, { onDelete: "set null" }),
    workDate: date("work_date").notNull(),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    status: attendanceDayStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_days_employee_date_unique").on(table.employeeId, table.workDate),
    index("attendance_days_organization_date_index").on(table.organizationId, table.workDate),
  ],
);

export const attendanceCorrectionRequests = pgTable(
  "attendance_correction_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    attendanceDayId: uuid("attendance_day_id").references(() => attendanceDays.id, {
      onDelete: "set null",
    }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    workDate: date("work_date").notNull(),
    reason: text("reason").notNull(),
    status: attendanceCorrectionStatus("status").notNull().default("pending"),
    baseRevision: integer("base_revision").notNull().default(0),
    reviewComment: text("review_comment"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "attendance_correction_requests_reason_not_blank",
      sql`length(trim(${table.reason})) > 0`,
    ),
    check(
      "attendance_correction_requests_base_revision_nonnegative",
      sql`${table.baseRevision} >= 0`,
    ),
    uniqueIndex("attendance_correction_requests_pending_unique")
      .on(table.employeeId, table.workDate)
      .where(sql`${table.status} = 'pending'`),
    index("attendance_corrections_org_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("attendance_corrections_employee_date_idx").on(
      table.employeeId,
      table.workDate,
      table.createdAt,
    ),
    index("attendance_corrections_day_idx").on(table.attendanceDayId),
    index("attendance_corrections_requester_idx").on(table.requestedByUserId),
    index("attendance_corrections_reviewer_idx").on(table.reviewerUserId),
  ],
);

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attendanceDayId: uuid("attendance_day_id")
      .notNull()
      .references(() => attendanceDays.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    correctionRequestId: uuid("correction_request_id").references(
      () => attendanceCorrectionRequests.id,
      { onDelete: "restrict" },
    ),
    supersededByCorrectionRequestId: uuid("superseded_by_correction_request_id").references(
      () => attendanceCorrectionRequests.id,
      { onDelete: "restrict" },
    ),
    type: attendanceEventType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: text("source").notNull().default("web"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attendance_events_day_time_index").on(table.attendanceDayId, table.occurredAt),
    index("attendance_events_employee_time_index").on(table.employeeId, table.occurredAt),
    index("attendance_events_correction_request_index").on(table.correctionRequestId),
    index("attendance_events_superseded_request_index").on(table.supersededByCorrectionRequestId),
    index("attendance_events_active_day_time_index")
      .on(table.attendanceDayId, table.occurredAt)
      .where(sql`${table.supersededByCorrectionRequestId} is null`),
  ],
);

export const attendanceCorrectionEntries = pgTable(
  "attendance_correction_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => attendanceCorrectionRequests.id, { onDelete: "cascade" }),
    originalEventId: uuid("original_event_id").references(() => attendanceEvents.id, {
      onDelete: "restrict",
    }),
    kind: attendanceCorrectionEntryKind("kind").notNull(),
    position: integer("position").notNull(),
    type: attendanceEventType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("attendance_correction_entries_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "attendance_correction_entries_original_reference_required",
      sql`${table.kind} <> 'original' OR ${table.originalEventId} IS NOT NULL`,
    ),
    uniqueIndex("attendance_correction_entries_request_kind_position_unique").on(
      table.requestId,
      table.kind,
      table.position,
    ),
    index("attendance_correction_entries_original_event_index").on(table.originalEventId),
  ],
);

export const dailyAttendanceSummaries = pgTable(
  "daily_attendance_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attendanceDayId: uuid("attendance_day_id")
      .notNull()
      .references(() => attendanceDays.id, { onDelete: "cascade" }),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    breakMinutes: integer("break_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    status: attendanceDayStatus("status").notNull().default("open"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("daily_attendance_summaries_day_unique").on(table.attendanceDayId)],
);

export const attendanceMonthPeriods = pgTable(
  "attendance_month_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetMonth: text("target_month").notNull(),
    status: attendanceMonthStatus("status").notNull().default("open"),
    currentRevision: integer("current_revision"),
    nextRevision: integer("next_revision").notNull().default(1),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("attendance_month_periods_month_format", sql`${table.targetMonth} ~ '^\\d{4}-\\d{2}$'`),
    check("attendance_month_periods_next_revision_positive", sql`${table.nextRevision} > 0`),
    check("attendance_month_periods_version_nonnegative", sql`${table.version} >= 0`),
    uniqueIndex("attendance_month_periods_org_month_unique").on(
      table.organizationId,
      table.targetMonth,
    ),
  ],
);

export const attendanceMonthRevisions = pgTable(
  "attendance_month_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => attendanceMonthPeriods.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetMonth: text("target_month").notNull(),
    revision: integer("revision").notNull(),
    closedByUserId: uuid("closed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedByUserId: uuid("reopened_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    employeeCount: integer("employee_count").notNull().default(0),
    dayCount: integer("day_count").notNull().default(0),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  },
  (table) => [
    check("attendance_month_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "attendance_month_revisions_reopen_complete",
      sql`(${table.reopenedAt} IS NULL AND ${table.reopenedByUserId} IS NULL AND ${table.reopenReason} IS NULL) OR (${table.reopenedAt} IS NOT NULL AND ${table.reopenedByUserId} IS NOT NULL AND length(trim(${table.reopenReason})) > 0)`,
    ),
    uniqueIndex("attendance_month_revisions_period_revision_unique").on(
      table.periodId,
      table.revision,
    ),
    uniqueIndex("attendance_month_revisions_one_active_unique")
      .on(table.periodId)
      .where(sql`${table.reopenedAt} IS NULL`),
    index("attendance_month_revisions_org_month_index").on(
      table.organizationId,
      table.targetMonth,
      table.revision,
    ),
  ],
);

export const attendanceMonthDaySnapshots = pgTable(
  "attendance_month_day_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => attendanceMonthRevisions.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attendanceDayId: uuid("attendance_day_id").references(() => attendanceDays.id, {
      onDelete: "restrict",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    employeeNumber: text("employee_number").notNull(),
    displayName: text("display_name").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "restrict" }),
    departmentCode: text("department_code"),
    departmentName: text("department_name"),
    workDate: date("work_date").notNull(),
    status: attendanceDayStatus("status").notNull(),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes"),
    breakMinutes: integer("break_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    workRuleId: uuid("work_rule_id").references(() => workRules.id, { onDelete: "restrict" }),
    workRuleName: text("work_rule_name"),
    isCorrected: boolean("is_corrected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_month_snapshots_revision_employee_date_unique").on(
      table.revisionId,
      table.employeeId,
      table.workDate,
    ),
    index("attendance_month_snapshots_org_date_index").on(table.organizationId, table.workDate),
    index("attendance_month_snapshots_revision_employee_index").on(
      table.revisionId,
      table.employeeId,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: auditAction("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_organization_time_index").on(table.organizationId, table.occurredAt),
    index("audit_logs_entity_index").on(table.entityType, table.entityId),
  ],
);
