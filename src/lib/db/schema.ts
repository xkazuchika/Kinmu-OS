import {
  type AnyPgColumn,
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
export const workCalendarStatus = pgEnum("work_calendar_status", ["draft", "active"]);
export const workCalendarDayKind = pgEnum("work_calendar_day_kind", ["workday", "non_workday"]);
export const leaveRequestStatus = pgEnum("leave_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const leaveTransactionKind = pgEnum("leave_transaction_kind", [
  "grant",
  "adjustment",
  "consumption",
  "reversal",
  "expiry",
]);
export const attendanceOperationalStatus = pgEnum("attendance_operational_status", [
  "non_workday",
  "worked",
  "open_punch",
  "leave_full",
  "leave_half_worked",
  "unresolved",
  "absence",
  "conflict",
]);
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
  "work_calendar_changed",
  "work_calendar_activated",
  "leave_type_changed",
  "leave_balance_changed",
  "leave_requested",
  "leave_request_cancelled",
  "leave_request_approved",
  "leave_request_rejected",
  "absence_changed",
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

export const workCalendarPatterns = pgTable(
  "work_calendar_patterns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    status: workCalendarStatus("status").notNull().default("draft"),
    mondayWorkday: boolean("monday_workday").notNull().default(true),
    tuesdayWorkday: boolean("tuesday_workday").notNull().default(true),
    wednesdayWorkday: boolean("wednesday_workday").notNull().default(true),
    thursdayWorkday: boolean("thursday_workday").notNull().default(true),
    fridayWorkday: boolean("friday_workday").notNull().default(true),
    saturdayWorkday: boolean("saturday_workday").notNull().default(false),
    sundayWorkday: boolean("sunday_workday").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "work_calendar_patterns_activation_complete",
      sql`(${table.status} = 'draft' AND ${table.activatedAt} IS NULL AND ${table.activatedByUserId} IS NULL) OR (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.activatedByUserId} IS NOT NULL)`,
    ),
    uniqueIndex("work_calendar_patterns_org_effective_unique").on(
      table.organizationId,
      table.effectiveFrom,
    ),
    index("work_calendar_patterns_org_status_effective_idx").on(
      table.organizationId,
      table.status,
      table.effectiveFrom,
    ),
  ],
);

export const workCalendarDateExceptions = pgTable(
  "work_calendar_date_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    calendarDate: date("calendar_date").notNull(),
    dayKind: workCalendarDayKind("day_kind").notNull(),
    name: text("name").notNull(),
    reason: text("reason").notNull(),
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("work_calendar_exceptions_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check("work_calendar_exceptions_reason_not_blank", sql`length(trim(${table.reason})) > 0`),
    uniqueIndex("work_calendar_exceptions_org_date_unique")
      .on(table.organizationId, table.calendarDate)
      .where(sql`${table.employeeId} IS NULL AND ${table.active} = true`),
    uniqueIndex("work_calendar_exceptions_employee_date_unique")
      .on(table.employeeId, table.calendarDate)
      .where(sql`${table.employeeId} IS NOT NULL AND ${table.active} = true`),
    index("work_calendar_exceptions_org_date_idx").on(table.organizationId, table.calendarDate),
    index("work_calendar_exceptions_employee_date_idx").on(table.employeeId, table.calendarDate),
  ],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    paid: boolean("paid").notNull().default(false),
    consumesBalance: boolean("consumes_balance").notNull().default(false),
    requestable: boolean("requestable").notNull().default(true),
    active: boolean("active").notNull().default(true),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("leave_types_code_not_blank", sql`length(trim(${table.code})) > 0`),
    check("leave_types_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check(
      "leave_types_effective_range_valid",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    uniqueIndex("leave_types_org_code_unique").on(table.organizationId, table.code),
    index("leave_types_org_active_effective_idx").on(
      table.organizationId,
      table.active,
      table.effectiveFrom,
    ),
  ],
);

export const leaveBalanceAccounts = pgTable(
  "leave_balance_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("leave_balance_accounts_version_nonnegative", sql`${table.version} >= 0`),
    uniqueIndex("leave_balance_accounts_employee_type_unique").on(
      table.employeeId,
      table.leaveTypeId,
    ),
    index("leave_balance_accounts_org_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: leaveRequestStatus("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    reviewComment: text("review_comment"),
    baseBalanceVersion: integer("base_balance_version").notNull().default(0),
    leaveTypeCode: text("leave_type_code").notNull(),
    leaveTypeName: text("leave_type_name").notNull(),
    paid: boolean("paid").notNull(),
    consumesBalance: boolean("consumes_balance").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("leave_requests_reason_not_blank", sql`length(trim(${table.reason})) > 0`),
    check("leave_requests_base_balance_version_nonnegative", sql`${table.baseBalanceVersion} >= 0`),
    check(
      "leave_requests_status_details_valid",
      sql`(${table.status} = 'pending' AND ${table.reviewerUserId} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'approved' AND ${table.reviewerUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'rejected' AND ${table.reviewerUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND length(trim(${table.reviewComment})) > 0 AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'cancelled' AND ${table.reviewerUserId} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.cancelledAt} IS NOT NULL)`,
    ),
    index("leave_requests_org_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("leave_requests_employee_created_idx").on(table.employeeId, table.createdAt),
    index("leave_requests_leave_type_idx").on(table.leaveTypeId),
  ],
);

export const leaveRequestDays = pgTable(
  "leave_request_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => leaveRequests.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    units: integer("units").notNull(),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    calendarSource: text("calendar_source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("leave_request_days_units_valid", sql`${table.units} IN (1, 2)`),
    check("leave_request_days_scheduled_minutes_nonnegative", sql`${table.scheduledMinutes} >= 0`),
    uniqueIndex("leave_request_days_request_date_unique").on(table.requestId, table.workDate),
    index("leave_request_days_work_date_idx").on(table.workDate),
  ],
);

export const leaveGrantLots = pgTable(
  "leave_grant_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => leaveBalanceAccounts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    grantedUnits: integer("granted_units").notNull(),
    grantedOn: date("granted_on").notNull(),
    expiresOn: date("expires_on"),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("leave_grant_lots_units_positive", sql`${table.grantedUnits} > 0`),
    check("leave_grant_lots_reason_not_blank", sql`length(trim(${table.reason})) > 0`),
    check(
      "leave_grant_lots_expiry_valid",
      sql`${table.expiresOn} IS NULL OR ${table.expiresOn} >= ${table.grantedOn}`,
    ),
    index("leave_grant_lots_account_expiry_idx").on(
      table.accountId,
      table.expiresOn,
      table.grantedOn,
    ),
  ],
);

export const leaveTransactions = pgTable(
  "leave_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => leaveBalanceAccounts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    grantLotId: uuid("grant_lot_id").references(() => leaveGrantLots.id, {
      onDelete: "restrict",
    }),
    requestId: uuid("request_id").references(() => leaveRequests.id, {
      onDelete: "restrict",
    }),
    originalTransactionId: uuid("original_transaction_id").references(
      (): AnyPgColumn => leaveTransactions.id,
      { onDelete: "restrict" },
    ),
    kind: leaveTransactionKind("kind").notNull(),
    units: integer("units").notNull(),
    effectiveOn: date("effective_on").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("leave_transactions_units_nonzero", sql`${table.units} <> 0`),
    check("leave_transactions_reason_not_blank", sql`length(trim(${table.reason})) > 0`),
    check(
      "leave_transactions_kind_sign_valid",
      sql`(${table.kind} = 'grant' AND ${table.units} > 0) OR (${table.kind} = 'consumption' AND ${table.units} < 0) OR (${table.kind} = 'expiry' AND ${table.units} < 0) OR (${table.kind} IN ('adjustment', 'reversal'))`,
    ),
    check(
      "leave_transactions_references_valid",
      sql`(${table.kind} = 'grant' AND ${table.grantLotId} IS NOT NULL AND ${table.requestId} IS NULL AND ${table.originalTransactionId} IS NULL) OR (${table.kind} = 'adjustment' AND ${table.requestId} IS NULL AND ${table.originalTransactionId} IS NULL) OR (${table.kind} = 'consumption' AND ${table.grantLotId} IS NOT NULL AND ${table.requestId} IS NOT NULL AND ${table.originalTransactionId} IS NULL) OR (${table.kind} = 'reversal' AND ${table.originalTransactionId} IS NOT NULL) OR (${table.kind} = 'expiry' AND ${table.grantLotId} IS NOT NULL AND ${table.requestId} IS NULL AND ${table.originalTransactionId} IS NULL)`,
    ),
    index("leave_transactions_account_effective_idx").on(
      table.accountId,
      table.effectiveOn,
      table.createdAt,
    ),
    index("leave_transactions_request_idx").on(table.requestId),
    index("leave_transactions_grant_lot_idx").on(table.grantLotId),
  ],
);

export const absenceRecords = pgTable(
  "absence_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    reason: text("reason").notNull(),
    confirmedByUserId: uuid("confirmed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("absence_records_reason_not_blank", sql`length(trim(${table.reason})) > 0`),
    check("absence_records_version_nonnegative", sql`${table.version} >= 0`),
    check(
      "absence_records_revoke_complete",
      sql`(${table.revokedAt} IS NULL AND ${table.revokedByUserId} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByUserId} IS NOT NULL AND length(trim(${table.revokeReason})) > 0)`,
    ),
    uniqueIndex("absence_records_employee_date_active_unique")
      .on(table.employeeId, table.workDate)
      .where(sql`${table.revokedAt} IS NULL`),
    index("absence_records_org_date_idx").on(table.organizationId, table.workDate),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fingerprint: text("fingerprint").notNull(),
    fileName: text("file_name"),
    rowCount: integer("row_count").notNull(),
    resultSummary: jsonb("result_summary").$type<Record<string, number>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("import_batches_kind_valid", sql`${table.kind} IN ('calendar', 'leave_grant')`),
    check("import_batches_row_count_nonnegative", sql`${table.rowCount} >= 0`),
    uniqueIndex("import_batches_org_kind_fingerprint_unique").on(
      table.organizationId,
      table.kind,
      table.fingerprint,
    ),
    index("import_batches_org_created_idx").on(table.organizationId, table.createdAt),
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
    operationalStatus: attendanceOperationalStatus("operational_status"),
    calendarSource: text("calendar_source"),
    calendarLabel: text("calendar_label"),
    leaveTypeCode: text("leave_type_code"),
    leaveTypeName: text("leave_type_name"),
    leaveUnits: integer("leave_units"),
    leaveScheduledMinutes: integer("leave_scheduled_minutes"),
    absenceReason: text("absence_reason"),
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
    check(
      "attendance_month_snapshots_leave_units_valid",
      sql`${table.leaveUnits} IS NULL OR ${table.leaveUnits} IN (0, 1, 2)`,
    ),
    check(
      "attendance_month_snapshots_leave_minutes_nonnegative",
      sql`${table.leaveScheduledMinutes} IS NULL OR ${table.leaveScheduledMinutes} >= 0`,
    ),
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
