import { performance } from "node:perf_hooks";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { GET as exportGet } from "@/app/api/exports/[kind]/route";
import { listManagedAttendance } from "@/lib/attendance";
import { closeAttendanceMonth } from "@/lib/attendance-closing";
import type { SessionActor } from "@/lib/authorization";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import {
  attendanceDays,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
  notifications,
  organizations,
  overtimeRequestPolicies,
  overtimeWorkRequests,
  payrollEmployeeMappings,
  users,
} from "@/lib/db/schema";
import { managementDashboard } from "@/lib/reporting";
import { listNotifications } from "@/lib/notifications";
import {
  createDraftFromPublishedPayrollProfile,
  createPayrollExportProfile,
  publishPayrollExportProfile,
  savePayrollExportProfileDraft,
} from "@/lib/payroll-export-profiles";
import {
  generatePayrollExportRun,
  inspectPayrollExport,
  listPayrollExportRuns,
  redownloadPayrollExportRun,
} from "@/lib/payroll-export-runs";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("100 employee performance smoke", () => {
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

  it("queries a full month and exports CSV within the small-team smoke budget", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "100名性能検証" })
      .returning();
    const [owner] = await client.db
      .insert(users)
      .values({
        displayName: "性能検証所有者",
        email: "performance-owner@example.com",
        organizationId: organization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "PERF", name: "性能検証部", organizationId: organization.id })
      .returning();
    const employeeUsers = await client.db
      .insert(users)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          displayName: `従業員 ${String(index + 1).padStart(3, "0")}`,
          email: `performance-employee-${index + 1}@example.com`,
          organizationId: organization.id,
          role: "employee" as const,
          status: "active" as const,
        })),
      )
      .returning();
    const employeeRows = await client.db
      .insert(employees)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          displayName: `従業員 ${String(index + 1).padStart(3, "0")}`,
          employeeNumber: `P${String(index + 1).padStart(3, "0")}`,
          employmentType: "full_time" as const,
          familyName: "性能",
          givenName: String(index + 1),
          joinedOn: "2026-01-01",
          organizationId: organization.id,
          status: "active" as const,
          userId: employeeUsers[index].id,
        })),
      )
      .returning();
    await client.db.insert(employeeDepartments).values(
      employeeRows.map((employee) => ({
        departmentId: department.id,
        employeeId: employee.id,
        startedOn: "2026-01-01",
      })),
    );
    const dayRows = await client.db
      .insert(attendanceDays)
      .values(
        employeeRows.flatMap((employee) =>
          Array.from({ length: 31 }, (_, day) => ({
            employeeId: employee.id,
            organizationId: organization.id,
            scheduledMinutes: 480,
            status: "complete" as const,
            workDate: `2026-05-${String(day + 1).padStart(2, "0")}`,
          })),
        ),
      )
      .returning();
    await client.db.insert(dailyAttendanceSummaries).values(
      dayRows.map((day, index) => ({
        attendanceDayId: day.id,
        breakMinutes: 60,
        overtimeMinutes: index % 5,
        scheduledMinutes: 480,
        status: "complete" as const,
        workedMinutes: 480 + (index % 5),
      })),
    );
    const [policy] = await client.db
      .insert(overtimeRequestPolicies)
      .values({
        activatedAt: new Date(),
        activatedByUserId: owner.id,
        allowedDeviationMinutes: 15,
        blockCloseOnUnresolvedDifference: false,
        effectiveFrom: "2026-05-01",
        organizationId: organization.id,
        requirePriorApproval: false,
        status: "active",
      })
      .returning();
    const requestRows = await client.db
      .insert(overtimeWorkRequests)
      .values(
        employeeRows.flatMap((employee, index) =>
          [0, 1].map((slot) => ({
            employeeId: employee.id,
            kind: "overtime" as const,
            organizationId: organization.id,
            plannedEndAt: new Date(`2026-05-10T${String(11 + slot).padStart(2, "0")}:00:00.000Z`),
            plannedMinutes: 30,
            plannedStartAt: new Date(`2026-05-10T${String(10 + slot).padStart(2, "0")}:00:00.000Z`),
            policyId: policy.id,
            reason: `性能検証申請${index + 1}-${slot + 1}`,
            requestedByUserId: employeeUsers[index].id,
            reviewedAt: new Date(),
            reviewerUserId: owner.id,
            status: "approved" as const,
            workDate: "2026-05-10",
          })),
        ),
      )
      .returning({ id: overtimeWorkRequests.id });
    await client.db.insert(notifications).values(
      Array.from({ length: 500 }, (_, index) => ({
        entityId: requestRows[index % requestRows.length].id,
        entityType: "overtime_work_request",
        kind: "overtime_request_approved" as const,
        organizationId: organization.id,
        recipientUserId: owner.id,
        summary: `性能検証通知${index + 1}`,
        title: "残業申請が承認されました",
      })),
    );
    const ownerActor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };

    const attendanceStarted = performance.now();
    const attendance = await listManagedAttendance(client.db, {
      month: "2026-05",
      organizationId: organization.id,
    });
    const attendanceMs = performance.now() - attendanceStarted;

    const dashboardStarted = performance.now();
    const dashboard = await managementDashboard(client.db, organization.id, "2026-05");
    const dashboardMs = performance.now() - dashboardStarted;

    const notificationStarted = performance.now();
    const notificationInbox = await listNotifications(client.db, ownerActor, { limit: 30 });
    const notificationMs = performance.now() - notificationStarted;

    const closingStarted = performance.now();
    await closeAttendanceMonth(client.db, ownerActor, {
      expectedVersion: 0,
      month: "2026-05",
    });
    const closingMs = performance.now() - closingStarted;

    const closedListStarted = performance.now();
    const closedAttendance = await listManagedAttendance(client.db, {
      month: "2026-05",
      organizationId: organization.id,
    });
    const closedListMs = performance.now() - closedListStarted;

    const session = await createSession(client.db, owner.id);
    const exportStarted = performance.now();
    const exported = await exportGet(
      new Request("http://kinmu.test/api/exports/attendance?month=2026-05", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
      }),
      { params: Promise.resolve({ kind: "attendance" }) },
    );
    const exportMs = performance.now() - exportStarted;
    const csv = await exported.text();

    const payrollColumns: PayrollExportProfileConfig["columns"] = Array.from(
      { length: 60 },
      (_, index) =>
        index === 0
          ? {
              formulaPolicy: "reject" as const,
              header: "外部従業員コード",
              id: "external_employee_code",
              required: true,
              source: { field: "external_employee_code", kind: "field" as const },
              transform: { kind: "text" as const },
            }
          : {
              formulaPolicy: "reject" as const,
              header: `実働分${String(index).padStart(2, "0")}`,
              id: `worked_minutes_${String(index).padStart(2, "0")}`,
              required: true,
              source: { field: "worked_minutes", kind: "field" as const },
              transform: { kind: "minutes" as const },
            },
    );
    const utf8Config: PayrollExportProfileConfig = {
      columns: payrollColumns,
      encoding: "utf8_bom",
      fileNamePattern: "performance-{targetMonth}-r{revision}.csv",
      lineEnding: "crlf",
      schemaVersion: 1,
    };
    const profile = await createPayrollExportProfile(client.db, ownerActor, {
      config: utf8Config,
      name: "100名60列性能検証",
    });
    const utf8Published = await publishPayrollExportProfile(client.db, ownerActor, {
      expectedVersion: profile.version,
      profileId: profile.id,
    });
    const draft = await createDraftFromPublishedPayrollProfile(client.db, ownerActor, {
      expectedVersion: utf8Published.profile.version,
      profileId: profile.id,
    });
    const cp932Config: PayrollExportProfileConfig = { ...utf8Config, encoding: "cp932" };
    const cp932Draft = await savePayrollExportProfileDraft(client.db, ownerActor, {
      config: cp932Config,
      expectedVersion: draft.version,
      name: profile.name,
      profileId: profile.id,
    });
    const cp932Published = await publishPayrollExportProfile(client.db, ownerActor, {
      expectedVersion: cp932Draft.version,
      profileId: profile.id,
    });
    await client.db.insert(payrollEmployeeMappings).values(
      employeeRows.map((employee, index) => ({
        employeeId: employee.id,
        externalEmployeeCode: `PAY${String(index + 1).padStart(3, "0")}`,
        organizationId: organization.id,
        profileId: profile.id,
        updatedByUserId: owner.id,
      })),
    );

    const inspectUtf8Started = performance.now();
    const utf8Inspection = await inspectPayrollExport(client.db, ownerActor, {
      month: "2026-05",
      page: 2,
      pageSize: 25,
      profileVersionId: utf8Published.publishedVersion.id,
    });
    const inspectUtf8Ms = performance.now() - inspectUtf8Started;
    const mappingVersions = Object.fromEntries(
      utf8Inspection.mappings.map((mapping) => [mapping.employeeId, mapping.mappingVersion]),
    );
    const generateUtf8Started = performance.now();
    const utf8Run = await generatePayrollExportRun(client.db, ownerActor, {
      confirmedWarningCodes: [],
      expectedMappingVersions: mappingVersions,
      expectedRevision: 1,
      month: "2026-05",
      profileVersionId: utf8Published.publishedVersion.id,
    });
    const generateUtf8Ms = performance.now() - generateUtf8Started;

    const inspectCp932Started = performance.now();
    const cp932Inspection = await inspectPayrollExport(client.db, ownerActor, {
      month: "2026-05",
      pageSize: 100,
      profileVersionId: cp932Published.publishedVersion.id,
    });
    const inspectCp932Ms = performance.now() - inspectCp932Started;
    const generateCp932Started = performance.now();
    const cp932Run = await generatePayrollExportRun(client.db, ownerActor, {
      confirmedWarningCodes: [],
      expectedMappingVersions: Object.fromEntries(
        cp932Inspection.mappings.map((mapping) => [mapping.employeeId, mapping.mappingVersion]),
      ),
      expectedRevision: 1,
      month: "2026-05",
      profileVersionId: cp932Published.publishedVersion.id,
    });
    const generateCp932Ms = performance.now() - generateCp932Started;
    const historyStarted = performance.now();
    const payrollHistory = await listPayrollExportRuns(client.db, ownerActor, "2026-05");
    const historyMs = performance.now() - historyStarted;
    const redownloadStarted = performance.now();
    const redownloaded = await redownloadPayrollExportRun(client.db, ownerActor, utf8Run.run.id);
    const redownloadMs = performance.now() - redownloadStarted;

    console.info(
      `Performance smoke: attendance=${attendanceMs.toFixed(1)}ms dashboard=${dashboardMs.toFixed(1)}ms notifications=${notificationMs.toFixed(1)}ms closing=${closingMs.toFixed(1)}ms closed-list=${closedListMs.toFixed(1)}ms csv=${exportMs.toFixed(1)}ms payroll-utf8-inspect=${inspectUtf8Ms.toFixed(1)}ms payroll-utf8-generate=${generateUtf8Ms.toFixed(1)}ms payroll-cp932-inspect=${inspectCp932Ms.toFixed(1)}ms payroll-cp932-generate=${generateCp932Ms.toFixed(1)}ms payroll-history=${historyMs.toFixed(1)}ms payroll-redownload=${redownloadMs.toFixed(1)}ms`,
    );
    expect(attendance).toHaveLength(3_100);
    expect(closedAttendance).toHaveLength(3_100);
    expect(dashboard.activeEmployees).toBe(100);
    expect(dashboard.overtime).toHaveLength(100);
    expect(notificationInbox).toMatchObject({ unreadCount: 500 });
    expect(notificationInbox.items).toHaveLength(30);
    expect(exported.status).toBe(200);
    expect(csv.split("\r\n")).toHaveLength(3_102);
    expect(attendanceMs).toBeLessThan(3_000);
    expect(dashboardMs).toBeLessThan(3_000);
    expect(notificationMs).toBeLessThan(3_000);
    expect(exportMs).toBeLessThan(3_000);
    expect(closingMs).toBeLessThan(3_000);
    expect(closedListMs).toBeLessThan(3_000);
    expect(utf8Inspection).toMatchObject({ page: 2, pageCount: 4, totalRows: 100 });
    expect(utf8Inspection.previewRows).toHaveLength(25);
    expect(cp932Inspection).toMatchObject({ pageCount: 1, totalRows: 100 });
    expect(utf8Run.run).toMatchObject({ columnCount: 60, rowCount: 100 });
    expect(cp932Run.run).toMatchObject({ columnCount: 60, rowCount: 100 });
    expect(payrollHistory).toHaveLength(2);
    expect(redownloaded.bytes.equals(utf8Run.bytes)).toBe(true);
    expect(inspectUtf8Ms).toBeLessThan(3_000);
    expect(generateUtf8Ms).toBeLessThan(3_000);
    expect(inspectCp932Ms).toBeLessThan(3_000);
    expect(generateCp932Ms).toBeLessThan(3_000);
    expect(historyMs).toBeLessThan(3_000);
    expect(redownloadMs).toBeLessThan(3_000);
  }, 30_000);
});
