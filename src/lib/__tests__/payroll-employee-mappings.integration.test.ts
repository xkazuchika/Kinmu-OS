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
import {
  commitPayrollMappingCsv,
  listPayrollEmployeeMappings,
  PayrollMappingConflictError,
  PayrollMappingValidationError,
  payrollMappingCsvTemplate,
  payrollMappingSnapshotForRevision,
  previewPayrollMappingCsv,
  savePayrollEmployeeMapping,
} from "@/lib/payroll-employee-mappings";
import { createPayrollExportProfile } from "@/lib/payroll-export-profiles";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const config: PayrollExportProfileConfig = {
  schemaVersion: 1,
  encoding: "utf8_bom",
  lineEnding: "crlf",
  fileNamePattern: "payroll-{targetMonth}.csv",
  columns: [
    {
      id: "external_employee_code",
      header: "従業員コード",
      source: { kind: "field", field: "external_employee_code" },
      transform: { kind: "text" },
      required: true,
      formulaPolicy: "reject",
    },
  ],
};

describeDatabase("payroll employee mappings", () => {
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

  async function fixture(label: string) {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: `${label}組織` })
      .returning();
    const [owner] = await client.db
      .insert(users)
      .values({
        displayName: `${label}管理者`,
        email: `${label.toLowerCase()}@example.com`,
        organizationId: organization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    const employeeRows = await client.db
      .insert(employees)
      .values([
        {
          employeeNumber: `${label}-001`,
          familyName: label,
          givenName: "一郎",
          organizationId: organization.id,
          status: "active" as const,
        },
        {
          employeeNumber: `${label}-002`,
          familyName: label,
          givenName: "二郎",
          organizationId: organization.id,
          status: "on_leave" as const,
        },
      ])
      .returning();
    const actor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };
    const profile = await createPayrollExportProfile(client.db, actor, {
      config,
      name: `${label}給与連携`,
    });
    return { actor, employees: employeeRows, organization, owner, profile };
  }

  it("lists employment status and applies create, update, remove, conflict, and uniqueness rules", async () => {
    const first = await fixture("MAP");
    const other = await fixture("OTHER");
    expect(
      await listPayrollEmployeeMappings(client.db, first.actor, first.profile.id),
    ).toMatchObject([
      { externalEmployeeCode: null, mappingVersion: null, status: "active" },
      { externalEmployeeCode: null, mappingVersion: null, status: "on_leave" },
    ]);

    const mapping = await savePayrollEmployeeMapping(client.db, first.actor, {
      employeeId: first.employees[0].id,
      expectedVersion: 0,
      externalEmployeeCode: "PAY-001",
      profileId: first.profile.id,
    });
    const updated = await savePayrollEmployeeMapping(client.db, first.actor, {
      employeeId: first.employees[0].id,
      expectedVersion: mapping!.version,
      externalEmployeeCode: "PAY-UPDATED",
      profileId: first.profile.id,
    });
    await expect(
      savePayrollEmployeeMapping(client.db, first.actor, {
        employeeId: first.employees[0].id,
        expectedVersion: mapping!.version,
        externalEmployeeCode: "PAY-STALE",
        profileId: first.profile.id,
      }),
    ).rejects.toBeInstanceOf(PayrollMappingConflictError);
    await expect(
      savePayrollEmployeeMapping(client.db, first.actor, {
        employeeId: first.employees[1].id,
        expectedVersion: 0,
        externalEmployeeCode: "PAY-UPDATED",
        profileId: first.profile.id,
      }),
    ).rejects.toThrow("同じ外部従業員コード");
    await expect(
      savePayrollEmployeeMapping(client.db, first.actor, {
        employeeId: other.employees[0].id,
        expectedVersion: 0,
        externalEmployeeCode: "PAY-OTHER",
        profileId: first.profile.id,
      }),
    ).rejects.toThrow("指定された給与連携リソースが見つかりません。");
    await expect(
      savePayrollEmployeeMapping(client.db, first.actor, {
        employeeId: first.employees[0].id,
        expectedVersion: updated!.version,
        externalEmployeeCode: null,
        profileId: first.profile.id,
      }),
    ).resolves.toBeNull();
  });

  it("validates every CSV row and commits all valid rows atomically", async () => {
    const data = await fixture("CSV");
    expect(payrollMappingCsvTemplate()).toBe("\uFEFFemployeeNumber,externalEmployeeCode\r\n");
    const invalidCsv = `employeeNumber,externalEmployeeCode\r\n${data.employees[0].employeeNumber},DUP\r\nUNKNOWN,DUP,EXTRA\r\n`;
    const invalid = await previewPayrollMappingCsv(client.db, data.actor, {
      csv: invalidCsv,
      profileId: data.profile.id,
    });
    expect(invalid.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "列数が2列ではありません。",
        "組織内に従業員番号が見つかりません。",
        "外部従業員コードがCSV内で重複しています。",
      ]),
    );
    await expect(
      commitPayrollMappingCsv(client.db, data.actor, {
        csv: invalidCsv,
        profileId: data.profile.id,
      }),
    ).rejects.toBeInstanceOf(PayrollMappingValidationError);
    expect(
      (await listPayrollEmployeeMappings(client.db, data.actor, data.profile.id)).every(
        (row) => row.externalEmployeeCode === null,
      ),
    ).toBe(true);

    const validCsv = `\uFEFFemployeeNumber,externalEmployeeCode\r\n${data.employees[0].employeeNumber},CSV-001\r\n${data.employees[1].employeeNumber},CSV-002\r\n`;
    await expect(
      commitPayrollMappingCsv(client.db, data.actor, {
        csv: validCsv,
        profileId: data.profile.id,
      }),
    ).resolves.toBe(2);
  });

  it("snapshots mapping versions for revision employees and reports missing mappings", async () => {
    const data = await fixture("SNAP");
    const [period] = await client.db
      .insert(attendanceMonthPeriods)
      .values({
        currentRevision: 1,
        nextRevision: 2,
        organizationId: data.organization.id,
        status: "closed",
        targetMonth: "2026-07",
      })
      .returning();
    const [revision] = await client.db
      .insert(attendanceMonthRevisions)
      .values({
        closedByUserId: data.owner.id,
        employeeCount: 2,
        organizationId: data.organization.id,
        periodId: period.id,
        revision: 1,
        targetMonth: "2026-07",
      })
      .returning();
    await client.db.insert(attendanceMonthDaySnapshots).values(
      data.employees.map((employee, index) => ({
        displayName: employee.displayName,
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        organizationId: data.organization.id,
        revisionId: revision.id,
        scheduledMinutes: 480,
        status: "complete" as const,
        workDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        workedMinutes: 480,
      })),
    );
    const mapping = await savePayrollEmployeeMapping(client.db, data.actor, {
      employeeId: data.employees[0].id,
      expectedVersion: 0,
      externalEmployeeCode: "SNAP-001",
      profileId: data.profile.id,
    });
    const captured = await payrollMappingSnapshotForRevision(client.db, data.actor, {
      profileId: data.profile.id,
      revisionId: revision.id,
    });
    expect(captured.missingEmployeeIds).toEqual([data.employees[1].id]);
    expect(captured.snapshots).toMatchObject([
      { externalEmployeeCode: "SNAP-001", mappingVersion: mapping!.version },
    ]);

    await savePayrollEmployeeMapping(client.db, data.actor, {
      employeeId: data.employees[0].id,
      expectedVersion: mapping!.version,
      externalEmployeeCode: "CHANGED-001",
      profileId: data.profile.id,
    });
    expect(captured.snapshots[0].externalEmployeeCode).toBe("SNAP-001");
  });
});
