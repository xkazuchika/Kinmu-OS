import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { GET as overtimeRequestsGet } from "@/app/api/overtime/requests/route";
import {
  GET as overtimeReviewGet,
  POST as overtimeReviewPost,
} from "@/app/api/overtime/reviews/[requestId]/route";
import { GET as overtimeReviewsGet } from "@/app/api/overtime/reviews/route";
import type { SessionActor } from "@/lib/authorization";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import {
  attendanceMonthPeriods,
  auditLogs,
  employees,
  notifications,
  organizations,
  overtimeRequestPolicies,
  overtimeWorkRequests,
  users,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";
import { listNotifications, markNotificationsRead, notificationTarget } from "@/lib/notifications";
import {
  activateOvertimePolicy,
  effectiveOvertimePolicy,
  previewOvertimePolicyActivation,
  saveOvertimePolicyDraft,
} from "@/lib/overtime-policies";
import {
  approveOvertimeWorkRequest,
  cancelOvertimeWorkRequest,
  createOvertimeWorkRequest,
  getOwnOvertimeWorkRequest,
  listOwnOvertimeWorkRequests,
  listOvertimeReviewRequests,
  OvertimeRequestConflictError,
  OvertimeRequestValidationError,
  previewOvertimeWorkRequest,
  rejectOvertimeWorkRequest,
} from "@/lib/overtime-requests";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("overtime request workflow", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await client.close();
  });

  async function createFixture(label: string, policyOptions: { prior?: boolean } = {}) {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: `${label}組織`, timezone: "Asia/Tokyo" })
      .returning();
    const [employeeUser, reviewer, owner] = await client.db
      .insert(users)
      .values([
        {
          displayName: `${label}従業員`,
          email: `${label.toLowerCase()}-employee@example.com`,
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
        {
          displayName: `${label}労務`,
          email: `${label.toLowerCase()}-reviewer@example.com`,
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
        {
          displayName: `${label}所有者`,
          email: `${label.toLowerCase()}-owner@example.com`,
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: `${label}-001`,
        familyName: label,
        givenName: "従業員",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
      .returning();
    await client.db.insert(workCalendarPatterns).values({
      activatedAt: new Date(),
      activatedByUserId: reviewer.id,
      effectiveFrom: "2026-07-01",
      organizationId: organization.id,
      status: "active",
    });
    await client.db.insert(workRules).values({
      dailyStandardMinutes: 480,
      effectiveFrom: "2026-07-01",
      name: "標準勤務",
      organizationId: organization.id,
      scheduledBreakMinutes: 60,
      scheduledEndTime: "18:00",
      scheduledStartTime: "09:00",
    });
    const [policy] = await client.db
      .insert(overtimeRequestPolicies)
      .values({
        activatedAt: new Date(),
        activatedByUserId: reviewer.id,
        allowedDeviationMinutes: 15,
        blockCloseOnUnresolvedDifference: true,
        effectiveFrom: "2026-08-01",
        minuteIncrement: 15,
        organizationId: organization.id,
        requirePriorApproval: policyOptions.prior ?? false,
        status: "active",
      })
      .returning();
    const actor = (user: typeof employeeUser): SessionActor => ({
      displayName: user.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: user.role,
      userId: user.id,
    });
    return {
      employee,
      employeeActor: actor(employeeUser),
      employeeUser,
      organization,
      owner,
      ownerActor: actor(owner),
      policy,
      reviewer,
      reviewerActor: actor(reviewer),
    };
  }

  it("creates, previews, and activates an effective-dated policy with optimistic locking", async () => {
    const fixture = await createFixture("POLICY");
    const draft = await saveOvertimePolicyDraft(client.db, fixture.reviewerActor, {
      allowedDeviationMinutes: 30,
      blockCloseOnUnresolvedDifference: false,
      effectiveFrom: "2026-09-01",
      minuteIncrement: 30,
      requirePriorApproval: true,
    });
    const preview = await previewOvertimePolicyActivation(
      client.db,
      fixture.reviewerActor,
      draft.id,
    );
    expect(preview).toMatchObject({ closedMonths: [], employeesAffected: 1, requestsAffected: 0 });

    const activated = await activateOvertimePolicy(
      client.db,
      fixture.reviewerActor,
      draft.id,
      draft.version,
    );
    expect(activated).toMatchObject({ status: "active", version: 1 });
    expect(
      (await effectiveOvertimePolicy(client.db, fixture.organization.id, "2026-08-31"))?.id,
    ).toBe(fixture.policy.id);
    expect(
      (await effectiveOvertimePolicy(client.db, fixture.organization.id, "2026-09-01"))?.id,
    ).toBe(activated.id);
    await expect(
      activateOvertimePolicy(client.db, fixture.reviewerActor, draft.id, draft.version),
    ).rejects.toThrow();

    const actions = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, draft.id));
    expect(actions.map((row) => row.action)).toEqual([
      "overtime_policy_created",
      "overtime_policy_activated",
    ]);
  });

  it("validates input units, calendar kinds, prior approval, next-day ranges, and overlap", async () => {
    const fixture = await createFixture("CREATE");
    const preview = await previewOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      kind: "overtime",
      plannedBreakMinutes: 0,
      startTime: "18:00",
      workDate: "2026-08-03",
    });
    expect(preview).toMatchObject({ kind: "overtime", range: { plannedMinutes: 120 } });
    await expect(
      previewOvertimeWorkRequest(client.db, fixture.employeeActor, {
        endTime: "20:00",
        plannedBreakMinutes: 0,
        startTime: "18:07",
        workDate: "2026-08-03",
      }),
    ).rejects.toThrow("15分単位");
    await expect(
      previewOvertimeWorkRequest(client.db, fixture.employeeActor, {
        endTime: "20:00",
        kind: "holiday_work",
        plannedBreakMinutes: 0,
        startTime: "18:00",
        workDate: "2026-08-03",
      }),
    ).rejects.toThrow("残業として");
    const nextDay = await previewOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "01:00",
      plannedBreakMinutes: 30,
      startTime: "23:00",
      workDate: "2026-08-03",
    });
    expect(nextDay.range).toMatchObject({ endDate: "2026-08-04", plannedMinutes: 90 });

    const created = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      kind: "overtime",
      plannedBreakMinutes: 0,
      reason: "月初処理のため",
      startTime: "18:00",
      workDate: "2026-08-03",
    });
    expect(created.request).toMatchObject({ plannedMinutes: 120, status: "pending", version: 0 });
    await expect(
      createOvertimeWorkRequest(client.db, fixture.employeeActor, {
        endTime: "21:00",
        plannedBreakMinutes: 0,
        reason: "重複する申請",
        startTime: "19:00",
        workDate: "2026-08-03",
      }),
    ).rejects.toThrow("審査待ち");
    expect(await listOwnOvertimeWorkRequests(client.db, fixture.employeeActor)).toHaveLength(1);
    expect(
      await listOvertimeReviewRequests(client.db, fixture.reviewerActor, { status: "pending" }),
    ).toHaveLength(1);

    const priorFixture = await createFixture("PRIOR", { prior: true });
    await expect(
      previewOvertimeWorkRequest(client.db, priorFixture.employeeActor, {
        endTime: "20:00",
        now: new Date("2026-08-03T09:00:00.000Z"),
        plannedBreakMinutes: 0,
        startTime: "18:00",
        workDate: "2026-08-03",
      }),
    ).rejects.toThrow("事前申請");
  });

  it("cancels only the latest pending request and protects another employee scope", async () => {
    const fixture = await createFixture("CANCEL");
    const created = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      plannedBreakMinutes: 0,
      reason: "取消テスト",
      startTime: "18:00",
      workDate: "2026-08-04",
    });
    const cancelled = await cancelOvertimeWorkRequest(
      client.db,
      fixture.employeeActor,
      created.request.id,
      0,
    );
    expect(cancelled).toMatchObject({ status: "cancelled", version: 1 });
    await expect(
      cancelOvertimeWorkRequest(client.db, fixture.employeeActor, created.request.id, 0),
    ).rejects.toBeInstanceOf(OvertimeRequestConflictError);

    const other = await createFixture("SCOPE");
    await expect(
      getOwnOvertimeWorkRequest(client.db, other.employeeActor, created.request.id),
    ).rejects.toBeInstanceOf(OvertimeRequestValidationError);
  });

  it("rejects submission, cancellation, and review for a closed month", async () => {
    const fixture = await createFixture("CLOSED");
    const created = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      plannedBreakMinutes: 0,
      reason: "締め済み月の競合確認",
      startTime: "18:00",
      workDate: "2026-08-08",
    });
    await client.db.insert(attendanceMonthPeriods).values({
      organizationId: fixture.organization.id,
      status: "closed",
      targetMonth: "2026-08",
      version: 1,
    });

    await expect(
      createOvertimeWorkRequest(client.db, fixture.employeeActor, {
        endTime: "21:00",
        plannedBreakMinutes: 0,
        reason: "締め後の新規申請",
        startTime: "20:00",
        workDate: "2026-08-09",
      }),
    ).rejects.toThrow("締め済み");
    await expect(
      cancelOvertimeWorkRequest(client.db, fixture.employeeActor, created.request.id, 0),
    ).rejects.toThrow("締め済み");
    await expect(
      approveOvertimeWorkRequest(client.db, fixture.reviewerActor, created.request.id, 0),
    ).rejects.toThrow("締め済み");
  });

  it("enforces role, organization, version, and active-session boundaries at the API", async () => {
    const fixture = await createFixture("API");
    const created = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      plannedBreakMinutes: 0,
      reason: "API境界の確認",
      startTime: "18:00",
      workDate: "2026-08-10",
    });
    const other = await createFixture("OTHER");
    const employeeSession = await createSession(client.db, fixture.employeeUser.id);
    const reviewerSession = await createSession(client.db, fixture.reviewer.id);
    const otherSession = await createSession(client.db, other.owner.id);
    const headers = (token: string) => ({
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    });

    const unauthenticated = await overtimeReviewsGet(
      new Request("http://kinmu.test/api/overtime/reviews"),
    );
    const employeeOwn = await overtimeRequestsGet(
      new Request("http://kinmu.test/api/overtime/requests", {
        headers: headers(employeeSession.token),
      }),
    );
    const employeeForbidden = await overtimeReviewsGet(
      new Request("http://kinmu.test/api/overtime/reviews", {
        headers: headers(employeeSession.token),
      }),
    );
    const crossOrganization = await overtimeReviewGet(
      new Request(`http://kinmu.test/api/overtime/reviews/${created.request.id}`, {
        headers: headers(otherSession.token),
      }),
      { params: Promise.resolve({ requestId: created.request.id }) },
    );
    const staleVersion = await overtimeReviewPost(
      new Request(`http://kinmu.test/api/overtime/reviews/${created.request.id}`, {
        body: JSON.stringify({ action: "approve", expectedVersion: 9 }),
        headers: headers(reviewerSession.token),
        method: "POST",
      }),
      { params: Promise.resolve({ requestId: created.request.id }) },
    );
    const approved = await overtimeReviewPost(
      new Request(`http://kinmu.test/api/overtime/reviews/${created.request.id}`, {
        body: JSON.stringify({ action: "approve", expectedVersion: 0 }),
        headers: headers(reviewerSession.token),
        method: "POST",
      }),
      { params: Promise.resolve({ requestId: created.request.id }) },
    );
    await client.db
      .update(users)
      .set({ status: "disabled" })
      .where(eq(users.id, fixture.reviewer.id));
    const disabledUser = await overtimeReviewsGet(
      new Request("http://kinmu.test/api/overtime/reviews", {
        headers: headers(reviewerSession.token),
      }),
    );

    expect(unauthenticated.status).toBe(401);
    expect(employeeOwn.status).toBe(200);
    expect(employeeForbidden.status).toBe(403);
    expect(crossOrganization.status).toBe(422);
    expect(staleVersion.status).toBe(409);
    expect(approved.status).toBe(200);
    expect(disabledUser.status).toBe(401);
  });

  it("approves or rejects atomically without self-review and creates audit and result notifications", async () => {
    const fixture = await createFixture("REVIEW");
    const approval = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      plannedBreakMinutes: 0,
      reason: "承認対象",
      startTime: "18:00",
      workDate: "2026-08-05",
    });
    await expect(
      approveOvertimeWorkRequest(client.db, fixture.employeeActor, approval.request.id, 0),
    ).rejects.toThrow();
    const noticesAfterFailedSelfReview = await client.db
      .select({ kind: notifications.kind })
      .from(notifications)
      .where(eq(notifications.organizationId, fixture.organization.id));
    expect(
      noticesAfterFailedSelfReview.every((notice) => notice.kind === "overtime_request_submitted"),
    ).toBe(true);
    const approved = await approveOvertimeWorkRequest(
      client.db,
      fixture.reviewerActor,
      approval.request.id,
      0,
    );
    expect(approved).toMatchObject({
      reviewerUserId: fixture.reviewer.id,
      status: "approved",
      version: 1,
    });
    await expect(
      approveOvertimeWorkRequest(client.db, fixture.ownerActor, approval.request.id, 0),
    ).rejects.toBeInstanceOf(OvertimeRequestConflictError);

    const rejection = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "21:00",
      plannedBreakMinutes: 0,
      reason: "却下対象",
      startTime: "20:00",
      workDate: "2026-08-06",
    });
    const rejected = await rejectOvertimeWorkRequest(
      client.db,
      fixture.reviewerActor,
      rejection.request.id,
      0,
      "業務調整が必要です",
    );
    expect(rejected).toMatchObject({ reviewComment: "業務調整が必要です", status: "rejected" });

    const resultNotices = await client.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, fixture.organization.id),
          eq(notifications.recipientUserId, fixture.employeeUser.id),
        ),
      );
    expect(resultNotices.map((notice) => notice.kind).sort()).toEqual([
      "overtime_request_approved",
      "overtime_request_rejected",
    ]);
    const actions = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityType, "overtime_work_request"));
    expect(actions.map((row) => row.action)).toContain("overtime_request_approved");
    expect(actions.map((row) => row.action)).toContain("overtime_request_rejected");
  });

  it("scopes notification inbox, read operations, and target routes to the current recipient and role", async () => {
    const fixture = await createFixture("NOTICE");
    const created = await createOvertimeWorkRequest(client.db, fixture.employeeActor, {
      endTime: "20:00",
      plannedBreakMinutes: 0,
      reason: "通知対象",
      startTime: "18:00",
      workDate: "2026-08-07",
    });
    const inbox = await listNotifications(client.db, fixture.reviewerActor, { limit: 1 });
    expect(inbox).toMatchObject({ unreadCount: 1 });
    expect(inbox.items[0]).toMatchObject({ entityId: created.request.id, readAt: null });
    const otherOrganization = await createFixture("NOTICE-OTHER");
    await expect(
      markNotificationsRead(client.db, fixture.employeeActor, [inbox.items[0].id]),
    ).rejects.toThrow();
    await expect(
      markNotificationsRead(client.db, otherOrganization.reviewerActor, [inbox.items[0].id]),
    ).rejects.toThrow();
    expect(
      await notificationTarget(client.db, fixture.reviewerActor, inbox.items[0].id),
    ).toMatchObject({ available: true, href: expect.stringContaining("/overtime/reviews") });
    const concurrentReads = await Promise.all([
      markNotificationsRead(client.db, fixture.reviewerActor, [inbox.items[0].id]),
      markNotificationsRead(client.db, fixture.reviewerActor, [inbox.items[0].id]),
    ]);
    expect(concurrentReads.map((result) => result.updatedCount).sort()).toEqual([0, 1]);
    expect((await listNotifications(client.db, fixture.reviewerActor)).unreadCount).toBe(0);
    await approveOvertimeWorkRequest(client.db, fixture.reviewerActor, created.request.id, 0);
    expect(
      await notificationTarget(client.db, fixture.reviewerActor, inbox.items[0].id),
    ).toMatchObject({ available: true, href: expect.stringContaining("/overtime/reviews") });

    await client.db
      .update(users)
      .set({ role: "employee" })
      .where(eq(users.id, fixture.reviewer.id));
    const demotedActor = { ...fixture.reviewerActor, role: "employee" as const };
    expect(await notificationTarget(client.db, demotedActor, inbox.items[0].id)).toMatchObject({
      available: false,
      href: "/notifications",
    });
  });
});
