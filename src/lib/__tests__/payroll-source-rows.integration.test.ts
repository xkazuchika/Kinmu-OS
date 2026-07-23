import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import type { SessionActor } from "@/lib/authorization";
import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceMonthDaySnapshots,
  attendanceMonthPeriods,
  attendanceMonthRevisions,
  employees,
  organizations,
  users,
} from "@/lib/db/schema";
import { buildPayrollSourceRows } from "@/lib/payroll-source-rows";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("payroll source rows", () => {
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

  it("aggregates immutable day snapshots to one typed row per employee", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "給与集約組織" })
      .returning();
    const [owner] = await client.db
      .insert(users)
      .values({
        displayName: "給与管理者",
        email: "payroll-source@example.com",
        organizationId: organization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    const employeeRows = await client.db
      .insert(employees)
      .values([
        {
          employeeNumber: "SRC-001",
          familyName: "給与",
          givenName: "一郎",
          organizationId: organization.id,
        },
        {
          employeeNumber: "SRC-002",
          familyName: "旧版",
          givenName: "花子",
          organizationId: organization.id,
        },
      ])
      .returning();
    const [period] = await client.db
      .insert(attendanceMonthPeriods)
      .values({
        currentRevision: 1,
        nextRevision: 2,
        organizationId: organization.id,
        status: "closed",
        targetMonth: "2026-07",
      })
      .returning();
    const [revision] = await client.db
      .insert(attendanceMonthRevisions)
      .values({
        closedByUserId: owner.id,
        employeeCount: 2,
        organizationId: organization.id,
        periodId: period.id,
        revision: 1,
        targetMonth: "2026-07",
      })
      .returning();
    await client.db.insert(attendanceMonthDaySnapshots).values([
      {
        breakMinutes: 60,
        displayName: "給与 一郎",
        employeeId: employeeRows[0].id,
        employeeNumber: employeeRows[0].employeeNumber,
        operationalStatus: "worked",
        organizationId: organization.id,
        overtimeActualMinutes: 60,
        overtimeDifferenceMinutes: 0,
        overtimeMinutes: 60,
        overtimeReconciliationStatus: "within_request",
        overtimeRequestKind: "overtime",
        overtimeRequestedMinutes: 60,
        revisionId: revision.id,
        scheduledMinutes: 480,
        status: "complete",
        workDate: "2026-07-01",
        workedMinutes: 540,
      },
      {
        breakMinutes: 0,
        displayName: "給与 一郎",
        employeeId: employeeRows[0].id,
        employeeNumber: employeeRows[0].employeeNumber,
        operationalStatus: "absence",
        organizationId: organization.id,
        overtimeMinutes: 0,
        revisionId: revision.id,
        scheduledMinutes: 480,
        status: "complete",
        workDate: "2026-07-02",
        workedMinutes: 0,
      },
      {
        displayName: "旧版 花子",
        employeeId: employeeRows[1].id,
        employeeNumber: employeeRows[1].employeeNumber,
        organizationId: organization.id,
        revisionId: revision.id,
        scheduledMinutes: 480,
        status: "complete",
        workDate: "2026-07-01",
        workedMinutes: 480,
      },
    ]);
    const actor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };
    const rows = await buildPayrollSourceRows(client.db, actor, {
      mappings: employeeRows.map((employee, index) => ({
        displayName: employee.displayName,
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        externalEmployeeCode: `EXT-${index + 1}`,
        mappingVersion: 0,
      })),
      revisionId: revision.id,
    });

    expect(rows).toHaveLength(2);
    const currentRow = rows.find((row) => row.externalEmployeeCode === "EXT-1");
    const legacyRow = rows.find((row) => row.externalEmployeeCode === "EXT-2");
    expect(currentRow).toMatchObject({
      externalEmployeeCode: "EXT-1",
      unavailableFields: [],
      values: {
        absence_days: 1,
        attendance_revision: 1,
        break_minutes: 60,
        leave_units: 0,
        overtime_actual_minutes: 60,
        overtime_minutes: 60,
        overtime_requested_minutes: 60,
        scheduled_minutes: 960,
        target_month: "2026-07",
        worked_minutes: 540,
      },
    });
    expect(legacyRow?.unavailableFields).toEqual(
      expect.arrayContaining(["leave_units", "absence_days", "overtime_requested_minutes"]),
    );
  });
});
