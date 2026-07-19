import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  closeAttendanceMonth,
  inspectAttendanceMonth,
  listClosedAttendanceSnapshots,
} from "@/lib/attendance-closing";
import { projectOperationalAttendanceMonth } from "@/lib/attendance-operations";
import { AttendanceError, punchAttendance } from "@/lib/attendance";
import type { SessionActor } from "@/lib/authorization";
import { createDatabaseClient } from "@/lib/db/client";
import {
  absenceRecords,
  attendanceDays,
  attendanceEvents,
  dailyAttendanceSummaries,
  employees,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
  organizations,
  users,
  workCalendarDateExceptions,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("operational attendance projection", () => {
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
        daily_attendance_summaries,
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
      .values({ name: "日次状態組織", timezone: "Asia/Tokyo" })
      .returning();
    const [adminUser, employeeUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "管理者",
          email: "operations-admin@example.com",
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
        {
          displayName: "従業員",
          email: "operations-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "OPS-001",
        familyName: "状態",
        givenName: "花子",
        joinedOn: "2026-01-01",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
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
    const [leaveType] = await client.db
      .insert(leaveTypes)
      .values({
        code: "SPECIAL",
        consumesBalance: false,
        effectiveFrom: "2026-01-01",
        name: "特別休暇",
        organizationId: organization.id,
        paid: true,
      })
      .returning();
    const admin: SessionActor = {
      displayName: adminUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: adminUser.id,
    };
    const employeeActor: SessionActor = {
      displayName: employeeUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: employeeUser.id,
    };
    return { admin, adminUser, employee, employeeActor, employeeUser, leaveType, organization };
  }

  async function makeWorkday(organizationId: string, employeeId: string, date: string) {
    await client.db.insert(workCalendarDateExceptions).values({
      calendarDate: date,
      dayKind: "workday",
      employeeId,
      name: "個別勤務日",
      organizationId,
      reason: "日次状態テスト",
    });
  }

  async function approveLeave(input: {
    adminUserId: string;
    employeeId: string;
    employeeUserId: string;
    leaveType: typeof leaveTypes.$inferSelect;
    organizationId: string;
    units: number;
    workDate: string;
  }) {
    const [request] = await client.db
      .insert(leaveRequests)
      .values({
        consumesBalance: input.leaveType.consumesBalance,
        employeeId: input.employeeId,
        leaveTypeCode: input.leaveType.code,
        leaveTypeId: input.leaveType.id,
        leaveTypeName: input.leaveType.name,
        organizationId: input.organizationId,
        paid: input.leaveType.paid,
        reason: "承認済み休暇",
        requestedByUserId: input.employeeUserId,
        reviewedAt: new Date(),
        reviewerUserId: input.adminUserId,
        status: "approved",
      })
      .returning();
    await client.db.insert(leaveRequestDays).values({
      calendarSource: "employee_exception",
      requestId: request.id,
      scheduledMinutes: input.units === 2 ? 480 : 240,
      units: input.units,
      workDate: input.workDate,
    });
  }

  it("derives all operational states without adding leave minutes to worked or overtime", async () => {
    const data = await fixture();
    for (const date of ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"]) {
      await makeWorkday(data.organization.id, data.employee.id, date);
    }
    const [workedDay, openDay] = await client.db
      .insert(attendanceDays)
      .values([
        {
          employeeId: data.employee.id,
          organizationId: data.organization.id,
          scheduledMinutes: 480,
          status: "complete",
          workDate: "2026-07-14",
        },
        {
          employeeId: data.employee.id,
          organizationId: data.organization.id,
          scheduledMinutes: 480,
          status: "open",
          workDate: "2026-07-15",
        },
      ])
      .returning();
    await client.db.insert(dailyAttendanceSummaries).values({
      attendanceDayId: workedDay.id,
      breakMinutes: 60,
      overtimeMinutes: 30,
      scheduledMinutes: 480,
      status: "complete",
      workedMinutes: 510,
    });
    await client.db.insert(attendanceEvents).values([
      {
        attendanceDayId: workedDay.id,
        employeeId: data.employee.id,
        occurredAt: new Date("2026-07-14T00:00:00.000Z"),
        organizationId: data.organization.id,
        type: "clock_in",
      },
      {
        attendanceDayId: openDay.id,
        employeeId: data.employee.id,
        occurredAt: new Date("2026-07-15T00:00:00.000Z"),
        organizationId: data.organization.id,
        type: "clock_in",
      },
    ]);
    await approveLeave({
      adminUserId: data.adminUser.id,
      employeeId: data.employee.id,
      employeeUserId: data.employeeUser.id,
      leaveType: data.leaveType,
      organizationId: data.organization.id,
      units: 2,
      workDate: "2026-07-16",
    });
    await approveLeave({
      adminUserId: data.adminUser.id,
      employeeId: data.employee.id,
      employeeUserId: data.employeeUser.id,
      leaveType: data.leaveType,
      organizationId: data.organization.id,
      units: 1,
      workDate: "2026-07-17",
    });

    const rows = await projectOperationalAttendanceMonth(client.db, {
      month: "2026-07",
      organizationId: data.organization.id,
    });
    const byDate = new Map(rows.map((row) => [row.workDate, row]));
    expect(byDate.get("2026-07-13")?.operationalStatus).toBe("unresolved");
    expect(byDate.get("2026-07-14")).toMatchObject({
      operationalStatus: "worked",
      overtimeMinutes: 30,
      workedMinutes: 510,
    });
    expect(byDate.get("2026-07-15")?.operationalStatus).toBe("open_punch");
    expect(byDate.get("2026-07-16")).toMatchObject({
      leaveScheduledMinutes: 480,
      leaveUnits: 2,
      operationalStatus: "leave_full",
      overtimeMinutes: null,
      workedMinutes: null,
    });
    expect(byDate.get("2026-07-17")?.operationalStatus).toBe("unresolved");
    expect(byDate.get("2026-07-18")?.operationalStatus).toBe("non_workday");
  });

  it("rejects normal punching on an approved full-day leave", async () => {
    const data = await fixture();
    await makeWorkday(data.organization.id, data.employee.id, "2026-07-19");
    await approveLeave({
      adminUserId: data.adminUser.id,
      employeeId: data.employee.id,
      employeeUserId: data.employeeUser.id,
      leaveType: data.leaveType,
      organizationId: data.organization.id,
      units: 2,
      workDate: "2026-07-19",
    });
    await expect(
      punchAttendance(client.db, data.employeeActor, {
        occurredAt: new Date("2026-07-19T00:00:00.000Z"),
        type: "clock_in",
      }),
    ).rejects.toBeInstanceOf(AttendanceError);
  });

  it("blocks unresolved days, then snapshots fixed leave and absence details on close", async () => {
    const data = await fixture();
    for (const date of ["2026-06-01", "2026-06-02", "2026-06-03"]) {
      await makeWorkday(data.organization.id, data.employee.id, date);
    }
    await approveLeave({
      adminUserId: data.adminUser.id,
      employeeId: data.employee.id,
      employeeUserId: data.employeeUser.id,
      leaveType: data.leaveType,
      organizationId: data.organization.id,
      units: 2,
      workDate: "2026-06-01",
    });
    await client.db.insert(absenceRecords).values({
      confirmedByUserId: data.adminUser.id,
      employeeId: data.employee.id,
      organizationId: data.organization.id,
      reason: "連絡のない欠勤",
      workDate: "2026-06-02",
    });
    let inspection = await inspectAttendanceMonth(client.db, data.organization.id, "2026-06");
    expect(inspection).toMatchObject({
      blockers: { conflictingDays: 0, unresolvedDays: 1 },
      canClose: false,
    });

    const [day] = await client.db
      .insert(attendanceDays)
      .values({
        employeeId: data.employee.id,
        organizationId: data.organization.id,
        scheduledMinutes: 480,
        status: "complete",
        workDate: "2026-06-03",
      })
      .returning();
    await client.db.insert(dailyAttendanceSummaries).values({
      attendanceDayId: day.id,
      breakMinutes: 60,
      overtimeMinutes: 0,
      scheduledMinutes: 480,
      status: "complete",
      workedMinutes: 480,
    });
    inspection = await inspectAttendanceMonth(client.db, data.organization.id, "2026-06");
    expect(inspection.canClose).toBe(true);
    await closeAttendanceMonth(client.db, data.admin, { expectedVersion: 0, month: "2026-06" });
    const closed = await listClosedAttendanceSnapshots(client.db, data.organization.id, "2026-06");
    expect(closed?.rows.find((row) => row.workDate === "2026-06-01")).toMatchObject({
      calendarSource: "employee_exception",
      leaveTypeCode: "SPECIAL",
      leaveTypeName: "特別休暇",
      leaveUnits: 2,
      operationalStatus: "leave_full",
    });
    expect(closed?.rows.find((row) => row.workDate === "2026-06-02")).toMatchObject({
      absenceReason: "連絡のない欠勤",
      operationalStatus: "absence",
    });
  });
});
