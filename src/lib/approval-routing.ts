import { and, asc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import { requirePermission, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  approvalDelegations,
  approvalRouteAssignments,
  departments,
  employeeDepartments,
  employees,
  users,
} from "@/lib/db/schema";
import {
  approvalRequestTypes,
  type ApprovalRequestType,
  type ApprovalRouteReason,
} from "@/lib/approval-types";

type ApprovalQueryDatabase = Pick<AppDatabase, "select">;

export class ApprovalRouteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRouteValidationError";
  }
}

export class ApprovalRouteConflictError extends Error {
  constructor(message = "承認経路が更新されています。最新の内容を読み込んでください。") {
    super(message);
    this.name = "ApprovalRouteConflictError";
  }
}

export type ResolvedApprovalRoute = {
  assignedApproverUserId: string | null;
  dueAt: Date | null;
  originalApproverUserId: string | null;
  routeAssignmentId: string | null;
  routeReason: ApprovalRouteReason;
  submittedDepartmentId: string | null;
};

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new ApprovalRouteValidationError(`${label}を入力してください。`);
  return normalized;
}

function dateValue(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApprovalRouteValidationError(`${label}が正しくありません。`);
  }
  return value;
}

function requestTypeValue(value: string): ApprovalRequestType {
  if (!(approvalRequestTypes as readonly string[]).includes(value)) {
    throw new ApprovalRouteValidationError("申請種別が正しくありません。");
  }
  return value as ApprovalRequestType;
}

async function primaryDepartmentAt(
  db: ApprovalQueryDatabase,
  employeeId: string,
  submittedOn: string,
) {
  const [row] = await db
    .select({
      departmentId: employeeDepartments.departmentId,
      organizationId: departments.organizationId,
      targetUserId: employees.userId,
    })
    .from(employees)
    .leftJoin(
      employeeDepartments,
      and(
        eq(employeeDepartments.employeeId, employees.id),
        eq(employeeDepartments.isPrimary, true),
        lte(employeeDepartments.startedOn, submittedOn),
        or(isNull(employeeDepartments.endedOn), gte(employeeDepartments.endedOn, submittedOn)),
      ),
    )
    .leftJoin(departments, eq(departments.id, employeeDepartments.departmentId))
    .where(eq(employees.id, employeeId))
    .orderBy(
      sql`${employeeDepartments.startedOn} DESC NULLS LAST`,
      sql`${employeeDepartments.createdAt} DESC NULLS LAST`,
    )
    .limit(1);

  return row;
}

export async function resolveApprovalRoute(
  db: ApprovalQueryDatabase,
  input: Readonly<{
    employeeId: string;
    organizationId: string;
    requestType: ApprovalRequestType;
    submittedAt?: Date;
    submittedByUserId: string;
  }>,
): Promise<ResolvedApprovalRoute> {
  const submittedAt = input.submittedAt ?? new Date();
  const submittedOn = submittedAt.toISOString().slice(0, 10);
  const employeeContext = await primaryDepartmentAt(db, input.employeeId, submittedOn);

  if (!employeeContext || employeeContext.organizationId !== input.organizationId) {
    if (employeeContext?.organizationId) {
      throw new ApprovalRouteValidationError("対象従業員が申請組織に所属していません。");
    }
    const [employee] = await db
      .select({ organizationId: employees.organizationId, userId: employees.userId })
      .from(employees)
      .where(
        and(eq(employees.id, input.employeeId), eq(employees.organizationId, input.organizationId)),
      )
      .limit(1);
    if (!employee) {
      throw new ApprovalRouteValidationError("対象従業員を確認できませんでした。");
    }
    return {
      assignedApproverUserId: null,
      dueAt: null,
      originalApproverUserId: null,
      routeAssignmentId: null,
      routeReason: "legacy_admin_pool",
      submittedDepartmentId: null,
    };
  }

  if (!employeeContext.departmentId) {
    return {
      assignedApproverUserId: null,
      dueAt: null,
      originalApproverUserId: null,
      routeAssignmentId: null,
      routeReason: "legacy_admin_pool",
      submittedDepartmentId: null,
    };
  }

  const [route] = await db
    .select({
      approverRole: users.role,
      approverStatus: users.status,
      approverUserId: approvalRouteAssignments.approverUserId,
      dueDays: approvalRouteAssignments.dueDays,
      id: approvalRouteAssignments.id,
    })
    .from(approvalRouteAssignments)
    .innerJoin(users, eq(users.id, approvalRouteAssignments.approverUserId))
    .where(
      and(
        eq(approvalRouteAssignments.organizationId, input.organizationId),
        eq(approvalRouteAssignments.departmentId, employeeContext.departmentId),
        eq(approvalRouteAssignments.requestType, input.requestType),
        lte(approvalRouteAssignments.effectiveFrom, submittedOn),
        or(
          isNull(approvalRouteAssignments.effectiveTo),
          gte(approvalRouteAssignments.effectiveTo, submittedOn),
        ),
      ),
    )
    .orderBy(sql`${approvalRouteAssignments.effectiveFrom} DESC`)
    .limit(1);

  if (!route) {
    return {
      assignedApproverUserId: null,
      dueAt: null,
      originalApproverUserId: null,
      routeAssignmentId: null,
      routeReason: "legacy_admin_pool",
      submittedDepartmentId: employeeContext.departmentId,
    };
  }

  const eligible =
    route.approverStatus === "active" &&
    (["owner", "hr_admin", "approver"] as string[]).includes(route.approverRole);
  const selfReview =
    route.approverUserId === input.submittedByUserId ||
    route.approverUserId === employeeContext.targetUserId;
  let assignedApproverUserId = eligible && !selfReview ? route.approverUserId : null;
  let routeReason: ApprovalRouteReason = "department_route";

  if (assignedApproverUserId) {
    const [delegation] = await db
      .select({
        delegateRole: users.role,
        delegateStatus: users.status,
        delegateUserId: approvalDelegations.delegateApproverUserId,
      })
      .from(approvalDelegations)
      .innerJoin(users, eq(users.id, approvalDelegations.delegateApproverUserId))
      .where(
        and(
          eq(approvalDelegations.organizationId, input.organizationId),
          eq(approvalDelegations.departmentId, employeeContext.departmentId),
          eq(approvalDelegations.requestType, input.requestType),
          eq(approvalDelegations.originalApproverUserId, route.approverUserId),
          lte(approvalDelegations.startsAt, submittedAt),
          gte(approvalDelegations.endsAt, submittedAt),
        ),
      )
      .orderBy(sql`${approvalDelegations.startsAt} DESC`)
      .limit(1);
    const delegateEligible =
      delegation?.delegateStatus === "active" &&
      (["owner", "hr_admin", "approver"] as string[]).includes(delegation?.delegateRole ?? "") &&
      delegation.delegateUserId !== input.submittedByUserId &&
      delegation.delegateUserId !== employeeContext.targetUserId;
    if (delegation && delegateEligible) {
      assignedApproverUserId = delegation.delegateUserId;
      routeReason = "delegated";
    }
  }

  return {
    assignedApproverUserId,
    dueAt: route.dueDays
      ? new Date(submittedAt.getTime() + route.dueDays * 24 * 60 * 60 * 1_000)
      : null,
    originalApproverUserId: route.approverUserId,
    routeAssignmentId: route.id,
    routeReason,
    submittedDepartmentId: employeeContext.departmentId,
  };
}

export async function listApprovalRoutes(db: AppDatabase, actor: SessionActor) {
  requirePermission(actor, "approvals:manage");
  return db
    .select({
      approverDisplayName: users.displayName,
      approverUserId: approvalRouteAssignments.approverUserId,
      departmentId: approvalRouteAssignments.departmentId,
      departmentName: departments.name,
      dueDays: approvalRouteAssignments.dueDays,
      effectiveFrom: approvalRouteAssignments.effectiveFrom,
      effectiveTo: approvalRouteAssignments.effectiveTo,
      id: approvalRouteAssignments.id,
      requestType: approvalRouteAssignments.requestType,
      version: approvalRouteAssignments.version,
    })
    .from(approvalRouteAssignments)
    .innerJoin(departments, eq(departments.id, approvalRouteAssignments.departmentId))
    .innerJoin(users, eq(users.id, approvalRouteAssignments.approverUserId))
    .where(eq(approvalRouteAssignments.organizationId, actor.organizationId))
    .orderBy(
      asc(departments.name),
      asc(approvalRouteAssignments.requestType),
      asc(approvalRouteAssignments.effectiveFrom),
    );
}

type ApprovalRouteInput = Readonly<{
  approverUserId: string;
  departmentId: string;
  dueDays?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  requestType: string;
}>;

async function validateRouteReferences(
  db: ApprovalQueryDatabase,
  organizationId: string,
  input: ApprovalRouteInput,
) {
  const [reference] = await db
    .select({
      approverRole: users.role,
      approverStatus: users.status,
      departmentActive: departments.active,
    })
    .from(departments)
    .innerJoin(
      users,
      and(eq(users.id, input.approverUserId), eq(users.organizationId, organizationId)),
    )
    .where(
      and(eq(departments.id, input.departmentId), eq(departments.organizationId, organizationId)),
    )
    .limit(1);
  if (!reference?.departmentActive) {
    throw new ApprovalRouteValidationError("有効な部署を選択してください。");
  }
  if (
    reference.approverStatus !== "active" ||
    !(["owner", "hr_admin", "approver"] as string[]).includes(reference.approverRole)
  ) {
    throw new ApprovalRouteValidationError("有効な承認担当者を選択してください。");
  }
}

function normalizeRouteInput(input: ApprovalRouteInput) {
  const effectiveFrom = dateValue(input.effectiveFrom, "適用開始日");
  const effectiveTo = input.effectiveTo ? dateValue(input.effectiveTo, "適用終了日") : null;
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new ApprovalRouteValidationError("適用終了日は開始日以後にしてください。");
  }
  const dueDays = input.dueDays ?? null;
  if (dueDays !== null && (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365)) {
    throw new ApprovalRouteValidationError("対応期限は1〜365日で入力してください。");
  }
  return {
    approverUserId: required(input.approverUserId, "承認担当者"),
    departmentId: required(input.departmentId, "部署"),
    dueDays,
    effectiveFrom,
    effectiveTo,
    requestType: requestTypeValue(input.requestType),
  };
}

async function assertNoRouteOverlap(
  db: ApprovalQueryDatabase,
  organizationId: string,
  input: ReturnType<typeof normalizeRouteInput>,
  exceptRouteId?: string,
) {
  const conditions = [
    eq(approvalRouteAssignments.organizationId, organizationId),
    eq(approvalRouteAssignments.departmentId, input.departmentId),
    eq(approvalRouteAssignments.requestType, input.requestType),
    lte(approvalRouteAssignments.effectiveFrom, input.effectiveTo ?? "9999-12-31"),
    or(
      isNull(approvalRouteAssignments.effectiveTo),
      gte(approvalRouteAssignments.effectiveTo, input.effectiveFrom),
    ),
  ];
  if (exceptRouteId) conditions.push(ne(approvalRouteAssignments.id, exceptRouteId));
  const [overlap] = await db
    .select({
      effectiveFrom: approvalRouteAssignments.effectiveFrom,
      effectiveTo: approvalRouteAssignments.effectiveTo,
      id: approvalRouteAssignments.id,
    })
    .from(approvalRouteAssignments)
    .where(and(...conditions))
    .limit(1);
  if (overlap) {
    throw new ApprovalRouteValidationError(
      `この期間は既存経路（${overlap.effectiveFrom}〜${overlap.effectiveTo ?? "終了日なし"}）と重複します。`,
    );
  }
}

export async function createApprovalRoute(
  db: AppDatabase,
  actor: SessionActor,
  input: ApprovalRouteInput,
) {
  requirePermission(actor, "approvals:manage");
  const normalized = normalizeRouteInput(input);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${actor.organizationId}:${normalized.departmentId}:${normalized.requestType}`}))`,
    );
    await validateRouteReferences(transaction, actor.organizationId, normalized);
    await assertNoRouteOverlap(transaction, actor.organizationId, normalized);
    const [route] = await transaction
      .insert(approvalRouteAssignments)
      .values({
        ...normalized,
        createdByUserId: actor.userId,
        organizationId: actor.organizationId,
      })
      .returning();
    await recordAudit(transaction, {
      action: "approval_route_changed",
      actorUserId: actor.userId,
      entityId: route.id,
      entityType: "approval_route",
      metadata: {
        approverUserId: route.approverUserId,
        departmentId: route.departmentId,
        dueDays: route.dueDays,
        effectiveFrom: route.effectiveFrom,
        effectiveTo: route.effectiveTo,
        operation: "created",
        requestType: route.requestType,
      },
      organizationId: actor.organizationId,
    });
    return route;
  });
}

export async function updateApprovalRoute(
  db: AppDatabase,
  actor: SessionActor,
  routeId: string,
  input: ApprovalRouteInput & { version: number },
) {
  requirePermission(actor, "approvals:manage");
  const normalized = normalizeRouteInput(input);
  if (!Number.isInteger(input.version) || input.version < 0) {
    throw new ApprovalRouteValidationError("経路のversionが正しくありません。");
  }
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${actor.organizationId}:${normalized.departmentId}:${normalized.requestType}`}))`,
    );
    await validateRouteReferences(transaction, actor.organizationId, normalized);
    await assertNoRouteOverlap(transaction, actor.organizationId, normalized, routeId);
    const [route] = await transaction
      .update(approvalRouteAssignments)
      .set({ ...normalized, updatedAt: new Date(), version: input.version + 1 })
      .where(
        and(
          eq(approvalRouteAssignments.id, routeId),
          eq(approvalRouteAssignments.organizationId, actor.organizationId),
          eq(approvalRouteAssignments.version, input.version),
        ),
      )
      .returning();
    if (!route) throw new ApprovalRouteConflictError();
    await recordAudit(transaction, {
      action: "approval_route_changed",
      actorUserId: actor.userId,
      entityId: route.id,
      entityType: "approval_route",
      metadata: { operation: "updated", version: route.version },
      organizationId: actor.organizationId,
    });
    return route;
  });
}

export async function deleteApprovalRoute(
  db: AppDatabase,
  actor: SessionActor,
  routeId: string,
  expectedVersion: number,
) {
  requirePermission(actor, "approvals:manage");
  return db.transaction(async (transaction) => {
    const [route] = await transaction
      .delete(approvalRouteAssignments)
      .where(
        and(
          eq(approvalRouteAssignments.id, routeId),
          eq(approvalRouteAssignments.organizationId, actor.organizationId),
          eq(approvalRouteAssignments.version, expectedVersion),
        ),
      )
      .returning();
    if (!route) throw new ApprovalRouteConflictError();
    await recordAudit(transaction, {
      action: "approval_route_changed",
      actorUserId: actor.userId,
      entityId: route.id,
      entityType: "approval_route",
      metadata: { operation: "deleted", version: route.version },
      organizationId: actor.organizationId,
    });
    return route;
  });
}
