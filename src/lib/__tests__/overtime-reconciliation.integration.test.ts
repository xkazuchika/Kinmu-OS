import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { SessionActor } from "@/lib/authorization";
import {
  closeAttendanceMonth,
  getAttendanceMonthStatus,
  inspectAttendanceMonth,
} from "@/lib/attendance-closing";
import { projectOperationalAttendanceMonth } from "@/lib/attendance-operations";
import { listManagedAttendance } from "@/lib/attendance";
import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceDays,
  attendanceMonthDaySnapshots,
  dailyAttendanceSummaries,
  employees,
  organizations,
  overtimeRequestPolicies,
  overtimeWorkRequests,
  users,
  workCalendarPatterns,
} from "@/lib/db/schema";
import {
  approveOvertimeWorkRequest,
  cancelOvertimeWorkRequest,
  createOvertimeWorkRequest,
} from "@/lib/overtime-requests";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("overtime reconciliation and monthly closing", () => {
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

  async function fixture(input: { blockClose?: boolean; month?: string } = {}) {
    const month = input.month ?? "2026-06";
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "差異組織", timezone: "Asia/Tokyo" })
      .returning();
    const [employeeUser, reviewer] = await client.db
      .insert(users)
      .values([
        {
          displayName: "差異 従業員",
          email: `reconciliation-employee-${organization.id}@example.com`,
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
        {
          displayName: "差異 管理者",
          email: `reconciliation-reviewer-${organization.id}@example.com`,
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "REC-001",
        familyName: "差異",
        givenName: "従業員",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
      .returning();
    await client.db.insert(workCalendarPatterns).values({
      activatedAt: new Date(),
      activatedByUserId: reviewer.id,
      effectiveFrom: `${month}-01`,
      fridayWorkday: false,
      mondayWorkday: false,
      organizationId: organization.id,
      saturdayWorkday: false,
      status: "active",
      sundayWorkday: false,
      thursdayWorkday: false,
      tuesdayWorkday: false,
      wednesdayWorkday: false,
    });
    const [policy] = await client.db
      .insert(overtimeRequestPolicies)
      .values({
        activatedAt: new Date(),
        activatedByUserId: reviewer.id,
        allowedDeviationMinutes: 15,
        blockCloseOnUnresolvedDifference: input.blockClose ?? true,
        effectiveFrom: `${month}-01`,
        organizationId: organization.id,
        requirePriorApproval: false,
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
      month,
      organization,
      policy,
      reviewer,
      reviewerActor: actor(reviewer),
    };
  }

  async function approvedRequest(
    data: Awaited<ReturnType<typeof fixture>>,
    input: { endHour: number; minutes: number; startHour: number; workDate: string },
  ) {
    const start = new Date(
      `${input.workDate}T${String(input.startHour).padStart(2, "0")}:00:00.000Z`,
    );
    const end = new Date(`${input.workDate}T${String(input.endHour).padStart(2, "0")}:00:00.000Z`);
    const [request] = await client.db
      .insert(overtimeWorkRequests)
      .values({
        employeeId: data.employee.id,
        kind: "holiday_work",
        organizationId: data.organization.id,
        plannedEndAt: end,
        plannedMinutes: input.minutes,
        plannedStartAt: start,
        policyId: data.policy.id,
        reason: "休日作業",
        requestedByUserId: data.employeeUser.id,
        reviewedAt: new Date(),
        reviewerUserId: data.reviewer.id,
        status: "approved",
        workDate: input.workDate,
      })
      .returning();
    return request;
  }

  async function attendance(
    data: Awaited<ReturnType<typeof fixture>>,
    input: { overtime?: number; workDate: string; worked: number },
  ) {
    const [day] = await client.db
      .insert(attendanceDays)
      .values({
        employeeId: data.employee.id,
        organizationId: data.organization.id,
        scheduledMinutes: 0,
        status: "complete",
        workDate: input.workDate,
      })
      .returning();
    await client.db.insert(dailyAttendanceSummaries).values({
      attendanceDayId: day.id,
      overtimeMinutes: input.overtime ?? input.worked,
      scheduledMinutes: 0,
      status: "complete",
      workedMinutes: input.worked,
    });
    return day;
  }

  it("recalculates approved, under, exceeded, missing, unapproved, and multiple-request results", async () => {
    const data = await fixture();
    await attendance(data, { workDate: "2026-06-06", worked: 120 });
    await approvedRequest(data, { endHour: 2, minutes: 120, startHour: 0, workDate: "2026-06-06" });
    await attendance(data, { workDate: "2026-06-07", worked: 160 });
    await approvedRequest(data, { endHour: 2, minutes: 120, startHour: 0, workDate: "2026-06-07" });
    await attendance(data, { workDate: "2026-06-13", worked: 80 });
    await approvedRequest(data, { endHour: 2, minutes: 120, startHour: 0, workDate: "2026-06-13" });
    await approvedRequest(data, { endHour: 2, minutes: 120, startHour: 0, workDate: "2026-06-14" });
    await attendance(data, { workDate: "2026-06-20", worked: 60 });
    await attendance(data, { workDate: "2026-06-21", worked: 120 });
    const first = await approvedRequest(data, {
      endHour: 1,
      minutes: 60,
      startHour: 0,
      workDate: "2026-06-21",
    });
    const second = await approvedRequest(data, {
      endHour: 3,
      minutes: 60,
      startHour: 2,
      workDate: "2026-06-21",
    });

    const projected = await projectOperationalAttendanceMonth(client.db, {
      month: data.month,
      organizationId: data.organization.id,
    });
    const byDate = new Map(projected.map((day) => [day.workDate, day]));
    expect(byDate.get("2026-06-06")).toMatchObject({
      overtimeActualMinutes: 120,
      overtimeDifferenceMinutes: 0,
      overtimeReconciliationStatus: "within_request",
      overtimeRequestedMinutes: 120,
      workedMinutes: 120,
    });
    expect(byDate.get("2026-06-07")?.overtimeReconciliationStatus).toBe("exceeded_request");
    expect(byDate.get("2026-06-13")?.overtimeReconciliationStatus).toBe("under_request");
    expect(byDate.get("2026-06-14")?.overtimeReconciliationStatus).toBe("no_actual");
    expect(byDate.get("2026-06-20")?.overtimeReconciliationStatus).toBe("unapproved_actual");
    expect(byDate.get("2026-06-21")).toMatchObject({
      overtimeReconciliationStatus: "within_request",
      overtimeRequestIds: [first.id, second.id],
      overtimeRequestedMinutes: 120,
    });

    const day = byDate.get("2026-06-06")!;
    await client.db
      .update(dailyAttendanceSummaries)
      .set({ workedMinutes: 160 })
      .where(eq(dailyAttendanceSummaries.attendanceDayId, day.attendanceDayId!));
    const recalculated = await projectOperationalAttendanceMonth(client.db, {
      month: data.month,
      organizationId: data.organization.id,
    });
    expect(recalculated.find((row) => row.workDate === "2026-06-06")).toMatchObject({
      overtimeActualMinutes: 160,
      overtimeReconciliationStatus: "exceeded_request",
      workedMinutes: 160,
    });
  });

  it("always blocks pending requests and only blocks configured unresolved differences", async () => {
    const blocking = await fixture({ blockClose: true });
    const pending = await client.db
      .insert(overtimeWorkRequests)
      .values({
        employeeId: blocking.employee.id,
        kind: "holiday_work",
        organizationId: blocking.organization.id,
        plannedEndAt: new Date("2026-06-08T02:00:00.000Z"),
        plannedMinutes: 120,
        plannedStartAt: new Date("2026-06-08T00:00:00.000Z"),
        policyId: blocking.policy.id,
        reason: "審査待ち",
        requestedByUserId: blocking.employeeUser.id,
        workDate: "2026-06-08",
      })
      .returning();
    expect(
      (await inspectAttendanceMonth(client.db, blocking.organization.id, blocking.month)).blockers,
    ).toMatchObject({ pendingOvertimeRequests: 1 });
    await client.db
      .update(overtimeWorkRequests)
      .set({
        reviewedAt: new Date(),
        reviewerUserId: blocking.reviewer.id,
        status: "approved",
      })
      .where(eq(overtimeWorkRequests.id, pending[0].id));
    const blocked = await inspectAttendanceMonth(
      client.db,
      blocking.organization.id,
      blocking.month,
    );
    expect(blocked.blockers).toMatchObject({ overtimeNoActual: 1, pendingOvertimeRequests: 0 });
    expect(blocked.canClose).toBe(false);

    const advisory = await fixture({ blockClose: false });
    await approvedRequest(advisory, {
      endHour: 2,
      minutes: 120,
      startHour: 0,
      workDate: "2026-06-09",
    });
    const allowed = await inspectAttendanceMonth(
      client.db,
      advisory.organization.id,
      advisory.month,
    );
    expect(allowed.blockers.overtimeNoActual).toBe(0);
    expect(allowed.canClose).toBe(true);
  });

  it("freezes reconciliation in a close revision and reads the snapshot after current values change", async () => {
    const data = await fixture({ blockClose: true });
    const day = await attendance(data, { workDate: "2026-06-06", worked: 120 });
    const request = await approvedRequest(data, {
      endHour: 2,
      minutes: 120,
      startHour: 0,
      workDate: "2026-06-06",
    });
    expect(
      (await inspectAttendanceMonth(client.db, data.organization.id, data.month)).canClose,
    ).toBe(true);
    const period = await closeAttendanceMonth(client.db, data.reviewerActor, {
      expectedVersion: 0,
      month: data.month,
    });
    expect(period.status).toBe("closed");
    const [snapshot] = await client.db
      .select()
      .from(attendanceMonthDaySnapshots)
      .where(eq(attendanceMonthDaySnapshots.workDate, "2026-06-06"));
    expect(snapshot).toMatchObject({
      overtimeActualMinutes: 120,
      overtimeDifferenceMinutes: 0,
      overtimePolicyId: data.policy.id,
      overtimeReconciliationStatus: "within_request",
      overtimeRequestIds: [request.id],
      overtimeRequestedMinutes: 120,
    });

    await client.db
      .update(dailyAttendanceSummaries)
      .set({ workedMinutes: 240 })
      .where(eq(dailyAttendanceSummaries.attendanceDayId, day.id));
    const rows = await listManagedAttendance(client.db, {
      month: data.month,
      organizationId: data.organization.id,
    });
    expect(rows.find((row) => row.workDate === "2026-06-06")).toMatchObject({
      overtimeActualMinutes: 120,
      overtimeReconciliationStatus: "within_request",
      workedMinutes: 120,
    });
  });

  it("serializes review and closing so the revision never contains a pending request", async () => {
    const data = await fixture({ blockClose: false });
    const [request] = await client.db
      .insert(overtimeWorkRequests)
      .values({
        employeeId: data.employee.id,
        kind: "holiday_work",
        organizationId: data.organization.id,
        plannedEndAt: new Date("2026-06-10T02:00:00.000Z"),
        plannedMinutes: 120,
        plannedStartAt: new Date("2026-06-10T00:00:00.000Z"),
        policyId: data.policy.id,
        reason: "同時処理",
        requestedByUserId: data.employeeUser.id,
        workDate: "2026-06-10",
      })
      .returning();
    const results = await Promise.allSettled([
      approveOvertimeWorkRequest(client.db, data.reviewerActor, request.id, 0),
      closeAttendanceMonth(client.db, data.reviewerActor, {
        expectedVersion: 0,
        month: data.month,
      }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const [current] = await client.db
      .select()
      .from(overtimeWorkRequests)
      .where(eq(overtimeWorkRequests.id, request.id));
    const inspection = await inspectAttendanceMonth(client.db, data.organization.id, data.month);
    expect(current.status).not.toBe("pending");
    expect(inspection.blockers.pendingOvertimeRequests).toBe(0);
  });

  it("serializes submission and closing so exactly one conflicting operation succeeds", async () => {
    const data = await fixture({ blockClose: false });
    const results = await Promise.allSettled([
      createOvertimeWorkRequest(client.db, data.employeeActor, {
        endTime: "10:00",
        kind: "holiday_work",
        plannedBreakMinutes: 0,
        reason: "締め処理と同時に提出する申請",
        startTime: "09:00",
        workDate: "2026-06-11",
      }),
      closeAttendanceMonth(client.db, data.reviewerActor, {
        expectedVersion: 0,
        month: data.month,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const requests = await client.db
      .select({ status: overtimeWorkRequests.status })
      .from(overtimeWorkRequests);
    const inspection = await inspectAttendanceMonth(client.db, data.organization.id, data.month);
    const period = await getAttendanceMonthStatus(client.db, data.organization.id, data.month);
    if (requests.length === 1) {
      expect(requests[0].status).toBe("pending");
      expect(period.status).toBe("open");
      expect(inspection.blockers.pendingOvertimeRequests).toBe(1);
    } else {
      expect(period.status).toBe("closed");
      expect(inspection.blockers.pendingOvertimeRequests).toBe(0);
    }
  });

  it("serializes cancellation and closing without leaving a pending request", async () => {
    const data = await fixture({ blockClose: false });
    const created = await createOvertimeWorkRequest(client.db, data.employeeActor, {
      endTime: "10:00",
      kind: "holiday_work",
      plannedBreakMinutes: 0,
      reason: "締め処理と同時に取り消す申請",
      startTime: "09:00",
      workDate: "2026-06-12",
    });
    const results = await Promise.allSettled([
      cancelOvertimeWorkRequest(client.db, data.employeeActor, created.request.id, 0),
      closeAttendanceMonth(client.db, data.reviewerActor, {
        expectedVersion: 0,
        month: data.month,
      }),
    ]);
    expect(results[0].status).toBe("fulfilled");

    const [request] = await client.db
      .select({ status: overtimeWorkRequests.status })
      .from(overtimeWorkRequests)
      .where(eq(overtimeWorkRequests.id, created.request.id));
    const inspection = await inspectAttendanceMonth(client.db, data.organization.id, data.month);
    const period = await getAttendanceMonthStatus(client.db, data.organization.id, data.month);
    expect(request.status).toBe("cancelled");
    expect(inspection.blockers.pendingOvertimeRequests).toBe(0);
    if (results[1].status === "fulfilled") {
      expect(period.status).toBe("closed");
    } else {
      expect(period.status).toBe("open");
    }
  });
});
