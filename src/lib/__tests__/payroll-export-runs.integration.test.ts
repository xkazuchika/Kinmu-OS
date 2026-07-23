import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { SessionActor } from "@/lib/authorization";
import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceMonthDaySnapshots,
  attendanceMonthPeriods,
  attendanceMonthRevisions,
  auditLogs,
  employees,
  organizations,
  payrollExportRuns,
  users,
} from "@/lib/db/schema";
import { savePayrollEmployeeMapping } from "@/lib/payroll-employee-mappings";
import {
  generatePayrollExportRun,
  inspectPayrollExport,
  listPayrollExportRuns,
  PayrollExportConflictError,
  PayrollExportIntegrityError,
  PayrollExportValidationError,
  redownloadPayrollExportRun,
} from "@/lib/payroll-export-runs";
import {
  createPayrollExportProfile,
  publishPayrollExportProfile,
} from "@/lib/payroll-export-profiles";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const config: PayrollExportProfileConfig = {
  schemaVersion: 1,
  encoding: "utf8_bom",
  lineEnding: "crlf",
  fileNamePattern: "payroll-{targetMonth}-r{revision}.csv",
  columns: [
    {
      id: "external_code",
      header: "外部コード",
      source: { kind: "field", field: "external_employee_code" },
      transform: { kind: "text" },
      required: true,
      formulaPolicy: "reject",
    },
    {
      id: "worked_minutes",
      header: "実働分",
      source: { kind: "field", field: "worked_minutes" },
      transform: { kind: "minutes" },
      required: true,
      formulaPolicy: "reject",
    },
    {
      id: "fixed_secret",
      header: "会社区分",
      source: { kind: "fixed", value: "SECRET-FIXED-VALUE" },
      transform: { kind: "text" },
      required: false,
      formulaPolicy: "reject",
    },
  ],
};

describeDatabase("payroll export inspection and runs", () => {
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

  async function fixture() {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "給与出力組織" })
      .returning();
    const [owner] = await client.db
      .insert(users)
      .values({
        displayName: "給与管理者",
        email: "payroll-run@example.com",
        organizationId: organization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "RUN-001",
        familyName: "出力",
        givenName: "花子",
        organizationId: organization.id,
      })
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
        employeeCount: 1,
        organizationId: organization.id,
        periodId: period.id,
        revision: 1,
        targetMonth: "2026-07",
        workedMinutes: 480,
      })
      .returning();
    await client.db.insert(attendanceMonthDaySnapshots).values({
      breakMinutes: 60,
      displayName: "出力 花子",
      employeeId: employee.id,
      employeeNumber: employee.employeeNumber,
      operationalStatus: "worked",
      organizationId: organization.id,
      overtimeMinutes: 0,
      revisionId: revision.id,
      scheduledMinutes: 480,
      status: "complete",
      workDate: "2026-07-01",
      workedMinutes: 480,
    });
    const actor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };
    const profile = await createPayrollExportProfile(client.db, actor, {
      config,
      name: "給与出力",
    });
    const published = await publishPayrollExportProfile(client.db, actor, {
      expectedVersion: profile.version,
      profileId: profile.id,
    });
    const mapping = await savePayrollEmployeeMapping(client.db, actor, {
      employeeId: employee.id,
      expectedVersion: 0,
      externalEmployeeCode: "PAY-001",
      profileId: profile.id,
    });
    return {
      actor,
      employee,
      mapping: mapping!,
      organization,
      period,
      profile,
      published,
      revision,
    };
  }

  it("inspects all rows, creates append-only runs, and reproduces identical downloads", async () => {
    const data = await fixture();
    const inspection = await inspectPayrollExport(client.db, data.actor, {
      month: "2026-07",
      pageSize: 1,
      profileVersionId: data.published.publishedVersion.id,
    });
    expect(inspection).toMatchObject({
      page: 1,
      pageCount: 1,
      summary: { errorCount: 0, warningCount: 0 },
      totalRows: 1,
    });
    expect(inspection.previewRows[0]).toMatchObject({
      cells: [
        { columnId: "external_code", sourceValue: "PAY-001", value: "PAY-001" },
        { columnId: "worked_minutes", sourceValue: 480, value: "480" },
        {
          columnId: "fixed_secret",
          sourceValue: "SECRET-FIXED-VALUE",
          value: "SECRET-FIXED-VALUE",
        },
      ],
    });
    const expectedMappingVersions = { [data.employee.id]: data.mapping.version };
    const first = await generatePayrollExportRun(client.db, data.actor, {
      confirmedWarningCodes: [],
      expectedMappingVersions,
      expectedRevision: 1,
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
    });
    const second = await generatePayrollExportRun(client.db, data.actor, {
      confirmedWarningCodes: [],
      expectedMappingVersions,
      expectedRevision: 1,
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
      sourceRunId: first.run.id,
    });
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.run.sha256).toBe(first.run.sha256);
    expect(second.run.kind).toBe("regenerated");

    const downloaded = await redownloadPayrollExportRun(client.db, data.actor, first.run.id);
    expect(downloaded.bytes.equals(first.bytes)).toBe(true);
    expect(await listPayrollExportRuns(client.db, data.actor, "2026-07")).toMatchObject([
      { id: second.run.id, isLatestRevision: true },
      { id: first.run.id, isLatestRevision: true },
    ]);
    const payrollAudits = await client.db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, data.organization.id));
    expect(payrollAudits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "payroll_export_validated",
        "payroll_export_generated",
        "payroll_export_regenerated",
        "payroll_export_downloaded",
      ]),
    );
    const auditText = JSON.stringify(payrollAudits);
    expect(auditText).not.toContain("PAY-001");
    expect(auditText).not.toContain("SECRET-FIXED-VALUE");
  });

  it("detects mapping races and preserves old runs when the month is reopened", async () => {
    const data = await fixture();
    await savePayrollEmployeeMapping(client.db, data.actor, {
      employeeId: data.employee.id,
      expectedVersion: data.mapping.version,
      externalEmployeeCode: "PAY-CHANGED",
      profileId: data.profile.id,
    });
    await expect(
      generatePayrollExportRun(client.db, data.actor, {
        confirmedWarningCodes: [],
        expectedMappingVersions: { [data.employee.id]: data.mapping.version },
        expectedRevision: 1,
        month: "2026-07",
        profileVersionId: data.published.publishedVersion.id,
      }),
    ).rejects.toBeInstanceOf(PayrollExportConflictError);

    const latest = await inspectPayrollExport(client.db, data.actor, {
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
    });
    const run = await generatePayrollExportRun(client.db, data.actor, {
      confirmedWarningCodes: [],
      expectedMappingVersions: Object.fromEntries(
        latest.mappings.map((mapping) => [mapping.employeeId, mapping.mappingVersion]),
      ),
      expectedRevision: 1,
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
    });
    await client.db
      .update(attendanceMonthRevisions)
      .set({
        reopenedAt: new Date(),
        reopenedByUserId: data.actor.userId,
        reopenReason: "勤怠修正",
      })
      .where(eq(attendanceMonthRevisions.id, data.revision.id));
    await client.db
      .update(attendanceMonthPeriods)
      .set({ currentRevision: null, status: "open" })
      .where(eq(attendanceMonthPeriods.id, data.period.id));

    await expect(
      inspectPayrollExport(client.db, data.actor, {
        month: "2026-07",
        profileVersionId: data.published.publishedVersion.id,
      }),
    ).rejects.toMatchObject({ code: "attendance_month_not_closed" });
    expect(await redownloadPayrollExportRun(client.db, data.actor, run.run.id)).toMatchObject({
      run: { id: run.run.id },
    });
    expect((await listPayrollExportRuns(client.db, data.actor, "2026-07"))[0]).toMatchObject({
      id: run.run.id,
      isLatestRevision: false,
    });
  });

  it("refuses a hash-mismatched run and records an integrity audit without changing it", async () => {
    const data = await fixture();
    const inspection = await inspectPayrollExport(client.db, data.actor, {
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
    });
    const [badRun] = await client.db
      .insert(payrollExportRuns)
      .values({
        attendanceRevision: 1,
        attendanceRevisionId: data.revision.id,
        byteCount: inspection.generated.bytes.length,
        columnCount: inspection.generated.columnCount,
        generatedByUserId: data.actor.userId,
        generatorVersion: 1,
        manifest: {
          attendanceRevision: 1,
          attendanceRevisionId: data.revision.id,
          config,
          confirmedWarningCodes: [],
          generatorVersion: 1,
          mappings: inspection.mappings,
          profileId: data.profile.id,
          profileVersion: 1,
          profileVersionId: data.published.publishedVersion.id,
          schemaVersion: 1,
          targetMonth: "2026-07",
        },
        organizationId: data.organization.id,
        periodId: data.period.id,
        profileVersionId: data.published.publishedVersion.id,
        rowCount: 1,
        sha256: "f".repeat(64),
        targetMonth: "2026-07",
        validationSummary: inspection.summary,
      })
      .returning();
    await expect(
      redownloadPayrollExportRun(client.db, data.actor, badRun.id),
    ).rejects.toBeInstanceOf(PayrollExportIntegrityError);
    const [preserved] = await client.db
      .select({ sha256: payrollExportRuns.sha256 })
      .from(payrollExportRuns)
      .where(eq(payrollExportRuns.id, badRun.id));
    expect(preserved.sha256).toBe("f".repeat(64));
    expect(
      await client.db
        .select()
        .from(auditLogs)
        .where(
          sql`${auditLogs.entityId} = ${badRun.id} AND ${auditLogs.action} = 'payroll_export_integrity_failed'`,
        ),
    ).toHaveLength(1);
  });

  it("rejects missing mappings and unclosed months before creating a run", async () => {
    const data = await fixture();
    await savePayrollEmployeeMapping(client.db, data.actor, {
      employeeId: data.employee.id,
      expectedVersion: data.mapping.version,
      externalEmployeeCode: null,
      profileId: data.profile.id,
    });
    const inspection = await inspectPayrollExport(client.db, data.actor, {
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
    });
    expect(inspection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "mapping_missing", severity: "error" }),
      ]),
    );
    await expect(
      generatePayrollExportRun(client.db, data.actor, {
        confirmedWarningCodes: [],
        expectedMappingVersions: {},
        expectedRevision: 1,
        month: "2026-07",
        profileVersionId: data.published.publishedVersion.id,
      }),
    ).rejects.toBeInstanceOf(PayrollExportValidationError);
  });

  it("serializes concurrent generation and keeps both explicit runs", async () => {
    const data = await fixture();
    const input = {
      confirmedWarningCodes: [],
      expectedMappingVersions: { [data.employee.id]: data.mapping.version },
      expectedRevision: 1,
      month: "2026-07",
      profileVersionId: data.published.publishedVersion.id,
    };
    const [first, second] = await Promise.all([
      generatePayrollExportRun(client.db, data.actor, input),
      generatePayrollExportRun(client.db, data.actor, input),
    ]);

    expect(first.run.id).not.toBe(second.run.id);
    expect(first.run.sha256).toBe(second.run.sha256);
    expect(await listPayrollExportRuns(client.db, data.actor, "2026-07")).toHaveLength(2);
  });

  it("rolls back the run when its audit record cannot be saved", async () => {
    const data = await fixture();
    await client.db.execute(sql`
      CREATE FUNCTION fail_payroll_generated_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'payroll_export_generated' THEN
          RAISE EXCEPTION 'forced payroll audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.db.execute(sql`
      CREATE TRIGGER fail_payroll_generated_audit_trigger
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_payroll_generated_audit()
    `);
    try {
      await expect(
        generatePayrollExportRun(client.db, data.actor, {
          confirmedWarningCodes: [],
          expectedMappingVersions: { [data.employee.id]: data.mapping.version },
          expectedRevision: 1,
          month: "2026-07",
          profileVersionId: data.published.publishedVersion.id,
        }),
      ).rejects.toBeDefined();
      expect(await listPayrollExportRuns(client.db, data.actor, "2026-07")).toHaveLength(0);
    } finally {
      await client.db.execute(sql`DROP TRIGGER fail_payroll_generated_audit_trigger ON audit_logs`);
      await client.db.execute(sql`DROP FUNCTION fail_payroll_generated_audit()`);
    }
  });
});
