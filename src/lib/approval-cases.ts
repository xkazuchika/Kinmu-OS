import { and, asc, count, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { ApprovalCaseSnapshot, ApprovalRequestType } from "@/lib/approval-types";
import { approvalCaseStatuses, approvalRequestTypes } from "@/lib/approval-types";
import { createApprovalEventNotifications } from "@/lib/approval-notifications";
import { recordAudit } from "@/lib/audit";
import { assertAttendanceMonthOpen, lockAttendanceMonth } from "@/lib/attendance-closing";
import { AuthorizationError, can, requirePermission, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import {
  approvalCaseRevisions,
  approvalCases,
  attendanceCorrectionEntries,
  attendanceCorrectionRequests,
  departments,
  employees,
  leaveRequestDays,
  leaveRequests,
  overtimeWorkRequests,
  users,
} from "@/lib/db/schema";
import { resolveApprovalRoute } from "@/lib/approval-routing";

type ApprovalMutationDatabase = Pick<AppDatabase, "execute" | "insert" | "select" | "update">;

export class ApprovalCaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalCaseValidationError";
  }
}

export class ApprovalCaseConflictError extends Error {
  constructor(message = "申請が更新されています。最新の内容を読み込んでください。") {
    super(message);
    this.name = "ApprovalCaseConflictError";
  }
}

type DomainReference =
  | { attendanceCorrectionRequestId: string; requestType: "attendance_correction" }
  | { leaveRequestId: string; requestType: "leave" }
  | { overtimeWorkRequestId: string; requestType: "holiday_work" | "overtime" };

function referenceValues(reference: DomainReference) {
  return {
    attendanceCorrectionRequestId:
      "attendanceCorrectionRequestId" in reference ? reference.attendanceCorrectionRequestId : null,
    leaveRequestId: "leaveRequestId" in reference ? reference.leaveRequestId : null,
    overtimeWorkRequestId:
      "overtimeWorkRequestId" in reference ? reference.overtimeWorkRequestId : null,
  };
}

export async function createApprovalCase(
  db: ApprovalMutationDatabase,
  input: Readonly<{
    createdAt?: Date;
    employeeId: string;
    organizationId: string;
    proxyReason?: string | null;
    reference: DomainReference;
    snapshot: ApprovalCaseSnapshot;
    submittedByUserId: string;
    submittedOnBehalf?: boolean;
    targetDate: string;
  }>,
) {
  const createdAt = input.createdAt ?? new Date();
  const proxyReason = input.proxyReason?.trim() || null;
  if (input.submittedOnBehalf && (!proxyReason || proxyReason.length > 1000)) {
    throw new ApprovalCaseValidationError("代理申請理由を1,000文字以内で入力してください。");
  }
  if (!input.submittedOnBehalf && proxyReason) {
    throw new ApprovalCaseValidationError("本人申請に代理申請理由は設定できません。");
  }

  const route = await resolveApprovalRoute(db, {
    employeeId: input.employeeId,
    organizationId: input.organizationId,
    requestType: input.reference.requestType,
    submittedAt: createdAt,
    submittedByUserId: input.submittedByUserId,
  });
  const [approvalCase] = await db
    .insert(approvalCases)
    .values({
      ...referenceValues(input.reference),
      ...route,
      createdAt,
      organizationId: input.organizationId,
      proxyReason,
      requestType: input.reference.requestType,
      submittedByUserId: input.submittedByUserId,
      submittedOnBehalf: input.submittedOnBehalf ?? false,
      targetDate: input.targetDate,
      targetEmployeeId: input.employeeId,
      updatedAt: createdAt,
    })
    .returning();
  await db.insert(approvalCaseRevisions).values({
    approvalCaseId: approvalCase.id,
    createdAt,
    organizationId: input.organizationId,
    revisedByUserId: input.submittedByUserId,
    revision: 1,
    revisionReason: input.submittedOnBehalf ? "代理作成" : "初回申請",
    snapshot: input.snapshot,
  });
  await recordAudit(db, {
    action: input.submittedOnBehalf ? "approval_proxy_created" : "approval_case_submitted",
    actorUserId: input.submittedByUserId,
    entityId: approvalCase.id,
    entityType: "approval_case",
    metadata: {
      assignedApproverUserId: approvalCase.assignedApproverUserId,
      currentRevision: approvalCase.currentRevision,
      originalApproverUserId: approvalCase.originalApproverUserId,
      requestType: approvalCase.requestType,
      routeReason: approvalCase.routeReason,
      status: approvalCase.status,
      submittedDepartmentId: approvalCase.submittedDepartmentId,
      submittedByUserId: approvalCase.submittedByUserId,
      submittedOnBehalf: approvalCase.submittedOnBehalf,
      targetEmployeeId: approvalCase.targetEmployeeId,
      version: approvalCase.version,
    },
    organizationId: input.organizationId,
  });
  await createApprovalEventNotifications(db, approvalCase, "submitted");
  return approvalCase;
}

type DomainRequestReference =
  | { attendanceCorrectionRequestId: string }
  | { leaveRequestId: string }
  | { overtimeWorkRequestId: string };

function domainReferenceCondition(reference: DomainRequestReference) {
  if ("attendanceCorrectionRequestId" in reference) {
    return eq(approvalCases.attendanceCorrectionRequestId, reference.attendanceCorrectionRequestId);
  }
  if ("leaveRequestId" in reference) {
    return eq(approvalCases.leaveRequestId, reference.leaveRequestId);
  }
  return eq(approvalCases.overtimeWorkRequestId, reference.overtimeWorkRequestId);
}

export async function syncApprovalCaseStatus(
  db: ApprovalMutationDatabase,
  input: Readonly<{
    actorUserId: string;
    cancelledAt?: Date | null;
    expectedStatus?: "pending" | "returned";
    expectedVersion?: number;
    organizationId: string;
    reference: DomainRequestReference;
    reviewComment?: string | null;
    reviewedAt?: Date | null;
    reviewerUserId?: string | null;
    status: "approved" | "cancelled" | "pending" | "rejected" | "returned";
  }>,
) {
  const action = {
    approved: "approval_case_approved",
    cancelled: "approval_case_cancelled",
    pending: "approval_case_resubmitted",
    rejected: "approval_case_rejected",
    returned: "approval_case_returned",
  } as const;
  const [approvalCase] = await db
    .update(approvalCases)
    .set({
      cancelledAt: input.status === "cancelled" ? (input.cancelledAt ?? new Date()) : null,
      reviewComment:
        input.status === "returned" || input.status === "rejected"
          ? (input.reviewComment?.trim() ?? null)
          : null,
      reviewedAt:
        input.status === "returned" || input.status === "approved" || input.status === "rejected"
          ? (input.reviewedAt ?? new Date())
          : null,
      reviewerUserId:
        input.status === "returned" || input.status === "approved" || input.status === "rejected"
          ? (input.reviewerUserId ?? input.actorUserId)
          : null,
      status: input.status,
      updatedAt: new Date(),
      version: sql`${approvalCases.version} + 1`,
    })
    .where(
      and(
        eq(approvalCases.organizationId, input.organizationId),
        domainReferenceCondition(input.reference),
        input.expectedStatus ? eq(approvalCases.status, input.expectedStatus) : sql`true`,
        input.expectedVersion === undefined
          ? sql`true`
          : eq(approvalCases.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!approvalCase) throw new ApprovalCaseConflictError();
  await recordAudit(db, {
    action: action[input.status],
    actorUserId: input.actorUserId,
    entityId: approvalCase.id,
    entityType: "approval_case",
    metadata: {
      assignedApproverUserId: approvalCase.assignedApproverUserId,
      currentRevision: approvalCase.currentRevision,
      fromStatus: input.expectedStatus ?? null,
      originalApproverUserId: approvalCase.originalApproverUserId,
      requestType: approvalCase.requestType,
      routeReason: approvalCase.routeReason,
      submittedDepartmentId: approvalCase.submittedDepartmentId,
      submittedByUserId: approvalCase.submittedByUserId,
      submittedOnBehalf: approvalCase.submittedOnBehalf,
      targetEmployeeId: approvalCase.targetEmployeeId,
      toStatus: approvalCase.status,
      version: approvalCase.version,
    },
    organizationId: input.organizationId,
  });
  if (input.status !== "pending") {
    await createApprovalEventNotifications(db, approvalCase, input.status);
  }
  return approvalCase;
}

type InboxFilters = Readonly<{
  assigned?: "assigned" | "mine" | "unassigned";
  departmentId?: string;
  due?: "all" | "not_overdue" | "overdue";
  employeeId?: string;
  from?: string;
  page?: number;
  proxy?: boolean;
  requestType?: string;
  status?: string;
  submittedFrom?: Date;
  submittedTo?: Date;
  to?: string;
}>;

function inboxScope(actor: SessionActor) {
  if (actor.role === "approver") {
    requirePermission(actor, "approvals:review");
    return eq(approvalCases.assignedApproverUserId, actor.userId);
  }
  requirePermission(actor, "approvals:manage");
  return sql`true`;
}

export async function listApprovalInbox(
  db: AppDatabase,
  actor: SessionActor,
  filters: InboxFilters = {},
) {
  const page = Number.isInteger(filters.page) && (filters.page ?? 0) > 0 ? filters.page! : 1;
  const conditions = [eq(approvalCases.organizationId, actor.organizationId), inboxScope(actor)];
  if (filters.status) {
    if (!(approvalCaseStatuses as readonly string[]).includes(filters.status)) {
      throw new ApprovalCaseValidationError("承認状態が正しくありません。");
    }
    conditions.push(
      eq(approvalCases.status, filters.status as (typeof approvalCaseStatuses)[number]),
    );
  } else {
    conditions.push(eq(approvalCases.status, "pending"));
  }
  if (filters.requestType) {
    if (!(approvalRequestTypes as readonly string[]).includes(filters.requestType)) {
      throw new ApprovalCaseValidationError("申請種別が正しくありません。");
    }
    conditions.push(eq(approvalCases.requestType, filters.requestType as ApprovalRequestType));
  }
  if (filters.departmentId) {
    conditions.push(eq(approvalCases.submittedDepartmentId, filters.departmentId));
  }
  if (filters.employeeId) {
    conditions.push(eq(approvalCases.targetEmployeeId, filters.employeeId));
  }
  if (filters.from) conditions.push(gte(approvalCases.targetDate, filters.from));
  if (filters.to) conditions.push(lte(approvalCases.targetDate, filters.to));
  if (filters.submittedFrom) {
    conditions.push(gte(approvalCases.createdAt, filters.submittedFrom));
  }
  if (filters.submittedTo) conditions.push(lt(approvalCases.createdAt, filters.submittedTo));
  if (filters.proxy !== undefined) {
    conditions.push(eq(approvalCases.submittedOnBehalf, filters.proxy));
  }
  if (filters.assigned === "unassigned") {
    conditions.push(isNull(approvalCases.assignedApproverUserId));
  } else if (filters.assigned === "mine") {
    conditions.push(eq(approvalCases.assignedApproverUserId, actor.userId));
  } else if (filters.assigned === "assigned") {
    conditions.push(sql`${approvalCases.assignedApproverUserId} IS NOT NULL`);
  }
  if (filters.due === "overdue") {
    conditions.push(lte(approvalCases.dueAt, new Date()));
  } else if (filters.due === "not_overdue") {
    conditions.push(or(isNull(approvalCases.dueAt), gte(approvalCases.dueAt, new Date()))!);
  }

  const where = and(...conditions);
  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(approvalCases).where(where),
    db
      .select({
        assignedApproverUserId: approvalCases.assignedApproverUserId,
        assigneeEligible: sql<boolean>`(
          ${approvalCases.assignedApproverUserId} IS NULL
          OR EXISTS (
            SELECT 1
            FROM users approval_assignee
            WHERE approval_assignee.id = ${approvalCases.assignedApproverUserId}
              AND approval_assignee.organization_id = ${actor.organizationId}
              AND approval_assignee.status = 'active'
              AND approval_assignee.role IN ('owner', 'hr_admin', 'approver')
          )
        )`,
        createdAt: approvalCases.createdAt,
        departmentId: approvalCases.submittedDepartmentId,
        departmentName: departments.name,
        delegationStillActive: sql<boolean>`(
          ${approvalCases.routeReason} <> 'delegated'
          OR EXISTS (
            SELECT 1
            FROM approval_delegations active_delegation
            WHERE active_delegation.organization_id = ${actor.organizationId}
              AND active_delegation.department_id = ${approvalCases.submittedDepartmentId}
              AND active_delegation.request_type = ${approvalCases.requestType}
              AND active_delegation.original_approver_user_id = ${approvalCases.originalApproverUserId}
              AND active_delegation.delegate_approver_user_id = ${approvalCases.assignedApproverUserId}
              AND active_delegation.starts_at <= now()
              AND active_delegation.ends_at >= now()
          )
        )`,
        dueAt: approvalCases.dueAt,
        employeeDisplayName: employees.displayName,
        employeeId: approvalCases.targetEmployeeId,
        id: approvalCases.id,
        requestType: approvalCases.requestType,
        routeReason: approvalCases.routeReason,
        status: approvalCases.status,
        submittedOnBehalf: approvalCases.submittedOnBehalf,
        targetDate: approvalCases.targetDate,
        version: approvalCases.version,
      })
      .from(approvalCases)
      .innerJoin(employees, eq(employees.id, approvalCases.targetEmployeeId))
      .leftJoin(departments, eq(departments.id, approvalCases.submittedDepartmentId))
      .where(where)
      .orderBy(
        sql`${approvalCases.dueAt} ASC NULLS LAST`,
        asc(approvalCases.createdAt),
        asc(approvalCases.id),
      )
      .limit(50)
      .offset((page - 1) * 50),
  ]);
  const now = Date.now();
  return {
    items: rows.map((row) => ({
      ...row,
      ageDays: Math.max(0, Math.floor((now - row.createdAt.getTime()) / 86_400_000)),
      canReview:
        row.status === "pending" &&
        (row.assignedApproverUserId === actor.userId ||
          (actor.role !== "approver" && row.assignedApproverUserId === null)),
      needsReassignment:
        row.status === "pending" &&
        ((row.assignedApproverUserId !== null && !row.assigneeEligible) ||
          !row.delegationStillActive),
      overdue: row.dueAt ? row.dueAt.getTime() < now : false,
    })),
    page,
    pageSize: 50,
    total: totalRow[0]?.total ?? 0,
  };
}

async function scopedApprovalCase(db: AppDatabase, actor: SessionActor, caseId: string) {
  const scope =
    actor.role === "approver"
      ? eq(approvalCases.assignedApproverUserId, actor.userId)
      : can(actor, "approvals:manage")
        ? sql`true`
        : sql`false`;
  const [approvalCase] = await db
    .select({
      case: approvalCases,
      departmentName: departments.name,
      employeeDisplayName: employees.displayName,
      targetEmployeeUserId: employees.userId,
    })
    .from(approvalCases)
    .innerJoin(employees, eq(employees.id, approvalCases.targetEmployeeId))
    .leftJoin(departments, eq(departments.id, approvalCases.submittedDepartmentId))
    .where(
      and(
        eq(approvalCases.id, caseId),
        eq(approvalCases.organizationId, actor.organizationId),
        scope,
      ),
    )
    .limit(1);
  if (!approvalCase) throw new AuthorizationError();
  return approvalCase;
}

export async function getApprovalCaseDetail(db: AppDatabase, actor: SessionActor, caseId: string) {
  requirePermission(actor, actor.role === "approver" ? "approvals:review" : "approvals:manage");
  const context = await scopedApprovalCase(db, actor, caseId);
  const [revisions, submitter, originalApprover, assignedApprover] = await Promise.all([
    db
      .select()
      .from(approvalCaseRevisions)
      .where(
        and(
          eq(approvalCaseRevisions.approvalCaseId, context.case.id),
          eq(approvalCaseRevisions.organizationId, actor.organizationId),
        ),
      )
      .orderBy(desc(approvalCaseRevisions.revision)),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, context.case.submittedByUserId))
      .limit(1),
    context.case.originalApproverUserId
      ? db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, context.case.originalApproverUserId))
          .limit(1)
      : Promise.resolve([]),
    context.case.assignedApproverUserId
      ? db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, context.case.assignedApproverUserId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  let domain: unknown;
  if (context.case.attendanceCorrectionRequestId) {
    const [request, entries] = await Promise.all([
      db
        .select()
        .from(attendanceCorrectionRequests)
        .where(eq(attendanceCorrectionRequests.id, context.case.attendanceCorrectionRequestId))
        .limit(1),
      db
        .select()
        .from(attendanceCorrectionEntries)
        .where(
          eq(attendanceCorrectionEntries.requestId, context.case.attendanceCorrectionRequestId),
        )
        .orderBy(asc(attendanceCorrectionEntries.kind), asc(attendanceCorrectionEntries.position)),
    ]);
    domain = { entries, request: request[0] };
  } else if (context.case.leaveRequestId) {
    const [request, days] = await Promise.all([
      db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, context.case.leaveRequestId))
        .limit(1),
      db
        .select()
        .from(leaveRequestDays)
        .where(eq(leaveRequestDays.requestId, context.case.leaveRequestId))
        .orderBy(asc(leaveRequestDays.workDate)),
    ]);
    domain = { days, request: request[0] };
  } else if (context.case.overtimeWorkRequestId) {
    const [request] = await db
      .select()
      .from(overtimeWorkRequests)
      .where(eq(overtimeWorkRequests.id, context.case.overtimeWorkRequestId))
      .limit(1);
    domain = { request };
  }

  return {
    ...context,
    assignedApproverName: assignedApprover[0]?.displayName ?? null,
    canManage: can(actor, "approvals:manage"),
    canReview:
      context.case.status === "pending" &&
      context.case.submittedByUserId !== actor.userId &&
      context.targetEmployeeUserId !== actor.userId,
    domain,
    originalApproverName: originalApprover[0]?.displayName ?? null,
    revisions,
    submitterName: submitter[0]?.displayName ?? "",
  };
}

export async function assertApprovalReviewAccess(
  db: AppDatabase,
  actor: SessionActor,
  caseId: string,
  expectedVersion?: number,
) {
  requirePermission(actor, "approvals:review");
  const context = await scopedApprovalCase(db, actor, caseId);
  if (
    context.case.submittedByUserId === actor.userId ||
    context.targetEmployeeUserId === actor.userId
  ) {
    await recordAudit(db, {
      action: "approval_self_review_rejected",
      actorUserId: actor.userId,
      entityId: context.case.id,
      entityType: "approval_case",
      metadata: {
        assignedApproverUserId: context.case.assignedApproverUserId,
        currentRevision: context.case.currentRevision,
        originalApproverUserId: context.case.originalApproverUserId,
        requestType: context.case.requestType,
        routeReason: context.case.routeReason,
        submittedDepartmentId: context.case.submittedDepartmentId,
        submittedByUserId: context.case.submittedByUserId,
        submittedOnBehalf: context.case.submittedOnBehalf,
        targetEmployeeId: context.case.targetEmployeeId,
        version: context.case.version,
      },
      organizationId: actor.organizationId,
    });
    throw new AuthorizationError("自分の申請（自分が対象または作成者）は審査できません。");
  }
  if (expectedVersion !== undefined && context.case.version !== expectedVersion) {
    throw new ApprovalCaseConflictError();
  }
  return context;
}

export async function approvalCaseIdForDomainRequest(
  db: Pick<AppDatabase, "select">,
  organizationId: string,
  reference: DomainRequestReference,
) {
  const [approvalCase] = await db
    .select({ id: approvalCases.id })
    .from(approvalCases)
    .where(
      and(eq(approvalCases.organizationId, organizationId), domainReferenceCondition(reference)),
    )
    .limit(1);
  return approvalCase?.id ?? null;
}

export async function approvalCaseSelfAccessForDomainRequest(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  reference: DomainRequestReference,
) {
  const [context] = await db
    .select({
      approvalCase: approvalCases,
      targetEmployeeUserId: employees.userId,
    })
    .from(approvalCases)
    .innerJoin(employees, eq(employees.id, approvalCases.targetEmployeeId))
    .where(
      and(
        eq(approvalCases.organizationId, actor.organizationId),
        domainReferenceCondition(reference),
      ),
    )
    .limit(1);
  if (!context) throw new AuthorizationError();
  const isTarget = context.targetEmployeeUserId === actor.userId;
  const isAuthorizedProxyCreator =
    context.approvalCase.submittedOnBehalf &&
    context.approvalCase.submittedByUserId === actor.userId &&
    can(actor, "approvals:manage");
  if (!isTarget && !isAuthorizedProxyCreator) throw new AuthorizationError();
  return context;
}

export async function listOwnApprovalCases(db: Pick<AppDatabase, "select">, actor: SessionActor) {
  requirePermission(actor, "self:read");
  const selfScope = can(actor, "approvals:manage")
    ? or(
        eq(employees.userId, actor.userId),
        and(
          eq(approvalCases.submittedByUserId, actor.userId),
          eq(approvalCases.submittedOnBehalf, true),
        ),
      )
    : eq(employees.userId, actor.userId);
  return db
    .select({
      createdAt: approvalCases.createdAt,
      currentRevision: approvalCases.currentRevision,
      id: approvalCases.id,
      proxyReason: approvalCases.proxyReason,
      requestType: approvalCases.requestType,
      reviewComment: approvalCases.reviewComment,
      status: approvalCases.status,
      submittedOnBehalf: approvalCases.submittedOnBehalf,
      targetDate: approvalCases.targetDate,
      version: approvalCases.version,
    })
    .from(approvalCases)
    .innerJoin(employees, eq(employees.id, approvalCases.targetEmployeeId))
    .where(and(eq(approvalCases.organizationId, actor.organizationId), selfScope))
    .orderBy(desc(approvalCases.createdAt));
}

export async function getOwnApprovalCaseDetail(
  db: AppDatabase,
  actor: SessionActor,
  caseId: string,
) {
  requirePermission(actor, "self:read");
  const [context] = await db
    .select({
      approvalCase: approvalCases,
      targetEmployeeUserId: employees.userId,
    })
    .from(approvalCases)
    .innerJoin(employees, eq(employees.id, approvalCases.targetEmployeeId))
    .where(
      and(eq(approvalCases.id, caseId), eq(approvalCases.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!context) throw new AuthorizationError();
  const isTarget = context.targetEmployeeUserId === actor.userId;
  const isAuthorizedProxyCreator =
    context.approvalCase.submittedOnBehalf &&
    context.approvalCase.submittedByUserId === actor.userId &&
    can(actor, "approvals:manage");
  if (!isTarget && !isAuthorizedProxyCreator) throw new AuthorizationError();

  const [revisions, submitter] = await Promise.all([
    db
      .select()
      .from(approvalCaseRevisions)
      .where(
        and(
          eq(approvalCaseRevisions.approvalCaseId, context.approvalCase.id),
          eq(approvalCaseRevisions.organizationId, actor.organizationId),
        ),
      )
      .orderBy(desc(approvalCaseRevisions.revision)),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, context.approvalCase.submittedByUserId))
      .limit(1),
  ]);

  let domain: unknown;
  if (context.approvalCase.attendanceCorrectionRequestId) {
    const [request, entries] = await Promise.all([
      db
        .select()
        .from(attendanceCorrectionRequests)
        .where(
          eq(attendanceCorrectionRequests.id, context.approvalCase.attendanceCorrectionRequestId),
        )
        .limit(1),
      db
        .select()
        .from(attendanceCorrectionEntries)
        .where(
          eq(
            attendanceCorrectionEntries.requestId,
            context.approvalCase.attendanceCorrectionRequestId,
          ),
        )
        .orderBy(asc(attendanceCorrectionEntries.kind), asc(attendanceCorrectionEntries.position)),
    ]);
    domain = { entries, request: request[0] };
  } else if (context.approvalCase.leaveRequestId) {
    const [request, days] = await Promise.all([
      db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, context.approvalCase.leaveRequestId))
        .limit(1),
      db
        .select()
        .from(leaveRequestDays)
        .where(eq(leaveRequestDays.requestId, context.approvalCase.leaveRequestId))
        .orderBy(asc(leaveRequestDays.workDate)),
    ]);
    domain = { days, request: request[0] };
  } else if (context.approvalCase.overtimeWorkRequestId) {
    const [request] = await db
      .select()
      .from(overtimeWorkRequests)
      .where(eq(overtimeWorkRequests.id, context.approvalCase.overtimeWorkRequestId))
      .limit(1);
    domain = { request };
  }

  const approvalCase = context.approvalCase;
  return {
    case: {
      attendanceCorrectionRequestId: approvalCase.attendanceCorrectionRequestId,
      createdAt: approvalCase.createdAt,
      currentRevision: approvalCase.currentRevision,
      id: approvalCase.id,
      leaveRequestId: approvalCase.leaveRequestId,
      overtimeWorkRequestId: approvalCase.overtimeWorkRequestId,
      proxyReason: approvalCase.proxyReason,
      requestType: approvalCase.requestType,
      reviewComment: approvalCase.reviewComment,
      status: approvalCase.status,
      submittedOnBehalf: approvalCase.submittedOnBehalf,
      targetDate: approvalCase.targetDate,
      updatedAt: approvalCase.updatedAt,
      version: approvalCase.version,
    },
    domain,
    revisions,
    submitterName: submitter[0]?.displayName ?? "",
  };
}

export async function assertDomainApprovalReviewAccess(
  db: AppDatabase,
  actor: SessionActor,
  reference: DomainRequestReference,
  expectedVersion?: number,
) {
  const caseId = await approvalCaseIdForDomainRequest(db, actor.organizationId, reference);
  if (!caseId) throw new AuthorizationError();
  return assertApprovalReviewAccess(db, actor, caseId, expectedVersion);
}

export async function lockApprovalCaseForDomain(
  db: Pick<AppDatabase, "execute" | "select">,
  organizationId: string,
  reference: DomainRequestReference,
) {
  const [row] = (await db.execute(sql`
    SELECT id
    FROM approval_cases
    WHERE organization_id = ${organizationId}
      AND (
        ${
          "attendanceCorrectionRequestId" in reference
            ? sql`attendance_correction_request_id = ${reference.attendanceCorrectionRequestId}`
            : "leaveRequestId" in reference
              ? sql`leave_request_id = ${reference.leaveRequestId}`
              : sql`overtime_work_request_id = ${reference.overtimeWorkRequestId}`
        }
      )
    FOR UPDATE
  `)) as unknown as Array<{ id: string }>;
  if (!row) throw new ApprovalCaseConflictError();
  return row.id;
}

export async function returnApprovalCase(
  db: AppDatabase,
  actor: SessionActor,
  caseId: string,
  input: Readonly<{ comment: string; expectedVersion: number }>,
) {
  const reviewComment = input.comment.trim();
  if (!reviewComment || reviewComment.length > 1000) {
    throw new ApprovalCaseValidationError("差し戻し理由を1,000文字以内で入力してください。");
  }
  await assertApprovalReviewAccess(db, actor, caseId, input.expectedVersion);

  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT id FROM ${approvalCases} WHERE id = ${caseId} FOR UPDATE`);
    const [approvalCase] = await transaction
      .select()
      .from(approvalCases)
      .where(
        and(
          eq(approvalCases.id, caseId),
          eq(approvalCases.organizationId, actor.organizationId),
          eq(approvalCases.status, "pending"),
          eq(approvalCases.version, input.expectedVersion),
        ),
      )
      .limit(1);
    if (!approvalCase) throw new ApprovalCaseConflictError();

    const targetDates = approvalCase.leaveRequestId
      ? (
          await transaction
            .select({ workDate: leaveRequestDays.workDate })
            .from(leaveRequestDays)
            .where(eq(leaveRequestDays.requestId, approvalCase.leaveRequestId))
        ).map((day) => day.workDate)
      : [approvalCase.targetDate];
    const months = [...new Set(targetDates.map((date) => date.slice(0, 7)))].sort();
    for (const month of months) {
      await lockAttendanceMonth(transaction, actor.organizationId, month);
    }
    for (const date of targetDates) {
      await assertAttendanceMonthOpen(transaction, actor.organizationId, date);
    }

    const reviewedAt = new Date();
    let updatedDomain:
      | typeof attendanceCorrectionRequests.$inferSelect
      | typeof leaveRequests.$inferSelect
      | typeof overtimeWorkRequests.$inferSelect
      | undefined;
    if (approvalCase.attendanceCorrectionRequestId) {
      [updatedDomain] = await transaction
        .update(attendanceCorrectionRequests)
        .set({
          reviewComment,
          reviewedAt,
          reviewerUserId: actor.userId,
          status: "returned",
          updatedAt: reviewedAt,
        })
        .where(
          and(
            eq(attendanceCorrectionRequests.id, approvalCase.attendanceCorrectionRequestId),
            eq(attendanceCorrectionRequests.status, "pending"),
          ),
        )
        .returning();
    } else if (approvalCase.leaveRequestId) {
      [updatedDomain] = await transaction
        .update(leaveRequests)
        .set({
          reviewComment,
          reviewedAt,
          reviewerUserId: actor.userId,
          status: "returned",
          updatedAt: reviewedAt,
        })
        .where(
          and(
            eq(leaveRequests.id, approvalCase.leaveRequestId),
            eq(leaveRequests.status, "pending"),
          ),
        )
        .returning();
    } else if (approvalCase.overtimeWorkRequestId) {
      [updatedDomain] = await transaction
        .update(overtimeWorkRequests)
        .set({
          reviewComment,
          reviewedAt,
          reviewerUserId: actor.userId,
          status: "returned",
          updatedAt: reviewedAt,
          version: sql`${overtimeWorkRequests.version} + 1`,
        })
        .where(
          and(
            eq(overtimeWorkRequests.id, approvalCase.overtimeWorkRequestId),
            eq(overtimeWorkRequests.status, "pending"),
          ),
        )
        .returning();
    }
    if (!updatedDomain) throw new ApprovalCaseConflictError();
    const updatedCase = await syncApprovalCaseStatus(transaction, {
      actorUserId: actor.userId,
      expectedStatus: "pending",
      expectedVersion: input.expectedVersion,
      organizationId: actor.organizationId,
      reference: approvalCase.attendanceCorrectionRequestId
        ? {
            attendanceCorrectionRequestId: approvalCase.attendanceCorrectionRequestId,
          }
        : approvalCase.leaveRequestId
          ? { leaveRequestId: approvalCase.leaveRequestId }
          : { overtimeWorkRequestId: approvalCase.overtimeWorkRequestId! },
      reviewComment,
      reviewedAt,
      reviewerUserId: actor.userId,
      status: "returned",
    });
    return { approvalCase: updatedCase, domainRequest: updatedDomain };
  });
}

export async function appendApprovalRevisionAndResubmit(
  db: ApprovalMutationDatabase,
  actor: SessionActor,
  input: Readonly<{
    approvalCaseId: string;
    expectedVersion: number;
    snapshot: ApprovalCaseSnapshot;
  }>,
) {
  const [context] = await db
    .select({
      approvalCase: approvalCases,
      targetEmployeeUserId: employees.userId,
    })
    .from(approvalCases)
    .innerJoin(employees, eq(employees.id, approvalCases.targetEmployeeId))
    .where(
      and(
        eq(approvalCases.id, input.approvalCaseId),
        eq(approvalCases.organizationId, actor.organizationId),
        eq(approvalCases.status, "returned"),
        eq(approvalCases.version, input.expectedVersion),
      ),
    )
    .limit(1);
  if (!context) throw new ApprovalCaseConflictError();
  if (
    context.targetEmployeeUserId !== actor.userId &&
    !(
      context.approvalCase.submittedOnBehalf &&
      context.approvalCase.submittedByUserId === actor.userId &&
      can(actor, "approvals:manage")
    )
  ) {
    throw new AuthorizationError();
  }
  const nextRevision = context.approvalCase.currentRevision + 1;
  await db.insert(approvalCaseRevisions).values({
    approvalCaseId: context.approvalCase.id,
    organizationId: actor.organizationId,
    revisedByUserId: actor.userId,
    revision: nextRevision,
    revisionReason: "差し戻し後の再申請",
    snapshot: input.snapshot,
  });
  const [updated] = await db
    .update(approvalCases)
    .set({
      cancelledAt: null,
      currentRevision: nextRevision,
      reviewComment: null,
      reviewedAt: null,
      reviewerUserId: null,
      status: "pending",
      updatedAt: new Date(),
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(approvalCases.id, context.approvalCase.id),
        eq(approvalCases.status, "returned"),
        eq(approvalCases.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated) throw new ApprovalCaseConflictError();
  await recordAudit(db, {
    action: "approval_case_resubmitted",
    actorUserId: actor.userId,
    entityId: updated.id,
    entityType: "approval_case",
    metadata: {
      assignedApproverUserId: updated.assignedApproverUserId,
      currentRevision: updated.currentRevision,
      fromStatus: "returned",
      originalApproverUserId: updated.originalApproverUserId,
      requestType: updated.requestType,
      routeReason: updated.routeReason,
      submittedDepartmentId: updated.submittedDepartmentId,
      submittedByUserId: updated.submittedByUserId,
      submittedOnBehalf: updated.submittedOnBehalf,
      targetEmployeeId: updated.targetEmployeeId,
      toStatus: "pending",
      version: updated.version,
    },
    organizationId: actor.organizationId,
  });
  await createApprovalEventNotifications(db, updated, "resubmitted");
  return updated;
}
