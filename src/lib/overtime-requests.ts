import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";

import { assertAttendanceMonthOpen, lockAttendanceMonth } from "@/lib/attendance-closing";
import { recordAudit } from "@/lib/audit";
import { can, requirePermission, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceDays,
  attendanceEvents,
  employees,
  organizations,
  overtimeWorkRequests,
} from "@/lib/db/schema";
import { createOvertimeRequestNotifications } from "@/lib/notifications";
import { effectiveOvertimePolicy } from "@/lib/overtime-policies";
import { minutesBetween, workDateFor, type WorkDate } from "@/lib/time";
import { resolveWorkSchedule, validateWorkDate } from "@/lib/work-calendar";

type OvertimeQueryDatabase = Pick<AppDatabase, "select">;
type OvertimeRequestKind = "holiday_work" | "overtime";
type OvertimeRequestStatus = "approved" | "cancelled" | "pending" | "rejected";

export class OvertimeRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OvertimeRequestValidationError";
  }
}

export class OvertimeRequestConflictError extends Error {
  constructor(
    message = "残業・休日出勤申請が更新されています。再読み込みしてやり直してください。",
  ) {
    super(message);
    this.name = "OvertimeRequestConflictError";
  }
}

function required(value: string, label: string, maxLength = 500) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new OvertimeRequestValidationError(`${label}は1〜${maxLength}文字で入力してください。`);
  }
  return normalized;
}

function validateLocalTime(value: string, label: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new OvertimeRequestValidationError(`${label}をHH:mm形式で入力してください。`);
  }
  return value;
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10) as WorkDate;
}

function formattedLocalParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}`;
}

export function localDateTimeToInstant(
  timezone: string,
  workDate: string,
  localTime: string,
  label = "日時",
) {
  const date = validateWorkDate(workDate, label);
  const time = validateLocalTime(localTime, label);
  const target = `${date}T${time}`;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const displayed = formattedLocalParts(candidate, timezone);
      const displayedEpoch = Date.parse(`${displayed}:00.000Z`);
      const targetEpoch = Date.UTC(year, month - 1, day, hour, minute);
      candidate = new Date(candidate.getTime() + targetEpoch - displayedEpoch);
    }
  } catch {
    throw new OvertimeRequestValidationError("組織タイムゾーンを確認できませんでした。");
  }
  if (formattedLocalParts(candidate, timezone) !== target) {
    throw new OvertimeRequestValidationError(`${label}は組織タイムゾーンに存在しない日時です。`);
  }
  const alternatives = new Set<number>();
  for (let offset = -180; offset <= 180; offset += 1) {
    const instant = new Date(candidate.getTime() + offset * 60_000);
    if (formattedLocalParts(instant, timezone) === target) alternatives.add(instant.getTime());
  }
  if (alternatives.size > 1) {
    throw new OvertimeRequestValidationError(`${label}は夏時間の切替で曖昧な日時です。`);
  }
  return candidate;
}

export function plannedOvertimeRange(
  input: Readonly<{
    endTime: string;
    minuteIncrement: number;
    plannedBreakMinutes: number;
    startTime: string;
    timezone: string;
    workDate: string;
  }>,
) {
  const workDate = validateWorkDate(input.workDate);
  const startTime = validateLocalTime(input.startTime, "予定開始時刻");
  const endTime = validateLocalTime(input.endTime, "予定終了時刻");
  const startMinute = Number(startTime.slice(3));
  const endMinute = Number(endTime.slice(3));
  if (startMinute % input.minuteIncrement !== 0 || endMinute % input.minuteIncrement !== 0) {
    throw new OvertimeRequestValidationError(
      `予定開始・終了時刻を${input.minuteIncrement}分単位で入力してください。`,
    );
  }
  if (!Number.isInteger(input.plannedBreakMinutes) || input.plannedBreakMinutes < 0) {
    throw new OvertimeRequestValidationError("予定休憩を0分以上の整数で入力してください。");
  }
  const endDate = endTime <= startTime ? nextDate(workDate) : workDate;
  const plannedStartAt = localDateTimeToInstant(
    input.timezone,
    workDate,
    startTime,
    "予定開始日時",
  );
  const plannedEndAt = localDateTimeToInstant(input.timezone, endDate, endTime, "予定終了日時");
  const elapsedMinutes = minutesBetween(plannedStartAt, plannedEndAt);
  if (elapsedMinutes <= 0 || elapsedMinutes > 1_440) {
    throw new OvertimeRequestValidationError("申請時間は24時間以内で入力してください。");
  }
  if (input.plannedBreakMinutes >= elapsedMinutes) {
    throw new OvertimeRequestValidationError("予定休憩は申請時間より短くしてください。");
  }
  return {
    endDate,
    plannedEndAt,
    plannedMinutes: elapsedMinutes - input.plannedBreakMinutes,
    plannedStartAt,
    workDate,
  };
}

async function activeEmployeeForActor(db: OvertimeQueryDatabase, actor: SessionActor) {
  const [employee] = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, actor.organizationId),
        eq(employees.userId, actor.userId),
        eq(employees.status, "active"),
      ),
    )
    .limit(1);
  if (!employee) {
    throw new OvertimeRequestValidationError("在籍中の従業員情報を確認できませんでした。");
  }
  return employee;
}

async function buildOvertimePreview(
  db: OvertimeQueryDatabase,
  input: Readonly<{
    employeeId: string;
    endTime: string;
    kind?: OvertimeRequestKind;
    now?: Date;
    organizationId: string;
    plannedBreakMinutes: number;
    startTime: string;
    workDate: string;
  }>,
) {
  const workDate = validateWorkDate(input.workDate);
  const [organization, policy, schedule] = await Promise.all([
    db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .then((rows) => rows[0]),
    effectiveOvertimePolicy(db, input.organizationId, workDate),
    resolveWorkSchedule(db, {
      employeeId: input.employeeId,
      organizationId: input.organizationId,
      workDate,
    }),
  ]);
  if (!organization) throw new OvertimeRequestValidationError("組織を確認できませんでした。");
  if (!policy) {
    throw new OvertimeRequestValidationError(
      "この勤務日に有効な残業申請ポリシーがありません。管理者へ確認してください。",
    );
  }
  if (
    schedule.calendarSource === "inactive_calendar" ||
    schedule.calendarSource === "not_employed"
  ) {
    throw new OvertimeRequestValidationError(
      "対象日の勤務カレンダーまたは在籍状態を確認してください。",
    );
  }
  const kind: OvertimeRequestKind = schedule.dayKind === "workday" ? "overtime" : "holiday_work";
  if (input.kind && input.kind !== kind) {
    throw new OvertimeRequestValidationError(
      kind === "overtime"
        ? "所定勤務日は残業として申請してください。"
        : "所定休日・会社休日は休日出勤として申請してください。",
    );
  }
  const range = plannedOvertimeRange({
    endTime: input.endTime,
    minuteIncrement: policy.minuteIncrement,
    plannedBreakMinutes: input.plannedBreakMinutes,
    startTime: input.startTime,
    timezone: organization.timezone,
    workDate,
  });
  if (
    policy.requirePriorApproval &&
    (input.now ?? new Date()).getTime() >= range.plannedStartAt.getTime()
  ) {
    throw new OvertimeRequestValidationError(
      "事前申請が必要です。予定開始時刻を過ぎた場合は管理者へ連絡してください。",
    );
  }
  if (kind === "overtime" && schedule.scheduledStartTime && schedule.scheduledEndTime) {
    const scheduledStartAt = localDateTimeToInstant(
      organization.timezone,
      workDate,
      schedule.scheduledStartTime.slice(0, 5),
      "所定開始日時",
    );
    const scheduleEndDate =
      schedule.scheduledEndTime <= schedule.scheduledStartTime ? nextDate(workDate) : workDate;
    const scheduledEndAt = localDateTimeToInstant(
      organization.timezone,
      scheduleEndDate,
      schedule.scheduledEndTime.slice(0, 5),
      "所定終了日時",
    );
    if (range.plannedStartAt >= scheduledStartAt && range.plannedEndAt <= scheduledEndAt) {
      throw new OvertimeRequestValidationError("所定時間外を含む時間帯を申請してください。");
    }
  }
  return { kind, policy, range, schedule, timezone: organization.timezone };
}

export async function previewOvertimeWorkRequest(
  db: OvertimeQueryDatabase,
  actor: SessionActor,
  input: Readonly<{
    endTime: string;
    kind?: OvertimeRequestKind;
    now?: Date;
    plannedBreakMinutes: number;
    startTime: string;
    workDate: string;
  }>,
) {
  const employee = await activeEmployeeForActor(db, actor);
  return {
    employee,
    ...(await buildOvertimePreview(db, {
      ...input,
      employeeId: employee.id,
      organizationId: actor.organizationId,
    })),
  };
}

async function overlappingRequest(
  db: OvertimeQueryDatabase,
  input: Readonly<{
    employeeId: string;
    exceptRequestId?: string;
    organizationId: string;
    plannedEndAt: Date;
    plannedStartAt: Date;
  }>,
) {
  const conditions = [
    eq(overtimeWorkRequests.organizationId, input.organizationId),
    eq(overtimeWorkRequests.employeeId, input.employeeId),
    inArray(overtimeWorkRequests.status, ["pending", "approved"]),
    lt(overtimeWorkRequests.plannedStartAt, input.plannedEndAt),
    gt(overtimeWorkRequests.plannedEndAt, input.plannedStartAt),
  ];
  if (input.exceptRequestId) conditions.push(ne(overtimeWorkRequests.id, input.exceptRequestId));
  const [request] = await db
    .select({ id: overtimeWorkRequests.id })
    .from(overtimeWorkRequests)
    .where(and(...conditions))
    .limit(1);
  return request ?? null;
}

export async function createOvertimeWorkRequest(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    endTime: string;
    kind?: OvertimeRequestKind;
    now?: Date;
    plannedBreakMinutes: number;
    reason: string;
    startTime: string;
    workDate: string;
  }>,
) {
  const reason = required(input.reason, "申請理由");
  const workDate = validateWorkDate(input.workDate);
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, workDate.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, workDate);
    const employee = await activeEmployeeForActor(transaction, actor);
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${employee.id}:${workDate}:overtime`}))`,
    );
    const preview = await buildOvertimePreview(transaction, {
      ...input,
      employeeId: employee.id,
      organizationId: actor.organizationId,
      workDate,
    });
    const duplicate = await overlappingRequest(transaction, {
      employeeId: employee.id,
      organizationId: actor.organizationId,
      plannedEndAt: preview.range.plannedEndAt,
      plannedStartAt: preview.range.plannedStartAt,
    });
    if (duplicate) {
      throw new OvertimeRequestValidationError(
        "同じ時間帯に審査待ちまたは承認済みの申請があります。",
      );
    }
    const [request] = await transaction
      .insert(overtimeWorkRequests)
      .values({
        calendarSnapshot: {
          calendarLabel: preview.schedule.calendarLabel,
          calendarSource: preview.schedule.calendarSource,
          dayKind: preview.schedule.dayKind,
        },
        employeeId: employee.id,
        kind: preview.kind,
        organizationId: actor.organizationId,
        plannedBreakMinutes: input.plannedBreakMinutes,
        plannedEndAt: preview.range.plannedEndAt,
        plannedMinutes: preview.range.plannedMinutes,
        plannedStartAt: preview.range.plannedStartAt,
        policyId: preview.policy.id,
        reason,
        requestedByUserId: actor.userId,
        workDate,
        workRuleSnapshot: {
          scheduledBreakMinutes: preview.schedule.scheduledBreakMinutes,
          scheduledEndTime: preview.schedule.scheduledEndTime,
          scheduledMinutes: preview.schedule.scheduledMinutes,
          scheduledStartTime: preview.schedule.scheduledStartTime,
          workRuleId: preview.schedule.workRuleId,
          workRuleName: preview.schedule.workRuleName,
        },
      })
      .returning();
    await recordAudit(transaction, {
      action: "overtime_request_submitted",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "overtime_work_request",
      metadata: {
        employeeId: employee.id,
        kind: request.kind,
        plannedBreakMinutes: request.plannedBreakMinutes,
        plannedEndAt: request.plannedEndAt.toISOString(),
        plannedMinutes: request.plannedMinutes,
        plannedStartAt: request.plannedStartAt.toISOString(),
        policyId: request.policyId,
        workDate,
      },
      organizationId: actor.organizationId,
    });
    await createOvertimeRequestNotifications(transaction, { event: "submitted", request });
    return { employee, preview, request };
  });
}

export async function listOwnOvertimeWorkRequests(
  db: OvertimeQueryDatabase,
  actor: SessionActor,
  input: Readonly<{
    from?: string;
    kind?: OvertimeRequestKind;
    status?: OvertimeRequestStatus;
    to?: string;
  }> = {},
) {
  const employee = await activeEmployeeForActor(db, actor);
  const conditions = [
    eq(overtimeWorkRequests.organizationId, actor.organizationId),
    eq(overtimeWorkRequests.employeeId, employee.id),
    eq(overtimeWorkRequests.requestedByUserId, actor.userId),
  ];
  if (input.from) conditions.push(gte(overtimeWorkRequests.workDate, validateWorkDate(input.from)));
  if (input.to) conditions.push(lte(overtimeWorkRequests.workDate, validateWorkDate(input.to)));
  if (input.kind) conditions.push(eq(overtimeWorkRequests.kind, input.kind));
  if (input.status) conditions.push(eq(overtimeWorkRequests.status, input.status));
  return db
    .select()
    .from(overtimeWorkRequests)
    .where(and(...conditions))
    .orderBy(desc(overtimeWorkRequests.workDate), desc(overtimeWorkRequests.createdAt));
}

export async function getOwnOvertimeWorkRequest(
  db: OvertimeQueryDatabase,
  actor: SessionActor,
  requestId: string,
) {
  const [request] = await db
    .select()
    .from(overtimeWorkRequests)
    .where(
      and(
        eq(overtimeWorkRequests.id, requestId),
        eq(overtimeWorkRequests.organizationId, actor.organizationId),
        eq(overtimeWorkRequests.requestedByUserId, actor.userId),
      ),
    )
    .limit(1);
  if (!request) throw new OvertimeRequestValidationError("自分の申請を確認できませんでした。");
  return request;
}

export async function cancelOvertimeWorkRequest(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
  expectedVersion: number,
) {
  const request = await getOwnOvertimeWorkRequest(db, actor, requestId);
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, request.workDate.slice(0, 7));
    await transaction.execute(
      sql`SELECT id FROM ${overtimeWorkRequests} WHERE id = ${requestId} FOR UPDATE`,
    );
    const [current] = await transaction
      .select()
      .from(overtimeWorkRequests)
      .where(
        and(
          eq(overtimeWorkRequests.id, requestId),
          eq(overtimeWorkRequests.organizationId, actor.organizationId),
          eq(overtimeWorkRequests.requestedByUserId, actor.userId),
        ),
      )
      .limit(1);
    if (!current || current.status !== "pending" || current.version !== expectedVersion) {
      throw new OvertimeRequestConflictError();
    }
    await assertAttendanceMonthOpen(transaction, actor.organizationId, current.workDate);
    const [cancelled] = await transaction
      .update(overtimeWorkRequests)
      .set({
        cancelledAt: new Date(),
        status: "cancelled",
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(
        and(
          eq(overtimeWorkRequests.id, current.id),
          eq(overtimeWorkRequests.status, "pending"),
          eq(overtimeWorkRequests.version, expectedVersion),
        ),
      )
      .returning();
    if (!cancelled) throw new OvertimeRequestConflictError();
    await recordAudit(transaction, {
      action: "overtime_request_cancelled",
      actorUserId: actor.userId,
      entityId: cancelled.id,
      entityType: "overtime_work_request",
      metadata: { employeeId: cancelled.employeeId, workDate: cancelled.workDate },
      organizationId: actor.organizationId,
    });
    await createOvertimeRequestNotifications(transaction, {
      event: "cancelled",
      request: cancelled,
    });
    return cancelled;
  });
}

export async function listOvertimeReviewRequests(
  db: OvertimeQueryDatabase,
  actor: SessionActor,
  input: Readonly<{
    employeeId?: string;
    from?: string;
    kind?: OvertimeRequestKind;
    status?: OvertimeRequestStatus;
    to?: string;
  }> = {},
) {
  requirePermission(actor, "attendance:manage");
  const conditions = [eq(overtimeWorkRequests.organizationId, actor.organizationId)];
  if (input.employeeId) conditions.push(eq(overtimeWorkRequests.employeeId, input.employeeId));
  if (input.from) conditions.push(gte(overtimeWorkRequests.workDate, validateWorkDate(input.from)));
  if (input.to) conditions.push(lte(overtimeWorkRequests.workDate, validateWorkDate(input.to)));
  if (input.kind) conditions.push(eq(overtimeWorkRequests.kind, input.kind));
  if (input.status) conditions.push(eq(overtimeWorkRequests.status, input.status));
  return db
    .select({
      displayName: sql<string>`${employees.familyName} || ' ' || ${employees.givenName}`,
      employeeNumber: employees.employeeNumber,
      request: overtimeWorkRequests,
    })
    .from(overtimeWorkRequests)
    .innerJoin(employees, eq(employees.id, overtimeWorkRequests.employeeId))
    .where(and(...conditions))
    .orderBy(asc(overtimeWorkRequests.status), asc(overtimeWorkRequests.workDate));
}

async function activePunches(
  db: OvertimeQueryDatabase,
  organizationId: string,
  employeeId: string,
  workDate: string,
) {
  return db
    .select({ occurredAt: attendanceEvents.occurredAt, type: attendanceEvents.type })
    .from(attendanceEvents)
    .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceEvents.attendanceDayId))
    .where(
      and(
        eq(attendanceEvents.organizationId, organizationId),
        eq(attendanceEvents.employeeId, employeeId),
        eq(attendanceDays.workDate, workDate),
        isNull(attendanceEvents.supersededByCorrectionRequestId),
      ),
    )
    .orderBy(asc(attendanceEvents.occurredAt));
}

export async function getOvertimeReviewDetail(
  db: OvertimeQueryDatabase,
  actor: SessionActor,
  requestId: string,
) {
  requirePermission(actor, "attendance:manage");
  const [request] = await db
    .select()
    .from(overtimeWorkRequests)
    .where(
      and(
        eq(overtimeWorkRequests.id, requestId),
        eq(overtimeWorkRequests.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!request) throw new OvertimeRequestValidationError("申請を確認できませんでした。");
  const [schedule, punches, conflicts] = await Promise.all([
    resolveWorkSchedule(db, {
      employeeId: request.employeeId,
      organizationId: actor.organizationId,
      workDate: request.workDate as WorkDate,
    }),
    activePunches(db, actor.organizationId, request.employeeId, request.workDate),
    db
      .select()
      .from(overtimeWorkRequests)
      .where(
        and(
          eq(overtimeWorkRequests.organizationId, actor.organizationId),
          eq(overtimeWorkRequests.employeeId, request.employeeId),
          eq(overtimeWorkRequests.workDate, request.workDate),
          ne(overtimeWorkRequests.id, request.id),
          inArray(overtimeWorkRequests.status, ["pending", "approved"]),
        ),
      ),
  ]);
  return { conflicts, punches, request, schedule };
}

async function validateReviewState(
  db: OvertimeQueryDatabase,
  actor: SessionActor,
  request: typeof overtimeWorkRequests.$inferSelect,
) {
  if (request.requestedByUserId === actor.userId) {
    throw new OvertimeRequestValidationError("自分の申請は審査できません。");
  }
  const [employee, policy, schedule] = await Promise.all([
    db
      .select({ status: employees.status })
      .from(employees)
      .where(
        and(
          eq(employees.id, request.employeeId),
          eq(employees.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    effectiveOvertimePolicy(db, actor.organizationId, request.workDate),
    resolveWorkSchedule(db, {
      employeeId: request.employeeId,
      organizationId: actor.organizationId,
      workDate: request.workDate as WorkDate,
    }),
  ]);
  if (!employee || employee.status !== "active") {
    throw new OvertimeRequestValidationError("申請者の在籍状態を確認してください。");
  }
  if (!policy || policy.id !== request.policyId) {
    throw new OvertimeRequestValidationError(
      "申請後にポリシーが変更されています。申請者へ取消と再申請を依頼してください。",
    );
  }
  const currentKind = schedule.dayKind === "workday" ? "overtime" : "holiday_work";
  if (schedule.calendarSource === "inactive_calendar" || currentKind !== request.kind) {
    throw new OvertimeRequestValidationError(
      "申請後に勤務カレンダーが変更されています。申請者へ取消と再申請を依頼してください。",
    );
  }
  const duplicate = await overlappingRequest(db, {
    employeeId: request.employeeId,
    exceptRequestId: request.id,
    organizationId: actor.organizationId,
    plannedEndAt: request.plannedEndAt,
    plannedStartAt: request.plannedStartAt,
  });
  if (duplicate) throw new OvertimeRequestValidationError("重複する申請があります。");
}

async function reviewOvertimeRequest(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    action: "approve" | "reject";
    comment?: string;
    expectedVersion: number;
    requestId: string;
  }>,
) {
  requirePermission(actor, "attendance:manage");
  const reviewComment =
    input.action === "reject" ? required(input.comment ?? "", "却下理由") : null;
  const [preflight] = await db
    .select({ workDate: overtimeWorkRequests.workDate })
    .from(overtimeWorkRequests)
    .where(
      and(
        eq(overtimeWorkRequests.id, input.requestId),
        eq(overtimeWorkRequests.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!preflight) throw new OvertimeRequestValidationError("申請を確認できませんでした。");
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, preflight.workDate.slice(0, 7));
    await transaction.execute(
      sql`SELECT id FROM ${overtimeWorkRequests} WHERE id = ${input.requestId} FOR UPDATE`,
    );
    const [request] = await transaction
      .select()
      .from(overtimeWorkRequests)
      .where(
        and(
          eq(overtimeWorkRequests.id, input.requestId),
          eq(overtimeWorkRequests.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!request || request.status !== "pending" || request.version !== input.expectedVersion) {
      throw new OvertimeRequestConflictError();
    }
    await assertAttendanceMonthOpen(transaction, actor.organizationId, request.workDate);
    await validateReviewState(transaction, actor, request);
    const [reviewed] = await transaction
      .update(overtimeWorkRequests)
      .set({
        reviewComment,
        reviewedAt: new Date(),
        reviewerUserId: actor.userId,
        status: input.action === "approve" ? "approved" : "rejected",
        updatedAt: new Date(),
        version: request.version + 1,
      })
      .where(
        and(
          eq(overtimeWorkRequests.id, request.id),
          eq(overtimeWorkRequests.status, "pending"),
          eq(overtimeWorkRequests.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!reviewed) throw new OvertimeRequestConflictError();
    const auditAction =
      input.action === "approve" ? "overtime_request_approved" : "overtime_request_rejected";
    await recordAudit(transaction, {
      action: auditAction,
      actorUserId: actor.userId,
      entityId: reviewed.id,
      entityType: "overtime_work_request",
      metadata: {
        employeeId: reviewed.employeeId,
        kind: reviewed.kind,
        plannedBreakMinutes: reviewed.plannedBreakMinutes,
        plannedEndAt: reviewed.plannedEndAt.toISOString(),
        plannedMinutes: reviewed.plannedMinutes,
        plannedStartAt: reviewed.plannedStartAt.toISOString(),
        policyId: reviewed.policyId,
        reviewComment,
        reviewerUserId: actor.userId,
        workDate: reviewed.workDate,
      },
      organizationId: actor.organizationId,
    });
    await createOvertimeRequestNotifications(transaction, {
      event: input.action === "approve" ? "approved" : "rejected",
      request: reviewed,
      reviewComment,
    });
    return reviewed;
  });
}

export async function approveOvertimeWorkRequest(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
  expectedVersion: number,
) {
  return reviewOvertimeRequest(db, actor, {
    action: "approve",
    expectedVersion,
    requestId,
  });
}

export async function rejectOvertimeWorkRequest(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
  expectedVersion: number,
  comment: string,
) {
  return reviewOvertimeRequest(db, actor, {
    action: "reject",
    comment,
    expectedVersion,
    requestId,
  });
}

export function mayReviewOvertime(actor: SessionActor) {
  return can(actor, "attendance:manage");
}
