import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PATCH as reviewPatch } from "@/app/api/attendance/correction-reviews/[requestId]/route";
import { GET as exportGet } from "@/app/api/exports/[kind]/route";
import { GET as reviewsGet } from "@/app/api/attendance/correction-reviews/route";
import { PATCH as correctionPatch } from "@/app/api/attendance/corrections/[requestId]/route";
import {
  GET as correctionsGet,
  POST as correctionsPost,
} from "@/app/api/attendance/corrections/route";
import {
  AttendanceCorrectionConflictError,
  AttendanceCorrectionValidationError,
  cancelAttendanceCorrection,
  createAttendanceCorrection,
  getOwnAttendanceCorrection,
  listOwnAttendanceCorrections,
  reviewAttendanceCorrection,
} from "@/lib/attendance-corrections";
import {
  effectiveAttendanceEvents,
  getMonthlyAttendance,
  listManagedAttendance,
  punchAttendance,
} from "@/lib/attendance";
import type { SessionActor } from "@/lib/authorization";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import {
  attendanceCorrectionRequests,
  attendanceDays,
  attendanceEvents,
  auditLogs,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
  organizations,
  users,
  workRules,
} from "@/lib/db/schema";
import { managementDashboard } from "@/lib/reporting";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("attendance correction workflow", () => {
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

  async function fixture(options: { complete?: boolean } = { complete: true }) {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "修正申請株式会社", timezone: "Asia/Tokyo" })
      .returning();
    const [employeeUser, managerUser, otherUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "申請 花子",
          email: "correction-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
        {
          displayName: "承認 太郎",
          email: "correction-manager@example.com",
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
        {
          displayName: "別 従業員",
          email: "correction-other@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee, otherEmployee] = await client.db
      .insert(employees)
      .values([
        {
          displayName: employeeUser.displayName,
          employeeNumber: "COR-001",
          familyName: "申請",
          givenName: "花子",
          joinedOn: "2026-01-01",
          organizationId: organization.id,
          status: "active",
          userId: employeeUser.id,
        },
        {
          displayName: otherUser.displayName,
          employeeNumber: "COR-002",
          familyName: "別",
          givenName: "従業員",
          joinedOn: "2026-01-01",
          organizationId: organization.id,
          status: "active",
          userId: otherUser.id,
        },
      ])
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "COR", name: "修正申請部", organizationId: organization.id })
      .returning();
    await client.db.insert(employeeDepartments).values([
      {
        departmentId: department.id,
        employeeId: employee.id,
        isPrimary: true,
        startedOn: "2026-01-01",
      },
      {
        departmentId: department.id,
        employeeId: otherEmployee.id,
        isPrimary: true,
        startedOn: "2026-01-01",
      },
    ]);
    await client.db.insert(workRules).values({
      dailyStandardMinutes: 480,
      effectiveFrom: "2026-01-01",
      name: "標準勤務",
      organizationId: organization.id,
      scheduledBreakMinutes: 60,
      scheduledEndTime: "18:00",
      scheduledStartTime: "09:00",
    });
    const employeeActor: SessionActor = {
      displayName: employeeUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: employeeUser.id,
    };
    const managerActor: SessionActor = {
      displayName: managerUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "hr_admin",
      userId: managerUser.id,
    };
    const otherActor: SessionActor = {
      displayName: otherUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: otherUser.id,
    };
    await punchAttendance(client.db, employeeActor, {
      occurredAt: new Date("2026-07-15T00:00:00.000Z"),
      type: "clock_in",
    });
    if (options.complete !== false) {
      await punchAttendance(client.db, employeeActor, {
        occurredAt: new Date("2026-07-15T09:00:00.000Z"),
        type: "clock_out",
      });
    }
    const [day] = await client.db
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.employeeId, employee.id));
    const events = await effectiveAttendanceEvents(client.db, day.id);
    return {
      day,
      employee,
      employeeActor,
      employeeUser,
      events,
      managerActor,
      managerUser,
      organization,
      otherActor,
      otherEmployee,
      otherUser,
    };
  }

  function correctedEntries(
    events: Awaited<ReturnType<typeof effectiveAttendanceEvents>>,
    clockIn = "2026-07-15T00:30:00.000Z",
  ) {
    return events.map((event) => ({
      occurredAt: event.type === "clock_in" ? clockIn : event.occurredAt,
      originalEventId: event.id,
      type: event.type,
    }));
  }

  it("creates an immutable snapshot and lets only the applicant cancel pending work", async () => {
    const data = await fixture();
    const beforeSummary = await client.db.select().from(dailyAttendanceSummaries);
    const detail = await createAttendanceCorrection(client.db, data.employeeActor, {
      entries: correctedEntries(data.events),
      reason: "出勤時刻の入力を間違えました",
      workDate: data.day.workDate,
    });
    const afterSummary = await client.db.select().from(dailyAttendanceSummaries);

    expect(detail.request).toMatchObject({ baseRevision: 2, status: "pending" });
    expect(detail.entries.filter((entry) => entry.kind === "original")).toHaveLength(2);
    expect(detail.entries.filter((entry) => entry.kind === "requested")).toHaveLength(2);
    expect(afterSummary).toEqual(beforeSummary);
    await expect(
      createAttendanceCorrection(client.db, data.employeeActor, {
        entries: correctedEntries(data.events, "2026-07-15T00:45:00.000Z"),
        reason: "重複申請",
        workDate: data.day.workDate,
      }),
    ).rejects.toBeInstanceOf(AttendanceCorrectionConflictError);
    await expect(
      getOwnAttendanceCorrection(client.db, data.otherActor, detail.request.id),
    ).rejects.toThrow();

    await cancelAttendanceCorrection(client.db, data.employeeActor, detail.request.id);
    await expect(
      cancelAttendanceCorrection(client.db, data.employeeActor, detail.request.id),
    ).rejects.toBeInstanceOf(AttendanceCorrectionConflictError);
    const own = await listOwnAttendanceCorrections(client.db, data.employeeActor);
    expect(own[0]?.status).toBe("cancelled");
    const actions = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.occurredAt));
    expect(actions.map((entry) => entry.action)).toEqual([
      "attendance_correction_requested",
      "attendance_correction_cancelled",
    ]);
  });

  it("approves atomically, preserves old events, and recalculates all effective values", async () => {
    const data = await fixture();
    const created = await createAttendanceCorrection(client.db, data.employeeActor, {
      entries: correctedEntries(data.events),
      reason: "出勤は9時30分でした",
      workDate: data.day.workDate,
    });
    const approved = await reviewAttendanceCorrection(
      client.db,
      data.managerActor,
      created.request.id,
      { comment: "確認しました", decision: "approve" },
    );
    const allEvents = await client.db
      .select()
      .from(attendanceEvents)
      .where(eq(attendanceEvents.attendanceDayId, data.day.id));
    const effective = await effectiveAttendanceEvents(client.db, data.day.id);
    const [summary] = await client.db.select().from(dailyAttendanceSummaries);
    const [day] = await client.db
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.id, data.day.id));

    expect(approved.request.status).toBe("approved");
    expect(allEvents).toHaveLength(4);
    expect(allEvents.filter((event) => event.supersededByCorrectionRequestId)).toHaveLength(2);
    expect(effective.every((event) => event.correctionRequestId === created.request.id)).toBe(true);
    expect(summary).toMatchObject({ overtimeMinutes: 30, workedMinutes: 510 });
    expect(day.revision).toBe(3);
    const [monthly, managed, dashboard] = await Promise.all([
      getMonthlyAttendance(client.db, data.employeeActor, "2026-07"),
      listManagedAttendance(client.db, {
        month: "2026-07",
        organizationId: data.organization.id,
      }),
      managementDashboard(client.db, data.organization.id, "2026-07"),
    ]);
    expect(monthly.days[0]).toMatchObject({
      isCorrected: true,
      overtimeMinutes: 30,
      status: "complete",
      workedMinutes: 510,
    });
    expect(managed[0]).toMatchObject({
      isCorrected: true,
      overtimeMinutes: 30,
      workedMinutes: 510,
    });
    expect(dashboard.overtime[0]).toMatchObject({ overtimeMinutes: 30 });
    const session = await createSession(client.db, data.managerUser.id);
    const csvResponse = await exportGet(
      new Request("http://localhost/api/exports/attendance?month=2026-07", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
      }),
      { params: Promise.resolve({ kind: "attendance" }) },
    );
    expect(csvResponse.status).toBe(200);
    expect(await csvResponse.text()).toContain("510,480,30,はい");
    await expect(
      reviewAttendanceCorrection(client.db, data.managerActor, created.request.id, {
        decision: "approve",
      }),
    ).rejects.toBeInstanceOf(AttendanceCorrectionConflictError);
    const auditEntries = await client.db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.request.id))
      .orderBy(asc(auditLogs.occurredAt));
    expect(auditEntries.map((entry) => entry.action)).toEqual([
      "attendance_correction_requested",
      "attendance_correction_approved",
      "attendance_correction_applied",
    ]);
    expect(auditEntries.at(-1)?.metadata).toMatchObject({
      employeeId: data.employee.id,
      workDate: data.day.workDate,
    });
  });

  it("rejects invalid reviews without changing attendance", async () => {
    const data = await fixture();
    const created = await createAttendanceCorrection(client.db, data.employeeActor, {
      entries: correctedEntries(data.events),
      reason: "修正を申請します",
      workDate: data.day.workDate,
    });
    await expect(
      reviewAttendanceCorrection(client.db, data.managerActor, created.request.id, {
        decision: "reject",
      }),
    ).rejects.toBeInstanceOf(AttendanceCorrectionValidationError);
    await client.db
      .update(users)
      .set({ role: "hr_admin" })
      .where(eq(users.id, data.employeeUser.id));
    await expect(
      reviewAttendanceCorrection(
        client.db,
        { ...data.employeeActor, role: "hr_admin" },
        created.request.id,
        {
          decision: "approve",
        },
      ),
    ).rejects.toThrow("自分の申請");
    await reviewAttendanceCorrection(client.db, data.managerActor, created.request.id, {
      comment: "勤務表と一致しません",
      decision: "reject",
    });
    const effective = await effectiveAttendanceEvents(client.db, data.day.id);
    const [request] = await client.db
      .select()
      .from(attendanceCorrectionRequests)
      .where(eq(attendanceCorrectionRequests.id, created.request.id));
    expect(request).toMatchObject({
      reviewComment: "勤務表と一致しません",
      status: "rejected",
    });
    expect(effective.map((entry) => entry.id)).toEqual(data.events.map((entry) => entry.id));
  });

  it("detects a punch made after the request and keeps the request pending", async () => {
    const data = await fixture({ complete: false });
    const created = await createAttendanceCorrection(client.db, data.employeeActor, {
      entries: [
        ...data.events.map((event) => ({
          occurredAt: event.occurredAt,
          originalEventId: event.id,
          type: event.type,
        })),
        { occurredAt: "2026-07-15T08:30:00.000Z", type: "clock_out" },
      ],
      reason: "退勤時刻を追加します",
      workDate: data.day.workDate,
    });
    await punchAttendance(client.db, data.employeeActor, {
      occurredAt: new Date("2026-07-15T09:00:00.000Z"),
      type: "clock_out",
    });

    await expect(
      reviewAttendanceCorrection(client.db, data.managerActor, created.request.id, {
        decision: "approve",
      }),
    ).rejects.toBeInstanceOf(AttendanceCorrectionConflictError);
    const [request] = await client.db
      .select()
      .from(attendanceCorrectionRequests)
      .where(eq(attendanceCorrectionRequests.id, created.request.id));
    expect(request.status).toBe("pending");
  });

  it("rolls back the whole approval when audit insertion fails", async () => {
    const data = await fixture();
    const created = await createAttendanceCorrection(client.db, data.employeeActor, {
      entries: correctedEntries(data.events),
      reason: "ロールバック検証",
      workDate: data.day.workDate,
    });
    await client.db.execute(sql`
      CREATE FUNCTION fail_correction_applied_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'attendance_correction_applied' THEN
          RAISE EXCEPTION 'forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.db.execute(sql`
      CREATE TRIGGER fail_correction_applied_audit_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_correction_applied_audit()
    `);
    try {
      await expect(
        reviewAttendanceCorrection(client.db, data.managerActor, created.request.id, {
          decision: "approve",
        }),
      ).rejects.toThrow();
      const [request] = await client.db
        .select()
        .from(attendanceCorrectionRequests)
        .where(eq(attendanceCorrectionRequests.id, created.request.id));
      const effective = await effectiveAttendanceEvents(client.db, data.day.id);
      expect(request.status).toBe("pending");
      expect(effective.map((event) => event.id)).toEqual(data.events.map((event) => event.id));
    } finally {
      await client.db.execute(
        sql`DROP TRIGGER fail_correction_applied_audit_trigger ON audit_logs`,
      );
      await client.db.execute(sql`DROP FUNCTION fail_correction_applied_audit()`);
    }
  });

  it("maps employee and manager API outcomes to consistent status codes", async () => {
    const data = await fixture();
    const employeeSession = await createSession(client.db, data.employeeUser.id);
    const managerSession = await createSession(client.db, data.managerUser.id);
    const otherSession = await createSession(client.db, data.otherUser.id);
    const employeeHeaders = {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}`,
    };
    const managerHeaders = {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${managerSession.token}`,
    };
    const otherHeaders = {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${otherSession.token}`,
    };

    const unauthenticated = await correctionsGet(
      new Request("http://kinmu.test/api/attendance/corrections"),
    );
    const invalid = await correctionsPost(
      new Request("http://kinmu.test/api/attendance/corrections", {
        body: JSON.stringify({ entries: [], reason: "", workDate: "bad" }),
        headers: employeeHeaders,
        method: "POST",
      }),
    );
    const createdResponse = await correctionsPost(
      new Request("http://kinmu.test/api/attendance/corrections", {
        body: JSON.stringify({
          entries: correctedEntries(data.events),
          reason: "APIから修正します",
          workDate: data.day.workDate,
        }),
        headers: employeeHeaders,
        method: "POST",
      }),
    );
    const createdBody = (await createdResponse.json()) as {
      correction: { request: { id: string } };
    };
    const forbiddenReviews = await reviewsGet(
      new Request("http://kinmu.test/api/attendance/correction-reviews", {
        headers: employeeHeaders,
      }),
    );
    const forbiddenCancel = await correctionPatch(
      new Request(
        `http://kinmu.test/api/attendance/corrections/${createdBody.correction.request.id}`,
        {
          body: JSON.stringify({ action: "cancel" }),
          headers: otherHeaders,
          method: "PATCH",
        },
      ),
      { params: Promise.resolve({ requestId: createdBody.correction.request.id }) },
    );
    const approvedResponse = await reviewPatch(
      new Request(
        `http://kinmu.test/api/attendance/correction-reviews/${createdBody.correction.request.id}`,
        {
          body: JSON.stringify({ decision: "approve" }),
          headers: managerHeaders,
          method: "PATCH",
        },
      ),
      { params: Promise.resolve({ requestId: createdBody.correction.request.id }) },
    );
    const reviewedAgain = await reviewPatch(
      new Request(
        `http://kinmu.test/api/attendance/correction-reviews/${createdBody.correction.request.id}`,
        {
          body: JSON.stringify({ decision: "approve" }),
          headers: managerHeaders,
          method: "PATCH",
        },
      ),
      { params: Promise.resolve({ requestId: createdBody.correction.request.id }) },
    );

    expect(unauthenticated.status).toBe(403);
    expect(invalid.status).toBe(422);
    expect(createdResponse.status).toBe(201);
    expect(forbiddenReviews.status).toBe(403);
    expect(forbiddenCancel.status).toBe(403);
    expect(approvedResponse.status).toBe(200);
    expect(reviewedAgain.status).toBe(409);
  });
});
