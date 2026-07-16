import { and, asc, count, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import type { SessionActor } from "@/lib/authorization";
import { requirePermission } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceCorrectionRequests,
  attendanceDays,
  attendanceEvents,
  attendanceMonthDaySnapshots,
  attendanceMonthPeriods,
  attendanceMonthRevisions,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
  organizations,
  users,
  workRules,
} from "@/lib/db/schema";

export type AttendanceMonthState = "closed" | "open";
type AttendanceClosingQueryDatabase = Pick<AppDatabase, "select">;

export class AttendanceClosingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceClosingValidationError";
  }
}

export class AttendanceClosingConflictError extends Error {
  constructor(message = "月次勤怠が更新されています。再読み込みしてからやり直してください。") {
    super(message);
    this.name = "AttendanceClosingConflictError";
  }
}

export function validateTargetMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new AttendanceClosingValidationError("対象月が正しくありません。");
  }
  return month;
}

export function attendanceMonthRange(month: string) {
  validateTargetMonth(month);
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10),
  };
}

export function currentMonthInTimezone(timezone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function isEndedAttendanceMonth(month: string, timezone: string, instant = new Date()) {
  validateTargetMonth(month);
  return month < currentMonthInTimezone(timezone, instant);
}

export async function lockAttendanceMonth(
  db: Pick<AppDatabase, "execute">,
  organizationId: string,
  month: string,
) {
  validateTargetMonth(month);
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${month}))`,
  );
}

export async function getAttendanceMonthStatus(
  db: AttendanceClosingQueryDatabase,
  organizationId: string,
  month: string,
) {
  validateTargetMonth(month);
  const [period] = await db
    .select({
      closedAt: attendanceMonthRevisions.closedAt,
      closedBy: users.displayName,
      currentRevision: attendanceMonthPeriods.currentRevision,
      periodId: attendanceMonthPeriods.id,
      status: attendanceMonthPeriods.status,
      version: attendanceMonthPeriods.version,
    })
    .from(attendanceMonthPeriods)
    .leftJoin(
      attendanceMonthRevisions,
      and(
        eq(attendanceMonthRevisions.periodId, attendanceMonthPeriods.id),
        eq(attendanceMonthRevisions.revision, attendanceMonthPeriods.currentRevision),
        isNull(attendanceMonthRevisions.reopenedAt),
      ),
    )
    .leftJoin(users, eq(users.id, attendanceMonthRevisions.closedByUserId))
    .where(
      and(
        eq(attendanceMonthPeriods.organizationId, organizationId),
        eq(attendanceMonthPeriods.targetMonth, month),
      ),
    )
    .limit(1);
  return (
    period ?? {
      closedAt: null,
      closedBy: null,
      currentRevision: null,
      periodId: null,
      status: "open" as const,
      version: 0,
    }
  );
}

export async function assertAttendanceMonthOpen(
  db: AttendanceClosingQueryDatabase,
  organizationId: string,
  workDate: string,
) {
  const state = await getAttendanceMonthStatus(db, organizationId, workDate.slice(0, 7));
  if (state.status === "closed") {
    throw new AttendanceClosingConflictError(
      `${workDate.slice(0, 7)}は締め済み（リビジョン${state.currentRevision}）です。管理者へ再開を依頼してください。`,
    );
  }
  return state;
}

export async function inspectAttendanceMonth(
  db: AttendanceClosingQueryDatabase,
  organizationId: string,
  month: string,
) {
  const range = attendanceMonthRange(month);
  const [[openDays], [pending], [invalid], [summary]] = await Promise.all([
    db
      .select({ value: count() })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.organizationId, organizationId),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
          eq(attendanceDays.status, "open"),
        ),
      ),
    db
      .select({ value: count() })
      .from(attendanceCorrectionRequests)
      .where(
        and(
          eq(attendanceCorrectionRequests.organizationId, organizationId),
          gte(attendanceCorrectionRequests.workDate, range.from),
          lt(attendanceCorrectionRequests.workDate, range.to),
          eq(attendanceCorrectionRequests.status, "pending"),
        ),
      ),
    db
      .select({ value: count() })
      .from(attendanceDays)
      .leftJoin(
        dailyAttendanceSummaries,
        eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
      )
      .where(
        and(
          eq(attendanceDays.organizationId, organizationId),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
          eq(attendanceDays.status, "complete"),
          isNull(dailyAttendanceSummaries.id),
        ),
      ),
    db
      .select({
        dayCount: sql<number>`count(${attendanceDays.id})::int`,
        employeeCount: sql<number>`count(distinct ${attendanceDays.employeeId})::int`,
        overtimeMinutes: sql<number>`coalesce(sum(${dailyAttendanceSummaries.overtimeMinutes}), 0)::int`,
        scheduledMinutes: sql<number>`coalesce(sum(${attendanceDays.scheduledMinutes}), 0)::int`,
        workedMinutes: sql<number>`coalesce(sum(${dailyAttendanceSummaries.workedMinutes}), 0)::int`,
      })
      .from(attendanceDays)
      .leftJoin(
        dailyAttendanceSummaries,
        eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
      )
      .where(
        and(
          eq(attendanceDays.organizationId, organizationId),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
        ),
      ),
  ]);
  const blockers = {
    invalidDays: invalid.value,
    openDays: openDays.value,
    pendingCorrections: pending.value,
  };
  return {
    blockers,
    canClose: Object.values(blockers).every((value) => value === 0),
    summary,
  };
}

async function organizationTimezone(db: AttendanceClosingQueryDatabase, organizationId: string) {
  const [organization] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) throw new AttendanceClosingValidationError("対象月を確認できませんでした。");
  return organization.timezone;
}

async function snapshotRows(
  db: AttendanceClosingQueryDatabase,
  organizationId: string,
  month: string,
) {
  const range = attendanceMonthRange(month);
  return db
    .select({
      attendanceDayId: attendanceDays.id,
      breakMinutes: dailyAttendanceSummaries.breakMinutes,
      departmentCode: departments.code,
      departmentId: departments.id,
      departmentName: departments.name,
      displayName: employees.displayName,
      employeeId: employees.id,
      employeeNumber: employees.employeeNumber,
      isCorrected: sql<boolean>`exists (
        select 1 from ${attendanceEvents}
        where ${attendanceEvents.attendanceDayId} = ${attendanceDays.id}
          and ${attendanceEvents.correctionRequestId} is not null
          and ${attendanceEvents.supersededByCorrectionRequestId} is null
      )`,
      overtimeMinutes: dailyAttendanceSummaries.overtimeMinutes,
      scheduledMinutes: attendanceDays.scheduledMinutes,
      status: attendanceDays.status,
      workDate: attendanceDays.workDate,
      workedMinutes: dailyAttendanceSummaries.workedMinutes,
      workRuleId: attendanceDays.workRuleId,
      workRuleName: workRules.name,
    })
    .from(attendanceDays)
    .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
    .leftJoin(
      employeeDepartments,
      and(
        eq(employeeDepartments.employeeId, employees.id),
        eq(employeeDepartments.isPrimary, true),
        isNull(employeeDepartments.endedOn),
      ),
    )
    .leftJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .leftJoin(workRules, eq(workRules.id, attendanceDays.workRuleId))
    .leftJoin(
      dailyAttendanceSummaries,
      eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
    )
    .where(
      and(
        eq(attendanceDays.organizationId, organizationId),
        gte(attendanceDays.workDate, range.from),
        lt(attendanceDays.workDate, range.to),
      ),
    )
    .orderBy(asc(attendanceDays.workDate), asc(employees.employeeNumber));
}

export async function closeAttendanceMonth(
  db: AppDatabase,
  actor: SessionActor,
  input: { expectedVersion: number; month: string },
) {
  requirePermission(actor, "attendance:manage");
  const month = validateTargetMonth(input.month);
  const timezone = await organizationTimezone(db, actor.organizationId);
  if (!isEndedAttendanceMonth(month, timezone)) {
    throw new AttendanceClosingValidationError("終了した月だけを締められます。");
  }
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, month);
    await transaction
      .insert(attendanceMonthPeriods)
      .values({ organizationId: actor.organizationId, targetMonth: month })
      .onConflictDoNothing();
    const [period] = await transaction
      .select()
      .from(attendanceMonthPeriods)
      .where(
        and(
          eq(attendanceMonthPeriods.organizationId, actor.organizationId),
          eq(attendanceMonthPeriods.targetMonth, month),
        ),
      )
      .limit(1);
    if (!period || period.version !== input.expectedVersion || period.status === "closed") {
      throw new AttendanceClosingConflictError();
    }
    const inspection = await inspectAttendanceMonth(transaction, actor.organizationId, month);
    if (!inspection.canClose) {
      throw new AttendanceClosingValidationError("未退勤または審査待ちを解消してください。");
    }
    const rows = await snapshotRows(transaction, actor.organizationId, month);
    const [revision] = await transaction
      .insert(attendanceMonthRevisions)
      .values({
        closedByUserId: actor.userId,
        dayCount: inspection.summary.dayCount,
        employeeCount: inspection.summary.employeeCount,
        organizationId: actor.organizationId,
        overtimeMinutes: inspection.summary.overtimeMinutes,
        periodId: period.id,
        revision: period.nextRevision,
        scheduledMinutes: inspection.summary.scheduledMinutes,
        targetMonth: month,
        workedMinutes: inspection.summary.workedMinutes,
      })
      .returning();
    if (rows.length) {
      await transaction.insert(attendanceMonthDaySnapshots).values(
        rows.map((row) => ({
          ...row,
          organizationId: actor.organizationId,
          revisionId: revision.id,
        })),
      );
    }
    const [updated] = await transaction
      .update(attendanceMonthPeriods)
      .set({
        currentRevision: period.nextRevision,
        nextRevision: period.nextRevision + 1,
        status: "closed",
        updatedAt: new Date(),
        version: period.version + 1,
      })
      .where(
        and(
          eq(attendanceMonthPeriods.id, period.id),
          eq(attendanceMonthPeriods.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!updated) throw new AttendanceClosingConflictError();
    await recordAudit(transaction, {
      action: period.nextRevision === 1 ? "attendance_month_closed" : "attendance_month_reclosed",
      actorUserId: actor.userId,
      entityId: period.id,
      entityType: "attendance_month",
      metadata: { ...inspection.summary, month, revision: revision.revision },
      organizationId: actor.organizationId,
    });
    return getAttendanceMonthStatus(transaction, actor.organizationId, month);
  });
}

export async function reopenAttendanceMonth(
  db: AppDatabase,
  actor: SessionActor,
  input: { expectedVersion: number; month: string; reason: string },
) {
  requirePermission(actor, "attendance:manage");
  const month = validateTargetMonth(input.month);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new AttendanceClosingValidationError(
      "再開理由を5文字以上1,000文字以内で入力してください。",
    );
  }
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, month);
    const [period] = await transaction
      .select()
      .from(attendanceMonthPeriods)
      .where(
        and(
          eq(attendanceMonthPeriods.organizationId, actor.organizationId),
          eq(attendanceMonthPeriods.targetMonth, month),
        ),
      )
      .limit(1);
    if (
      !period ||
      period.status !== "closed" ||
      period.currentRevision === null ||
      period.version !== input.expectedVersion
    ) {
      throw new AttendanceClosingConflictError();
    }
    const [revision] = await transaction
      .update(attendanceMonthRevisions)
      .set({
        reopenedAt: new Date(),
        reopenedByUserId: actor.userId,
        reopenReason: reason,
      })
      .where(
        and(
          eq(attendanceMonthRevisions.periodId, period.id),
          eq(attendanceMonthRevisions.revision, period.currentRevision),
          isNull(attendanceMonthRevisions.reopenedAt),
        ),
      )
      .returning();
    if (!revision) throw new AttendanceClosingConflictError();
    const [updated] = await transaction
      .update(attendanceMonthPeriods)
      .set({
        currentRevision: null,
        status: "open",
        updatedAt: new Date(),
        version: period.version + 1,
      })
      .where(
        and(
          eq(attendanceMonthPeriods.id, period.id),
          eq(attendanceMonthPeriods.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!updated) throw new AttendanceClosingConflictError();
    await recordAudit(transaction, {
      action: "attendance_month_reopened",
      actorUserId: actor.userId,
      entityId: period.id,
      entityType: "attendance_month",
      metadata: { month, reason, revision: revision.revision },
      organizationId: actor.organizationId,
    });
    return getAttendanceMonthStatus(transaction, actor.organizationId, month);
  });
}

export async function listClosedAttendanceSnapshots(
  db: AttendanceClosingQueryDatabase,
  organizationId: string,
  month: string,
) {
  const state = await getAttendanceMonthStatus(db, organizationId, month);
  if (state.status !== "closed" || !state.periodId || state.currentRevision === null) return null;
  const [revision] = await db
    .select()
    .from(attendanceMonthRevisions)
    .where(
      and(
        eq(attendanceMonthRevisions.periodId, state.periodId),
        eq(attendanceMonthRevisions.revision, state.currentRevision),
        isNull(attendanceMonthRevisions.reopenedAt),
      ),
    )
    .limit(1);
  if (!revision) return null;
  const rows = await db
    .select()
    .from(attendanceMonthDaySnapshots)
    .where(eq(attendanceMonthDaySnapshots.revisionId, revision.id))
    .orderBy(
      asc(attendanceMonthDaySnapshots.workDate),
      asc(attendanceMonthDaySnapshots.employeeNumber),
    );
  return { revision, rows, state };
}
