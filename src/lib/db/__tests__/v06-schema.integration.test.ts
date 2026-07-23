import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceMonthPeriods,
  attendanceMonthRevisions,
  employees,
  organizations,
  payrollEmployeeMappings,
  payrollExportProfiles,
  payrollExportProfileVersions,
  payrollExportRuns,
  users,
} from "@/lib/db/schema";
import type { PayrollExportProfileConfig } from "@/lib/payroll-export-types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const profileConfig: PayrollExportProfileConfig = {
  schemaVersion: 1,
  encoding: "utf8_bom",
  lineEnding: "crlf",
  fileNamePattern: "payroll-{targetMonth}.csv",
  columns: [
    {
      id: "employee_number",
      header: "従業員番号",
      source: { kind: "field", field: "employee_number" },
      transform: { kind: "text" },
      required: true,
      formulaPolicy: "reject",
    },
  ],
};

async function expectDatabaseFailure(operation: Promise<unknown>, message: string) {
  try {
    await operation;
    throw new Error("The database operation unexpectedly succeeded.");
  } catch (error) {
    const cause = (error as { cause?: { message?: unknown } }).cause;

    expect(cause?.message).toContain(message);
  }
}

describeDatabase("v0.6 payroll export schema", () => {
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

  async function createFixture(label: string) {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: `${label}組織` })
      .returning();
    const [owner] = await client.db
      .insert(users)
      .values({
        displayName: `${label}管理者`,
        email: `${label.toLowerCase()}-owner@example.com`,
        organizationId: organization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: `${label}-001`,
        familyName: label,
        givenName: "従業員",
        organizationId: organization.id,
        status: "active",
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
      })
      .returning();
    const [profile] = await client.db
      .insert(payrollExportProfiles)
      .values({
        createdByUserId: owner.id,
        draftConfig: profileConfig,
        name: `${label}給与連携`,
        organizationId: organization.id,
        updatedByUserId: owner.id,
      })
      .returning();

    return { employee, organization, owner, period, profile, revision };
  }

  async function publishFixture(fixture: Awaited<ReturnType<typeof createFixture>>, version = 1) {
    const [profileVersion] = await client.db
      .insert(payrollExportProfileVersions)
      .values({
        configHash: "a".repeat(64),
        configSnapshot: profileConfig,
        encoding: profileConfig.encoding,
        lineEnding: profileConfig.lineEnding,
        organizationId: fixture.organization.id,
        profileId: fixture.profile.id,
        publishedByUserId: fixture.owner.id,
        schemaVersion: 1,
        version,
      })
      .returning();

    return profileVersion;
  }

  function runValues(fixture: Awaited<ReturnType<typeof createFixture>>, profileVersionId: string) {
    return {
      attendanceRevision: 1,
      attendanceRevisionId: fixture.revision.id,
      byteCount: 32,
      columnCount: 1,
      generatedByUserId: fixture.owner.id,
      generatorVersion: 1,
      manifest: {
        attendanceRevision: 1,
        attendanceRevisionId: fixture.revision.id,
        config: profileConfig,
        confirmedWarningCodes: [],
        generatorVersion: 1,
        mappings: [],
        profileId: fixture.profile.id,
        profileVersion: 1,
        profileVersionId,
        schemaVersion: 1,
        targetMonth: "2026-07",
      },
      organizationId: fixture.organization.id,
      periodId: fixture.period.id,
      profileVersionId,
      rowCount: 1,
      sha256: "b".repeat(64),
      targetMonth: "2026-07",
      validationSummary: { errorCount: 0, issueCounts: {}, warningCount: 0 },
    } satisfies typeof payrollExportRuns.$inferInsert;
  }

  it("enforces organization boundaries for actors and payroll references", async () => {
    const first = await createFixture("FIRST");
    const second = await createFixture("SECOND");

    await expectDatabaseFailure(
      client.db.insert(payrollExportProfiles).values({
        createdByUserId: second.owner.id,
        draftConfig: profileConfig,
        name: "組織境界違反",
        organizationId: first.organization.id,
      }),
      "payroll profile creator must belong",
    );
    await expectDatabaseFailure(
      client.db.insert(payrollExportProfileVersions).values({
        configHash: "a".repeat(64),
        configSnapshot: profileConfig,
        encoding: "utf8_bom",
        lineEnding: "crlf",
        organizationId: first.organization.id,
        profileId: second.profile.id,
        publishedByUserId: first.owner.id,
        schemaVersion: 1,
        version: 1,
      }),
      "payroll profile version references must belong",
    );
    await expectDatabaseFailure(
      client.db.insert(payrollEmployeeMappings).values({
        employeeId: second.employee.id,
        externalEmployeeCode: "EXT-001",
        organizationId: first.organization.id,
        profileId: first.profile.id,
        updatedByUserId: first.owner.id,
      }),
      "payroll employee mapping references must belong",
    );

    const secondVersion = await publishFixture(second);
    await expectDatabaseFailure(
      client.db.insert(payrollExportRuns).values(runValues(first, secondVersion.id)),
      "payroll export run references must belong",
    );
  });

  it("enforces profile version, employee mapping, data limit, and run constraints", async () => {
    const fixture = await createFixture("RULES");
    const profileVersion = await publishFixture(fixture);

    await expectDatabaseFailure(
      publishFixture(fixture),
      "payroll_export_profile_versions_profile_version_unique",
    );
    await client.db.insert(payrollEmployeeMappings).values({
      employeeId: fixture.employee.id,
      externalEmployeeCode: "EXT-001",
      organizationId: fixture.organization.id,
      profileId: fixture.profile.id,
      updatedByUserId: fixture.owner.id,
    });
    await expectDatabaseFailure(
      client.db.insert(payrollEmployeeMappings).values({
        employeeId: fixture.employee.id,
        externalEmployeeCode: "EXT-002",
        organizationId: fixture.organization.id,
        profileId: fixture.profile.id,
      }),
      "payroll_employee_mappings_org_profile_employee_unique",
    );
    await expectDatabaseFailure(
      client.db.insert(payrollExportProfileVersions).values({
        configHash: "invalid",
        configSnapshot: profileConfig,
        encoding: "utf8_bom",
        lineEnding: "crlf",
        organizationId: fixture.organization.id,
        profileId: fixture.profile.id,
        publishedByUserId: fixture.owner.id,
        schemaVersion: 1,
        version: 2,
      }),
      "payroll_export_profile_versions_hash_format",
    );
    await expectDatabaseFailure(
      client.db.insert(payrollExportRuns).values({
        ...runValues(fixture, profileVersion.id),
        byteCount: 0,
      }),
      "payroll_export_runs_byte_count_positive",
    );

    const indexes = (await client.db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'payroll_export_profiles_org_name_active_unique',
          'payroll_export_profile_versions_profile_version_unique',
          'payroll_employee_mappings_org_profile_code_unique',
          'payroll_export_runs_org_month_generated_idx'
        )
    `)) as unknown as Array<{ indexname: string }>;

    expect(indexes.map((row) => row.indexname).sort()).toEqual([
      "payroll_employee_mappings_org_profile_code_unique",
      "payroll_export_profile_versions_profile_version_unique",
      "payroll_export_profiles_org_name_active_unique",
      "payroll_export_runs_org_month_generated_idx",
    ]);
  });

  it("keeps published versions and export runs append-only", async () => {
    const fixture = await createFixture("IMMUTABLE");
    const profileVersion = await publishFixture(fixture);
    const [run] = await client.db
      .insert(payrollExportRuns)
      .values(runValues(fixture, profileVersion.id))
      .returning();

    await expectDatabaseFailure(
      client.db
        .update(payrollExportProfileVersions)
        .set({ configHash: "c".repeat(64) })
        .where(eq(payrollExportProfileVersions.id, profileVersion.id)),
      "payroll_export_profile_versions is append-only",
    );
    await expectDatabaseFailure(
      client.db
        .delete(payrollExportProfileVersions)
        .where(eq(payrollExportProfileVersions.id, profileVersion.id)),
      "payroll_export_profile_versions is append-only",
    );
    await expectDatabaseFailure(
      client.db
        .update(payrollExportRuns)
        .set({ sha256: "d".repeat(64) })
        .where(eq(payrollExportRuns.id, run.id)),
      "payroll_export_runs is append-only",
    );
    await expectDatabaseFailure(
      client.db.delete(payrollExportRuns).where(eq(payrollExportRuns.id, run.id)),
      "payroll_export_runs is append-only",
    );
  });
});
