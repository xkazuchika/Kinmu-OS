import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { AttendanceClosingConflictError } from "@/lib/attendance-closing";
import type { SessionActor } from "@/lib/authorization";
import { CsvImportValidationError } from "@/lib/csv-imports";
import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceMonthPeriods,
  auditLogs,
  employees,
  organizations,
  users,
  workCalendarDateExceptions,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";
import {
  activateWorkCalendar,
  commitCalendarCsv,
  createWorkCalendarDraft,
  deactivateCalendarException,
  getCalendarActivationPreview,
  previewCalendarCsv,
  resolveWorkSchedule,
  saveCalendarException,
  WorkCalendarValidationError,
} from "@/lib/work-calendar";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("work calendar domain", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        import_batches,
        attendance_month_day_snapshots,
        attendance_month_revisions,
        attendance_month_periods,
        work_calendar_date_exceptions,
        work_calendar_patterns,
        work_rules,
        employee_status_history,
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
      .values({ name: "カレンダー組織", timezone: "Asia/Tokyo" })
      .returning();
    const [owner, employeeUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "管理者",
          email: "calendar-owner@example.com",
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
        {
          displayName: "従業員",
          email: "calendar-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "CAL-001",
        familyName: "暦",
        givenName: "太郎",
        joinedOn: "2026-04-01",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
      .returning();
    await client.db.insert(workRules).values([
      {
        dailyStandardMinutes: 480,
        effectiveFrom: "2026-04-01",
        name: "組織標準",
        organizationId: organization.id,
        scheduledBreakMinutes: 60,
        scheduledEndTime: "18:00",
        scheduledStartTime: "09:00",
      },
      {
        dailyStandardMinutes: 420,
        effectiveFrom: "2026-07-01",
        employeeId: employee.id,
        name: "個別短時間",
        organizationId: organization.id,
        scheduledBreakMinutes: 45,
        scheduledEndTime: "17:00",
        scheduledStartTime: "09:00",
      },
    ]);
    const actor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };
    return { actor, employee, employeeUser, organization, owner };
  }

  it("resolves employee exception over company exception over the effective weekly pattern", async () => {
    const { employee, organization, owner } = await fixture();
    await client.db.insert(workCalendarPatterns).values({
      activatedAt: new Date(),
      activatedByUserId: owner.id,
      effectiveFrom: "2026-07-01",
      organizationId: organization.id,
      status: "active",
    });
    await client.db.insert(workCalendarDateExceptions).values([
      {
        calendarDate: "2026-07-19",
        dayKind: "workday",
        name: "全社臨時勤務",
        organizationId: organization.id,
        reason: "棚卸し",
      },
      {
        calendarDate: "2026-07-19",
        dayKind: "non_workday",
        employeeId: employee.id,
        name: "個人休日",
        organizationId: organization.id,
        reason: "別日勤務済み",
      },
    ]);

    await expect(
      resolveWorkSchedule(client.db, {
        employeeId: employee.id,
        organizationId: organization.id,
        workDate: "2026-06-30",
      }),
    ).resolves.toMatchObject({ calendarSource: "inactive_calendar", dayKind: "non_workday" });
    await expect(
      resolveWorkSchedule(client.db, {
        employeeId: employee.id,
        organizationId: organization.id,
        workDate: "2026-07-19",
      }),
    ).resolves.toMatchObject({
      calendarLabel: "個人休日",
      calendarSource: "employee_exception",
      dayKind: "non_workday",
    });

    await client.db
      .update(workCalendarDateExceptions)
      .set({ active: false })
      .where(eq(workCalendarDateExceptions.employeeId, employee.id));
    await expect(
      resolveWorkSchedule(client.db, {
        employeeId: employee.id,
        organizationId: organization.id,
        workDate: "2026-07-19",
      }),
    ).resolves.toMatchObject({
      calendarLabel: "全社臨時勤務",
      calendarSource: "company_exception",
      dayKind: "workday",
      scheduledMinutes: 420,
      workRuleName: "個別短時間",
    });
    await expect(
      resolveWorkSchedule(client.db, {
        employeeId: employee.id,
        organizationId: organization.id,
        workDate: "2026-07-20",
      }),
    ).resolves.toMatchObject({
      calendarSource: "weekly_pattern",
      dayKind: "workday",
      scheduledMinutes: 420,
    });
  });

  it("previews and activates a draft only in an open month, recording the activation", async () => {
    const { actor, organization } = await fixture();
    const draft = await createWorkCalendarDraft(client.db, actor, {
      effectiveFrom: "2026-08-01",
      fridayWorkday: true,
      mondayWorkday: true,
      saturdayWorkday: false,
      sundayWorkday: false,
      thursdayWorkday: true,
      tuesdayWorkday: true,
      wednesdayWorkday: true,
    });
    await expect(
      getCalendarActivationPreview(client.db, actor, draft.id, "2026-08-01"),
    ).resolves.toMatchObject({ blockedByRevision: null, employeeCount: 1 });

    const activated = await activateWorkCalendar(client.db, actor, {
      effectiveFrom: "2026-08-01",
      patternId: draft.id,
    });
    expect(activated.status).toBe("active");
    await expect(
      client.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "work_calendar_activation")),
    ).resolves.toHaveLength(1);

    const blockedDraft = await createWorkCalendarDraft(client.db, actor, {
      effectiveFrom: "2026-06-01",
      fridayWorkday: true,
      mondayWorkday: true,
      saturdayWorkday: false,
      sundayWorkday: false,
      thursdayWorkday: true,
      tuesdayWorkday: true,
      wednesdayWorkday: true,
    });
    await client.db.insert(attendanceMonthPeriods).values({
      currentRevision: 2,
      nextRevision: 3,
      organizationId: organization.id,
      status: "closed",
      targetMonth: "2026-06",
    });
    await expect(
      activateWorkCalendar(client.db, actor, {
        effectiveFrom: "2026-06-01",
        patternId: blockedDraft.id,
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingConflictError);
  });

  it("creates, changes, and deactivates a reasoned exception while protecting closed months", async () => {
    const { actor, organization } = await fixture();
    const exception = await saveCalendarException(client.db, actor, {
      calendarDate: "2026-08-11",
      dayKind: "non_workday",
      name: "夏季休業",
      reason: "全社休業日",
    });
    const changed = await saveCalendarException(client.db, actor, {
      calendarDate: "2026-08-11",
      dayKind: "workday",
      exceptionId: exception.id,
      name: "臨時勤務",
      reason: "納期対応",
    });
    expect(changed.dayKind).toBe("workday");
    await expect(
      deactivateCalendarException(client.db, actor, exception.id, "予定変更"),
    ).resolves.toMatchObject({ active: false });

    await client.db.insert(attendanceMonthPeriods).values({
      currentRevision: 1,
      nextRevision: 2,
      organizationId: organization.id,
      status: "closed",
      targetMonth: "2026-07",
    });
    await expect(
      saveCalendarException(client.db, actor, {
        calendarDate: "2026-07-20",
        dayKind: "non_workday",
        name: "締め済み休日",
        reason: "保存不可",
      }),
    ).rejects.toBeInstanceOf(AttendanceClosingConflictError);
  });

  it("validates and atomically imports calendar CSV, rejecting an identical retry", async () => {
    const { actor } = await fixture();
    const csv = [
      "date,kind,name,reason",
      "2026-08-13,non_workday,夏季休業,全社休業",
      "2026-08-14,workday,臨時勤務,納期対応",
    ].join("\n");
    await expect(
      previewCalendarCsv(client.db, { csv, organizationId: actor.organizationId }),
    ).resolves.toMatchObject({ errors: [], summary: { added: 2, rejected: 0, updated: 0 } });
    await expect(
      commitCalendarCsv(client.db, actor, { csv, fileName: "calendar.csv" }),
    ).resolves.toMatchObject({
      added: 2,
      updated: 0,
    });
    await expect(commitCalendarCsv(client.db, actor, { csv })).rejects.toBeInstanceOf(
      CsvImportValidationError,
    );
    await expect(
      commitCalendarCsv(client.db, actor, {
        csv: [
          "date,kind,name,reason",
          "2026-08-15,non_workday,休日,",
          "2026-08-16,invalid,区分不正,検証用",
        ].join("\n"),
      }),
    ).rejects.toBeInstanceOf(CsvImportValidationError);
    await expect(
      client.db
        .select()
        .from(workCalendarDateExceptions)
        .where(eq(workCalendarDateExceptions.calendarDate, "2026-08-15")),
    ).resolves.toHaveLength(0);
  });

  it("rejects malformed dates instead of normalizing them", async () => {
    const { employee, organization } = await fixture();
    await expect(
      resolveWorkSchedule(client.db, {
        employeeId: employee.id,
        organizationId: organization.id,
        workDate: "2026-02-31",
      }),
    ).rejects.toBeInstanceOf(WorkCalendarValidationError);
  });
});
