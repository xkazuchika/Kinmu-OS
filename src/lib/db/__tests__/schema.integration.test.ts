import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceCorrectionEntries,
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
  employeeStatusHistory,
  employees,
  initialSetupLinks,
  organizations,
  userCredentials,
  userSessions,
  users,
  workRules,
} from "@/lib/db/schema";
import { findEffectiveWorkRule } from "@/lib/db/work-rules";
import { DepartmentManagementError, requireActiveDepartment } from "@/lib/departments";
import { commitCsvImport, CsvImportValidationError, previewCsvImport } from "@/lib/csv-imports";
import {
  assertEmployeeCanPunch,
  changeEmployeeStatus,
  createEmployee,
  EmployeeManagementError,
  listEmployees,
  updateEmployeeRecord,
} from "@/lib/employees";
import { AuthorizationError, requireEmployeeScope, type SessionActor } from "@/lib/authorization";
import {
  AttendanceError,
  effectiveAttendanceEvents,
  getMonthlyAttendance,
  listManagedAttendance,
  punchAttendance,
  recomputeAttendanceDay,
} from "@/lib/attendance";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

async function expectDatabaseFailure(operation: Promise<unknown>, message: string) {
  try {
    await operation;
    throw new Error("The database operation unexpectedly succeeded.");
  } catch (error) {
    const cause = (error as { cause?: { message?: unknown } }).cause;

    expect(cause?.message).toContain(message);
  }
}

describeDatabase("database organization boundaries", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await client.db.execute(sql`TRUNCATE TABLE audit_logs`);
    await client.db.delete(attendanceMonthDaySnapshots);
    await client.db.delete(attendanceMonthRevisions);
    await client.db.delete(attendanceMonthPeriods);
    await client.db.delete(attendanceCorrectionEntries);
    await client.db.delete(attendanceEvents);
    await client.db.delete(attendanceCorrectionRequests);
    await client.db.delete(dailyAttendanceSummaries);
    await client.db.delete(attendanceDays);
    await client.db.delete(employeeDepartments);
    await client.db.delete(employeeStatusHistory);
    await client.db.delete(workRules);
    await client.db.delete(employees);
    await client.db.delete(departments);
    await client.db.delete(initialSetupLinks);
    await client.db.delete(userSessions);
    await client.db.delete(userCredentials);
    await client.db.delete(users);
    await client.db.delete(organizations);
  });

  afterAll(async () => {
    await client.close();
  });

  it("rejects a department assignment across organizations", async () => {
    const [firstOrganization] = await client.db
      .insert(organizations)
      .values({ name: "第一組織" })
      .returning();
    const [secondOrganization] = await client.db
      .insert(organizations)
      .values({ name: "第二組織" })
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        organizationId: firstOrganization.id,
        employeeNumber: "E001",
        familyName: "山田",
        givenName: "花子",
      })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ organizationId: secondOrganization.id, code: "HR", name: "人事" })
      .returning();

    await expectDatabaseFailure(
      client.db.insert(employeeDepartments).values({
        employeeId: employee.id,
        departmentId: department.id,
        startedOn: "2026-07-01",
      }),
      "same organization",
    );
  });

  it("enforces attendance correction organization boundaries and one pending request", async () => {
    const [firstOrganization, secondOrganization] = await client.db
      .insert(organizations)
      .values([{ name: "修正申請組織" }, { name: "別組織" }])
      .returning();
    const [requester, otherRequester] = await client.db
      .insert(users)
      .values([
        {
          displayName: "申請者",
          email: "correction@example.com",
          organizationId: firstOrganization.id,
          role: "employee",
          status: "active",
        },
        {
          displayName: "別組織申請者",
          email: "other-correction@example.com",
          organizationId: secondOrganization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "COR-001",
        familyName: "修正",
        givenName: "申請",
        organizationId: firstOrganization.id,
        status: "active",
        userId: requester.id,
      })
      .returning();
    const [day] = await client.db
      .insert(attendanceDays)
      .values({
        employeeId: employee.id,
        organizationId: firstOrganization.id,
        workDate: "2026-07-14",
      })
      .returning();

    await expectDatabaseFailure(
      client.db.insert(attendanceCorrectionRequests).values({
        attendanceDayId: day.id,
        employeeId: employee.id,
        organizationId: firstOrganization.id,
        reason: "退勤を修正します",
        requestedByUserId: otherRequester.id,
        workDate: day.workDate,
      }),
      "requester must belong to the same organization",
    );

    await client.db.insert(attendanceCorrectionRequests).values({
      attendanceDayId: day.id,
      employeeId: employee.id,
      organizationId: firstOrganization.id,
      reason: "退勤を修正します",
      requestedByUserId: requester.id,
      workDate: day.workDate,
    });
    await expectDatabaseFailure(
      client.db.insert(attendanceCorrectionRequests).values({
        attendanceDayId: day.id,
        employeeId: employee.id,
        organizationId: firstOrganization.id,
        reason: "同じ日の重複申請",
        requestedByUserId: requester.id,
        workDate: day.workDate,
      }),
      "attendance_correction_requests_pending_unique",
    );
  });

  it("rejects correction entries that reference another employee work date", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "明細境界組織" })
      .returning();
    const [requester] = await client.db
      .insert(users)
      .values({
        displayName: "明細申請者",
        email: "entry@example.com",
        organizationId: organization.id,
        role: "employee",
        status: "active",
      })
      .returning();
    const [employee, otherEmployee] = await client.db
      .insert(employees)
      .values([
        {
          employeeNumber: "ENTRY-001",
          familyName: "明細",
          givenName: "本人",
          organizationId: organization.id,
          status: "active",
          userId: requester.id,
        },
        {
          employeeNumber: "ENTRY-002",
          familyName: "明細",
          givenName: "他人",
          organizationId: organization.id,
          status: "active",
        },
      ])
      .returning();
    const [day, otherDay] = await client.db
      .insert(attendanceDays)
      .values([
        {
          employeeId: employee.id,
          organizationId: organization.id,
          workDate: "2026-07-14",
        },
        {
          employeeId: otherEmployee.id,
          organizationId: organization.id,
          workDate: "2026-07-14",
        },
      ])
      .returning();
    const [otherEvent] = await client.db
      .insert(attendanceEvents)
      .values({
        attendanceDayId: otherDay.id,
        employeeId: otherEmployee.id,
        occurredAt: new Date("2026-07-14T00:00:00.000Z"),
        organizationId: organization.id,
        type: "clock_in",
      })
      .returning();
    const [request] = await client.db
      .insert(attendanceCorrectionRequests)
      .values({
        attendanceDayId: day.id,
        employeeId: employee.id,
        organizationId: organization.id,
        reason: "時刻を修正します",
        requestedByUserId: requester.id,
        workDate: day.workDate,
      })
      .returning();

    await expectDatabaseFailure(
      client.db.insert(attendanceCorrectionEntries).values({
        kind: "original",
        occurredAt: otherEvent.occurredAt,
        originalEventId: otherEvent.id,
        position: 0,
        requestId: request.id,
        type: otherEvent.type,
      }),
      "same employee work date",
    );
  });

  it("creates partial and composite indexes for correction workflows", async () => {
    const result = (await client.db.execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'attendance_correction_requests_pending_unique',
          'attendance_corrections_org_status_created_idx',
          'attendance_events_active_day_time_index'
        )
    `)) as unknown as Array<{ indexdef: string; indexname: string }>;
    const indexes = new Map(result.map((row) => [row.indexname, row.indexdef]));

    expect(indexes.get("attendance_correction_requests_pending_unique")).toContain(
      "WHERE (status = 'pending'",
    );
    expect(indexes.get("attendance_corrections_org_status_created_idx")).toContain(
      "organization_id, status, created_at",
    );
    expect(indexes.get("attendance_events_active_day_time_index")).toContain(
      "superseded_by_correction_request_id IS NULL",
    );
  });

  it("selects the employee-specific rule at the latest effective date", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "組織" })
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        organizationId: organization.id,
        employeeNumber: "E001",
        familyName: "佐藤",
        givenName: "太郎",
      })
      .returning();

    await client.db.insert(workRules).values([
      {
        organizationId: organization.id,
        name: "組織標準",
        effectiveFrom: "2026-07-01",
        scheduledStartTime: "09:00",
        scheduledEndTime: "18:00",
      },
      {
        organizationId: organization.id,
        employeeId: employee.id,
        name: "個別ルール",
        effectiveFrom: "2026-07-01",
        scheduledStartTime: "10:00",
        scheduledEndTime: "19:00",
      },
    ]);

    const rule = await findEffectiveWorkRule(client.db, {
      employeeId: employee.id,
      organizationId: organization.id,
      workDate: "2026-07-15",
    });

    expect(rule?.name).toBe("個別ルール");
  });

  it("rejects updates to append-only audit logs", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "監査組織" })
      .returning();
    const [auditLog] = await client.db
      .insert(auditLogs)
      .values({
        action: "csv_exported",
        entityType: "employee",
        organizationId: organization.id,
      })
      .returning();

    await expectDatabaseFailure(
      client.db
        .update(auditLogs)
        .set({ entityType: "changed" })
        .where(eq(auditLogs.id, auditLog.id)),
      "append-only",
    );
  });

  it("limits an employee actor to their own employee record", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "権限組織" })
      .returning();
    const [employeeUser] = await client.db
      .insert(users)
      .values({
        displayName: "従業員",
        email: "employee@example.com",
        organizationId: organization.id,
        role: "employee",
        status: "active",
      })
      .returning();
    const [ownEmployee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "E001",
        familyName: "本人",
        givenName: "太郎",
        organizationId: organization.id,
        userId: employeeUser.id,
      })
      .returning();
    const [otherEmployee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "E002",
        familyName: "他人",
        givenName: "花子",
        organizationId: organization.id,
      })
      .returning();
    const actor: SessionActor = {
      displayName: "従業員 太郎",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: employeeUser.id,
    };

    await expect(requireEmployeeScope(client.db, actor, ownEmployee.id)).resolves.toBeUndefined();
    await expect(requireEmployeeScope(client.db, actor, otherEmployee.id)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("rejects an inactive department as a new primary assignment", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "所属検証組織" })
      .returning();
    const [activeDepartment, inactiveDepartment] = await client.db
      .insert(departments)
      .values([
        { code: "ACTIVE", name: "有効部署", organizationId: organization.id },
        { active: false, code: "INACTIVE", name: "無効部署", organizationId: organization.id },
      ])
      .returning();

    await expect(
      requireActiveDepartment(client.db, {
        departmentId: activeDepartment.id,
        organizationId: organization.id,
      }),
    ).resolves.toEqual({ id: activeDepartment.id });
    await expect(
      requireActiveDepartment(client.db, {
        departmentId: inactiveDepartment.id,
        organizationId: organization.id,
      }),
    ).rejects.toBeInstanceOf(DepartmentManagementError);
  });

  it("creates an employee with primary department and supports filtered listing", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "従業員登録組織" })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "ENG", name: "開発部", organizationId: organization.id })
      .returning();

    const employee = await createEmployee(client.db, {
      contactEmail: "hanako@example.com",
      departmentId: department.id,
      displayName: "山田 花子",
      employeeNumber: "E100",
      employmentType: "full_time",
      familyName: "山田",
      givenName: "花子",
      joinedOn: "2026-07-01",
      organizationId: organization.id,
      status: "active",
    });
    const listed = await listEmployees(client.db, {
      departmentId: department.id,
      organizationId: organization.id,
      query: "花子",
      status: "active",
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      departmentName: "開発部",
      displayName: "山田 花子",
      id: employee.id,
    });
    await expect(
      client.db
        .select()
        .from(employeeStatusHistory)
        .where(eq(employeeStatusHistory.employeeId, employee.id)),
    ).resolves.toHaveLength(1);
  });

  it("closes the previous primary department when an employee changes affiliation", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "所属変更組織" })
      .returning();
    const [firstDepartment, secondDepartment] = await client.db
      .insert(departments)
      .values([
        { code: "SALES", name: "営業部", organizationId: organization.id },
        { code: "CS", name: "顧客支援部", organizationId: organization.id },
      ])
      .returning();
    const employee = await createEmployee(client.db, {
      departmentId: firstDepartment.id,
      displayName: "佐藤 次郎",
      employeeNumber: "E200",
      employmentType: "full_time",
      familyName: "佐藤",
      givenName: "次郎",
      joinedOn: "2026-04-01",
      organizationId: organization.id,
      status: "active",
    });

    await updateEmployeeRecord(client.db, {
      departmentEffectiveOn: "2026-07-01",
      departmentId: secondDepartment.id,
      employeeId: employee.id,
      organizationId: organization.id,
    });
    const assignments = await client.db
      .select()
      .from(employeeDepartments)
      .where(eq(employeeDepartments.employeeId, employee.id));

    expect(assignments).toHaveLength(2);
    expect(assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: firstDepartment.id, endedOn: "2026-06-30" }),
        expect.objectContaining({ departmentId: secondDepartment.id, startedOn: "2026-07-01" }),
      ]),
    );
  });

  it("records termination, excludes it by default, and rejects later punches", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "退職検証組織" })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "OPS", name: "運用部", organizationId: organization.id })
      .returning();
    const employee = await createEmployee(client.db, {
      departmentId: department.id,
      displayName: "退職 三郎",
      employeeNumber: "E300",
      employmentType: "contract",
      familyName: "退職",
      givenName: "三郎",
      joinedOn: "2026-01-01",
      organizationId: organization.id,
      status: "active",
    });
    const terminated = await changeEmployeeStatus(client.db, {
      effectiveOn: "2026-07-31",
      employeeId: employee.id,
      organizationId: organization.id,
      reason: "契約満了",
      status: "terminated",
    });

    await expect(
      listEmployees(client.db, { organizationId: organization.id }),
    ).resolves.toHaveLength(0);
    await expect(
      listEmployees(client.db, { organizationId: organization.id, status: "all" }),
    ).resolves.toHaveLength(1);
    expect(() => assertEmployeeCanPunch(terminated, "2026-08-01")).toThrow(EmployeeManagementError);
  });

  it("previews valid CSV and rejects an entire employee file containing duplicates", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "CSV取込組織" })
      .returning();
    await commitCsvImport(client.db, {
      csv: "code,name\nHR,人事部\n",
      kind: "departments",
      organizationId: organization.id,
    });
    const validCsv =
      "employeeNumber,familyName,givenName,displayName,contactEmail,departmentCode,joinedOn,employmentType,status\n" +
      "E501,山田,花子,山田 花子,hanako501@example.com,HR,2026-04-01,full_time,active\n";
    const validPreview = await previewCsvImport(client.db, {
      csv: validCsv,
      kind: "employees",
      organizationId: organization.id,
    });

    expect(validPreview.errors).toEqual([]);
    await expect(
      commitCsvImport(client.db, {
        csv:
          validCsv.replace("E501,山田", "E501,山田") +
          "E501,佐藤,次郎,佐藤 次郎,jiro501@example.com,HR,2026-04-01,contract,active\n",
        kind: "employees",
        organizationId: organization.id,
      }),
    ).rejects.toBeInstanceOf(CsvImportValidationError);
    await expect(
      client.db.select().from(employees).where(eq(employees.organizationId, organization.id)),
    ).resolves.toHaveLength(0);
    await expect(
      commitCsvImport(client.db, {
        csv: validCsv,
        kind: "employees",
        organizationId: organization.id,
      }),
    ).resolves.toBe(1);
  });

  it("records a valid punch sequence in the organization timezone and rejects contradictions", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "打刻検証組織", timezone: "Asia/Tokyo" })
      .returning();
    const [user] = await client.db
      .insert(users)
      .values({
        displayName: "打刻 花子",
        email: "punch@example.com",
        organizationId: organization.id,
        role: "employee",
        status: "active",
      })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "TIME", name: "勤怠部", organizationId: organization.id })
      .returning();
    const employee = await createEmployee(client.db, {
      departmentId: department.id,
      displayName: "打刻 花子",
      employeeNumber: "T001",
      employmentType: "full_time",
      familyName: "打刻",
      givenName: "花子",
      joinedOn: "2026-04-01",
      organizationId: organization.id,
      status: "active",
    });
    await updateEmployeeRecord(client.db, {
      employeeId: employee.id,
      organizationId: organization.id,
      userId: user.id,
    });
    await client.db.insert(workRules).values({
      dailyStandardMinutes: 480,
      effectiveFrom: "2026-07-01",
      name: "標準8時間",
      organizationId: organization.id,
      scheduledBreakMinutes: 60,
      scheduledEndTime: "18:00",
      scheduledStartTime: "09:00",
    });
    const actor: SessionActor = {
      displayName: user.displayName,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      organizationId: organization.id,
      role: "employee",
      userId: user.id,
    };

    await expect(
      punchAttendance(client.db, actor, {
        occurredAt: new Date("2026-07-14T15:20:00Z"),
        type: "clock_out",
      }),
    ).rejects.toBeInstanceOf(AttendanceError);
    await punchAttendance(client.db, actor, {
      occurredAt: new Date("2026-07-15T00:00:00Z"),
      type: "clock_in",
    });
    await punchAttendance(client.db, actor, {
      occurredAt: new Date("2026-07-15T03:00:00Z"),
      type: "break_start",
    });
    await expect(
      punchAttendance(client.db, actor, {
        occurredAt: new Date("2026-07-15T03:01:00Z"),
        type: "break_start",
      }),
    ).rejects.toBeInstanceOf(AttendanceError);
    await punchAttendance(client.db, actor, {
      occurredAt: new Date("2026-07-15T04:00:00Z"),
      type: "break_end",
    });
    const finalState = await punchAttendance(client.db, actor, {
      occurredAt: new Date("2026-07-15T10:00:00Z"),
      type: "clock_out",
    });
    const storedEvents = await client.db
      .select()
      .from(attendanceEvents)
      .where(eq(attendanceEvents.employeeId, employee.id));
    const [summary] = await client.db.select().from(dailyAttendanceSummaries);
    const [storedDay] = await client.db
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.employeeId, employee.id));
    const monthly = await getMonthlyAttendance(client.db, actor, "2026-07");
    const managed = await listManagedAttendance(client.db, {
      month: "2026-07",
      organizationId: organization.id,
    });

    expect(finalState).toMatchObject({ actions: [], state: "clock_out", workDate: "2026-07-15" });
    expect(storedEvents).toHaveLength(4);
    expect(storedEvents.every((event) => event.recordedByUserId === user.id)).toBe(true);
    expect(storedDay.revision).toBe(4);
    expect(summary).toMatchObject({
      breakMinutes: 60,
      overtimeMinutes: 60,
      scheduledMinutes: 480,
      workedMinutes: 540,
    });
    expect(monthly.totals).toEqual({
      overtimeMinutes: 60,
      scheduledMinutes: 480,
      workedMinutes: 540,
    });
    expect(monthly.days[0]?.isCorrected).toBe(false);
    expect(managed).toHaveLength(1);
    expect(managed[0]?.isCorrected).toBe(false);

    const [correction] = await client.db
      .insert(attendanceCorrectionRequests)
      .values({
        attendanceDayId: storedDay.id,
        baseRevision: storedDay.revision,
        employeeId: employee.id,
        organizationId: organization.id,
        reason: "出勤時刻を修正",
        requestedByUserId: user.id,
        status: "approved",
        workDate: storedDay.workDate,
      })
      .returning();
    const originalClockIn = storedEvents.find((event) => event.type === "clock_in")!;
    await client.db
      .update(attendanceEvents)
      .set({ supersededByCorrectionRequestId: correction.id })
      .where(eq(attendanceEvents.id, originalClockIn.id));
    await client.db.insert(attendanceEvents).values({
      attendanceDayId: storedDay.id,
      correctionRequestId: correction.id,
      employeeId: employee.id,
      occurredAt: originalClockIn.occurredAt,
      organizationId: organization.id,
      recordedByUserId: user.id,
      source: "correction",
      type: "clock_in",
    });

    const effectiveEvents = await effectiveAttendanceEvents(client.db, storedDay.id);
    expect(effectiveEvents).toHaveLength(4);
    expect(effectiveEvents.some((event) => event.id === originalClockIn.id)).toBe(false);
    expect(effectiveEvents.some((event) => event.correctionRequestId === correction.id)).toBe(true);

    await recomputeAttendanceDay(
      client.db,
      storedDay,
      effectiveEvents.filter((event) => event.type !== "clock_out"),
    );
    const [reopenedDay] = await client.db
      .select()
      .from(attendanceDays)
      .where(eq(attendanceDays.id, storedDay.id));
    const summariesAfterReopen = await client.db
      .select()
      .from(dailyAttendanceSummaries)
      .where(eq(dailyAttendanceSummaries.attendanceDayId, storedDay.id));
    expect(reopenedDay.status).toBe("open");
    expect(summariesAfterReopen).toHaveLength(0);
  });
});
