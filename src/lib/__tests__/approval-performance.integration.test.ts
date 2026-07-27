import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createApprovalCase, listApprovalInbox } from "@/lib/approval-cases";
import { createApprovalRoute } from "@/lib/approval-routing";
import type { SessionActor } from "@/lib/authorization";
import { createDatabaseClient } from "@/lib/db/client";
import {
  attendanceCorrectionRequests,
  departments,
  employeeDepartments,
  employees,
  organizations,
  users,
} from "@/lib/db/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("approval inbox at the 100 employee target size", () => {
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

  it("pages and filters 100 assigned cases across multiple departments", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "100名承認性能検証" })
      .returning();
    const [owner, approver] = await client.db
      .insert(users)
      .values([
        {
          displayName: "性能検証 所有者",
          email: "approval-performance-owner@example.com",
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
        {
          displayName: "性能検証 承認者",
          email: "approval-performance-approver@example.com",
          organizationId: organization.id,
          role: "approver",
          status: "active",
        },
      ])
      .returning();
    const ownerActor: SessionActor = {
      displayName: owner.displayName,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      organizationId: organization.id,
      role: "owner",
      userId: owner.id,
    };
    const approverActor: SessionActor = {
      displayName: approver.displayName,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      organizationId: organization.id,
      role: "approver",
      userId: approver.id,
    };
    const departmentRows = await client.db
      .insert(departments)
      .values(
        Array.from({ length: 4 }, (_, index) => ({
          code: `PERF-${index + 1}`,
          name: `性能検証部${index + 1}`,
          organizationId: organization.id,
        })),
      )
      .returning();
    for (const department of departmentRows) {
      await createApprovalRoute(client.db, ownerActor, {
        approverUserId: approver.id,
        departmentId: department.id,
        dueDays: 1,
        effectiveFrom: "2025-01-01",
        requestType: "attendance_correction",
      });
    }

    const employeeUsers = await client.db
      .insert(users)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          displayName: `性能 従業員${String(index + 1).padStart(3, "0")}`,
          email: `approval-performance-${index + 1}@example.com`,
          organizationId: organization.id,
          role: "employee" as const,
          status: "active" as const,
        })),
      )
      .returning();
    const employeeRows = await client.db
      .insert(employees)
      .values(
        employeeUsers.map((user, index) => ({
          displayName: user.displayName,
          employeeNumber: `PERF-${String(index + 1).padStart(3, "0")}`,
          familyName: "性能",
          givenName: `従業員${index + 1}`,
          organizationId: organization.id,
          status: "active" as const,
          userId: user.id,
        })),
      )
      .returning();
    await client.db.insert(employeeDepartments).values(
      employeeRows.map((employee, index) => ({
        departmentId: departmentRows[index % departmentRows.length].id,
        employeeId: employee.id,
        isPrimary: true,
        startedOn: "2025-01-01",
      })),
    );
    const requests = await client.db
      .insert(attendanceCorrectionRequests)
      .values(
        employeeRows.map((employee, index) => ({
          employeeId: employee.id,
          organizationId: organization.id,
          reason: "100名規模の受信箱検証",
          requestedByUserId: employeeUsers[index].id,
          workDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
        })),
      )
      .returning();
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      await createApprovalCase(client.db, {
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        employeeId: request.employeeId,
        organizationId: organization.id,
        reference: {
          attendanceCorrectionRequestId: request.id,
          requestType: "attendance_correction",
        },
        snapshot: {
          attendanceDayId: null,
          baseRevision: 0,
          employeeId: request.employeeId,
          entries: [],
          reason: request.reason,
          requestId: request.id,
          requestType: "attendance_correction",
          workDate: request.workDate,
        },
        submittedByUserId: request.requestedByUserId,
        targetDate: request.workDate,
      });
    }

    const startedAt = performance.now();
    const [firstPage, secondPage, departmentPage, overduePage] = await Promise.all([
      listApprovalInbox(client.db, approverActor, { page: 1 }),
      listApprovalInbox(client.db, approverActor, { page: 2 }),
      listApprovalInbox(client.db, approverActor, {
        departmentId: departmentRows[0].id,
        page: 1,
      }),
      listApprovalInbox(client.db, approverActor, {
        due: "overdue",
        page: 1,
      }),
    ]);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(firstPage).toMatchObject({ page: 1, pageSize: 50, total: 100 });
    expect(firstPage.items).toHaveLength(50);
    expect(secondPage).toMatchObject({ page: 2, pageSize: 50, total: 100 });
    expect(secondPage.items).toHaveLength(50);
    expect(departmentPage.total).toBe(25);
    expect(overduePage.total).toBe(100);
    expect(elapsedMilliseconds).toBeLessThan(5_000);
  }, 30_000);
});
