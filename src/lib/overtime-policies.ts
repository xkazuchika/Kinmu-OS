import { and, count, desc, eq, gte, lte, ne, sql } from "drizzle-orm";

import { assertAttendanceMonthOpen, lockAttendanceMonth } from "@/lib/attendance-closing";
import { recordAudit } from "@/lib/audit";
import { requirePermission, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  attendanceMonthPeriods,
  employees,
  organizations,
  overtimeRequestPolicies,
  overtimeWorkRequests,
} from "@/lib/db/schema";
import { workDateFor } from "@/lib/time";
import { validateWorkDate } from "@/lib/work-calendar";

type PolicyDatabase = Pick<AppDatabase, "insert" | "select" | "update">;
type MinuteIncrement = 1 | 5 | 10 | 15 | 30;

export class OvertimePolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OvertimePolicyValidationError";
  }
}

export class OvertimePolicyConflictError extends Error {
  constructor(message = "残業申請ポリシーが更新されています。再読み込みしてやり直してください。") {
    super(message);
    this.name = "OvertimePolicyConflictError";
  }
}

function validateMinuteIncrement(value: number): MinuteIncrement {
  if (![1, 5, 10, 15, 30].includes(value)) {
    throw new OvertimePolicyValidationError(
      "申請時刻の入力単位を1・5・10・15・30分から選択してください。",
    );
  }
  return value as MinuteIncrement;
}

function validateAllowedDeviation(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 1_440) {
    throw new OvertimePolicyValidationError("実績差異の許容分数を0〜1440分で入力してください。");
  }
  return value;
}

export async function effectiveOvertimePolicy(
  db: Pick<AppDatabase, "select">,
  organizationId: string,
  workDate: string,
) {
  const date = validateWorkDate(workDate);
  const [policy] = await db
    .select()
    .from(overtimeRequestPolicies)
    .where(
      and(
        eq(overtimeRequestPolicies.organizationId, organizationId),
        eq(overtimeRequestPolicies.status, "active"),
        lte(overtimeRequestPolicies.effectiveFrom, date),
      ),
    )
    .orderBy(desc(overtimeRequestPolicies.effectiveFrom), desc(overtimeRequestPolicies.createdAt))
    .limit(1);
  return policy ?? null;
}

export async function ensureOvertimePolicyDraft(
  db: PolicyDatabase,
  actor: SessionActor,
  now = new Date(),
) {
  requirePermission(actor, "attendance:manage");
  const existing = await db
    .select()
    .from(overtimeRequestPolicies)
    .where(eq(overtimeRequestPolicies.organizationId, actor.organizationId))
    .orderBy(desc(overtimeRequestPolicies.effectiveFrom), desc(overtimeRequestPolicies.createdAt));
  if (existing.length) return existing;
  const [organization] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, actor.organizationId))
    .limit(1);
  if (!organization) throw new OvertimePolicyValidationError("組織を確認できませんでした。");
  await db
    .insert(overtimeRequestPolicies)
    .values({
      createdByUserId: actor.userId,
      effectiveFrom: workDateFor(now, organization.timezone),
      organizationId: actor.organizationId,
    })
    .onConflictDoNothing();
  return db
    .select()
    .from(overtimeRequestPolicies)
    .where(eq(overtimeRequestPolicies.organizationId, actor.organizationId))
    .orderBy(desc(overtimeRequestPolicies.effectiveFrom), desc(overtimeRequestPolicies.createdAt));
}

export async function listOvertimePolicies(db: PolicyDatabase, actor: SessionActor) {
  return ensureOvertimePolicyDraft(db, actor);
}

export async function saveOvertimePolicyDraft(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    allowedDeviationMinutes: number;
    blockCloseOnUnresolvedDifference: boolean;
    effectiveFrom: string;
    expectedVersion?: number;
    minuteIncrement: number;
    policyId?: string;
    requirePriorApproval: boolean;
  }>,
) {
  requirePermission(actor, "attendance:manage");
  const effectiveFrom = validateWorkDate(input.effectiveFrom, "適用開始日");
  const values = {
    allowedDeviationMinutes: validateAllowedDeviation(input.allowedDeviationMinutes),
    blockCloseOnUnresolvedDifference: input.blockCloseOnUnresolvedDifference,
    effectiveFrom,
    minuteIncrement: validateMinuteIncrement(input.minuteIncrement),
    requirePriorApproval: input.requirePriorApproval,
    updatedAt: new Date(),
  };
  const sameDateConditions = [
    eq(overtimeRequestPolicies.organizationId, actor.organizationId),
    eq(overtimeRequestPolicies.effectiveFrom, effectiveFrom),
  ];
  if (input.policyId) sameDateConditions.push(ne(overtimeRequestPolicies.id, input.policyId));
  const [sameDatePolicy] = await db
    .select({ id: overtimeRequestPolicies.id })
    .from(overtimeRequestPolicies)
    .where(and(...sameDateConditions))
    .limit(1);
  if (sameDatePolicy) {
    throw new OvertimePolicyValidationError(
      "同じ適用開始日の設定があります。別の日付を指定してください。",
    );
  }
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(transaction, actor.organizationId, effectiveFrom.slice(0, 7));
    if (input.policyId) {
      await transaction.execute(
        sql`SELECT id FROM ${overtimeRequestPolicies} WHERE id = ${input.policyId} FOR UPDATE`,
      );
      const [current] = await transaction
        .select()
        .from(overtimeRequestPolicies)
        .where(
          and(
            eq(overtimeRequestPolicies.id, input.policyId),
            eq(overtimeRequestPolicies.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (!current || current.status !== "draft" || current.version !== input.expectedVersion) {
        throw new OvertimePolicyConflictError();
      }
      const [updated] = await transaction
        .update(overtimeRequestPolicies)
        .set({ ...values, version: current.version + 1 })
        .where(
          and(
            eq(overtimeRequestPolicies.id, current.id),
            eq(overtimeRequestPolicies.version, current.version),
            eq(overtimeRequestPolicies.status, "draft"),
          ),
        )
        .returning();
      if (!updated) throw new OvertimePolicyConflictError();
      await recordAudit(transaction, {
        action: "overtime_policy_changed",
        actorUserId: actor.userId,
        entityId: updated.id,
        entityType: "overtime_request_policy",
        metadata: values,
        organizationId: actor.organizationId,
      });
      return updated;
    }
    const [created] = await transaction
      .insert(overtimeRequestPolicies)
      .values({
        ...values,
        createdByUserId: actor.userId,
        organizationId: actor.organizationId,
      })
      .returning();
    await recordAudit(transaction, {
      action: "overtime_policy_created",
      actorUserId: actor.userId,
      entityId: created.id,
      entityType: "overtime_request_policy",
      metadata: values,
      organizationId: actor.organizationId,
    });
    return created;
  });
}

export async function previewOvertimePolicyActivation(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  policyId: string,
) {
  requirePermission(actor, "attendance:manage");
  const [policy] = await db
    .select()
    .from(overtimeRequestPolicies)
    .where(
      and(
        eq(overtimeRequestPolicies.id, policyId),
        eq(overtimeRequestPolicies.organizationId, actor.organizationId),
        eq(overtimeRequestPolicies.status, "draft"),
      ),
    )
    .limit(1);
  if (!policy)
    throw new OvertimePolicyValidationError("有効化するドラフトを確認できませんでした。");
  const [[employeesAffected], [requestsAffected], closedPeriods] = await Promise.all([
    db
      .select({ value: count() })
      .from(employees)
      .where(
        and(eq(employees.organizationId, actor.organizationId), eq(employees.status, "active")),
      ),
    db
      .select({ value: count() })
      .from(overtimeWorkRequests)
      .where(
        and(
          eq(overtimeWorkRequests.organizationId, actor.organizationId),
          gte(overtimeWorkRequests.workDate, policy.effectiveFrom),
        ),
      ),
    db
      .select({ targetMonth: attendanceMonthPeriods.targetMonth })
      .from(attendanceMonthPeriods)
      .where(
        and(
          eq(attendanceMonthPeriods.organizationId, actor.organizationId),
          eq(attendanceMonthPeriods.status, "closed"),
          gte(attendanceMonthPeriods.targetMonth, policy.effectiveFrom.slice(0, 7)),
        ),
      ),
  ]);
  return {
    closedMonths: closedPeriods.map((period) => period.targetMonth),
    employeesAffected: employeesAffected.value,
    policy,
    requestsAffected: requestsAffected.value,
  };
}

export async function activateOvertimePolicy(
  db: AppDatabase,
  actor: SessionActor,
  policyId: string,
  expectedVersion: number,
) {
  requirePermission(actor, "attendance:manage");
  const preview = await previewOvertimePolicyActivation(db, actor, policyId);
  if (preview.closedMonths.length) {
    throw new OvertimePolicyValidationError(
      `${preview.closedMonths[0]}以後に締め済み月があります。再開するか、未締め期間を適用開始日にしてください。`,
    );
  }
  return db.transaction(async (transaction) => {
    await lockAttendanceMonth(
      transaction,
      actor.organizationId,
      preview.policy.effectiveFrom.slice(0, 7),
    );
    await assertAttendanceMonthOpen(
      transaction,
      actor.organizationId,
      preview.policy.effectiveFrom,
    );
    await transaction.execute(
      sql`SELECT id FROM ${overtimeRequestPolicies} WHERE id = ${policyId} FOR UPDATE`,
    );
    const [policy] = await transaction
      .select()
      .from(overtimeRequestPolicies)
      .where(
        and(
          eq(overtimeRequestPolicies.id, policyId),
          eq(overtimeRequestPolicies.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!policy || policy.status !== "draft" || policy.version !== expectedVersion) {
      throw new OvertimePolicyConflictError();
    }
    const [closed] = await transaction
      .select({ targetMonth: attendanceMonthPeriods.targetMonth })
      .from(attendanceMonthPeriods)
      .where(
        and(
          eq(attendanceMonthPeriods.organizationId, actor.organizationId),
          eq(attendanceMonthPeriods.status, "closed"),
          gte(attendanceMonthPeriods.targetMonth, policy.effectiveFrom.slice(0, 7)),
        ),
      )
      .limit(1);
    if (closed) {
      throw new OvertimePolicyValidationError(
        `${closed.targetMonth}は締め済みです。再開してから有効化してください。`,
      );
    }
    const [activated] = await transaction
      .update(overtimeRequestPolicies)
      .set({
        activatedAt: new Date(),
        activatedByUserId: actor.userId,
        status: "active",
        updatedAt: new Date(),
        version: policy.version + 1,
      })
      .where(
        and(
          eq(overtimeRequestPolicies.id, policy.id),
          eq(overtimeRequestPolicies.status, "draft"),
          eq(overtimeRequestPolicies.version, expectedVersion),
        ),
      )
      .returning();
    if (!activated) throw new OvertimePolicyConflictError();
    await recordAudit(transaction, {
      action: "overtime_policy_activated",
      actorUserId: actor.userId,
      entityId: activated.id,
      entityType: "overtime_request_policy",
      metadata: {
        allowedDeviationMinutes: activated.allowedDeviationMinutes,
        blockCloseOnUnresolvedDifference: activated.blockCloseOnUnresolvedDifference,
        effectiveFrom: activated.effectiveFrom,
        minuteIncrement: activated.minuteIncrement,
        requirePriorApproval: activated.requirePriorApproval,
      },
      organizationId: actor.organizationId,
    });
    return activated;
  });
}

export async function latestPolicyDraft(db: Pick<AppDatabase, "select">, organizationId: string) {
  const [draft] = await db
    .select()
    .from(overtimeRequestPolicies)
    .where(
      and(
        eq(overtimeRequestPolicies.organizationId, organizationId),
        eq(overtimeRequestPolicies.status, "draft"),
      ),
    )
    .orderBy(desc(overtimeRequestPolicies.updatedAt))
    .limit(1);
  return draft ?? null;
}

export async function hasDifferentActivePolicyAfter(
  db: Pick<AppDatabase, "select">,
  policyId: string,
  organizationId: string,
  effectiveFrom: string,
) {
  const [policy] = await db
    .select({ id: overtimeRequestPolicies.id })
    .from(overtimeRequestPolicies)
    .where(
      and(
        eq(overtimeRequestPolicies.organizationId, organizationId),
        eq(overtimeRequestPolicies.status, "active"),
        gte(overtimeRequestPolicies.effectiveFrom, effectiveFrom),
        ne(overtimeRequestPolicies.id, policyId),
      ),
    )
    .limit(1);
  return Boolean(policy);
}
