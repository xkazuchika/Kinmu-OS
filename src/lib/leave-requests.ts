import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { assertAttendanceMonthOpen, lockAttendanceMonth } from "@/lib/attendance-closing";
import { recordAudit } from "@/lib/audit";
import type { SessionActor } from "@/lib/authorization";
import { requireEmployeeScope, requirePermission } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  absenceRecords,
  attendanceDays,
  attendanceEvents,
  employees,
  leaveBalanceAccounts,
  leaveGrantLots,
  leaveRequestDays,
  leaveRequests,
  leaveTransactions,
  leaveTypes,
  organizations,
} from "@/lib/db/schema";
import {
  consumeLeaveBalance,
  getLeaveBalance,
  LeaveLedgerValidationError,
} from "@/lib/leave-ledger";
import { workDateFor, type WorkDate } from "@/lib/time";
import { resolveWorkSchedule, validateWorkDate } from "@/lib/work-calendar";

type LeaveUnit = "full_day" | "half_day";
type LeaveQueryDatabase = Pick<AppDatabase, "select">;

export class LeaveRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveRequestValidationError";
  }
}

export class LeaveRequestConflictError extends Error {
  constructor(message = "休暇申請が更新されています。再読み込みしてやり直してください。") {
    super(message);
    this.name = "LeaveRequestConflictError";
  }
}

function required(value: string, label: string, maxLength = 500) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new LeaveRequestValidationError(`${label}は1〜${maxLength}文字で入力してください。`);
  }
  return normalized;
}

export function datesBetween(from: string, to: string) {
  const start = validateWorkDate(from, "開始日");
  const end = validateWorkDate(to, "終了日");
  if (end < start) throw new LeaveRequestValidationError("終了日は開始日以後にしてください。");
  const dates: WorkDate[] = [];
  for (
    let cursor = new Date(`${start}T00:00:00.000Z`);
    cursor.toISOString().slice(0, 10) <= end;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    dates.push(cursor.toISOString().slice(0, 10) as WorkDate);
    if (dates.length > 366)
      throw new LeaveRequestValidationError("申請期間は366日以内にしてください。");
  }
  return dates;
}

async function employeeForActor(db: LeaveQueryDatabase, actor: SessionActor) {
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
  if (!employee)
    throw new LeaveRequestValidationError("在籍中の従業員情報を確認できませんでした。");
  return employee;
}

async function requestableLeaveType(
  db: LeaveQueryDatabase,
  organizationId: string,
  leaveTypeId: string,
  from: string,
  to: string,
) {
  const [leaveType] = await db
    .select()
    .from(leaveTypes)
    .where(
      and(
        eq(leaveTypes.id, leaveTypeId),
        eq(leaveTypes.organizationId, organizationId),
        eq(leaveTypes.active, true),
        eq(leaveTypes.requestable, true),
      ),
    )
    .limit(1);
  if (
    !leaveType ||
    leaveType.effectiveFrom > from ||
    (leaveType.effectiveTo && leaveType.effectiveTo < to)
  ) {
    throw new LeaveRequestValidationError("対象期間に申請できる休暇種別ではありません。");
  }
  return leaveType;
}

export async function previewLeaveRequest(
  db: LeaveQueryDatabase,
  actor: SessionActor,
  input: { from: string; leaveTypeId: string; to: string; unit: LeaveUnit },
) {
  const employee = await employeeForActor(db, actor);
  const dates = datesBetween(input.from, input.to);
  if (input.unit === "half_day" && dates.length !== 1) {
    throw new LeaveRequestValidationError("半日休暇は一つの勤務日を指定してください。");
  }
  const leaveType = await requestableLeaveType(
    db,
    actor.organizationId,
    input.leaveTypeId,
    dates[0],
    dates.at(-1)!,
  );
  const schedules = await Promise.all(
    dates.map(async (workDate) => ({
      schedule: await resolveWorkSchedule(db, {
        employeeId: employee.id,
        organizationId: actor.organizationId,
        workDate,
      }),
      workDate,
    })),
  );
  const included = schedules
    .filter(({ schedule }) => schedule.dayKind === "workday")
    .map(({ schedule, workDate }) => ({
      calendarLabel: schedule.calendarLabel,
      calendarSource: schedule.calendarSource,
      scheduledMinutes:
        input.unit === "half_day"
          ? Math.floor(schedule.scheduledMinutes / 2)
          : schedule.scheduledMinutes,
      units: input.unit === "half_day" ? 1 : 2,
      workDate,
    }));
  if (!included.length) throw new LeaveRequestValidationError("対象期間に所定勤務日がありません。");
  const excluded = schedules
    .filter(({ schedule }) => schedule.dayKind === "non_workday")
    .map(({ schedule, workDate }) => ({
      calendarLabel: schedule.calendarLabel,
      calendarSource: schedule.calendarSource,
      workDate,
    }));
  const requiredUnits = included.reduce((sum, day) => sum + day.units, 0);
  const balance = leaveType.consumesBalance
    ? await getLeaveBalance(db as Parameters<typeof getLeaveBalance>[0], {
        asOf: included.at(-1)!.workDate,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: actor.organizationId,
      })
    : {
        accountId: null,
        availableUnits: Number.MAX_SAFE_INTEGER,
        expiredUnits: 0,
        ledgerUnits: Number.MAX_SAFE_INTEGER,
        nextExpiry: null,
        pendingUnits: 0,
        version: 0,
      };
  return {
    afterAvailableUnits: leaveType.consumesBalance ? balance.availableUnits - requiredUnits : null,
    balance,
    employee,
    excluded,
    included,
    leaveType,
    requiredUnits,
  };
}

async function overlappingLeave(
  db: LeaveQueryDatabase,
  organizationId: string,
  employeeId: string,
  dates: string[],
  exceptRequestId?: string,
) {
  const rows = await db
    .select({ requestId: leaveRequests.id, workDate: leaveRequestDays.workDate })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .where(
      and(
        eq(leaveRequests.organizationId, organizationId),
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequestDays.workDate, dates),
        or(eq(leaveRequests.status, "pending"), eq(leaveRequests.status, "approved")),
      ),
    );
  return rows.find((row) => row.requestId !== exceptRequestId);
}

export async function createLeaveRequest(
  db: AppDatabase,
  actor: SessionActor,
  input: { from: string; leaveTypeId: string; reason: string; to: string; unit: LeaveUnit },
) {
  const reason = required(input.reason, "申請理由");
  const dates = datesBetween(input.from, input.to);
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  return db.transaction(async (transaction) => {
    for (const month of months) await lockAttendanceMonth(transaction, actor.organizationId, month);
    for (const date of dates)
      await assertAttendanceMonthOpen(transaction, actor.organizationId, date);
    const preview = await previewLeaveRequest(transaction, actor, input);
    const duplicate = await overlappingLeave(
      transaction,
      actor.organizationId,
      preview.employee.id,
      preview.included.map((day) => day.workDate),
    );
    if (duplicate) {
      throw new LeaveRequestValidationError(`${duplicate.workDate}には既存の休暇申請があります。`);
    }
    if (preview.leaveType.consumesBalance && preview.afterAvailableUnits! < 0) {
      throw new LeaveLedgerValidationError(
        `休暇残高が${Math.abs(preview.afterAvailableUnits!)}単位不足しています。`,
      );
    }
    const [request] = await transaction
      .insert(leaveRequests)
      .values({
        baseBalanceVersion: preview.balance.version,
        consumesBalance: preview.leaveType.consumesBalance,
        employeeId: preview.employee.id,
        leaveTypeCode: preview.leaveType.code,
        leaveTypeId: preview.leaveType.id,
        leaveTypeName: preview.leaveType.name,
        organizationId: actor.organizationId,
        paid: preview.leaveType.paid,
        reason,
        requestedByUserId: actor.userId,
      })
      .returning();
    await transaction.insert(leaveRequestDays).values(
      preview.included.map((day) => ({
        calendarSource: day.calendarSource,
        requestId: request.id,
        scheduledMinutes: day.scheduledMinutes,
        units: day.units,
        workDate: day.workDate as WorkDate,
      })),
    );
    await recordAudit(transaction, {
      action: "leave_requested",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "leave_request",
      metadata: {
        excludedDates: preview.excluded.map((day) => day.workDate),
        requiredUnits: preview.requiredUnits,
      },
      organizationId: actor.organizationId,
    });
    return { ...preview, request };
  });
}

export async function cancelLeaveRequest(db: AppDatabase, actor: SessionActor, requestId: string) {
  const preflight = await db
    .select({ request: leaveRequests, workDate: leaveRequestDays.workDate })
    .from(leaveRequests)
    .innerJoin(leaveRequestDays, eq(leaveRequestDays.requestId, leaveRequests.id))
    .where(
      and(
        eq(leaveRequests.id, requestId),
        eq(leaveRequests.organizationId, actor.organizationId),
        eq(leaveRequests.requestedByUserId, actor.userId),
      ),
    );
  if (!preflight.length)
    throw new LeaveRequestValidationError("自分の休暇申請を確認できませんでした。");
  const months = [...new Set(preflight.map((row) => row.workDate.slice(0, 7)))].sort();
  return db.transaction(async (transaction) => {
    for (const month of months) await lockAttendanceMonth(transaction, actor.organizationId, month);
    const [request] = await transaction
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, requestId),
          eq(leaveRequests.organizationId, actor.organizationId),
          eq(leaveRequests.requestedByUserId, actor.userId),
        ),
      )
      .limit(1);
    if (!request) throw new LeaveRequestConflictError();
    if (request.status !== "pending") {
      throw new LeaveRequestValidationError(
        "審査済みの申請は取り消せません。管理者へ連絡してください。",
      );
    }
    const days = await transaction
      .select()
      .from(leaveRequestDays)
      .where(eq(leaveRequestDays.requestId, request.id));
    for (const day of days)
      await assertAttendanceMonthOpen(transaction, actor.organizationId, day.workDate);
    const [cancelled] = await transaction
      .update(leaveRequests)
      .set({ cancelledAt: new Date(), status: "cancelled", updatedAt: new Date() })
      .where(and(eq(leaveRequests.id, request.id), eq(leaveRequests.status, "pending")))
      .returning();
    if (!cancelled) throw new LeaveRequestConflictError();
    await recordAudit(transaction, {
      action: "leave_request_cancelled",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "leave_request",
      organizationId: actor.organizationId,
    });
    return cancelled;
  });
}

async function activePunches(
  db: LeaveQueryDatabase,
  organizationId: string,
  employeeId: string,
  dates: string[],
) {
  if (!dates.length) return [];
  return db
    .select({
      eventId: attendanceEvents.id,
      type: attendanceEvents.type,
      workDate: attendanceDays.workDate,
    })
    .from(attendanceEvents)
    .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceEvents.attendanceDayId))
    .where(
      and(
        eq(attendanceEvents.organizationId, organizationId),
        eq(attendanceEvents.employeeId, employeeId),
        isNull(attendanceEvents.supersededByCorrectionRequestId),
        inArray(attendanceDays.workDate, dates),
      ),
    )
    .orderBy(asc(attendanceDays.workDate), asc(attendanceEvents.occurredAt));
}

export async function getLeaveReviewDetail(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
) {
  requirePermission(actor, "leave:manage");
  const [request] = await db
    .select()
    .from(leaveRequests)
    .where(
      and(eq(leaveRequests.id, requestId), eq(leaveRequests.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!request) throw new LeaveRequestValidationError("休暇申請を確認できませんでした。");
  const days = await db
    .select()
    .from(leaveRequestDays)
    .where(eq(leaveRequestDays.requestId, request.id))
    .orderBy(asc(leaveRequestDays.workDate));
  const punches = await activePunches(
    db,
    actor.organizationId,
    request.employeeId,
    days.map((day) => day.workDate),
  );
  const schedules = await Promise.all(
    days.map(async (day) => ({
      ...(await resolveWorkSchedule(db, {
        employeeId: request.employeeId,
        organizationId: actor.organizationId,
        workDate: day.workDate as WorkDate,
      })),
      workDate: day.workDate,
    })),
  );
  const existingLeave = await overlappingLeave(
    db,
    actor.organizationId,
    request.employeeId,
    days.map((day) => day.workDate),
    request.id,
  );
  const balance = request.consumesBalance
    ? await getLeaveBalance(db, {
        asOf: days.at(-1)!.workDate,
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        organizationId: actor.organizationId,
      })
    : null;
  const lots = balance?.accountId
    ? await db
        .select()
        .from(leaveGrantLots)
        .where(eq(leaveGrantLots.accountId, balance.accountId))
        .orderBy(asc(leaveGrantLots.expiresOn), asc(leaveGrantLots.grantedOn))
    : [];
  return { balance, days, existingLeave: existingLeave ?? null, lots, punches, request, schedules };
}

export async function approveLeaveRequest(db: AppDatabase, actor: SessionActor, requestId: string) {
  requirePermission(actor, "leave:manage");
  const preflight = await db
    .select({ workDate: leaveRequestDays.workDate })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .where(
      and(eq(leaveRequests.id, requestId), eq(leaveRequests.organizationId, actor.organizationId)),
    );
  if (!preflight.length) throw new LeaveRequestValidationError("休暇申請を確認できませんでした。");
  const months = [...new Set(preflight.map((row) => row.workDate.slice(0, 7)))].sort();
  return db.transaction(async (transaction) => {
    for (const month of months) await lockAttendanceMonth(transaction, actor.organizationId, month);
    await transaction.execute(
      sql`SELECT id FROM ${leaveRequests} WHERE id = ${requestId} FOR UPDATE`,
    );
    const [request] = await transaction
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, requestId),
          eq(leaveRequests.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!request || request.status !== "pending") throw new LeaveRequestConflictError();
    if (request.requestedByUserId === actor.userId) {
      throw new LeaveRequestValidationError("自分の休暇申請は承認できません。");
    }
    const days = await transaction
      .select()
      .from(leaveRequestDays)
      .where(eq(leaveRequestDays.requestId, request.id))
      .orderBy(asc(leaveRequestDays.workDate));
    for (const day of days)
      await assertAttendanceMonthOpen(transaction, actor.organizationId, day.workDate);
    const duplicate = await overlappingLeave(
      transaction,
      actor.organizationId,
      request.employeeId,
      days.map((day) => day.workDate),
      request.id,
    );
    if (duplicate)
      throw new LeaveRequestValidationError(`${duplicate.workDate}に承認済み休暇があります。`);
    const fullDates = days.filter((day) => day.units === 2).map((day) => day.workDate);
    const punches = await activePunches(
      transaction,
      actor.organizationId,
      request.employeeId,
      fullDates,
    );
    if (punches.length) {
      throw new LeaveRequestValidationError(
        `${punches[0].workDate}に打刻があるため全日休暇を承認できません。`,
      );
    }
    if (request.consumesBalance) {
      const balance = await getLeaveBalance(transaction, {
        asOf: days.at(-1)!.workDate,
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        organizationId: actor.organizationId,
      });
      if (!balance.accountId || balance.availableUnits < 0) {
        throw new LeaveLedgerValidationError(
          `休暇残高が${Math.abs(Math.min(0, balance.availableUnits)) || days.reduce((sum, day) => sum + day.units, 0)}単位不足しています。`,
        );
      }
      let version = balance.version;
      for (const day of days) {
        const consumed = await consumeLeaveBalance(transaction, actor, {
          accountId: balance.accountId,
          effectiveOn: day.workDate,
          employeeId: request.employeeId,
          expectedVersion: version,
          leaveTypeId: request.leaveTypeId,
          reason: `休暇申請 ${request.id} の承認消化`,
          requestId: request.id,
          units: day.units,
        });
        version = consumed.version;
      }
    }
    const [approved] = await transaction
      .update(leaveRequests)
      .set({
        reviewedAt: new Date(),
        reviewerUserId: actor.userId,
        status: "approved",
        updatedAt: new Date(),
      })
      .where(and(eq(leaveRequests.id, request.id), eq(leaveRequests.status, "pending")))
      .returning();
    if (!approved) throw new LeaveRequestConflictError();
    await recordAudit(transaction, {
      action: "leave_request_approved",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "leave_request",
      metadata: {
        employeeId: request.employeeId,
        units: days.reduce((sum, day) => sum + day.units, 0),
      },
      organizationId: actor.organizationId,
    });
    return approved;
  });
}

export async function rejectLeaveRequest(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
  comment: string,
) {
  requirePermission(actor, "leave:manage");
  const reviewComment = required(comment, "却下理由");
  const preflight = await db
    .select({ workDate: leaveRequestDays.workDate })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .where(
      and(eq(leaveRequests.id, requestId), eq(leaveRequests.organizationId, actor.organizationId)),
    );
  if (!preflight.length) throw new LeaveRequestValidationError("休暇申請を確認できませんでした。");
  const months = [...new Set(preflight.map((row) => row.workDate.slice(0, 7)))].sort();
  return db.transaction(async (transaction) => {
    for (const month of months) await lockAttendanceMonth(transaction, actor.organizationId, month);
    await transaction.execute(
      sql`SELECT id FROM ${leaveRequests} WHERE id = ${requestId} FOR UPDATE`,
    );
    const [request] = await transaction
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, requestId),
          eq(leaveRequests.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!request || request.status !== "pending") throw new LeaveRequestConflictError();
    if (request.requestedByUserId === actor.userId) {
      throw new LeaveRequestValidationError("自分の休暇申請は却下できません。");
    }
    const days = await transaction
      .select()
      .from(leaveRequestDays)
      .where(eq(leaveRequestDays.requestId, request.id));
    for (const day of days)
      await assertAttendanceMonthOpen(transaction, actor.organizationId, day.workDate);
    const [rejected] = await transaction
      .update(leaveRequests)
      .set({
        reviewComment,
        reviewedAt: new Date(),
        reviewerUserId: actor.userId,
        status: "rejected",
        updatedAt: new Date(),
      })
      .where(and(eq(leaveRequests.id, request.id), eq(leaveRequests.status, "pending")))
      .returning();
    if (!rejected) throw new LeaveRequestConflictError();
    await recordAudit(transaction, {
      action: "leave_request_rejected",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "leave_request",
      metadata: { reviewComment },
      organizationId: actor.organizationId,
    });
    return rejected;
  });
}

export async function confirmAbsence(
  db: AppDatabase,
  actor: SessionActor,
  input: { employeeId: string; reason: string; workDate: string },
) {
  requirePermission(actor, "leave:manage");
  const workDate = validateWorkDate(input.workDate);
  const reason = required(input.reason, "欠勤理由");
  const [organization] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, actor.organizationId))
    .limit(1);
  if (!organization || workDate >= workDateFor(new Date(), organization.timezone)) {
    throw new LeaveRequestValidationError("過去の所定勤務日だけを欠勤へ確定できます。");
  }
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, workDate.slice(0, 7));
    await assertAttendanceMonthOpen(transaction, actor.organizationId, workDate);
    const schedule = await resolveWorkSchedule(transaction, {
      employeeId: input.employeeId,
      organizationId: actor.organizationId,
      workDate,
    });
    if (schedule.dayKind !== "workday") {
      throw new LeaveRequestValidationError("所定勤務日ではありません。");
    }
    const [punch] = await activePunches(transaction, actor.organizationId, input.employeeId, [
      workDate,
    ]);
    if (punch) throw new LeaveRequestValidationError("打刻がある日は欠勤へ確定できません。");
    const [approvedLeave] = await transaction
      .select({ id: leaveRequests.id })
      .from(leaveRequestDays)
      .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
      .where(
        and(
          eq(leaveRequests.organizationId, actor.organizationId),
          eq(leaveRequests.employeeId, input.employeeId),
          eq(leaveRequests.status, "approved"),
          eq(leaveRequestDays.workDate, workDate),
        ),
      )
      .limit(1);
    if (approvedLeave)
      throw new LeaveRequestValidationError("承認済み休暇がある日は欠勤へ確定できません。");
    const [absence] = await transaction
      .insert(absenceRecords)
      .values({
        confirmedByUserId: actor.userId,
        employeeId: input.employeeId,
        organizationId: actor.organizationId,
        reason,
        workDate,
      })
      .returning();
    await recordAudit(transaction, {
      action: "absence_changed",
      actorUserId: actor.userId,
      entityId: absence.id,
      entityType: "absence",
      metadata: { employeeId: input.employeeId, reason, workDate },
      organizationId: actor.organizationId,
    });
    return absence;
  });
}

export async function listLeaveRequests(
  db: AppDatabase,
  actor: SessionActor,
  filters: { employeeId?: string; status?: (typeof leaveRequests.status.enumValues)[number] },
) {
  if (filters.employeeId) await requireEmployeeScope(db, actor, filters.employeeId);
  const conditions = [eq(leaveRequests.organizationId, actor.organizationId)];
  if (actor.role === "employee") conditions.push(eq(leaveRequests.requestedByUserId, actor.userId));
  if (filters.employeeId) conditions.push(eq(leaveRequests.employeeId, filters.employeeId));
  if (filters.status) conditions.push(eq(leaveRequests.status, filters.status));
  return db
    .select()
    .from(leaveRequests)
    .where(and(...conditions))
    .orderBy(desc(leaveRequests.createdAt));
}
