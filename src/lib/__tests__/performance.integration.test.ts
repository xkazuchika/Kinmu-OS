import { performance } from "node:perf_hooks";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { GET as exportGet } from "@/app/api/exports/[kind]/route";
import { listManagedAttendance } from "@/lib/attendance";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import {
  attendanceDays,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
  organizations,
  users,
} from "@/lib/db/schema";
import { managementDashboard } from "@/lib/reporting";

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

  it("queries a full month and exports CSV within the v0.1 smoke budget", async () => {
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
            workDate: `2026-07-${String(day + 1).padStart(2, "0")}`,
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

    const attendanceStarted = performance.now();
    const attendance = await listManagedAttendance(client.db, {
      month: "2026-07",
      organizationId: organization.id,
    });
    const attendanceMs = performance.now() - attendanceStarted;

    const dashboardStarted = performance.now();
    const dashboard = await managementDashboard(client.db, organization.id, "2026-07");
    const dashboardMs = performance.now() - dashboardStarted;

    const session = await createSession(client.db, owner.id);
    const exportStarted = performance.now();
    const exported = await exportGet(
      new Request("http://kinmu.test/api/exports/attendance?month=2026-07", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
      }),
      { params: Promise.resolve({ kind: "attendance" }) },
    );
    const exportMs = performance.now() - exportStarted;
    const csv = await exported.text();

    console.info(
      `Performance smoke: attendance=${attendanceMs.toFixed(1)}ms dashboard=${dashboardMs.toFixed(1)}ms csv=${exportMs.toFixed(1)}ms`,
    );
    expect(attendance).toHaveLength(3_100);
    expect(dashboard.activeEmployees).toBe(100);
    expect(dashboard.overtime).toHaveLength(100);
    expect(exported.status).toBe(200);
    expect(csv.split("\r\n")).toHaveLength(3_102);
    expect(attendanceMs).toBeLessThan(3_000);
    expect(dashboardMs).toBeLessThan(3_000);
    expect(exportMs).toBeLessThan(3_000);
  }, 20_000);
});
