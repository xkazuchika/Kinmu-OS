import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import {
  createApprovalDelegation,
  previewDelegationCases,
  reassignApprovalCases,
} from "@/lib/approval-delegations";
import {
  createApprovalCase,
  getApprovalCaseDetail,
  getOwnApprovalCaseDetail,
  listApprovalInbox,
  listOwnApprovalCases,
} from "@/lib/approval-cases";
import { createApprovalEventNotifications } from "@/lib/approval-notifications";
import {
  createApprovalRoute,
  ApprovalRouteValidationError,
  resolveApprovalRoute,
} from "@/lib/approval-routing";
import { reviewApprovalCase } from "@/lib/approval-review";
import { AuthorizationError, type SessionActor } from "@/lib/authorization";
import {
  cancelAttendanceCorrection,
  createAttendanceCorrection,
  resubmitAttendanceCorrection,
} from "@/lib/attendance-corrections";
import { createDatabaseClient } from "@/lib/db/client";
import {
  approvalCases,
  approvalDelegations,
  attendanceCorrectionRequests,
  departments,
  employeeDepartments,
  employees,
  notifications,
  organizations,
  users,
} from "@/lib/db/schema";
import { notificationTarget } from "@/lib/notifications";
import { searchAuditLogs } from "@/lib/reporting";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("approval routing and scoped inbox", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
  });

  afterAll(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await client.close();
  });

  function actor(
    organizationId: string,
    userId: string,
    role: SessionActor["role"],
    displayName = "テスト利用者",
  ): SessionActor {
    return {
      displayName,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      organizationId,
      role,
      userId,
    };
  }

  async function fixture() {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "承認運用株式会社" })
      .returning();
    const [owner, approver, otherApprover, employeeUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "管理 一郎",
          email: "approval-owner@example.com",
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
        {
          displayName: "承認 二郎",
          email: "approval-approver@example.com",
          organizationId: organization.id,
          role: "approver",
          status: "active",
        },
        {
          displayName: "別承認 三郎",
          email: "approval-other@example.com",
          organizationId: organization.id,
          role: "approver",
          status: "active",
        },
        {
          displayName: "申請 花子",
          email: "approval-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee, approverEmployee] = await client.db
      .insert(employees)
      .values([
        {
          displayName: employeeUser.displayName,
          employeeNumber: "APR-001",
          familyName: "申請",
          givenName: "花子",
          organizationId: organization.id,
          status: "active",
          userId: employeeUser.id,
        },
        {
          displayName: approver.displayName,
          employeeNumber: "APR-002",
          familyName: "承認",
          givenName: "二郎",
          organizationId: organization.id,
          status: "active",
          userId: approver.id,
        },
      ])
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "SALES", name: "営業部", organizationId: organization.id })
      .returning();
    await client.db.insert(employeeDepartments).values([
      {
        departmentId: department.id,
        employeeId: employee.id,
        isPrimary: true,
        startedOn: "2020-01-01",
      },
      {
        departmentId: department.id,
        employeeId: approverEmployee.id,
        isPrimary: true,
        startedOn: "2020-01-01",
      },
    ]);
    return {
      approver,
      approverActor: actor(organization.id, approver.id, "approver", approver.displayName),
      approverEmployee,
      department,
      employee,
      employeeActor: actor(organization.id, employeeUser.id, "employee", employeeUser.displayName),
      employeeUser,
      organization,
      otherApprover,
      otherApproverActor: actor(
        organization.id,
        otherApprover.id,
        "approver",
        otherApprover.displayName,
      ),
      owner,
      ownerActor: actor(organization.id, owner.id, "owner", owner.displayName),
    };
  }

  async function pendingCase(
    context: Awaited<ReturnType<typeof fixture>>,
    options: { employeeId?: string; requesterId?: string; workDate?: string } = {},
  ) {
    const employeeId = options.employeeId ?? context.employee.id;
    const requesterId = options.requesterId ?? context.employeeUser.id;
    const workDate = options.workDate ?? "2026-08-03";
    const [request] = await client.db
      .insert(attendanceCorrectionRequests)
      .values({
        employeeId,
        organizationId: context.organization.id,
        reason: "退勤打刻を追加",
        requestedByUserId: requesterId,
        workDate,
      })
      .returning();
    const approvalCase = await createApprovalCase(client.db, {
      employeeId,
      organizationId: context.organization.id,
      reference: {
        attendanceCorrectionRequestId: request.id,
        requestType: "attendance_correction",
      },
      snapshot: {
        attendanceDayId: null,
        baseRevision: 0,
        employeeId,
        entries: [],
        reason: request.reason,
        requestId: request.id,
        requestType: "attendance_correction",
        workDate,
      },
      submittedByUserId: requesterId,
      targetDate: workDate,
    });
    return { approvalCase, request };
  }

  it("resolves one effective route, snapshots its due date, and rejects overlaps", async () => {
    const context = await fixture();
    const route = await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      dueDays: 2,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });
    const resolved = await resolveApprovalRoute(client.db, {
      employeeId: context.employee.id,
      organizationId: context.organization.id,
      requestType: "attendance_correction",
      submittedAt: new Date("2026-08-01T00:00:00Z"),
      submittedByUserId: context.employeeUser.id,
    });

    expect(resolved).toMatchObject({
      assignedApproverUserId: context.approver.id,
      originalApproverUserId: context.approver.id,
      routeAssignmentId: route.id,
      routeReason: "department_route",
      submittedDepartmentId: context.department.id,
    });
    expect(resolved.dueAt?.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    await expect(
      createApprovalRoute(client.db, context.ownerActor, {
        approverUserId: context.otherApprover.id,
        departmentId: context.department.id,
        effectiveFrom: "2026-07-01",
        requestType: "attendance_correction",
      }),
    ).rejects.toThrow(ApprovalRouteValidationError);
  });

  it("shows approvers only their current assignments and hides all details of other cases", async () => {
    const context = await fixture();
    await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });
    const { approvalCase } = await pendingCase(context);

    const ownInbox = await listApprovalInbox(client.db, context.approverActor);
    const otherInbox = await listApprovalInbox(client.db, context.otherApproverActor);
    expect(ownInbox.items.map((item) => item.id)).toEqual([approvalCase.id]);
    expect(otherInbox).toMatchObject({ items: [], total: 0 });
    await expect(
      getApprovalCaseDetail(client.db, context.otherApproverActor, approvalCase.id),
    ).rejects.toThrow(AuthorizationError);
  });

  it("returns an assigned request atomically and prevents the target or creator from self-reviewing", async () => {
    const context = await fixture();
    await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });
    const { approvalCase, request } = await pendingCase(context);

    await reviewApprovalCase(client.db, context.approverActor, approvalCase.id, {
      action: "return",
      comment: "退勤時刻の根拠を確認してください。",
      expectedVersion: 0,
    });
    const [updatedCase] = await client.db
      .select()
      .from(approvalCases)
      .where(eq(approvalCases.id, approvalCase.id));
    const [updatedRequest] = await client.db
      .select()
      .from(attendanceCorrectionRequests)
      .where(eq(attendanceCorrectionRequests.id, request.id));
    expect(updatedCase).toMatchObject({
      reviewComment: "退勤時刻の根拠を確認してください。",
      status: "returned",
      version: 1,
    });
    expect(updatedRequest).toMatchObject({
      reviewComment: "退勤時刻の根拠を確認してください。",
      status: "returned",
    });
    await expect(
      getApprovalCaseDetail(client.db, context.approverActor, approvalCase.id),
    ).resolves.toMatchObject({
      case: { id: approvalCase.id, status: "returned" },
    });
    const resultNotifications = await client.db
      .select({ eventKey: notifications.eventKey, kind: notifications.kind })
      .from(notifications)
      .where(eq(notifications.recipientUserId, context.employeeUser.id));
    expect(resultNotifications).toEqual([
      {
        eventKey: `${approvalCase.id}:1:returned:${context.employeeUser.id}`,
        kind: "approval_returned",
      },
    ]);

    const self = await pendingCase(context, {
      employeeId: context.approverEmployee.id,
      requesterId: context.approver.id,
      workDate: "2026-08-04",
    });
    expect(self.approvalCase.assignedApproverUserId).toBeNull();
    await expect(
      reviewApprovalCase(client.db, context.approverActor, self.approvalCase.id, {
        action: "return",
        comment: "自己審査",
        expectedVersion: 0,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      reassignApprovalCases(client.db, context.ownerActor, {
        caseIds: [self.approvalCase.id],
        reason: "本人へ割り当てる誤操作",
        toApproverUserId: context.approver.id,
      }),
    ).rejects.toThrow("対象本人または代理作成者");
  });

  it("records proxy submissions separately from the target and keeps normal validation and self-review protections", async () => {
    const context = await fixture();
    await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });

    const correction = await createAttendanceCorrection(client.db, context.ownerActor, {
      employeeId: context.employee.id,
      entries: [
        { occurredAt: "2026-08-10T00:00:00.000Z", type: "clock_in" },
        { occurredAt: "2026-08-10T09:00:00.000Z", type: "clock_out" },
      ],
      proxyReason: "本人から電話で依頼を受けたため",
      reason: "出退勤の打刻を登録",
      workDate: "2026-08-10",
    });
    const [approvalCase] = await client.db
      .select()
      .from(approvalCases)
      .where(eq(approvalCases.attendanceCorrectionRequestId, correction.request.id));
    expect(approvalCase).toMatchObject({
      assignedApproverUserId: context.approver.id,
      proxyReason: "本人から電話で依頼を受けたため",
      submittedByUserId: context.owner.id,
      submittedOnBehalf: true,
      targetEmployeeId: context.employee.id,
    });
    await createApprovalEventNotifications(client.db, approvalCase, "submitted");
    await createApprovalEventNotifications(client.db, approvalCase, "submitted");
    const duplicateSafeNotifications = await client.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.entityId, approvalCase.id),
          eq(notifications.kind, "approval_submitted"),
        ),
      );
    expect(duplicateSafeNotifications).toHaveLength(1);
    expect(
      (await listOwnApprovalCases(client.db, context.employeeActor)).map((item) => item.id),
    ).toContain(approvalCase.id);
    expect(
      await getOwnApprovalCaseDetail(client.db, context.employeeActor, approvalCase.id),
    ).toMatchObject({
      case: {
        id: approvalCase.id,
        submittedOnBehalf: true,
      },
      submitterName: context.owner.displayName,
    });
    const proxyAudit = await searchAuditLogs(client.db, {
      approvalOnly: true,
      approvalRequestType: "attendance_correction",
      caseVersion: 1,
      departmentId: context.department.id,
      employeeId: context.employee.id,
      organizationId: context.organization.id,
      submittedOnBehalf: true,
    });
    expect(proxyAudit).toHaveLength(1);
    expect(proxyAudit[0]).toMatchObject({
      action: "approval_proxy_created",
      entityId: approvalCase.id,
    });
    expect(proxyAudit[0].metadata).not.toHaveProperty("proxyReason");
    expect(proxyAudit[0].metadata).not.toHaveProperty("reason");
    await expect(
      getOwnApprovalCaseDetail(client.db, context.otherApproverActor, approvalCase.id),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      reviewApprovalCase(client.db, context.ownerActor, approvalCase.id, {
        action: "approve",
        comment: "代理作成者による自己承認",
        expectedVersion: 0,
      }),
    ).rejects.toThrow(AuthorizationError);
    await reviewApprovalCase(client.db, context.approverActor, approvalCase.id, {
      action: "return",
      comment: "本人へ内容確認をお願いします。",
      expectedVersion: 0,
    });
    const proxyResultRecipients = await client.db
      .select({
        recipientUserId: notifications.recipientUserId,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.entityId, approvalCase.id),
          eq(notifications.kind, "approval_returned"),
        ),
      );
    expect(proxyResultRecipients.map((item) => item.recipientUserId).sort()).toEqual(
      [context.employeeUser.id, context.owner.id].sort(),
    );
    await expect(
      resubmitAttendanceCorrection(
        client.db,
        { ...context.ownerActor, role: "employee" },
        correction.request.id,
        {
          entries: [
            { occurredAt: "2026-08-10T00:00:00.000Z", type: "clock_in" },
            { occurredAt: "2026-08-10T10:00:00.000Z", type: "clock_out" },
          ],
          expectedCaseVersion: 1,
          reason: "役割喪失後の再申請",
          workDate: "2026-08-10",
        },
      ),
    ).rejects.toThrow(AuthorizationError);
    const resubmitted = await resubmitAttendanceCorrection(
      client.db,
      context.employeeActor,
      correction.request.id,
      {
        entries: [
          { occurredAt: "2026-08-10T00:00:00.000Z", type: "clock_in" },
          { occurredAt: "2026-08-10T10:00:00.000Z", type: "clock_out" },
        ],
        expectedCaseVersion: 1,
        reason: "本人確認後の出退勤時刻",
        workDate: "2026-08-10",
      },
    );
    expect(resubmitted.approvalCase).toMatchObject({
      currentRevision: 2,
      status: "pending",
      version: 2,
    });
    await cancelAttendanceCorrection(client.db, context.employeeActor, correction.request.id);
    const [cancelledCase] = await client.db
      .select()
      .from(approvalCases)
      .where(eq(approvalCases.id, approvalCase.id));
    expect(cancelledCase).toMatchObject({ status: "cancelled", version: 3 });

    const [otherOrganization] = await client.db
      .insert(organizations)
      .values({ name: "別組織株式会社" })
      .returning();
    const [otherEmployee] = await client.db
      .insert(employees)
      .values({
        displayName: "別組織 従業員",
        employeeNumber: "OTHER-001",
        familyName: "別組織",
        givenName: "従業員",
        organizationId: otherOrganization.id,
        status: "active",
      })
      .returning();
    await expect(
      createAttendanceCorrection(client.db, context.ownerActor, {
        employeeId: otherEmployee.id,
        entries: [
          { occurredAt: "2026-08-11T00:00:00.000Z", type: "clock_in" },
          { occurredAt: "2026-08-11T09:00:00.000Z", type: "clock_out" },
        ],
        proxyReason: "組織をまたぐ代理申請",
        reason: "許可されない申請",
        workDate: "2026-08-11",
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("revokes review permission immediately after an approver role is removed", async () => {
    const context = await fixture();
    await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });
    await pendingCase(context);
    await client.db
      .update(users)
      .set({ role: "employee" })
      .where(eq(users.id, context.approver.id));

    const demoted = {
      ...context.approverActor,
      role: "employee" as const,
    };
    await expect(listApprovalInbox(client.db, demoted)).rejects.toThrow(AuthorizationError);
    const adminInbox = await listApprovalInbox(client.db, context.ownerActor);
    expect(adminInbox.items[0]).toMatchObject({ needsReassignment: true });
  });

  it("serializes simultaneous reviews so only one current version can change state", async () => {
    const context = await fixture();
    await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });
    const { approvalCase } = await pendingCase(context, {
      workDate: "2026-08-12",
    });
    const results = await Promise.allSettled([
      reviewApprovalCase(client.db, context.approverActor, approvalCase.id, {
        action: "return",
        comment: "同時操作A",
        expectedVersion: 0,
      }),
      reviewApprovalCase(client.db, context.approverActor, approvalCase.id, {
        action: "return",
        comment: "同時操作B",
        expectedVersion: 0,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const [updated] = await client.db
      .select()
      .from(approvalCases)
      .where(eq(approvalCases.id, approvalCase.id));
    expect(updated).toMatchObject({ status: "returned", version: 1 });
  });

  it("delegates new cases during the time window and reassigns only selected pending cases", async () => {
    const context = await fixture();
    await createApprovalRoute(client.db, context.ownerActor, {
      approverUserId: context.approver.id,
      departmentId: context.department.id,
      effectiveFrom: "2026-01-01",
      requestType: "attendance_correction",
    });
    const first = await pendingCase(context, { workDate: "2026-08-05" });
    const second = await pendingCase(context, { workDate: "2026-08-06" });
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 3_600_000);
    const input = {
      delegateApproverUserId: context.otherApprover.id,
      departmentId: context.department.id,
      endsAt,
      originalApproverUserId: context.approver.id,
      reason: "休暇中の承認引継ぎ",
      requestType: "attendance_correction",
      startsAt,
    };
    const preview = await previewDelegationCases(client.db, context.ownerActor, input);
    expect(preview.count).toBe(2);

    await createApprovalDelegation(client.db, context.ownerActor, {
      ...input,
      reassignCaseIds: [first.approvalCase.id],
    });
    const reassignmentNotifications = await client.db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        recipientUserId: notifications.recipientUserId,
      })
      .from(notifications)
      .where(eq(notifications.entityId, first.approvalCase.id));
    expect(
      reassignmentNotifications
        .filter((item) => ["approval_assigned", "approval_unassigned"].includes(item.kind))
        .map(({ kind, recipientUserId }) => ({ kind, recipientUserId }))
        .sort((left, right) => left.kind.localeCompare(right.kind)),
    ).toEqual(
      [
        {
          kind: "approval_assigned",
          recipientUserId: context.otherApprover.id,
        },
        {
          kind: "approval_unassigned",
          recipientUserId: context.approver.id,
        },
      ].sort((left, right) => left.kind.localeCompare(right.kind)),
    );
    const oldPendingNotification = reassignmentNotifications.find(
      (item) => item.kind === "approval_submitted" && item.recipientUserId === context.approver.id,
    );
    const newAssignmentNotification = reassignmentNotifications.find(
      (item) =>
        item.kind === "approval_assigned" && item.recipientUserId === context.otherApprover.id,
    );
    expect(oldPendingNotification).toBeDefined();
    expect(newAssignmentNotification).toBeDefined();
    expect(
      await notificationTarget(client.db, context.approverActor, oldPendingNotification!.id),
    ).toMatchObject({ available: false, href: "/notifications" });
    expect(
      await notificationTarget(
        client.db,
        context.otherApproverActor,
        newAssignmentNotification!.id,
      ),
    ).toMatchObject({
      available: true,
      href: expect.stringContaining("/approvals/"),
    });
    const [firstAfter, secondAfter] = await Promise.all([
      client.db.query.approvalCases.findFirst({
        where: (table, { eq }) => eq(table.id, first.approvalCase.id),
      }),
      client.db.query.approvalCases.findFirst({
        where: (table, { eq }) => eq(table.id, second.approvalCase.id),
      }),
    ]);
    expect(firstAfter).toMatchObject({
      assignedApproverUserId: context.otherApprover.id,
      originalApproverUserId: context.approver.id,
      routeReason: "delegated",
    });
    expect(secondAfter).toMatchObject({
      assignedApproverUserId: context.approver.id,
      routeReason: "department_route",
    });

    const during = await pendingCase(context, { workDate: "2026-08-07" });
    expect(during.approvalCase).toMatchObject({
      assignedApproverUserId: context.otherApprover.id,
      originalApproverUserId: context.approver.id,
      routeReason: "delegated",
    });

    await client.db
      .update(approvalDelegations)
      .set({
        endsAt: new Date(Date.now() - 1_000),
        startsAt: new Date(Date.now() - 3_600_000),
      })
      .where(eq(approvalDelegations.organizationId, context.organization.id));
    const after = await pendingCase(context, { workDate: "2026-08-08" });
    expect(after.approvalCase).toMatchObject({
      assignedApproverUserId: context.approver.id,
      routeReason: "department_route",
    });
    const inbox = await listApprovalInbox(client.db, context.ownerActor);
    const delegatedCase = inbox.items.find((item) => item.id === during.approvalCase.id);
    expect(delegatedCase).toMatchObject({ needsReassignment: true });
  });
});
