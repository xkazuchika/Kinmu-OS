import { and, asc, count, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";

import { approvalRequestTypes, type ApprovalRequestType } from "@/lib/approval-types";
import { createApprovalReassignmentNotifications } from "@/lib/approval-notifications";
import { recordAudit } from "@/lib/audit";
import { requirePermission, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  approvalAssignmentHistory,
  approvalCases,
  approvalDelegations,
  departments,
  employees,
  users,
} from "@/lib/db/schema";
import { ApprovalRouteConflictError, ApprovalRouteValidationError } from "@/lib/approval-routing";

type DelegationInput = Readonly<{
  delegateApproverUserId: string;
  departmentId: string;
  endsAt: Date | string;
  originalApproverUserId: string;
  reason: string;
  requestType: string;
  startsAt: Date | string;
}>;

function parsedDate(value: Date | string, label: string) {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new ApprovalRouteValidationError(`${label}が正しくありません。`);
  }
  return result;
}

function normalize(input: DelegationInput) {
  const startsAt = parsedDate(input.startsAt, "引継ぎ開始日時");
  const endsAt = parsedDate(input.endsAt, "引継ぎ終了日時");
  if (endsAt <= startsAt) {
    throw new ApprovalRouteValidationError("引継ぎ終了は開始より後にしてください。");
  }
  if (input.originalApproverUserId === input.delegateApproverUserId) {
    throw new ApprovalRouteValidationError("元担当者と代理担当者は別の人を選んでください。");
  }
  if (!(approvalRequestTypes as readonly string[]).includes(input.requestType)) {
    throw new ApprovalRouteValidationError("申請種別が正しくありません。");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) {
    throw new ApprovalRouteValidationError("引継ぎ理由を1,000文字以内で入力してください。");
  }
  return {
    delegateApproverUserId: input.delegateApproverUserId,
    departmentId: input.departmentId,
    endsAt,
    originalApproverUserId: input.originalApproverUserId,
    reason,
    requestType: input.requestType as ApprovalRequestType,
    startsAt,
  };
}

async function validateReferences(
  db: Pick<AppDatabase, "select">,
  organizationId: string,
  input: ReturnType<typeof normalize>,
) {
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.organizationId, organizationId),
        eq(departments.active, true),
      ),
    )
    .limit(1);
  const eligibleUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        inArray(users.id, [input.originalApproverUserId, input.delegateApproverUserId]),
        inArray(users.role, ["owner", "hr_admin", "approver"]),
      ),
    );
  if (!department || eligibleUsers.length !== 2) {
    throw new ApprovalRouteValidationError("同じ組織の有効な部署・承認担当者を選択してください。");
  }
}

async function assertAssigneeIsNotCaseParty(
  db: Pick<AppDatabase, "select">,
  cases: ReadonlyArray<{
    submittedByUserId: string;
    targetEmployeeId: string;
  }>,
  assigneeUserId: string,
) {
  const employeeIds = [...new Set(cases.map((approvalCase) => approvalCase.targetEmployeeId))];
  const targetUsers = employeeIds.length
    ? await db
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .where(inArray(employees.id, employeeIds))
    : [];
  const userByEmployee = new Map(targetUsers.map((employee) => [employee.id, employee.userId]));
  if (
    cases.some(
      (approvalCase) =>
        approvalCase.submittedByUserId === assigneeUserId ||
        userByEmployee.get(approvalCase.targetEmployeeId) === assigneeUserId,
    )
  ) {
    throw new ApprovalRouteValidationError(
      "対象本人または代理作成者を承認担当へ割り当てることはできません。",
    );
  }
}

async function assertNoOverlap(
  db: Pick<AppDatabase, "select">,
  organizationId: string,
  input: ReturnType<typeof normalize>,
) {
  const [overlap] = await db
    .select({ endsAt: approvalDelegations.endsAt, startsAt: approvalDelegations.startsAt })
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.organizationId, organizationId),
        eq(approvalDelegations.departmentId, input.departmentId),
        eq(approvalDelegations.requestType, input.requestType),
        eq(approvalDelegations.originalApproverUserId, input.originalApproverUserId),
        lt(approvalDelegations.startsAt, input.endsAt),
        gt(approvalDelegations.endsAt, input.startsAt),
      ),
    )
    .limit(1);
  if (overlap) {
    throw new ApprovalRouteValidationError(
      `既存の引継ぎ（${overlap.startsAt.toLocaleString("ja-JP")}〜${overlap.endsAt.toLocaleString("ja-JP")}）と重複します。`,
    );
  }
}

export async function listApprovalDelegations(db: AppDatabase, actor: SessionActor) {
  requirePermission(actor, "approvals:manage");
  return db
    .select({
      delegateApproverUserId: approvalDelegations.delegateApproverUserId,
      departmentId: approvalDelegations.departmentId,
      departmentName: departments.name,
      endsAt: approvalDelegations.endsAt,
      id: approvalDelegations.id,
      originalApproverUserId: approvalDelegations.originalApproverUserId,
      reason: approvalDelegations.reason,
      requestType: approvalDelegations.requestType,
      startsAt: approvalDelegations.startsAt,
      version: approvalDelegations.version,
    })
    .from(approvalDelegations)
    .innerJoin(departments, eq(departments.id, approvalDelegations.departmentId))
    .where(eq(approvalDelegations.organizationId, actor.organizationId))
    .orderBy(asc(approvalDelegations.startsAt));
}

export async function previewDelegationCases(
  db: AppDatabase,
  actor: SessionActor,
  input: DelegationInput,
) {
  requirePermission(actor, "approvals:manage");
  const normalized = normalize(input);
  await validateReferences(db, actor.organizationId, normalized);
  const rows = await db
    .select({
      createdAt: approvalCases.createdAt,
      employeeId: approvalCases.targetEmployeeId,
      id: approvalCases.id,
      targetDate: approvalCases.targetDate,
      version: approvalCases.version,
    })
    .from(approvalCases)
    .where(
      and(
        eq(approvalCases.organizationId, actor.organizationId),
        eq(approvalCases.submittedDepartmentId, normalized.departmentId),
        eq(approvalCases.requestType, normalized.requestType),
        eq(approvalCases.assignedApproverUserId, normalized.originalApproverUserId),
        eq(approvalCases.status, "pending"),
      ),
    )
    .orderBy(asc(approvalCases.createdAt));
  return { count: rows.length, cases: rows };
}

export async function createApprovalDelegation(
  db: AppDatabase,
  actor: SessionActor,
  input: DelegationInput & { reassignCaseIds?: readonly string[] },
) {
  requirePermission(actor, "approvals:manage");
  const normalized = normalize(input);
  const selectedIds = [...new Set(input.reassignCaseIds ?? [])];
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${actor.organizationId}:${normalized.departmentId}:${normalized.requestType}:${normalized.originalApproverUserId}`}))`,
    );
    await validateReferences(transaction, actor.organizationId, normalized);
    await assertNoOverlap(transaction, actor.organizationId, normalized);
    const [delegation] = await transaction
      .insert(approvalDelegations)
      .values({
        ...normalized,
        createdByUserId: actor.userId,
        organizationId: actor.organizationId,
      })
      .returning();

    let reassignedCount = 0;
    if (selectedIds.length) {
      const selectedCases = await transaction
        .select({
          assignedApproverUserId: approvalCases.assignedApproverUserId,
          id: approvalCases.id,
          submittedByUserId: approvalCases.submittedByUserId,
          targetEmployeeId: approvalCases.targetEmployeeId,
        })
        .from(approvalCases)
        .where(
          and(
            eq(approvalCases.organizationId, actor.organizationId),
            eq(approvalCases.submittedDepartmentId, normalized.departmentId),
            eq(approvalCases.requestType, normalized.requestType),
            eq(approvalCases.assignedApproverUserId, normalized.originalApproverUserId),
            eq(approvalCases.status, "pending"),
            inArray(approvalCases.id, selectedIds),
          ),
        );
      if (selectedCases.length !== selectedIds.length) {
        throw new ApprovalRouteConflictError(
          "選択した申請の担当または状態が変わりました。対象を確認し直してください。",
        );
      }
      await assertAssigneeIsNotCaseParty(
        transaction,
        selectedCases,
        normalized.delegateApproverUserId,
      );
      for (const approvalCase of selectedCases) {
        const [updatedCase] = await transaction
          .update(approvalCases)
          .set({
            assignedApproverUserId: normalized.delegateApproverUserId,
            originalApproverUserId: normalized.originalApproverUserId,
            routeReason: "delegated",
            updatedAt: new Date(),
            version: sql`${approvalCases.version} + 1`,
          })
          .where(eq(approvalCases.id, approvalCase.id))
          .returning();
        await transaction.insert(approvalAssignmentHistory).values({
          approvalCaseId: approvalCase.id,
          changedByUserId: actor.userId,
          fromApproverUserId: approvalCase.assignedApproverUserId,
          organizationId: actor.organizationId,
          originalApproverUserId: normalized.originalApproverUserId,
          reason: normalized.reason,
          toApproverUserId: normalized.delegateApproverUserId,
        });
        await createApprovalReassignmentNotifications(transaction, updatedCase, {
          fromApproverUserId: approvalCase.assignedApproverUserId,
          toApproverUserId: normalized.delegateApproverUserId,
        });
      }
      reassignedCount = selectedCases.length;
    }
    await recordAudit(transaction, {
      action: "approval_delegation_changed",
      actorUserId: actor.userId,
      entityId: delegation.id,
      entityType: "approval_delegation",
      metadata: {
        departmentId: delegation.departmentId,
        endsAt: delegation.endsAt.toISOString(),
        operation: "created",
        originalApproverUserId: delegation.originalApproverUserId,
        reassignedCount,
        requestType: delegation.requestType,
        startsAt: delegation.startsAt.toISOString(),
      },
      organizationId: actor.organizationId,
    });
    return { delegation, reassignedCount };
  });
}

export async function reassignApprovalCases(
  db: AppDatabase,
  actor: SessionActor,
  input: Readonly<{
    caseIds: readonly string[];
    reason: string;
    toApproverUserId: string;
  }>,
) {
  requirePermission(actor, "approvals:manage");
  const reason = input.reason.trim();
  const caseIds = [...new Set(input.caseIds)];
  if (!reason || !caseIds.length) {
    throw new ApprovalRouteValidationError("対象申請と再割当理由を入力してください。");
  }
  return db.transaction(async (transaction) => {
    const [assignee] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.toApproverUserId),
          eq(users.organizationId, actor.organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "hr_admin", "approver"]),
        ),
      )
      .limit(1);
    if (!assignee) {
      throw new ApprovalRouteValidationError("有効な再割当先を選択してください。");
    }
    const cases = await transaction
      .select()
      .from(approvalCases)
      .where(
        and(
          eq(approvalCases.organizationId, actor.organizationId),
          eq(approvalCases.status, "pending"),
          inArray(approvalCases.id, caseIds),
        ),
      );
    if (cases.length !== caseIds.length) throw new ApprovalRouteConflictError();
    await assertAssigneeIsNotCaseParty(transaction, cases, input.toApproverUserId);
    for (const approvalCase of cases) {
      const [updatedCase] = await transaction
        .update(approvalCases)
        .set({
          assignedApproverUserId: input.toApproverUserId,
          routeReason: "manual_reassignment",
          updatedAt: new Date(),
          version: sql`${approvalCases.version} + 1`,
        })
        .where(
          and(
            eq(approvalCases.id, approvalCase.id),
            eq(approvalCases.version, approvalCase.version),
          ),
        )
        .returning();
      if (!updatedCase) throw new ApprovalRouteConflictError();
      await transaction.insert(approvalAssignmentHistory).values({
        approvalCaseId: approvalCase.id,
        changedByUserId: actor.userId,
        fromApproverUserId: approvalCase.assignedApproverUserId,
        organizationId: actor.organizationId,
        originalApproverUserId: approvalCase.originalApproverUserId,
        reason,
        toApproverUserId: input.toApproverUserId,
      });
      await recordAudit(transaction, {
        action: "approval_case_assigned",
        actorUserId: actor.userId,
        entityId: approvalCase.id,
        entityType: "approval_case",
        metadata: {
          currentRevision: updatedCase.currentRevision,
          fromApproverUserId: approvalCase.assignedApproverUserId,
          originalApproverUserId: updatedCase.originalApproverUserId,
          requestType: updatedCase.requestType,
          submittedDepartmentId: updatedCase.submittedDepartmentId,
          submittedOnBehalf: updatedCase.submittedOnBehalf,
          targetEmployeeId: updatedCase.targetEmployeeId,
          toApproverUserId: input.toApproverUserId,
          version: updatedCase.version,
        },
        organizationId: actor.organizationId,
      });
      await createApprovalReassignmentNotifications(transaction, updatedCase, {
        fromApproverUserId: approvalCase.assignedApproverUserId,
        toApproverUserId: input.toApproverUserId,
      });
    }
    return { count: cases.length };
  });
}
