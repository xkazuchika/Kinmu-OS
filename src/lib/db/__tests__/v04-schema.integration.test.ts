import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createDatabaseClient } from "@/lib/db/client";
import {
  absenceRecords,
  employees,
  importBatches,
  leaveBalanceAccounts,
  leaveGrantLots,
  leaveRequests,
  leaveTransactions,
  leaveTypes,
  organizations,
  users,
  workCalendarDateExceptions,
  workCalendarPatterns,
} from "@/lib/db/schema";

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

describeDatabase("v0.4 calendar and leave schema", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`
      TRUNCATE TABLE
        import_batches,
        absence_records,
        leave_transactions,
        leave_grant_lots,
        leave_request_days,
        leave_requests,
        leave_balance_accounts,
        leave_types,
        work_calendar_date_exceptions,
        work_calendar_patterns
      CASCADE
    `);
  });

  afterAll(async () => {
    await client.db.execute(sql`
      TRUNCATE TABLE
        import_batches,
        absence_records,
        leave_transactions,
        leave_grant_lots,
        leave_request_days,
        leave_requests,
        leave_balance_accounts,
        leave_types,
        work_calendar_date_exceptions,
        work_calendar_patterns
      CASCADE
    `);
    await client.close();
  });

  async function createFixture(label: string) {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: `${label}組織` })
      .returning();
    const [user] = await client.db
      .insert(users)
      .values({
        displayName: `${label}利用者`,
        email: `${label.toLowerCase()}-${organization.id}@example.com`,
        organizationId: organization.id,
        role: "employee",
        status: "active",
      })
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: `${label}-${organization.id.slice(0, 6)}`,
        familyName: label,
        givenName: "従業員",
        organizationId: organization.id,
        status: "active",
        userId: user.id,
      })
      .returning();
    const [leaveType] = await client.db
      .insert(leaveTypes)
      .values({
        code: "PAID",
        consumesBalance: true,
        effectiveFrom: "2026-07-01",
        name: "年次有給休暇",
        organizationId: organization.id,
        paid: true,
      })
      .returning();

    return { employee, leaveType, organization, user };
  }

  it("enforces calendar precedence keys, activation details, organization boundaries, and indexes", async () => {
    const first = await createFixture("FIRST");
    const second = await createFixture("SECOND");

    await client.db.insert(workCalendarPatterns).values({
      effectiveFrom: "2026-08-01",
      organizationId: first.organization.id,
    });
    await expectDatabaseFailure(
      client.db.insert(workCalendarPatterns).values({
        effectiveFrom: "2026-08-01",
        organizationId: first.organization.id,
      }),
      "work_calendar_patterns_org_effective_unique",
    );
    await expectDatabaseFailure(
      client.db.insert(workCalendarPatterns).values({
        activatedAt: new Date(),
        effectiveFrom: "2026-09-01",
        organizationId: first.organization.id,
        status: "draft",
      }),
      "work_calendar_patterns_activation_complete",
    );
    await expectDatabaseFailure(
      client.db.insert(workCalendarDateExceptions).values({
        calendarDate: "2026-08-11",
        dayKind: "non_workday",
        employeeId: second.employee.id,
        name: "会社休日",
        organizationId: first.organization.id,
        reason: "夏季休業",
      }),
      "calendar exception employee must belong",
    );

    await client.db.insert(workCalendarDateExceptions).values({
      calendarDate: "2026-08-11",
      dayKind: "non_workday",
      name: "会社休日",
      organizationId: first.organization.id,
      reason: "夏季休業",
    });
    await expectDatabaseFailure(
      client.db.insert(workCalendarDateExceptions).values({
        calendarDate: "2026-08-11",
        dayKind: "workday",
        name: "臨時勤務日",
        organizationId: first.organization.id,
        reason: "振替勤務",
      }),
      "work_calendar_exceptions_org_date_unique",
    );

    const result = (await client.db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'work_calendar_patterns_org_status_effective_idx',
          'work_calendar_exceptions_org_date_unique',
          'work_calendar_exceptions_employee_date_unique'
        )
    `)) as unknown as Array<{ indexname: string }>;

    expect(result.map((row) => row.indexname).sort()).toEqual([
      "work_calendar_exceptions_employee_date_unique",
      "work_calendar_exceptions_org_date_unique",
      "work_calendar_patterns_org_status_effective_idx",
    ]);
  });

  it("keeps leave balances append-only and rejects inconsistent cross-organization references", async () => {
    const first = await createFixture("LEDGER");
    const second = await createFixture("OTHER");
    const [account] = await client.db
      .insert(leaveBalanceAccounts)
      .values({
        employeeId: first.employee.id,
        leaveTypeId: first.leaveType.id,
        organizationId: first.organization.id,
      })
      .returning();

    await expectDatabaseFailure(
      client.db.insert(leaveBalanceAccounts).values({
        employeeId: second.employee.id,
        leaveTypeId: first.leaveType.id,
        organizationId: first.organization.id,
      }),
      "leave account employee and type must belong",
    );

    const [lot] = await client.db
      .insert(leaveGrantLots)
      .values({
        accountId: account.id,
        employeeId: first.employee.id,
        grantedOn: "2026-07-01",
        grantedUnits: 20,
        leaveTypeId: first.leaveType.id,
        organizationId: first.organization.id,
        reason: "初回付与",
      })
      .returning();
    const [transaction] = await client.db
      .insert(leaveTransactions)
      .values({
        accountId: account.id,
        effectiveOn: "2026-07-01",
        employeeId: first.employee.id,
        grantLotId: lot.id,
        kind: "grant",
        leaveTypeId: first.leaveType.id,
        organizationId: first.organization.id,
        reason: "初回付与",
        units: 20,
      })
      .returning();

    await expectDatabaseFailure(
      client.db
        .update(leaveTransactions)
        .set({ reason: "上書き" })
        .where(eq(leaveTransactions.id, transaction.id)),
      "append-only",
    );
    await expectDatabaseFailure(
      client.db.delete(leaveGrantLots).where(eq(leaveGrantLots.id, lot.id)),
      "append-only",
    );
    await expectDatabaseFailure(
      client.db.insert(leaveTransactions).values({
        accountId: account.id,
        effectiveOn: "2026-07-01",
        employeeId: first.employee.id,
        kind: "grant",
        leaveTypeId: first.leaveType.id,
        organizationId: first.organization.id,
        reason: "ロットなし",
        units: 2,
      }),
      "leave_transactions_references_valid",
    );
  });

  it("validates request snapshots, absence uniqueness, and import fingerprints", async () => {
    const fixture = await createFixture("FLOW");
    const [reviewer] = await client.db
      .insert(users)
      .values({
        displayName: "審査者",
        email: `reviewer-${fixture.organization.id}@example.com`,
        organizationId: fixture.organization.id,
        role: "hr_admin",
        status: "active",
      })
      .returning();

    const [request] = await client.db
      .insert(leaveRequests)
      .values({
        consumesBalance: true,
        employeeId: fixture.employee.id,
        leaveTypeCode: fixture.leaveType.code,
        leaveTypeId: fixture.leaveType.id,
        leaveTypeName: fixture.leaveType.name,
        organizationId: fixture.organization.id,
        paid: true,
        reason: "家族行事のため",
        requestedByUserId: fixture.user.id,
      })
      .returning();
    await expectDatabaseFailure(
      client.db
        .update(leaveRequests)
        .set({ status: "approved" })
        .where(eq(leaveRequests.id, request.id)),
      "leave_requests_status_details_valid",
    );
    await client.db
      .update(leaveRequests)
      .set({ reviewerUserId: reviewer.id, reviewedAt: new Date(), status: "approved" })
      .where(eq(leaveRequests.id, request.id));
    await expectDatabaseFailure(
      client.db
        .update(leaveRequests)
        .set({ status: "pending" })
        .where(eq(leaveRequests.id, request.id)),
      "final",
    );

    await client.db.insert(absenceRecords).values({
      confirmedByUserId: reviewer.id,
      employeeId: fixture.employee.id,
      organizationId: fixture.organization.id,
      reason: "連絡のない欠勤",
      workDate: "2026-07-17",
    });
    await expectDatabaseFailure(
      client.db.insert(absenceRecords).values({
        confirmedByUserId: reviewer.id,
        employeeId: fixture.employee.id,
        organizationId: fixture.organization.id,
        reason: "重複欠勤",
        workDate: "2026-07-17",
      }),
      "absence_records_employee_date_active_unique",
    );

    await client.db.insert(importBatches).values({
      createdByUserId: reviewer.id,
      fingerprint: "sha256:calendar-fixture",
      kind: "calendar",
      organizationId: fixture.organization.id,
      resultSummary: { inserted: 2 },
      rowCount: 2,
    });
    await expectDatabaseFailure(
      client.db.insert(importBatches).values({
        createdByUserId: reviewer.id,
        fingerprint: "sha256:calendar-fixture",
        kind: "calendar",
        organizationId: fixture.organization.id,
        rowCount: 2,
      }),
      "import_batches_org_kind_fingerprint_unique",
    );
  });
});
