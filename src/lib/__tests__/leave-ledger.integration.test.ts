import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { SessionActor } from "@/lib/authorization";
import { CsvImportValidationError } from "@/lib/csv-imports";
import { createDatabaseClient } from "@/lib/db/client";
import {
  employees,
  leaveGrantLots,
  leaveRequestDays,
  leaveRequests,
  leaveTransactions,
  organizations,
  users,
} from "@/lib/db/schema";
import {
  adjustLeaveBalance,
  commitLeaveGrantCsv,
  consumeLeaveBalance,
  createLeaveType,
  deactivateLeaveType,
  expireLeaveLots,
  getEmployeeLeaveLedger,
  getLeaveBalance,
  grantLeave,
  LeaveLedgerConflictError,
  LeaveLedgerValidationError,
  previewLeaveGrantCsv,
  updateLeaveType,
} from "@/lib/leave-ledger";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("leave type and append-only ledger", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`
      TRUNCATE TABLE
        audit_logs,
        import_batches,
        leave_transactions,
        leave_grant_lots,
        leave_request_days,
        leave_requests,
        leave_balance_accounts,
        leave_types,
        attendance_month_day_snapshots,
        attendance_month_revisions,
        attendance_month_periods,
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
      .values({ name: "休暇台帳組織" })
      .returning();
    const [owner, employeeUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "管理者",
          email: "leave-owner@example.com",
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
        {
          displayName: "従業員",
          email: "leave-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: "LEV-001",
        familyName: "休暇",
        givenName: "花子",
        joinedOn: "2026-04-01",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
      .returning();
    const actor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };
    const employeeActor: SessionActor = {
      displayName: employeeUser.displayName,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      organizationId: organization.id,
      role: "employee",
      userId: employeeUser.id,
    };
    const leaveType = await createLeaveType(client.db, actor, {
      code: "PAID",
      consumesBalance: true,
      effectiveFrom: "2026-04-01",
      name: "年次有給休暇",
      paid: true,
      requestable: true,
    });
    return { actor, employee, employeeActor, employeeUser, leaveType, organization };
  }

  it("protects used leave type attributes while preserving request-time display snapshots", async () => {
    const { actor, employee, employeeUser, leaveType, organization } = await fixture();
    await grantLeave(client.db, actor, {
      employeeId: employee.id,
      grantedOn: "2026-07-01",
      leaveTypeId: leaveType.id,
      reason: "年度付与",
      units: 20,
    });
    await client.db.insert(leaveRequests).values({
      consumesBalance: leaveType.consumesBalance,
      employeeId: employee.id,
      leaveTypeCode: leaveType.code,
      leaveTypeId: leaveType.id,
      leaveTypeName: leaveType.name,
      organizationId: organization.id,
      paid: leaveType.paid,
      reason: "家族行事",
      requestedByUserId: employeeUser.id,
    });

    await expect(
      updateLeaveType(client.db, actor, leaveType.id, {
        ...leaveType,
        code: "CHANGED",
      }),
    ).rejects.toBeInstanceOf(LeaveLedgerValidationError);
    await expect(deactivateLeaveType(client.db, actor, leaveType.id)).resolves.toMatchObject({
      active: false,
    });
    const [request] = await client.db.select().from(leaveRequests);
    expect(request).toMatchObject({ leaveTypeCode: "PAID", leaveTypeName: "年次有給休暇" });
  });

  it("calculates grants, pending reservations, adjustments, and expiry in half-day units", async () => {
    const { actor, employee, employeeUser, leaveType, organization } = await fixture();
    await grantLeave(client.db, actor, {
      employeeId: employee.id,
      expiresOn: "2026-07-31",
      grantedOn: "2026-07-01",
      leaveTypeId: leaveType.id,
      reason: "期限付き付与",
      units: 4,
    });
    await grantLeave(client.db, actor, {
      employeeId: employee.id,
      expiresOn: "2026-12-31",
      grantedOn: "2026-07-02",
      leaveTypeId: leaveType.id,
      reason: "通常付与",
      units: 16,
    });
    const [request] = await client.db
      .insert(leaveRequests)
      .values({
        consumesBalance: true,
        employeeId: employee.id,
        leaveTypeCode: leaveType.code,
        leaveTypeId: leaveType.id,
        leaveTypeName: leaveType.name,
        organizationId: organization.id,
        paid: true,
        reason: "申請中",
        requestedByUserId: employeeUser.id,
      })
      .returning();
    await client.db.insert(leaveRequestDays).values({
      calendarSource: "weekly_pattern",
      requestId: request.id,
      scheduledMinutes: 480,
      units: 2,
      workDate: "2026-07-20",
    });

    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-07-20",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ availableUnits: 18, ledgerUnits: 20, pendingUnits: 2 });

    await adjustLeaveBalance(client.db, actor, {
      effectiveOn: "2026-07-21",
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      reason: "誤付与訂正",
      units: -2,
    });
    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-07-21",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ availableUnits: 16, ledgerUnits: 18 });
    await expect(
      getLeaveBalance(client.db, {
        asOf: "2026-08-01",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        organizationId: organization.id,
      }),
    ).resolves.toMatchObject({ expiredUnits: 2, ledgerUnits: 16 });
    await expect(
      expireLeaveLots(client.db, actor, {
        asOf: "2026-08-01",
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
      }),
    ).resolves.toMatchObject({ expiredUnits: 2 });
  });

  it("consumes the earliest-expiring lots deterministically and exposes self ledger history", async () => {
    const { actor, employee, employeeActor, leaveType, organization } = await fixture();
    await grantLeave(client.db, actor, {
      employeeId: employee.id,
      expiresOn: "2026-08-31",
      grantedOn: "2026-07-01",
      leaveTypeId: leaveType.id,
      reason: "先期限",
      units: 2,
    });
    await grantLeave(client.db, actor, {
      employeeId: employee.id,
      expiresOn: "2026-12-31",
      grantedOn: "2026-07-01",
      leaveTypeId: leaveType.id,
      reason: "後期限",
      units: 4,
    });
    const balance = await getLeaveBalance(client.db, {
      asOf: "2026-07-20",
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      organizationId: organization.id,
    });
    const [request] = await client.db
      .insert(leaveRequests)
      .values({
        consumesBalance: true,
        employeeId: employee.id,
        leaveTypeCode: leaveType.code,
        leaveTypeId: leaveType.id,
        leaveTypeName: leaveType.name,
        organizationId: organization.id,
        paid: true,
        reason: "取得",
        requestedByUserId: employeeActor.userId,
      })
      .returning();

    await client.db.transaction((transaction) =>
      consumeLeaveBalance(transaction, actor, {
        accountId: balance.accountId!,
        effectiveOn: "2026-07-20",
        employeeId: employee.id,
        expectedVersion: balance.version,
        leaveTypeId: leaveType.id,
        reason: "承認消化",
        requestId: request.id,
        units: 3,
      }),
    );
    const lots = await client.db
      .select()
      .from(leaveGrantLots)
      .where(eq(leaveGrantLots.employeeId, employee.id));
    const consumption = await client.db
      .select()
      .from(leaveTransactions)
      .where(eq(leaveTransactions.kind, "consumption"));
    const firstLot = lots.find((lot) => lot.expiresOn === "2026-08-31")!;
    const secondLot = lots.find((lot) => lot.expiresOn === "2026-12-31")!;
    expect(consumption).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grantLotId: firstLot.id, units: -2 }),
        expect.objectContaining({ grantLotId: secondLot.id, units: -1 }),
      ]),
    );
    await expect(
      getEmployeeLeaveLedger(client.db, employeeActor, {
        asOf: "2026-07-20",
        employeeId: employee.id,
      }),
    ).resolves.toMatchObject({ balances: [expect.objectContaining({ availableUnits: 3 })] });
  });

  it("allows only one concurrent update from the same expected balance version", async () => {
    const { actor, employee, leaveType } = await fixture();
    const attempts = await Promise.allSettled([
      grantLeave(client.db, actor, {
        employeeId: employee.id,
        expectedVersion: 0,
        grantedOn: "2026-07-01",
        leaveTypeId: leaveType.id,
        reason: "同時付与A",
        units: 2,
      }),
      grantLeave(client.db, actor, {
        employeeId: employee.id,
        expectedVersion: 0,
        grantedOn: "2026-07-01",
        leaveTypeId: leaveType.id,
        reason: "同時付与B",
        units: 2,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const failure = attempts.find(
      (attempt) => attempt.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(LeaveLedgerConflictError);
  });

  it("validates and atomically imports grants, then rejects the same fingerprint", async () => {
    const { actor } = await fixture();
    const csv = [
      "employeeNumber,leaveTypeCode,units,grantedOn,expiresOn,reason",
      "LEV-001,PAID,20,2026-07-01,2027-06-30,年度付与",
    ].join("\n");
    await expect(
      previewLeaveGrantCsv(client.db, { csv, organizationId: actor.organizationId }),
    ).resolves.toMatchObject({
      errors: [],
      summary: { employeeCount: 1, rowCount: 1, totalUnits: 20 },
    });
    await expect(commitLeaveGrantCsv(client.db, actor, { csv })).resolves.toMatchObject({
      totalUnits: 20,
    });
    await expect(commitLeaveGrantCsv(client.db, actor, { csv })).rejects.toBeInstanceOf(
      CsvImportValidationError,
    );
    await expect(
      commitLeaveGrantCsv(client.db, actor, {
        csv: [
          "employeeNumber,leaveTypeCode,units,grantedOn,expiresOn,reason",
          "UNKNOWN,PAID,-2,2026-07-01,2026-06-30,不正",
        ].join("\n"),
      }),
    ).rejects.toBeInstanceOf(CsvImportValidationError);
  });
});
