import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { AttendanceClosingConflictError } from "@/lib/attendance-closing";
import type { SessionActor } from "@/lib/authorization";
import { createDatabaseClient } from "@/lib/db/client";
import {
  absenceRecords,
  attendanceDays,
  attendanceEvents,
  attendanceMonthPeriods,
  employees,
  leaveRequests,
  organizations,
  users,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";
import {
  createLeaveType,
  getLeaveBalance,
  grantLeave,
  LeaveLedgerValidationError,
} from "@/lib/leave-ledger";
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  confirmAbsence,
  createLeaveRequest,
  getLeaveReviewDetail,
  LeaveRequestValidationError,
  previewLeaveRequest,
  rejectLeaveRequest,
} from "@/lib/leave-requests";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("leave request review and absence", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        absence_records,
        leave_transactions,
        leave_grant_lots,
        leave_request_days,
        leave_requests,
        leave_balance_accounts,
        leave_types,
        attendance_events,
        attendance_days,
        attendance_month_day_snapshots,
        attendance_month_revisions,
        attendance_month_periods,
        work_calendar_date_exceptions,
        work_calendar_patterns,
        work_rules,
        employees,
        users,
        organizations
      CASCADE
    `);
  });

  afterAll(async () => {
    await client.close();
  });

  async function fixture() {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "休暇申請組織", timezone: "Asia/Tokyo" })
      .returning();
    const [adminUser, employeeUser, employeeAdminUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "審査者",
          email: "review-admin@example.com",
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
        {
          displayName: "申請者",
          email: "request-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
        {
          displayName: "従業員兼管理者",
          email: "self-review@example.com",
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
      ])
      .returning();
    const [employee, employeeAdmin] = await client.db
      .insert(employees)
      .values([
        {
          employeeNumber: "REQ-001",
          familyName: "申請",
          givenName: "花子",
          joinedOn: "2026-04-01",
          organizationId: organization.id,
          status: "active",
          userId: employeeUser.id,
        },
        {
          employeeNumber: "REQ-002",
          familyName: "兼務",
          givenName: "太郎",
          joinedOn: "2026-04-01",
          organizationId: organization.id,
          status: "active",
          userId: employeeAdminUser.id,
        },
      ])
      .returning();
    await client.db.insert(workRules).values({
      dailyStandardMinutes: 480,
      effectiveFrom: "2026-01-01",
      name: "標準勤務",
      organizationId: organization.id,
      scheduledBreakMinutes: 60,
      scheduledEndTime: "18:00",
      scheduledStartTime: "09:00",
    });
    await client.db.insert(workCalendarPatterns).values({
      activatedAt: new Date(),
      activatedByUserId: adminUser.id,
      effectiveFrom: "2026-01-01",
      organizationId: organization.id,
      status: "active",
    });
    const admin: SessionActor = {
      displayName: adminUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "hr_admin",
      userId: adminUser.id,
    };
    const employeeActor: SessionActor = {
      displayName: employeeUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: employeeUser.id,
    };
    const employeeAdminActor: SessionActor = {
      displayName: employeeAdminUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "hr_admin",
      userId: employeeAdminUser.id,
    };
    const leaveType = await createLeaveType(client.db, admin, {
      code: "PAID",
      consumesBalance: true,
      effectiveFrom: "2026-01-01",
      name: "年次有給休暇",
      paid: true,
      requestable: true,
    });
    await grantLeave(client.db, admin, {
      employeeId: employee.id,
      expiresOn: "2027-03-31",
      grantedOn: "2026-04-01",
      leaveTypeId: leaveType.id,
      reason: "年度付与",
      units: 20,
    });
    await grantLeave(client.db, admin, {
      employeeId: employeeAdmin.id,
      expiresOn: "2027-03-31",
      grantedOn: "2026-04-01",
      leaveTypeId: leaveType.id,
      reason: "年度付与",
      units: 20,
    });
    return {
      admin,
      employee,
      employeeActor,
      employeeAdmin,
      employeeAdminActor,
      leaveType,
      organization,
    };
  }

  it("previews only scheduled workdays and reserves full-day or half-day units", async () => {
    const { employeeActor, leaveType } = await fixture();
    const preview = await previewLeaveRequest(client.db, employeeActor, {
      from: "2026-07-17",
      leaveTypeId: leaveType.id,
      to: "2026-07-20",
      unit: "full_day",
    });
    expect(preview.included.map((day) => day.workDate)).toEqual(["2026-07-17", "2026-07-20"]);
    expect(preview.excluded.map((day) => day.workDate)).toEqual(["2026-07-18", "2026-07-19"]);
    expect(preview).toMatchObject({ afterAvailableUnits: 16, requiredUnits: 4 });

    const created = await createLeaveRequest(client.db, employeeActor, {
      from: "2026-07-21",
      leaveTypeId: leaveType.id,
      reason: "通院のため",
      to: "2026-07-21",
      unit: "half_day",
    });
    expect(created.request.status).toBe("pending");
    expect(created.included[0]).toMatchObject({ scheduledMinutes: 240, units: 1 });
  });

  it("lets the owner cancel only their open pending request and releases the reservation", async () => {
    const { employee, employeeActor, leaveType, organization } = await fixture();
    const created = await createLeaveRequest(client.db, employeeActor, {
      from: "2026-07-20",
      leaveTypeId: leaveType.id,
      reason: "私用のため",
      to: "2026-07-20",
      unit: "full_day",
    });
    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-07-20",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ availableUnits: 18, pendingUnits: 2 });
    await expect(
      cancelLeaveRequest(client.db, employeeActor, created.request.id),
    ).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-07-20",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ availableUnits: 20, pendingUnits: 0 });
    await expect(
      cancelLeaveRequest(client.db, employeeActor, created.request.id),
    ).rejects.toBeInstanceOf(LeaveRequestValidationError);
  });

  it("approves atomically, consumes balance by request day, and exposes the review diff", async () => {
    const { admin, employee, employeeActor, leaveType, organization } = await fixture();
    const created = await createLeaveRequest(client.db, employeeActor, {
      from: "2026-07-20",
      leaveTypeId: leaveType.id,
      reason: "家族行事のため",
      to: "2026-07-21",
      unit: "full_day",
    });
    await expect(getLeaveReviewDetail(client.db, admin, created.request.id)).resolves.toMatchObject(
      {
        days: [expect.objectContaining({ units: 2 }), expect.objectContaining({ units: 2 })],
        punches: [],
        request: expect.objectContaining({ status: "pending" }),
      },
    );
    await expect(approveLeaveRequest(client.db, admin, created.request.id)).resolves.toMatchObject({
      status: "approved",
    });
    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-07-21",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ availableUnits: 16, pendingUnits: 0 });
  });

  it("locks multiple request months in order and approves only their scheduled workdays", async () => {
    const { admin, employee, employeeActor, leaveType, organization } = await fixture();
    const created = await createLeaveRequest(client.db, employeeActor, {
      from: "2026-07-31",
      leaveTypeId: leaveType.id,
      reason: "月をまたぐ休暇",
      to: "2026-08-03",
      unit: "full_day",
    });

    await expect(getLeaveReviewDetail(client.db, admin, created.request.id)).resolves.toMatchObject(
      {
        days: [
          expect.objectContaining({ workDate: "2026-07-31" }),
          expect.objectContaining({ workDate: "2026-08-03" }),
        ],
      },
    );
    await expect(approveLeaveRequest(client.db, admin, created.request.id)).resolves.toMatchObject({
      status: "approved",
    });
    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-08-03",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ availableUnits: 16, pendingUnits: 0 });
  });

  it("rejects self approval, blank rejection, and a full-day request that conflicts with punches", async () => {
    const { admin, employee, employeeActor, employeeAdminActor, leaveType, organization } =
      await fixture();
    const selfRequest = await createLeaveRequest(client.db, employeeAdminActor, {
      from: "2026-07-20",
      leaveTypeId: leaveType.id,
      reason: "自己申請",
      to: "2026-07-20",
      unit: "full_day",
    });
    await expect(
      approveLeaveRequest(client.db, employeeAdminActor, selfRequest.request.id),
    ).rejects.toThrow("自分の休暇申請は承認できません");

    const punchedRequest = await createLeaveRequest(client.db, employeeActor, {
      from: "2026-07-22",
      leaveTypeId: leaveType.id,
      reason: "打刻競合",
      to: "2026-07-22",
      unit: "full_day",
    });
    const [day] = await client.db
      .insert(attendanceDays)
      .values({
        employeeId: employee.id,
        organizationId: organization.id,
        workDate: "2026-07-22",
      })
      .returning();
    await client.db.insert(attendanceEvents).values({
      attendanceDayId: day.id,
      employeeId: employee.id,
      occurredAt: new Date("2026-07-22T00:00:00.000Z"),
      organizationId: organization.id,
      type: "clock_in",
    });
    await expect(approveLeaveRequest(client.db, admin, punchedRequest.request.id)).rejects.toThrow(
      "打刻があるため",
    );
    await expect(
      rejectLeaveRequest(client.db, admin, punchedRequest.request.id, ""),
    ).rejects.toBeInstanceOf(LeaveRequestValidationError);
    await expect(
      rejectLeaveRequest(client.db, admin, punchedRequest.request.id, "打刻済みのため却下"),
    ).resolves.toMatchObject({ status: "rejected" });
  });

  it("keeps a request pending when the balance becomes insufficient before approval", async () => {
    const { admin, employee, employeeActor, leaveType } = await fixture();
    const created = await createLeaveRequest(client.db, employeeActor, {
      from: "2026-07-20",
      leaveTypeId: leaveType.id,
      reason: "残高競合",
      to: "2026-07-20",
      unit: "full_day",
    });
    await client.db.execute(sql`
      UPDATE leave_transactions
      SET units = units
      WHERE false
    `);
    const account = await getLeaveBalance(client.db, {
      asOf: "2026-07-20",
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      organizationId: admin.organizationId,
    });
    await client.db.execute(sql`
      INSERT INTO leave_transactions (
        account_id,
        organization_id,
        employee_id,
        leave_type_id,
        grant_lot_id,
        kind,
        units,
        effective_on,
        reason,
        created_by_user_id
      )
      SELECT
        ${account.accountId},
        ${admin.organizationId},
        ${employee.id},
        ${leaveType.id},
        id,
        'adjustment',
        -19,
        '2026-07-19',
        '承認前の別調整',
        ${admin.userId}
      FROM leave_grant_lots
      WHERE account_id = ${account.accountId}
      LIMIT 1
    `);
    await expect(approveLeaveRequest(client.db, admin, created.request.id)).rejects.toBeInstanceOf(
      LeaveLedgerValidationError,
    );
    const [preserved] = await client.db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.id, created.request.id));
    expect(preserved.status).toBe("pending");
  });

  it("confirms only an unresolved past workday absence and protects a closed month", async () => {
    const { admin, employee, organization } = await fixture();
    await expect(
      confirmAbsence(client.db, admin, {
        employeeId: employee.id,
        reason: "連絡のない欠勤",
        workDate: "2026-07-17",
      }),
    ).resolves.toMatchObject({ reason: "連絡のない欠勤", workDate: "2026-07-17" });
    await expect(client.db.select().from(absenceRecords)).resolves.toHaveLength(1);

    await client.db.insert(attendanceMonthPeriods).values({
      currentRevision: 1,
      nextRevision: 2,
      organizationId: organization.id,
      status: "closed",
      targetMonth: "2026-06",
    });
    await expect(
      confirmAbsence(client.db, admin, {
        employeeId: employee.id,
        reason: "締め済み",
        workDate: "2026-06-30",
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingConflictError);
  });
});
