import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AttendanceClosingConflictError,
  AttendanceClosingValidationError,
  closeAttendanceMonth,
  getAttendanceMonthStatus,
  inspectAttendanceMonth,
  listClosedAttendanceSnapshots,
  reopenAttendanceMonth,
} from "@/lib/attendance-closing";
import { GET as closingGet, POST as closingPost } from "@/app/api/attendance/closing/route";
import { POST as correctionPost } from "@/app/api/attendance/corrections/route";
import { GET as exportGet } from "@/app/api/exports/[kind]/route";
import { getMonthlyAttendance, listManagedAttendance, punchAttendance } from "@/lib/attendance";
import {
  createAttendanceCorrection,
  reviewAttendanceCorrection,
} from "@/lib/attendance-corrections";
import type { SessionActor } from "@/lib/authorization";
import { AuthorizationError } from "@/lib/authorization";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import {
  attendanceCorrectionRequests,
  attendanceDays,
  attendanceEvents,
  attendanceMonthDaySnapshots,
  attendanceMonthPeriods,
  attendanceMonthRevisions,
  auditLogs,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
  organizations,
  users,
  workRules,
} from "@/lib/db/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("monthly attendance closing", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
    await client.close();
  });

  async function fixture() {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "月次締め株式会社", timezone: "Asia/Tokyo" })
      .returning();
    const [manager, employeeUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "締め 管理者",
          email: "closing-manager@example.com",
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
        {
          displayName: "勤務 花子",
          email: "closing-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        displayName: "勤務 花子",
        employeeNumber: "CLS-001",
        familyName: "勤務",
        givenName: "花子",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "OPS", name: "業務部", organizationId: organization.id })
      .returning();
    await client.db.insert(employeeDepartments).values({
      departmentId: department.id,
      employeeId: employee.id,
      isPrimary: true,
      startedOn: "2026-01-01",
    });
    const [rule] = await client.db
      .insert(workRules)
      .values({
        dailyStandardMinutes: 480,
        effectiveFrom: "2026-01-01",
        name: "標準勤務",
        organizationId: organization.id,
        scheduledBreakMinutes: 60,
        scheduledEndTime: "18:00",
        scheduledStartTime: "09:00",
      })
      .returning();
    const [day] = await client.db
      .insert(attendanceDays)
      .values({
        employeeId: employee.id,
        organizationId: organization.id,
        scheduledMinutes: 480,
        status: "complete",
        workDate: "2026-06-15",
        workRuleId: rule.id,
      })
      .returning();
    await client.db.insert(dailyAttendanceSummaries).values({
      attendanceDayId: day.id,
      breakMinutes: 60,
      overtimeMinutes: 30,
      scheduledMinutes: 480,
      status: "complete",
      workedMinutes: 510,
    });
    const events = await client.db
      .insert(attendanceEvents)
      .values([
        {
          attendanceDayId: day.id,
          employeeId: employee.id,
          occurredAt: new Date("2026-06-15T00:00:00.000Z"),
          organizationId: organization.id,
          recordedByUserId: employeeUser.id,
          type: "clock_in",
        },
        {
          attendanceDayId: day.id,
          employeeId: employee.id,
          occurredAt: new Date("2026-06-15T09:30:00.000Z"),
          organizationId: organization.id,
          recordedByUserId: employeeUser.id,
          type: "clock_out",
        },
      ])
      .returning();
    const managerActor: SessionActor = {
      displayName: manager.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "hr_admin",
      userId: manager.id,
    };
    const employeeActor: SessionActor = {
      displayName: employeeUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: employeeUser.id,
    };
    return { day, department, employee, employeeActor, events, managerActor, organization, rule };
  }

  it("reports all blockers and does not auto-close an existing month", async () => {
    const data = await fixture();
    const [openDay] = await client.db
      .insert(attendanceDays)
      .values({
        employeeId: data.employee.id,
        organizationId: data.organization.id,
        status: "open",
        workDate: "2026-06-16",
      })
      .returning();
    await client.db.insert(attendanceCorrectionRequests).values({
      attendanceDayId: data.day.id,
      employeeId: data.employee.id,
      organizationId: data.organization.id,
      reason: "退勤時刻を修正したいです",
      requestedByUserId: data.employeeActor.userId,
      workDate: data.day.workDate,
    });
    await client.db
      .update(attendanceDays)
      .set({ status: "complete" })
      .where(eq(attendanceDays.id, openDay.id));

    const inspection = await inspectAttendanceMonth(client.db, data.organization.id, "2026-06");
    expect(inspection).toMatchObject({
      blockers: { invalidDays: 1, openDays: 0, pendingCorrections: 1 },
      canClose: false,
    });
    expect(
      await getAttendanceMonthStatus(client.db, data.organization.id, "2026-06"),
    ).toMatchObject({ status: "open", version: 0 });
    expect(await client.db.select().from(attendanceMonthPeriods)).toHaveLength(0);
    await expect(
      closeAttendanceMonth(client.db, data.managerActor, {
        expectedVersion: 0,
        month: "2026-06",
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingValidationError);
    expect(await client.db.select().from(attendanceMonthPeriods)).toHaveLength(0);
  });

  it("closes, preserves the snapshot, reopens with a reason, and recloses as a new revision", async () => {
    const data = await fixture();
    const closed = await closeAttendanceMonth(client.db, data.managerActor, {
      expectedVersion: 0,
      month: "2026-06",
    });
    expect(closed).toMatchObject({ currentRevision: 1, status: "closed", version: 1 });
    const firstSnapshot = await listClosedAttendanceSnapshots(
      client.db,
      data.organization.id,
      "2026-06",
    );
    expect(firstSnapshot?.rows[0]).toMatchObject({
      departmentName: "業務部",
      displayName: "勤務 花子",
      overtimeMinutes: 30,
      workedMinutes: 510,
      workRuleName: "標準勤務",
    });
    expect(await getMonthlyAttendance(client.db, data.employeeActor, "2026-06")).toMatchObject({
      closure: { currentRevision: 1, status: "closed" },
      days: [{ workedMinutes: 510 }],
    });
    expect(
      await listManagedAttendance(client.db, {
        month: "2026-06",
        organizationId: data.organization.id,
      }),
    ).toMatchObject([{ departmentName: "業務部", displayName: "勤務 花子" }]);
    await expect(
      punchAttendance(client.db, data.employeeActor, {
        occurredAt: new Date("2026-06-16T00:00:00.000Z"),
        type: "clock_in",
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingConflictError);

    await client.db
      .update(employees)
      .set({ displayName: "変更後の氏名" })
      .where(eq(employees.id, data.employee.id));
    await client.db
      .update(departments)
      .set({ name: "変更後の部署" })
      .where(eq(departments.id, data.department.id));
    await client.db
      .update(workRules)
      .set({ name: "変更後の勤務ルール" })
      .where(eq(workRules.id, data.rule.id));
    await client.db
      .update(dailyAttendanceSummaries)
      .set({ overtimeMinutes: 60, workedMinutes: 540 })
      .where(eq(dailyAttendanceSummaries.attendanceDayId, data.day.id));
    expect(
      (await listClosedAttendanceSnapshots(client.db, data.organization.id, "2026-06"))?.rows[0],
    ).toMatchObject({
      departmentName: "業務部",
      displayName: "勤務 花子",
      overtimeMinutes: 30,
      workedMinutes: 510,
      workRuleName: "標準勤務",
    });
    const managerSession = await createSession(client.db, data.managerActor.userId);
    const exported = await exportGet(
      new Request("http://localhost/api/exports/attendance?month=2026-06", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${managerSession.token}` },
      }),
      { params: Promise.resolve({ kind: "attendance" }) },
    );
    const exportedCsv = await exported.text();
    expect(exported.status).toBe(200);
    expect(exportedCsv).toContain("勤務 花子");
    expect(exportedCsv).not.toContain("変更後の氏名");
    expect(exportedCsv).toContain("締め済み");
    expect(exportedCsv).toContain(",1\r\n");

    await expect(
      reopenAttendanceMonth(client.db, data.managerActor, {
        expectedVersion: 1,
        month: "2026-06",
        reason: "短い",
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingValidationError);
    const reopened = await reopenAttendanceMonth(client.db, data.managerActor, {
      expectedVersion: 1,
      month: "2026-06",
      reason: "従業員から勤務時間の修正依頼があったため",
    });
    expect(reopened).toMatchObject({ currentRevision: null, status: "open", version: 2 });
    expect(
      await listClosedAttendanceSnapshots(client.db, data.organization.id, "2026-06"),
    ).toBeNull();

    const reclosed = await closeAttendanceMonth(client.db, data.managerActor, {
      expectedVersion: 2,
      month: "2026-06",
    });
    expect(reclosed).toMatchObject({ currentRevision: 2, status: "closed", version: 3 });
    expect(
      (await listClosedAttendanceSnapshots(client.db, data.organization.id, "2026-06"))?.rows[0],
    ).toMatchObject({
      departmentName: "変更後の部署",
      displayName: "変更後の氏名",
      overtimeMinutes: 60,
      workedMinutes: 540,
      workRuleName: "変更後の勤務ルール",
    });
    expect(await client.db.select().from(attendanceMonthRevisions)).toHaveLength(2);
    expect(await client.db.select().from(attendanceMonthDaySnapshots)).toHaveLength(2);
    expect(
      (await client.db.select({ action: auditLogs.action }).from(auditLogs))
        .map((entry) => entry.action)
        .filter((action) => action.startsWith("attendance_month_")),
    ).toEqual([
      "attendance_month_closed",
      "attendance_month_reopened",
      "attendance_month_reclosed",
    ]);
  });

  it("allows exactly one concurrent close and rejects stale versions and employees", async () => {
    const data = await fixture();
    const ownerActor: SessionActor = { ...data.managerActor, role: "owner" };
    await expect(
      closeAttendanceMonth(client.db, data.employeeActor, {
        expectedVersion: 0,
        month: "2026-06",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const results = await Promise.allSettled([
      closeAttendanceMonth(client.db, ownerActor, {
        expectedVersion: 0,
        month: "2026-06",
      }),
      closeAttendanceMonth(client.db, data.managerActor, {
        expectedVersion: 0,
        month: "2026-06",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      (results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(AttendanceClosingConflictError);
    expect(await client.db.select().from(attendanceMonthRevisions)).toHaveLength(1);
    await expect(
      reopenAttendanceMonth(client.db, data.managerActor, {
        expectedVersion: 0,
        month: "2026-06",
        reason: "古い画面から再開を実行したため",
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingConflictError);
  });

  it("serializes correction approval with closing and never snapshots a pending change", async () => {
    const data = await fixture();
    const correction = await createAttendanceCorrection(client.db, data.employeeActor, {
      entries: data.events.map((event) => ({
        occurredAt:
          event.type === "clock_out"
            ? new Date("2026-06-15T10:00:00.000Z").toISOString()
            : event.occurredAt.toISOString(),
        originalEventId: event.id,
        type: event.type,
      })),
      reason: "退勤時刻を正しい時刻へ修正します",
      workDate: data.day.workDate,
    });

    const [closingResult, approvalResult] = await Promise.allSettled([
      closeAttendanceMonth(client.db, data.managerActor, {
        expectedVersion: 0,
        month: "2026-06",
      }),
      reviewAttendanceCorrection(client.db, data.managerActor, correction.request.id, {
        decision: "approve",
      }),
    ]);
    expect(approvalResult.status).toBe("fulfilled");
    const [storedRequest] = await client.db
      .select({ status: attendanceCorrectionRequests.status })
      .from(attendanceCorrectionRequests)
      .where(eq(attendanceCorrectionRequests.id, correction.request.id));
    expect(storedRequest.status).toBe("approved");
    const period = await getAttendanceMonthStatus(client.db, data.organization.id, "2026-06");
    if (closingResult.status === "fulfilled") {
      expect(period.status).toBe("closed");
      expect(
        (await listClosedAttendanceSnapshots(client.db, data.organization.id, "2026-06"))?.rows[0],
      ).toMatchObject({ overtimeMinutes: 120, workedMinutes: 600 });
    } else {
      expect(closingResult.reason).toBeInstanceOf(AttendanceClosingValidationError);
      expect(period.status).toBe("open");
    }
  });

  it("protects the closing API and maps validation failures without exposing data", async () => {
    const data = await fixture();
    const [otherOrganization] = await client.db
      .insert(organizations)
      .values({ name: "別組織", timezone: "Asia/Tokyo" })
      .returning();
    const [otherOwner] = await client.db
      .insert(users)
      .values({
        displayName: "別組織 所有者",
        email: "closing-other-owner@example.com",
        organizationId: otherOrganization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    await closeAttendanceMonth(
      client.db,
      {
        displayName: otherOwner.displayName,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        organizationId: otherOrganization.id,
        role: "owner",
        userId: otherOwner.id,
      },
      { expectedVersion: 0, month: "2026-06" },
    );
    const managerSession = await createSession(client.db, data.managerActor.userId);
    const employeeSession = await createSession(client.db, data.employeeActor.userId);
    const unauthorized = await closingGet(
      new Request("http://localhost/api/attendance/closing?month=2026-06"),
    );
    expect(unauthorized.status).toBe(403);
    const forbidden = await closingGet(
      new Request("http://localhost/api/attendance/closing?month=2026-06", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}` },
      }),
    );
    expect(forbidden.status).toBe(403);
    const readable = await closingGet(
      new Request("http://localhost/api/attendance/closing?month=2026-06", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${managerSession.token}` },
      }),
    );
    expect(readable.status).toBe(200);
    expect(await readable.json()).toMatchObject({
      closing: { canClose: true, month: "2026-06", period: { status: "open", version: 0 } },
    });
    const future = await closingPost(
      new Request("http://localhost/api/attendance/closing", {
        body: JSON.stringify({ action: "close", expectedVersion: 0, month: "2999-01" }),
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${managerSession.token}`,
        },
        method: "POST",
      }),
    );
    expect(future.status).toBe(422);
    expect(await future.json()).toEqual({ error: "終了した月だけを締められます。" });

    await closeAttendanceMonth(client.db, data.managerActor, {
      expectedVersion: 0,
      month: "2026-06",
    });
    const correction = await correctionPost(
      new Request("http://localhost/api/attendance/corrections", {
        body: JSON.stringify({
          entries: data.events.map((event) => ({
            occurredAt: event.occurredAt.toISOString(),
            originalEventId: event.id,
            type: event.type,
          })),
          reason: "締め後に修正を試みます",
          workDate: "2026-06-15",
        }),
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}`,
        },
        method: "POST",
      }),
    );
    expect(correction.status).toBe(409);
    expect(await correction.json()).toMatchObject({ error: expect.stringContaining("締め済み") });
  });
});
