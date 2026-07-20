import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function databaseConnectionUrl(source: string, databaseName: string) {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function migrationFiles() {
  return (await readdir(join(process.cwd(), "drizzle")))
    .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
    .sort();
}

async function applyMigrationFiles(connection: postgres.Sql, fileNames: string[]) {
  for (const fileName of fileNames) {
    const source = await readFile(join(process.cwd(), "drizzle", fileName), "utf8");
    const statements = source
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await connection.unsafe(statement);
    }
  }
}

async function withTemporaryDatabase(
  sourceUrl: string,
  run: (connection: postgres.Sql) => Promise<void>,
) {
  const databaseName = `kinmu_v04_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const admin = postgres(databaseConnectionUrl(sourceUrl, "postgres"), { max: 1 });

  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const connection = postgres(databaseConnectionUrl(sourceUrl, databaseName), { max: 1 });

  try {
    await run(connection);
  } finally {
    await connection.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
}

describeDatabase("v0.4 and v0.5 additive migrations", () => {
  it("migrates an empty database through v0.5", async () => {
    await withTemporaryDatabase(databaseUrl!, async (connection) => {
      await applyMigrationFiles(connection, await migrationFiles());

      const [{ tableCount }] = await connection<{ tableCount: number }[]>`
          SELECT count(*)::integer AS "tableCount"
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'work_calendar_patterns',
              'work_calendar_date_exceptions',
              'leave_types',
              'leave_balance_accounts',
              'leave_grant_lots',
              'leave_transactions',
              'leave_requests',
              'leave_request_days',
              'absence_records',
              'import_batches',
              'overtime_request_policies',
              'overtime_work_requests',
              'notifications'
            )
        `;

      expect(tableCount).toBe(13);
    });
  }, 30_000);

  it("adds one inactive weekday draft to a v0.3 organization without rewriting closed snapshots", async () => {
    await withTemporaryDatabase(databaseUrl!, async (connection) => {
      const files = await migrationFiles();
      const v03Files = files.filter((fileName) => Number(fileName.slice(0, 4)) <= 11);
      const v04Files = files.filter((fileName) => Number(fileName.slice(0, 4)) >= 12);
      await applyMigrationFiles(connection, v03Files);

      const [organization] = await connection<{ id: string }[]>`
          INSERT INTO organizations (name)
          VALUES ('v0.3移行組織')
          RETURNING id
        `;
      const [owner] = await connection<{ id: string }[]>`
          INSERT INTO users (organization_id, email, display_name, role, status)
          VALUES (${organization.id}, 'migration-owner@example.com', '移行管理者', 'owner', 'active')
          RETURNING id
        `;
      const [employee] = await connection<{ id: string }[]>`
          INSERT INTO employees (
            organization_id,
            user_id,
            employee_number,
            family_name,
            given_name,
            status
          )
          VALUES (${organization.id}, ${owner.id}, 'MIG-001', '移行', '従業員', 'active')
          RETURNING id
        `;
      const [period] = await connection<{ id: string }[]>`
          INSERT INTO attendance_month_periods (
            organization_id,
            target_month,
            status,
            current_revision,
            next_revision
          )
          VALUES (${organization.id}, '2026-06', 'closed', 1, 2)
          RETURNING id
        `;
      const [revision] = await connection<{ id: string }[]>`
          INSERT INTO attendance_month_revisions (
            period_id,
            organization_id,
            target_month,
            revision,
            closed_by_user_id,
            employee_count,
            day_count,
            scheduled_minutes,
            worked_minutes,
            overtime_minutes
          )
          VALUES (
            ${period.id},
            ${organization.id},
            '2026-06',
            1,
            ${owner.id},
            1,
            1,
            480,
            480,
            0
          )
          RETURNING id
        `;
      const [snapshot] = await connection<{ id: string }[]>`
          INSERT INTO attendance_month_day_snapshots (
            revision_id,
            organization_id,
            employee_id,
            employee_number,
            display_name,
            work_date,
            status,
            scheduled_minutes,
            worked_minutes,
            break_minutes,
            overtime_minutes
          )
          VALUES (
            ${revision.id},
            ${organization.id},
            ${employee.id},
            'MIG-001',
            '移行 従業員',
            '2026-06-30',
            'complete',
            480,
            480,
            60,
            0
          )
          RETURNING id
        `;

      await applyMigrationFiles(connection, v04Files);

      const [draft] = await connection<
        {
          friday: boolean;
          monday: boolean;
          saturday: boolean;
          status: string;
          sunday: boolean;
        }[]
      >`
          SELECT
            status,
            monday_workday AS monday,
            friday_workday AS friday,
            saturday_workday AS saturday,
            sunday_workday AS sunday
          FROM work_calendar_patterns
          WHERE organization_id = ${organization.id}
        `;
      const [preservedSnapshot] = await connection<
        {
          id: string;
          operationalStatus: string | null;
          scheduledMinutes: number;
          workedMinutes: number | null;
        }[]
      >`
          SELECT
            id,
            operational_status AS "operationalStatus",
            scheduled_minutes AS "scheduledMinutes",
            worked_minutes AS "workedMinutes"
          FROM attendance_month_day_snapshots
          WHERE id = ${snapshot.id}
        `;

      expect(draft).toEqual({
        friday: true,
        monday: true,
        saturday: false,
        status: "draft",
        sunday: false,
      });
      expect(preservedSnapshot).toEqual({
        id: snapshot.id,
        operationalStatus: null,
        scheduledMinutes: 480,
        workedMinutes: 480,
      });
    });
  }, 30_000);

  it("adds one inactive overtime policy draft to a v0.4 organization without rewriting closed snapshots", async () => {
    await withTemporaryDatabase(databaseUrl!, async (connection) => {
      const files = await migrationFiles();
      const v04Files = files.filter((fileName) => Number(fileName.slice(0, 4)) <= 14);
      const v05Files = files.filter((fileName) => Number(fileName.slice(0, 4)) >= 15);
      await applyMigrationFiles(connection, v04Files);

      const [organization] = await connection<{ id: string }[]>`
          INSERT INTO organizations (name)
          VALUES ('v0.4移行組織')
          RETURNING id
        `;
      const [owner] = await connection<{ id: string }[]>`
          INSERT INTO users (organization_id, email, display_name, role, status)
          VALUES (${organization.id}, 'v05-migration-owner@example.com', 'v0.5移行管理者', 'owner', 'active')
          RETURNING id
        `;
      const [employee] = await connection<{ id: string }[]>`
          INSERT INTO employees (
            organization_id,
            user_id,
            employee_number,
            family_name,
            given_name,
            status
          )
          VALUES (${organization.id}, ${owner.id}, 'V05-001', '移行', '従業員', 'active')
          RETURNING id
        `;
      const [period] = await connection<{ id: string }[]>`
          INSERT INTO attendance_month_periods (
            organization_id,
            target_month,
            status,
            current_revision,
            next_revision
          )
          VALUES (${organization.id}, '2026-06', 'closed', 1, 2)
          RETURNING id
        `;
      const [revision] = await connection<{ id: string }[]>`
          INSERT INTO attendance_month_revisions (
            period_id,
            organization_id,
            target_month,
            revision,
            closed_by_user_id,
            employee_count,
            day_count,
            scheduled_minutes,
            worked_minutes,
            overtime_minutes
          )
          VALUES (${period.id}, ${organization.id}, '2026-06', 1, ${owner.id}, 1, 1, 480, 540, 60)
          RETURNING id
        `;
      const [snapshot] = await connection<{ id: string }[]>`
          INSERT INTO attendance_month_day_snapshots (
            revision_id,
            organization_id,
            employee_id,
            employee_number,
            display_name,
            work_date,
            status,
            scheduled_minutes,
            worked_minutes,
            break_minutes,
            overtime_minutes
          )
          VALUES (
            ${revision.id},
            ${organization.id},
            ${employee.id},
            'V05-001',
            '移行 従業員',
            '2026-06-30',
            'complete',
            480,
            540,
            60,
            60
          )
          RETURNING id
        `;

      await applyMigrationFiles(connection, v05Files);

      const [draft] = await connection<
        {
          blockClose: boolean;
          deviation: number;
          increment: number;
          priorApproval: boolean;
          status: string;
        }[]
      >`
          SELECT
            status,
            minute_increment AS increment,
            require_prior_approval AS "priorApproval",
            allowed_deviation_minutes AS deviation,
            block_close_on_unresolved_difference AS "blockClose"
          FROM overtime_request_policies
          WHERE organization_id = ${organization.id}
        `;
      const [preservedSnapshot] = await connection<
        {
          id: string;
          overtimeMinutes: number | null;
          overtimePolicyId: string | null;
          overtimeRequestIds: string[];
          workedMinutes: number | null;
        }[]
      >`
          SELECT
            id,
            worked_minutes AS "workedMinutes",
            overtime_minutes AS "overtimeMinutes",
            overtime_policy_id AS "overtimePolicyId",
            overtime_request_ids AS "overtimeRequestIds"
          FROM attendance_month_day_snapshots
          WHERE id = ${snapshot.id}
        `;

      expect(draft).toEqual({
        blockClose: false,
        deviation: 0,
        increment: 15,
        priorApproval: true,
        status: "draft",
      });
      expect(preservedSnapshot).toEqual({
        id: snapshot.id,
        overtimeMinutes: 60,
        overtimePolicyId: null,
        overtimeRequestIds: [],
        workedMinutes: 540,
      });
    });
  }, 30_000);
});
