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

function migrationStatements(source: string) {
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrationFiles(connection: postgres.Sql, fileNames: string[]) {
  for (const fileName of fileNames) {
    const source = await readFile(join(process.cwd(), "drizzle", fileName), "utf8");
    for (const statement of migrationStatements(source)) {
      await connection.unsafe(statement);
    }
  }
}

async function withTemporaryDatabase(
  sourceUrl: string,
  run: (connection: postgres.Sql) => Promise<void>,
) {
  const databaseName = `kinmu_v08_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

async function createLegacyRequests(connection: postgres.Sql) {
  const [organization] = await connection<{ id: string }[]>`
    INSERT INTO organizations (name)
    VALUES ('v0.8移行組織')
    RETURNING id
  `;
  const [owner] = await connection<{ id: string }[]>`
    INSERT INTO users (organization_id, email, display_name, role, status)
    VALUES (${organization.id}, 'v08-owner@example.com', '移行管理者', 'owner', 'active')
    RETURNING id
  `;
  const [employeeUser] = await connection<{ id: string }[]>`
    INSERT INTO users (organization_id, email, display_name, role, status)
    VALUES (${organization.id}, 'v08-employee@example.com', '移行従業員', 'employee', 'active')
    RETURNING id
  `;
  const [employee] = await connection<{ id: string }[]>`
    INSERT INTO employees (
      organization_id,
      user_id,
      employee_number,
      family_name,
      given_name,
      display_name,
      status
    )
    VALUES (
      ${organization.id},
      ${employeeUser.id},
      'V08-001',
      '移行',
      '従業員',
      '移行 従業員',
      'active'
    )
    RETURNING id
  `;
  const [department] = await connection<{ id: string }[]>`
    INSERT INTO departments (organization_id, code, name)
    VALUES (${organization.id}, 'MIG', '移行部')
    RETURNING id
  `;
  await connection`
    INSERT INTO employee_departments (
      employee_id,
      department_id,
      is_primary,
      started_on
    )
    VALUES (${employee.id}, ${department.id}, true, '2020-01-01')
  `;
  const [leaveType] = await connection<{ id: string }[]>`
    INSERT INTO leave_types (
      organization_id,
      code,
      name,
      paid,
      consumes_balance,
      effective_from
    )
    VALUES (${organization.id}, 'PAID', '有給休暇', true, true, '2020-01-01')
    RETURNING id
  `;
  const [policy] = await connection<{ id: string }[]>`
    INSERT INTO overtime_request_policies (
      organization_id,
      effective_from,
      status,
      created_by_user_id,
      activated_by_user_id,
      activated_at
    )
    VALUES (
      ${organization.id},
      '2020-01-01',
      'active',
      ${owner.id},
      ${owner.id},
      '2020-01-01T00:00:00Z'
    )
    RETURNING id
  `;

  const [attendanceRequest] = await connection<{ id: string }[]>`
    INSERT INTO attendance_correction_requests (
      organization_id,
      employee_id,
      requested_by_user_id,
      work_date,
      reason,
      status
    )
    VALUES (
      ${organization.id},
      ${employee.id},
      ${employeeUser.id},
      '2026-07-01',
      '退勤打刻を追加',
      'pending'
    )
    RETURNING id
  `;
  const [leaveRequest] = await connection<{ id: string }[]>`
    INSERT INTO leave_requests (
      organization_id,
      employee_id,
      leave_type_id,
      requested_by_user_id,
      reviewer_user_id,
      status,
      reason,
      review_comment,
      leave_type_code,
      leave_type_name,
      paid,
      consumes_balance,
      reviewed_at
    )
    VALUES (
      ${organization.id},
      ${employee.id},
      ${leaveType.id},
      ${employeeUser.id},
      ${owner.id},
      'approved',
      '通院',
      '承認します',
      'PAID',
      '有給休暇',
      true,
      true,
      '2026-06-20T00:00:00Z'
    )
    RETURNING id
  `;
  await connection`
    INSERT INTO leave_request_days (
      request_id,
      work_date,
      units,
      scheduled_minutes,
      calendar_source
    )
    VALUES (${leaveRequest.id}, '2026-07-02', 1, 480, 'work_rule')
  `;
  const [overtimeRequest] = await connection<{ id: string }[]>`
    INSERT INTO overtime_work_requests (
      organization_id,
      employee_id,
      requested_by_user_id,
      policy_id,
      kind,
      work_date,
      planned_start_at,
      planned_end_at,
      planned_minutes,
      reason,
      status,
      reviewer_user_id,
      review_comment,
      reviewed_at
    )
    VALUES (
      ${organization.id},
      ${employee.id},
      ${employeeUser.id},
      ${policy.id},
      'overtime',
      '2026-07-03',
      '2026-07-03T09:00:00Z',
      '2026-07-03T10:00:00Z',
      60,
      '月末対応',
      'rejected',
      ${owner.id},
      '予定を見直してください',
      '2026-06-21T00:00:00Z'
    )
    RETURNING id
  `;
  const [notification] = await connection<{ id: string }[]>`
    INSERT INTO notifications (
      organization_id,
      recipient_user_id,
      kind,
      title,
      summary,
      entity_type,
      entity_id,
      read_at
    )
    VALUES (
      ${organization.id},
      ${employeeUser.id},
      'overtime_request_rejected',
      '残業申請が却下されました',
      '予定を見直してください',
      'overtime_work_request',
      ${overtimeRequest.id},
      '2026-06-21T01:00:00Z'
    )
    RETURNING id
  `;
  const [auditLog] = await connection<{ id: string }[]>`
    INSERT INTO audit_logs (
      organization_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata,
      occurred_at
    )
    VALUES (
      ${organization.id},
      ${owner.id},
      'overtime_request_rejected',
      'overtime_work_request',
      ${overtimeRequest.id},
      '{"reviewCommentRecorded":true}'::jsonb,
      '2026-06-21T00:00:00Z'
    )
    RETURNING id
  `;

  return {
    attendanceRequest,
    auditLog,
    department,
    employee,
    employeeUser,
    leaveRequest,
    notification,
    organization,
    overtimeRequest,
    owner,
  };
}

describeDatabase("v0.8 approval migration", () => {
  it("backfills every legacy request with its status, department, and immutable revision", async () => {
    await withTemporaryDatabase(databaseUrl!, async (connection) => {
      const files = await migrationFiles();
      await applyMigrationFiles(
        connection,
        files.filter((fileName) => Number(fileName.slice(0, 4)) <= 16),
      );
      const fixture = await createLegacyRequests(connection);

      await applyMigrationFiles(
        connection,
        files.filter((fileName) => Number(fileName.slice(0, 4)) === 17),
      );

      const cases = await connection<
        Array<{
          departmentId: string | null;
          requestType: string;
          status: string;
          targetDate: string;
        }>
      >`
        SELECT
          request_type AS "requestType",
          status,
          submitted_department_id AS "departmentId",
          target_date::text AS "targetDate"
        FROM approval_cases
        ORDER BY target_date
      `;
      const revisions = await connection<
        Array<{ requestType: string; revision: number; workDate: string | null }>
      >`
        SELECT
          snapshot->>'requestType' AS "requestType",
          revision,
          COALESCE(
            snapshot->>'workDate',
            snapshot->'days'->0->>'workDate'
          ) AS "workDate"
        FROM approval_case_revisions
        ORDER BY "workDate"
      `;
      const [preservedNotification] = await connection<
        Array<{ eventKey: string | null; id: string; readAt: Date | null; summary: string }>
      >`
        SELECT
          id,
          event_key AS "eventKey",
          read_at AS "readAt",
          summary
        FROM notifications
        WHERE id = ${fixture.notification.id}
      `;
      const [preservedAudit] = await connection<
        Array<{ action: string; id: string; metadata: Record<string, unknown> }>
      >`
        SELECT id, action, metadata
        FROM audit_logs
        WHERE id = ${fixture.auditLog.id}
      `;

      expect(cases).toEqual([
        {
          departmentId: fixture.department.id,
          requestType: "attendance_correction",
          status: "pending",
          targetDate: "2026-07-01",
        },
        {
          departmentId: fixture.department.id,
          requestType: "leave",
          status: "approved",
          targetDate: "2026-07-02",
        },
        {
          departmentId: fixture.department.id,
          requestType: "overtime",
          status: "rejected",
          targetDate: "2026-07-03",
        },
      ]);
      expect(revisions).toEqual([
        { requestType: "attendance_correction", revision: 1, workDate: "2026-07-01" },
        { requestType: "leave", revision: 1, workDate: "2026-07-02" },
        { requestType: "overtime", revision: 1, workDate: "2026-07-03" },
      ]);
      expect(preservedNotification).toMatchObject({
        eventKey: null,
        id: fixture.notification.id,
        summary: "予定を見直してください",
      });
      expect(preservedNotification.readAt?.toISOString()).toBe("2026-06-21T01:00:00.000Z");
      expect(preservedAudit).toEqual({
        action: "overtime_request_rejected",
        id: fixture.auditLog.id,
        metadata: { reviewCommentRecorded: true },
      });
    });
  }, 30_000);

  it("can rerun the backfill statements without duplicating cases or revisions", async () => {
    await withTemporaryDatabase(databaseUrl!, async (connection) => {
      const files = await migrationFiles();
      await applyMigrationFiles(
        connection,
        files.filter((fileName) => Number(fileName.slice(0, 4)) <= 16),
      );
      await createLegacyRequests(connection);
      const v08File = files.find((fileName) => Number(fileName.slice(0, 4)) === 17)!;
      await applyMigrationFiles(connection, [v08File]);

      const source = await readFile(join(process.cwd(), "drizzle", v08File), "utf8");
      const backfillStatements = migrationStatements(source).filter(
        (statement) =>
          statement.startsWith("INSERT INTO approval_cases") ||
          statement.startsWith("INSERT INTO approval_case_revisions"),
      );
      for (const statement of backfillStatements) {
        await connection.unsafe(statement);
      }

      const [counts] = await connection<Array<{ caseCount: number; revisionCount: number }>>`
        SELECT
          (SELECT count(*)::integer FROM approval_cases) AS "caseCount",
          (SELECT count(*)::integer FROM approval_case_revisions) AS "revisionCount"
      `;
      expect(counts).toEqual({ caseCount: 3, revisionCount: 3 });
    });
  }, 30_000);

  it("rejects cross-organization and ineligible approval routes", async () => {
    await withTemporaryDatabase(databaseUrl!, async (connection) => {
      await applyMigrationFiles(connection, await migrationFiles());
      const fixture = await createLegacyRequests(connection);
      const [otherOrganization] = await connection<{ id: string }[]>`
        INSERT INTO organizations (name)
        VALUES ('別組織')
        RETURNING id
      `;
      const [otherOwner] = await connection<{ id: string }[]>`
        INSERT INTO users (organization_id, email, display_name, role, status)
        VALUES (${otherOrganization.id}, 'other-owner@example.com', '別組織管理者', 'owner', 'active')
        RETURNING id
      `;

      await expect(
        connection`
          INSERT INTO approval_route_assignments (
            organization_id,
            department_id,
            request_type,
            approver_user_id,
            effective_from,
            created_by_user_id
          )
          VALUES (
            ${fixture.organization.id},
            ${fixture.department.id},
            'leave',
            ${otherOwner.id},
            '2026-07-01',
            ${fixture.owner.id}
          )
        `,
      ).rejects.toThrow("approval route approver must be an active eligible user");

      await expect(
        connection`
          INSERT INTO approval_route_assignments (
            organization_id,
            department_id,
            request_type,
            approver_user_id,
            effective_from,
            created_by_user_id
          )
          VALUES (
            ${fixture.organization.id},
            ${fixture.department.id},
            'leave',
            ${fixture.employeeUser.id},
            '2026-07-01',
            ${fixture.owner.id}
          )
        `,
      ).rejects.toThrow("approval route approver must be an active eligible user");
    });
  }, 30_000);
});
