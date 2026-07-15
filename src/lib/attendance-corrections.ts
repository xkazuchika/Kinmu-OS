import { and, asc, count, desc, eq, gte, lt, sql } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import {
  effectiveAttendanceEvents,
  recomputeAttendanceDay,
  validateAttendanceEventSequence,
  type AttendanceEventRecord,
  type PunchType,
} from "@/lib/attendance";
import {
  AuthorizationError,
  requireEmployeeScope,
  requirePermission,
  type SessionActor,
} from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceCorrectionEntries,
  attendanceCorrectionRequests,
  attendanceDays,
  attendanceEvents,
  employees,
  organizations,
  users,
} from "@/lib/db/schema";
import { findEffectiveWorkRule } from "@/lib/db/work-rules";
import { assertEmployeeCanPunch } from "@/lib/employees";
import { workDateFor, type WorkDate } from "@/lib/time";

type CorrectionStatus = (typeof attendanceCorrectionRequests.$inferSelect)["status"];

export type CorrectionEntryInput = Readonly<{
  occurredAt: Date | string;
  originalEventId?: null | string;
  type: string;
}>;

export class AttendanceCorrectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceCorrectionValidationError";
  }
}

export class AttendanceCorrectionConflictError extends Error {
  constructor(message = "勤怠が更新されています。最新の記録を確認して再申請してください。") {
    super(message);
    this.name = "AttendanceCorrectionConflictError";
  }
}

function validateWorkDate(value: string): WorkDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AttendanceCorrectionValidationError("勤務日が正しくありません。");
  }
  return value as WorkDate;
}

function parseRequestedEntries(
  values: ReadonlyArray<CorrectionEntryInput>,
  workDate: WorkDate,
  timezone: string,
) {
  const entries = values.map((value) => {
    const occurredAt =
      value.occurredAt instanceof Date ? value.occurredAt : new Date(value.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new AttendanceCorrectionValidationError("打刻時刻が正しくありません。");
    }
    if (!(["clock_in", "clock_out", "break_start", "break_end"] as string[]).includes(value.type)) {
      throw new AttendanceCorrectionValidationError("打刻種別が正しくありません。");
    }
    if (workDateFor(occurredAt, timezone) !== workDate) {
      throw new AttendanceCorrectionValidationError(
        "打刻時刻は対象勤務日の範囲で入力してください。",
      );
    }
    return {
      occurredAt,
      originalEventId: value.originalEventId || null,
      type: value.type as PunchType,
    };
  });

  try {
    validateAttendanceEventSequence(entries);
  } catch (error) {
    throw new AttendanceCorrectionValidationError(
      error instanceof Error ? error.message : "打刻の順序が正しくありません。",
    );
  }
  const referenced = entries.flatMap((entry) =>
    entry.originalEventId ? [entry.originalEventId] : [],
  );
  if (new Set(referenced).size !== referenced.length) {
    throw new AttendanceCorrectionValidationError("同じ元打刻を複数回指定できません。");
  }
  return entries;
}

async function employeeContextForActor(db: AppDatabase, actor: SessionActor, workDate: WorkDate) {
  const [context] = await db
    .select({
      employeeId: employees.id,
      leftOn: employees.leftOn,
      status: employees.status,
      timezone: organizations.timezone,
    })
    .from(employees)
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(eq(employees.organizationId, actor.organizationId), eq(employees.userId, actor.userId)),
    )
    .limit(1);
  if (!context) throw new AuthorizationError("従業員情報が紐付いていません。");
  assertEmployeeCanPunch(context, workDate);
  return context;
}

function eventSignature(events: ReadonlyArray<{ occurredAt: Date; type: PunchType }>) {
  return events.map((event) => `${event.type}:${event.occurredAt.toISOString()}`).join("|");
}

export async function createAttendanceCorrection(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    entries: ReadonlyArray<CorrectionEntryInput>;
    reason: string;
    workDate: string;
  }>,
) {
  requirePermission(actor, "self:write");
  const workDate = validateWorkDate(input.workDate);
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) {
    throw new AttendanceCorrectionValidationError("修正理由を1,000文字以内で入力してください。");
  }
  const context = await employeeContextForActor(db, actor, workDate);
  const requestedEntries = parseRequestedEntries(input.entries, workDate, context.timezone);

  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.employeeId}:${workDate}`}))`,
    );
    const [pending] = await transaction
      .select({ id: attendanceCorrectionRequests.id })
      .from(attendanceCorrectionRequests)
      .where(
        and(
          eq(attendanceCorrectionRequests.employeeId, context.employeeId),
          eq(attendanceCorrectionRequests.workDate, workDate),
          eq(attendanceCorrectionRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new AttendanceCorrectionConflictError("この勤務日には審査待ちの申請があります。");
    }
    const [day] = await transaction
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.employeeId, context.employeeId),
          eq(attendanceDays.workDate, workDate),
        ),
      )
      .limit(1);
    const originalEvents = day ? await effectiveAttendanceEvents(transaction, day.id) : [];
    const originalIds = new Set(originalEvents.map((event) => event.id));
    if (
      requestedEntries.some(
        (entry) => entry.originalEventId && !originalIds.has(entry.originalEventId),
      )
    ) {
      throw new AttendanceCorrectionConflictError();
    }
    if (eventSignature(originalEvents) === eventSignature(requestedEntries)) {
      throw new AttendanceCorrectionValidationError("元の打刻から変更された内容がありません。");
    }

    const [request] = await transaction
      .insert(attendanceCorrectionRequests)
      .values({
        attendanceDayId: day?.id,
        baseRevision: day?.revision ?? 0,
        employeeId: context.employeeId,
        organizationId: actor.organizationId,
        reason,
        requestedByUserId: actor.userId,
        workDate,
      })
      .returning();
    if (originalEvents.length) {
      await transaction.insert(attendanceCorrectionEntries).values(
        originalEvents.map((event, position) => ({
          kind: "original" as const,
          occurredAt: event.occurredAt,
          originalEventId: event.id,
          position,
          requestId: request.id,
          type: event.type,
        })),
      );
    }
    if (requestedEntries.length) {
      await transaction.insert(attendanceCorrectionEntries).values(
        requestedEntries.map((entry, position) => ({
          kind: "requested" as const,
          occurredAt: entry.occurredAt,
          originalEventId: entry.originalEventId,
          position,
          requestId: request.id,
          type: entry.type,
        })),
      );
    }
    const detail = await correctionDetail(transaction, request.id, actor.organizationId);
    const changes = correctionDiff(detail.entries).map(auditChange);
    await recordAudit(transaction, {
      action: "attendance_correction_requested",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "attendance_correction",
      metadata: { changes, employeeId: context.employeeId, reason, workDate },
      organizationId: actor.organizationId,
    });
    return detail;
  });
}

export async function listOwnAttendanceCorrections(db: AppDatabase, actor: SessionActor) {
  requirePermission(actor, "self:read");
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(eq(employees.organizationId, actor.organizationId), eq(employees.userId, actor.userId)),
    )
    .limit(1);
  if (!employee) return [];
  return db
    .select({
      createdAt: attendanceCorrectionRequests.createdAt,
      id: attendanceCorrectionRequests.id,
      reason: attendanceCorrectionRequests.reason,
      reviewComment: attendanceCorrectionRequests.reviewComment,
      status: attendanceCorrectionRequests.status,
      workDate: attendanceCorrectionRequests.workDate,
    })
    .from(attendanceCorrectionRequests)
    .where(
      and(
        eq(attendanceCorrectionRequests.organizationId, actor.organizationId),
        eq(attendanceCorrectionRequests.employeeId, employee.id),
      ),
    )
    .orderBy(desc(attendanceCorrectionRequests.createdAt));
}

export async function cancelAttendanceCorrection(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
) {
  requirePermission(actor, "self:write");
  return db.transaction(async (transaction) => {
    const [request] = await transaction
      .select({
        employeeId: attendanceCorrectionRequests.employeeId,
        id: attendanceCorrectionRequests.id,
        status: attendanceCorrectionRequests.status,
        workDate: attendanceCorrectionRequests.workDate,
      })
      .from(attendanceCorrectionRequests)
      .where(
        and(
          eq(attendanceCorrectionRequests.id, requestId),
          eq(attendanceCorrectionRequests.organizationId, actor.organizationId),
          eq(attendanceCorrectionRequests.requestedByUserId, actor.userId),
        ),
      )
      .limit(1);
    if (!request) throw new AuthorizationError();
    await requireEmployeeScope(transaction, actor, request.employeeId);
    if (request.status !== "pending") {
      throw new AttendanceCorrectionConflictError("審査済みの申請は取り消せません。");
    }
    const [cancelled] = await transaction
      .update(attendanceCorrectionRequests)
      .set({ cancelledAt: new Date(), status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(attendanceCorrectionRequests.id, requestId),
          eq(attendanceCorrectionRequests.status, "pending"),
        ),
      )
      .returning();
    if (!cancelled) throw new AttendanceCorrectionConflictError();
    const detail = await correctionDetail(transaction, request.id, actor.organizationId);
    await recordAudit(transaction, {
      action: "attendance_correction_cancelled",
      actorUserId: actor.userId,
      entityId: request.id,
      entityType: "attendance_correction",
      metadata: {
        changes: correctionDiff(detail.entries).map(auditChange),
        employeeId: request.employeeId,
        workDate: request.workDate,
      },
      organizationId: actor.organizationId,
    });
    return cancelled;
  });
}

export async function listManagedAttendanceCorrections(
  db: AppDatabase,
  actor: SessionActor,
  filters: Readonly<{
    employeeId?: string;
    from?: string;
    status?: string;
    to?: string;
  }> = {},
) {
  requirePermission(actor, "attendance:manage");
  const conditions = [eq(attendanceCorrectionRequests.organizationId, actor.organizationId)];
  if (filters.employeeId)
    conditions.push(eq(attendanceCorrectionRequests.employeeId, filters.employeeId));
  if (filters.from) conditions.push(gte(attendanceCorrectionRequests.workDate, filters.from));
  if (filters.to) conditions.push(lt(attendanceCorrectionRequests.workDate, filters.to));
  if (filters.status) {
    if (!(["pending", "approved", "rejected", "cancelled"] as string[]).includes(filters.status)) {
      throw new AttendanceCorrectionValidationError("申請状態が正しくありません。");
    }
    conditions.push(eq(attendanceCorrectionRequests.status, filters.status as CorrectionStatus));
  }
  return db
    .select({
      createdAt: attendanceCorrectionRequests.createdAt,
      displayName: employees.displayName,
      employeeId: attendanceCorrectionRequests.employeeId,
      id: attendanceCorrectionRequests.id,
      reason: attendanceCorrectionRequests.reason,
      status: attendanceCorrectionRequests.status,
      workDate: attendanceCorrectionRequests.workDate,
    })
    .from(attendanceCorrectionRequests)
    .innerJoin(employees, eq(employees.id, attendanceCorrectionRequests.employeeId))
    .where(and(...conditions))
    .orderBy(desc(attendanceCorrectionRequests.createdAt));
}

export async function correctionDetail(
  db: Pick<AppDatabase, "select">,
  requestId: string,
  organizationId: string,
) {
  const [request] = await db
    .select()
    .from(attendanceCorrectionRequests)
    .where(
      and(
        eq(attendanceCorrectionRequests.id, requestId),
        eq(attendanceCorrectionRequests.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!request) throw new AuthorizationError();
  const [entries, employee, requester, reviewer] = await Promise.all([
    db
      .select()
      .from(attendanceCorrectionEntries)
      .where(eq(attendanceCorrectionEntries.requestId, request.id))
      .orderBy(asc(attendanceCorrectionEntries.kind), asc(attendanceCorrectionEntries.position)),
    db
      .select({ displayName: employees.displayName })
      .from(employees)
      .where(eq(employees.id, request.employeeId))
      .limit(1),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, request.requestedByUserId))
      .limit(1),
    request.reviewerUserId
      ? db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, request.reviewerUserId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    employeeName: employee[0]?.displayName ?? "",
    entries,
    request,
    requesterName: requester[0]?.displayName ?? "",
    reviewerName: reviewer[0]?.displayName ?? null,
  };
}

export async function getOwnAttendanceCorrection(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
) {
  const detail = await correctionDetail(db, requestId, actor.organizationId);
  if (detail.request.requestedByUserId !== actor.userId) throw new AuthorizationError();
  await requireEmployeeScope(db, actor, detail.request.employeeId);
  return detail;
}

export async function getManagedAttendanceCorrection(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
) {
  requirePermission(actor, "attendance:manage");
  return correctionDetail(db, requestId, actor.organizationId);
}

export function correctionDiff(
  entries: ReadonlyArray<typeof attendanceCorrectionEntries.$inferSelect>,
) {
  const original = entries.filter((entry) => entry.kind === "original");
  const requested = entries.filter((entry) => entry.kind === "requested");
  const requestedByOriginal = new Map(
    requested.flatMap((entry) => (entry.originalEventId ? [[entry.originalEventId, entry]] : [])),
  );
  const changes: Array<{
    after?: { occurredAt: Date; type: PunchType };
    before?: { occurredAt: Date; type: PunchType };
    kind: "added" | "changed" | "deleted";
  }> = [];
  for (const entry of original) {
    const replacement = entry.originalEventId
      ? requestedByOriginal.get(entry.originalEventId)
      : undefined;
    if (!replacement) {
      changes.push({ before: entry, kind: "deleted" });
    } else if (
      replacement.type !== entry.type ||
      replacement.occurredAt.getTime() !== entry.occurredAt.getTime()
    ) {
      changes.push({ after: replacement, before: entry, kind: "changed" });
    }
  }
  for (const entry of requested) {
    if (!entry.originalEventId) changes.push({ after: entry, kind: "added" });
  }
  return changes;
}

function auditChange(change: ReturnType<typeof correctionDiff>[number]) {
  return {
    after: change.after
      ? { occurredAt: change.after.occurredAt.toISOString(), type: change.after.type }
      : undefined,
    before: change.before
      ? { occurredAt: change.before.occurredAt.toISOString(), type: change.before.type }
      : undefined,
    kind: change.kind,
  };
}

export async function reviewAttendanceCorrection(
  db: AppDatabase,
  actor: SessionActor,
  requestId: string,
  input: Readonly<{ comment?: string; decision: "approve" | "reject" }>,
) {
  requirePermission(actor, "attendance:manage");
  const comment = input.comment?.trim() ?? "";
  if (input.decision === "reject" && !comment) {
    throw new AttendanceCorrectionValidationError("却下理由を入力してください。");
  }
  return db.transaction(async (transaction) => {
    let detail = await correctionDetail(transaction, requestId, actor.organizationId);
    if (detail.request.requestedByUserId === actor.userId) {
      throw new AuthorizationError("自分の申請は審査できません。");
    }
    if (detail.request.status !== "pending") {
      throw new AttendanceCorrectionConflictError("この申請はすでに審査されています。");
    }
    if (input.decision === "reject") {
      const [rejected] = await transaction
        .update(attendanceCorrectionRequests)
        .set({
          reviewComment: comment,
          reviewedAt: new Date(),
          reviewerUserId: actor.userId,
          status: "rejected",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceCorrectionRequests.id, requestId),
            eq(attendanceCorrectionRequests.status, "pending"),
          ),
        )
        .returning();
      if (!rejected) throw new AttendanceCorrectionConflictError();
      const changes = correctionDiff(detail.entries).map(auditChange);
      await recordAudit(transaction, {
        action: "attendance_correction_rejected",
        actorUserId: actor.userId,
        entityId: requestId,
        entityType: "attendance_correction",
        metadata: {
          changes,
          employeeId: detail.request.employeeId,
          reviewComment: comment,
          workDate: detail.request.workDate,
        },
        organizationId: actor.organizationId,
      });
      return correctionDetail(transaction, requestId, actor.organizationId);
    }

    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${detail.request.employeeId}:${detail.request.workDate}`}))`,
    );
    detail = await correctionDetail(transaction, requestId, actor.organizationId);
    if (detail.request.status !== "pending") throw new AttendanceCorrectionConflictError();
    let [day] = await transaction
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.employeeId, detail.request.employeeId),
          eq(attendanceDays.workDate, detail.request.workDate),
        ),
      )
      .limit(1);
    if ((day?.revision ?? 0) !== detail.request.baseRevision) {
      throw new AttendanceCorrectionConflictError();
    }
    const [organization] = await transaction
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    const requestedEntries = parseRequestedEntries(
      detail.entries
        .filter((entry) => entry.kind === "requested")
        .map((entry) => ({
          occurredAt: entry.occurredAt,
          originalEventId: entry.originalEventId,
          type: entry.type,
        })),
      detail.request.workDate as WorkDate,
      organization.timezone,
    );
    if (!day) {
      const rule = await findEffectiveWorkRule(transaction, {
        employeeId: detail.request.employeeId,
        organizationId: actor.organizationId,
        workDate: detail.request.workDate as WorkDate,
      });
      [day] = await transaction
        .insert(attendanceDays)
        .values({
          employeeId: detail.request.employeeId,
          organizationId: actor.organizationId,
          scheduledMinutes: rule?.dailyStandardMinutes ?? 0,
          workDate: detail.request.workDate,
          workRuleId: rule?.id,
        })
        .returning();
    }
    await transaction
      .update(attendanceEvents)
      .set({ supersededByCorrectionRequestId: requestId })
      .where(
        and(
          eq(attendanceEvents.attendanceDayId, day.id),
          sql`${attendanceEvents.supersededByCorrectionRequestId} is null`,
        ),
      );
    let appliedEvents: AttendanceEventRecord[] = [];
    if (requestedEntries.length) {
      appliedEvents = await transaction
        .insert(attendanceEvents)
        .values(
          requestedEntries.map((entry) => ({
            attendanceDayId: day.id,
            correctionRequestId: requestId,
            employeeId: detail.request.employeeId,
            occurredAt: entry.occurredAt,
            organizationId: actor.organizationId,
            recordedByUserId: actor.userId,
            source: "correction",
            type: entry.type,
          })),
        )
        .returning({
          correctionRequestId: attendanceEvents.correctionRequestId,
          id: attendanceEvents.id,
          occurredAt: attendanceEvents.occurredAt,
          source: attendanceEvents.source,
          type: attendanceEvents.type,
        });
    }
    await recomputeAttendanceDay(transaction, day, appliedEvents);
    await transaction
      .update(attendanceDays)
      .set({ revision: sql`${attendanceDays.revision} + 1`, updatedAt: new Date() })
      .where(eq(attendanceDays.id, day.id));
    const [approved] = await transaction
      .update(attendanceCorrectionRequests)
      .set({
        attendanceDayId: day.id,
        reviewComment: comment || null,
        reviewedAt: new Date(),
        reviewerUserId: actor.userId,
        status: "approved",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(attendanceCorrectionRequests.id, requestId),
          eq(attendanceCorrectionRequests.status, "pending"),
        ),
      )
      .returning();
    if (!approved) throw new AttendanceCorrectionConflictError();
    const changes = correctionDiff(detail.entries).map(auditChange);
    await recordAudit(transaction, {
      action: "attendance_correction_approved",
      actorUserId: actor.userId,
      entityId: requestId,
      entityType: "attendance_correction",
      metadata: {
        changes,
        employeeId: detail.request.employeeId,
        workDate: detail.request.workDate,
      },
      organizationId: actor.organizationId,
    });
    await recordAudit(transaction, {
      action: "attendance_correction_applied",
      actorUserId: actor.userId,
      entityId: requestId,
      entityType: "attendance_correction",
      metadata: {
        changes,
        employeeId: detail.request.employeeId,
        workDate: detail.request.workDate,
      },
      organizationId: actor.organizationId,
    });
    return correctionDetail(transaction, requestId, actor.organizationId);
  });
}

export async function countPendingAttendanceCorrections(db: AppDatabase, organizationId: string) {
  const [result] = await db
    .select({ value: count() })
    .from(attendanceCorrectionRequests)
    .where(
      and(
        eq(attendanceCorrectionRequests.organizationId, organizationId),
        eq(attendanceCorrectionRequests.status, "pending"),
      ),
    );
  return result.value;
}
