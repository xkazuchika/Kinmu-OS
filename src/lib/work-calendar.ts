import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { assertAttendanceMonthOpen, lockAttendanceMonth } from "@/lib/attendance-closing";
import { recordAudit } from "@/lib/audit";
import type { SessionActor } from "@/lib/authorization";
import { requirePermission } from "@/lib/authorization";
import { CsvImportValidationError, csvRecords, type CsvImportError } from "@/lib/csv-imports";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceMonthPeriods,
  employees,
  employeeStatusHistory,
  importBatches,
  organizations,
  workCalendarDateExceptions,
  workCalendarPatterns,
} from "@/lib/db/schema";
import { findEffectiveWorkRule } from "@/lib/db/work-rules";
import type { WorkDate } from "@/lib/time";

export type CalendarDayKind = "non_workday" | "workday";
export type CalendarSource =
  | "company_exception"
  | "employee_exception"
  | "inactive_calendar"
  | "not_employed"
  | "weekly_pattern";

export type WorkSchedule = Readonly<{
  calendarLabel: string;
  calendarSource: CalendarSource;
  dayKind: CalendarDayKind;
  scheduledBreakMinutes: number;
  scheduledEndTime: string | null;
  scheduledMinutes: number;
  scheduledStartTime: string | null;
  timezone: string;
  workRuleId: string | null;
  workRuleName: string | null;
}>;

type CalendarQueryDatabase = Pick<AppDatabase, "select">;

export class WorkCalendarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkCalendarValidationError";
  }
}

export class WorkCalendarConflictError extends Error {
  constructor(message = "勤務カレンダーが更新されています。再読み込みしてやり直してください。") {
    super(message);
    this.name = "WorkCalendarConflictError";
  }
}

export function validateWorkDate(value: string, label = "日付"): WorkDate {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(value)) {
    throw new WorkCalendarValidationError(`${label}をYYYY-MM-DD形式で入力してください。`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new WorkCalendarValidationError(`${label}が正しくありません。`);
  }
  return value as WorkDate;
}

function required(value: string, label: string, maxLength = 120) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new WorkCalendarValidationError(`${label}は1〜${maxLength}文字で入力してください。`);
  }
  return normalized;
}

const workdayColumnByDay = [
  "sundayWorkday",
  "mondayWorkday",
  "tuesdayWorkday",
  "wednesdayWorkday",
  "thursdayWorkday",
  "fridayWorkday",
  "saturdayWorkday",
] as const;

export async function resolveWorkSchedule(
  db: CalendarQueryDatabase,
  input: Readonly<{ employeeId: string; organizationId: string; workDate: WorkDate }>,
): Promise<WorkSchedule> {
  const workDate = validateWorkDate(input.workDate);
  const [employee] = await db
    .select({
      joinedOn: employees.joinedOn,
      leftOn: employees.leftOn,
      organizationId: employees.organizationId,
      status: employees.status,
      timezone: organizations.timezone,
    })
    .from(employees)
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
    )
    .limit(1);

  if (!employee) {
    throw new WorkCalendarValidationError("従業員を確認できませんでした。");
  }

  const [historicalStatus] = await db
    .select({ status: employeeStatusHistory.status })
    .from(employeeStatusHistory)
    .where(
      and(
        eq(employeeStatusHistory.employeeId, input.employeeId),
        lte(employeeStatusHistory.effectiveOn, workDate),
      ),
    )
    .orderBy(desc(employeeStatusHistory.effectiveOn), desc(employeeStatusHistory.createdAt))
    .limit(1);
  const status = historicalStatus?.status ?? employee.status;
  const employed =
    status === "active" &&
    (!employee.joinedOn || employee.joinedOn <= workDate) &&
    (!employee.leftOn || employee.leftOn >= workDate);

  if (!employed) {
    return {
      calendarLabel: "在籍期間外",
      calendarSource: "not_employed",
      dayKind: "non_workday",
      scheduledBreakMinutes: 0,
      scheduledEndTime: null,
      scheduledMinutes: 0,
      scheduledStartTime: null,
      timezone: employee.timezone,
      workRuleId: null,
      workRuleName: null,
    };
  }

  const [pattern] = await db
    .select()
    .from(workCalendarPatterns)
    .where(
      and(
        eq(workCalendarPatterns.organizationId, input.organizationId),
        eq(workCalendarPatterns.status, "active"),
        lte(workCalendarPatterns.effectiveFrom, workDate),
      ),
    )
    .orderBy(desc(workCalendarPatterns.effectiveFrom), desc(workCalendarPatterns.createdAt))
    .limit(1);

  if (!pattern) {
    return {
      calendarLabel: "勤務カレンダー未有効",
      calendarSource: "inactive_calendar",
      dayKind: "non_workday",
      scheduledBreakMinutes: 0,
      scheduledEndTime: null,
      scheduledMinutes: 0,
      scheduledStartTime: null,
      timezone: employee.timezone,
      workRuleId: null,
      workRuleName: null,
    };
  }

  const exceptions = await db
    .select()
    .from(workCalendarDateExceptions)
    .where(
      and(
        eq(workCalendarDateExceptions.organizationId, input.organizationId),
        eq(workCalendarDateExceptions.calendarDate, workDate),
        eq(workCalendarDateExceptions.active, true),
        or(
          eq(workCalendarDateExceptions.employeeId, input.employeeId),
          isNull(workCalendarDateExceptions.employeeId),
        ),
      ),
    );
  const employeeException = exceptions.find(
    (exception) => exception.employeeId === input.employeeId,
  );
  const companyException = exceptions.find((exception) => exception.employeeId === null);
  const exception = employeeException ?? companyException;
  const weekday = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
  const weeklyWorkday = pattern[workdayColumnByDay[weekday]];
  const dayKind = exception?.dayKind ?? (weeklyWorkday ? "workday" : "non_workday");
  const calendarSource: CalendarSource = employeeException
    ? "employee_exception"
    : companyException
      ? "company_exception"
      : "weekly_pattern";
  const calendarLabel =
    exception?.name ?? (weeklyWorkday ? "曜日パターン（勤務日）" : "曜日パターン（休日）");
  const workRule =
    dayKind === "workday"
      ? await findEffectiveWorkRule(db, {
          employeeId: input.employeeId,
          organizationId: input.organizationId,
          workDate,
        })
      : undefined;

  return {
    calendarLabel,
    calendarSource,
    dayKind,
    scheduledBreakMinutes: workRule?.scheduledBreakMinutes ?? 0,
    scheduledEndTime: workRule?.scheduledEndTime ?? null,
    scheduledMinutes: workRule?.dailyStandardMinutes ?? 0,
    scheduledStartTime: workRule?.scheduledStartTime ?? null,
    timezone: employee.timezone,
    workRuleId: workRule?.id ?? null,
    workRuleName: workRule?.name ?? null,
  };
}

export async function getCalendarActivationPreview(
  db: CalendarQueryDatabase,
  actor: SessionActor,
  patternId: string,
  effectiveFrom: string,
) {
  requirePermission(actor, "calendar:manage");
  const date = validateWorkDate(effectiveFrom, "適用開始日");
  const [pattern] = await db
    .select()
    .from(workCalendarPatterns)
    .where(
      and(
        eq(workCalendarPatterns.id, patternId),
        eq(workCalendarPatterns.organizationId, actor.organizationId),
        eq(workCalendarPatterns.status, "draft"),
      ),
    )
    .limit(1);
  if (!pattern) throw new WorkCalendarValidationError("有効化できるドラフトがありません。");
  const [{ employeeCount }] = await db
    .select({ employeeCount: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(eq(employees.organizationId, actor.organizationId), eq(employees.status, "active")));
  const [closedPeriod] = await db
    .select({ currentRevision: attendanceMonthPeriods.currentRevision })
    .from(attendanceMonthPeriods)
    .where(
      and(
        eq(attendanceMonthPeriods.organizationId, actor.organizationId),
        eq(attendanceMonthPeriods.targetMonth, date.slice(0, 7)),
        eq(attendanceMonthPeriods.status, "closed"),
      ),
    )
    .limit(1);

  return {
    effectiveFrom: date,
    employeeCount,
    pattern,
    blockedByRevision: closedPeriod?.currentRevision ?? null,
  };
}

export async function listWorkCalendarSettings(db: CalendarQueryDatabase, actor: SessionActor) {
  requirePermission(actor, "calendar:manage");
  const [patterns, exceptions] = await Promise.all([
    db
      .select()
      .from(workCalendarPatterns)
      .where(eq(workCalendarPatterns.organizationId, actor.organizationId))
      .orderBy(desc(workCalendarPatterns.effectiveFrom), desc(workCalendarPatterns.createdAt)),
    db
      .select()
      .from(workCalendarDateExceptions)
      .where(eq(workCalendarDateExceptions.organizationId, actor.organizationId))
      .orderBy(desc(workCalendarDateExceptions.calendarDate)),
  ]);
  return { exceptions, patterns };
}

export async function activateWorkCalendar(
  db: AppDatabase,
  actor: SessionActor,
  input: { effectiveFrom: string; patternId: string },
) {
  requirePermission(actor, "calendar:manage");
  const effectiveFrom = validateWorkDate(input.effectiveFrom, "適用開始日");
  const month = effectiveFrom.slice(0, 7);

  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, month);
    await assertAttendanceMonthOpen(transaction, actor.organizationId, effectiveFrom);
    await transaction.execute(
      sql`SELECT id FROM ${workCalendarPatterns} WHERE id = ${input.patternId} FOR UPDATE`,
    );
    const [pattern] = await transaction
      .select()
      .from(workCalendarPatterns)
      .where(
        and(
          eq(workCalendarPatterns.id, input.patternId),
          eq(workCalendarPatterns.organizationId, actor.organizationId),
          eq(workCalendarPatterns.status, "draft"),
        ),
      )
      .limit(1);
    if (!pattern) throw new WorkCalendarConflictError();
    const [activated] = await transaction
      .update(workCalendarPatterns)
      .set({
        activatedAt: new Date(),
        activatedByUserId: actor.userId,
        effectiveFrom,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(workCalendarPatterns.id, pattern.id))
      .returning();
    await recordAudit(transaction, {
      action: "work_calendar_activated",
      actorUserId: actor.userId,
      entityId: pattern.id,
      entityType: "work_calendar_activation",
      metadata: { effectiveFrom },
      organizationId: actor.organizationId,
    });
    return activated;
  });
}

type WeekPattern = Readonly<{
  fridayWorkday: boolean;
  mondayWorkday: boolean;
  saturdayWorkday: boolean;
  sundayWorkday: boolean;
  thursdayWorkday: boolean;
  tuesdayWorkday: boolean;
  wednesdayWorkday: boolean;
}>;

export async function createWorkCalendarDraft(
  db: AppDatabase,
  actor: SessionActor,
  input: WeekPattern & { effectiveFrom: string },
) {
  requirePermission(actor, "calendar:manage");
  const effectiveFrom = validateWorkDate(input.effectiveFrom, "適用開始日");
  const [created] = await db
    .insert(workCalendarPatterns)
    .values({
      ...input,
      createdByUserId: actor.userId,
      effectiveFrom,
      organizationId: actor.organizationId,
    })
    .returning();
  await recordAudit(db, {
    action: "work_calendar_changed",
    actorUserId: actor.userId,
    entityId: created.id,
    entityType: "work_calendar_draft",
    metadata: { effectiveFrom },
    organizationId: actor.organizationId,
  });
  return created;
}

export async function saveCalendarException(
  db: AppDatabase,
  actor: SessionActor,
  input: {
    calendarDate: string;
    dayKind: CalendarDayKind;
    employeeId?: string | null;
    exceptionId?: string;
    name: string;
    reason: string;
  },
) {
  requirePermission(actor, "calendar:manage");
  const calendarDate = validateWorkDate(input.calendarDate);
  const name = required(input.name, "名称");
  const reason = required(input.reason, "理由", 500);

  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, calendarDate.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, calendarDate);
    const values = {
      active: true,
      calendarDate,
      createdByUserId: actor.userId,
      dayKind: input.dayKind,
      employeeId: input.employeeId ?? null,
      name,
      organizationId: actor.organizationId,
      reason,
      updatedAt: new Date(),
    } as const;
    const [saved] = input.exceptionId
      ? await transaction
          .update(workCalendarDateExceptions)
          .set(values)
          .where(
            and(
              eq(workCalendarDateExceptions.id, input.exceptionId),
              eq(workCalendarDateExceptions.organizationId, actor.organizationId),
            ),
          )
          .returning()
      : await transaction.insert(workCalendarDateExceptions).values(values).returning();
    if (!saved) throw new WorkCalendarValidationError("日付例外を確認できませんでした。");
    await recordAudit(transaction, {
      action: "work_calendar_changed",
      actorUserId: actor.userId,
      entityId: saved.id,
      entityType: input.employeeId ? "employee_calendar_exception" : "company_calendar_exception",
      metadata: { calendarDate, dayKind: input.dayKind, reason },
      organizationId: actor.organizationId,
    });
    return saved;
  });
}

export async function deactivateCalendarException(
  db: AppDatabase,
  actor: SessionActor,
  exceptionId: string,
  reason: string,
) {
  requirePermission(actor, "calendar:manage");
  const deactivateReason = required(reason, "無効化理由", 500);
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(workCalendarDateExceptions)
      .where(
        and(
          eq(workCalendarDateExceptions.id, exceptionId),
          eq(workCalendarDateExceptions.organizationId, actor.organizationId),
          eq(workCalendarDateExceptions.active, true),
        ),
      )
      .limit(1);
    if (!existing) throw new WorkCalendarValidationError("有効な日付例外がありません。");
    await lockAttendanceMonth(transaction, actor.organizationId, existing.calendarDate.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, existing.calendarDate);
    const [deactivated] = await transaction
      .update(workCalendarDateExceptions)
      .set({
        active: false,
        reason: `${existing.reason} / 無効化: ${deactivateReason}`,
        updatedAt: new Date(),
      })
      .where(eq(workCalendarDateExceptions.id, existing.id))
      .returning();
    await recordAudit(transaction, {
      action: "work_calendar_changed",
      actorUserId: actor.userId,
      entityId: existing.id,
      entityType: "calendar_exception_deactivated",
      metadata: { calendarDate: existing.calendarDate, reason: deactivateReason },
      organizationId: actor.organizationId,
    });
    return deactivated;
  });
}

const calendarImportHeaders = ["date", "kind", "name", "reason"];

export async function previewCalendarCsv(
  db: CalendarQueryDatabase,
  input: { csv: string; organizationId: string },
) {
  const parsed = csvRecords(input.csv, calendarImportHeaders);
  const errors: CsvImportError[] = [];
  const fingerprint = createHash("sha256").update(input.csv.replace(/\r\n/g, "\n")).digest("hex");
  const seen = new Set<string>();
  const validDates = parsed.flatMap(({ value }) => {
    try {
      return [validateWorkDate(value.date)];
    } catch {
      return [];
    }
  });
  const existing = validDates.length
    ? await db
        .select()
        .from(workCalendarDateExceptions)
        .where(
          and(
            eq(workCalendarDateExceptions.organizationId, input.organizationId),
            isNull(workCalendarDateExceptions.employeeId),
            eq(workCalendarDateExceptions.active, true),
            inArray(workCalendarDateExceptions.calendarDate, validDates),
          ),
        )
    : [];
  const existingByDate = new Map(existing.map((row) => [row.calendarDate, row]));
  const months = [...new Set(validDates.map((date) => date.slice(0, 7)))];
  const closedPeriods = months.length
    ? await db
        .select({
          month: attendanceMonthPeriods.targetMonth,
          revision: attendanceMonthPeriods.currentRevision,
        })
        .from(attendanceMonthPeriods)
        .where(
          and(
            eq(attendanceMonthPeriods.organizationId, input.organizationId),
            eq(attendanceMonthPeriods.status, "closed"),
            inArray(attendanceMonthPeriods.targetMonth, months),
          ),
        )
    : [];
  const closedByMonth = new Map(closedPeriods.map((row) => [row.month, row.revision]));
  const [duplicateBatch] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.organizationId, input.organizationId),
        eq(importBatches.kind, "calendar"),
        eq(importBatches.fingerprint, fingerprint),
      ),
    )
    .limit(1);
  if (duplicateBatch) {
    errors.push({ line: 1, message: "同じ内容のCSVはすでに取り込まれています。" });
  }

  const preview = parsed.map(({ line, value }) => {
    let date = value.date;
    try {
      date = validateWorkDate(value.date);
    } catch {
      errors.push({ line, message: "日付をYYYY-MM-DD形式で入力してください。" });
    }
    if (seen.has(date)) errors.push({ line, message: `${date}がCSV内で重複しています。` });
    seen.add(date);
    if (!(["workday", "non_workday"] as string[]).includes(value.kind)) {
      errors.push({ line, message: "kindはworkdayまたはnon_workdayを指定してください。" });
    }
    if (!value.name.trim()) errors.push({ line, message: "名称は必須です。" });
    if (!value.reason.trim()) errors.push({ line, message: "理由は必須です。" });
    const closedRevision = closedByMonth.get(date.slice(0, 7));
    if (closedRevision) {
      errors.push({
        line,
        message: `${date.slice(0, 7)}は締め済み（リビジョン${closedRevision}）です。`,
      });
    }
    return {
      action: existingByDate.has(date) ? ("update" as const) : ("add" as const),
      calendarDate: date,
      dayKind: value.kind as CalendarDayKind,
      existingId: existingByDate.get(date)?.id,
      line,
      name: value.name.trim(),
      reason: value.reason.trim(),
    };
  });

  return {
    errors,
    fingerprint,
    preview,
    summary: {
      added: preview.filter((row) => row.action === "add").length,
      rejected: errors.length,
      updated: preview.filter((row) => row.action === "update").length,
    },
  };
}

export async function commitCalendarCsv(
  db: AppDatabase,
  actor: SessionActor,
  input: { csv: string; fileName?: string },
) {
  requirePermission(actor, "calendar:manage");
  const initial = await previewCalendarCsv(db, {
    csv: input.csv,
    organizationId: actor.organizationId,
  });
  if (initial.errors.length) {
    throw new CsvImportValidationError("CSVに修正が必要な行があります。", initial.errors);
  }
  const months = [...new Set(initial.preview.map((row) => row.calendarDate.slice(0, 7)))].sort();

  return db.transaction(async (transaction) => {
    for (const month of months) await lockAttendanceMonth(transaction, actor.organizationId, month);
    const validation = await previewCalendarCsv(transaction, {
      csv: input.csv,
      organizationId: actor.organizationId,
    });
    if (validation.errors.length) {
      throw new CsvImportValidationError("CSVに修正が必要な行があります。", validation.errors);
    }
    for (const row of validation.preview) {
      const values = {
        active: true,
        calendarDate: row.calendarDate,
        createdByUserId: actor.userId,
        dayKind: row.dayKind,
        name: row.name,
        organizationId: actor.organizationId,
        reason: row.reason,
        updatedAt: new Date(),
      } as const;
      if (row.existingId) {
        await transaction
          .update(workCalendarDateExceptions)
          .set(values)
          .where(
            and(
              eq(workCalendarDateExceptions.id, row.existingId),
              eq(workCalendarDateExceptions.organizationId, actor.organizationId),
            ),
          );
      } else {
        await transaction.insert(workCalendarDateExceptions).values(values);
      }
    }
    const [batch] = await transaction
      .insert(importBatches)
      .values({
        createdByUserId: actor.userId,
        fileName: input.fileName,
        fingerprint: validation.fingerprint,
        kind: "calendar",
        organizationId: actor.organizationId,
        resultSummary: validation.summary,
        rowCount: validation.preview.length,
      })
      .returning();
    await recordAudit(transaction, {
      action: "csv_imported",
      actorUserId: actor.userId,
      entityId: batch.id,
      entityType: "work_calendar",
      metadata: validation.summary,
      organizationId: actor.organizationId,
    });
    return { batch, ...validation.summary };
  });
}
