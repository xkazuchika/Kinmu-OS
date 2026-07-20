import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createDatabaseClient } from "@/lib/db/client";
import {
  employees,
  notifications,
  organizations,
  overtimeRequestPolicies,
  overtimeWorkRequests,
  users,
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

describeDatabase("v0.5 overtime request and notification schema", () => {
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
    const [employeeUser, reviewer] = await client.db
      .insert(users)
      .values([
        {
          displayName: `${label}従業員`,
          email: `${label.toLowerCase()}-employee@example.com`,
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
        {
          displayName: `${label}審査者`,
          email: `${label.toLowerCase()}-reviewer@example.com`,
          organizationId: organization.id,
          role: "hr_admin",
          status: "active",
        },
      ])
      .returning();
    const [employee] = await client.db
      .insert(employees)
      .values({
        employeeNumber: `${label}-001`,
        familyName: label,
        givenName: "従業員",
        organizationId: organization.id,
        status: "active",
        userId: employeeUser.id,
      })
      .returning();

    return { employee, employeeUser, organization, reviewer };
  }

  it("enforces policy values, activation details, organization boundaries, and indexes", async () => {
    const first = await createFixture("FIRST");
    const second = await createFixture("SECOND");

    await expectDatabaseFailure(
      client.db.insert(overtimeRequestPolicies).values({
        effectiveFrom: "2026-08-01",
        minuteIncrement: 7,
        organizationId: first.organization.id,
      }),
      "overtime_request_policies_minute_increment_valid",
    );
    await expectDatabaseFailure(
      client.db.insert(overtimeRequestPolicies).values({
        activatedAt: new Date(),
        activatedByUserId: second.reviewer.id,
        effectiveFrom: "2026-08-01",
        organizationId: first.organization.id,
        status: "active",
      }),
      "overtime policy activator must belong",
    );
    await client.db.insert(overtimeRequestPolicies).values({
      activatedAt: new Date(),
      activatedByUserId: first.reviewer.id,
      createdByUserId: first.reviewer.id,
      effectiveFrom: "2026-08-01",
      organizationId: first.organization.id,
      status: "active",
    });
    await expectDatabaseFailure(
      client.db.insert(overtimeRequestPolicies).values({
        effectiveFrom: "2026-08-01",
        organizationId: first.organization.id,
      }),
      "overtime_request_policies_org_effective_unique",
    );

    const result = (await client.db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'overtime_request_policies_org_status_effective_idx',
          'overtime_work_requests_org_status_created_idx',
          'overtime_work_requests_employee_date_idx',
          'notifications_recipient_unread_created_idx'
        )
    `)) as unknown as Array<{ indexname: string }>;

    expect(result.map((row) => row.indexname).sort()).toEqual([
      "notifications_recipient_unread_created_idx",
      "overtime_request_policies_org_status_effective_idx",
      "overtime_work_requests_employee_date_idx",
      "overtime_work_requests_org_status_created_idx",
    ]);
  });

  it("rejects cross-organization, overlapping, invalid, and final-state request mutations", async () => {
    const first = await createFixture("REQUEST");
    const second = await createFixture("OTHER");
    const [policy] = await client.db
      .insert(overtimeRequestPolicies)
      .values({
        activatedAt: new Date(),
        activatedByUserId: first.reviewer.id,
        effectiveFrom: "2026-08-01",
        organizationId: first.organization.id,
        status: "active",
      })
      .returning();
    const values = {
      employeeId: first.employee.id,
      kind: "overtime" as const,
      organizationId: first.organization.id,
      plannedBreakMinutes: 0,
      plannedEndAt: new Date("2026-08-03T11:00:00.000Z"),
      plannedMinutes: 120,
      plannedStartAt: new Date("2026-08-03T09:00:00.000Z"),
      policyId: policy.id,
      reason: "月初処理のため",
      requestedByUserId: first.employeeUser.id,
      workDate: "2026-08-03",
    };

    await expectDatabaseFailure(
      client.db.insert(overtimeWorkRequests).values({
        ...values,
        employeeId: second.employee.id,
      }),
      "overtime request employee, requester, and policy must belong",
    );
    const [request] = await client.db.insert(overtimeWorkRequests).values(values).returning();
    await expectDatabaseFailure(
      client.db.insert(overtimeWorkRequests).values({
        ...values,
        plannedEndAt: new Date("2026-08-03T12:00:00.000Z"),
        plannedStartAt: new Date("2026-08-03T10:00:00.000Z"),
      }),
      "overlaps an existing pending or approved request",
    );
    await expectDatabaseFailure(
      client.db
        .update(overtimeWorkRequests)
        .set({ status: "approved" })
        .where(eq(overtimeWorkRequests.id, request.id)),
      "overtime_work_requests_status_details_valid",
    );
    await expectDatabaseFailure(
      client.db
        .update(overtimeWorkRequests)
        .set({ reason: "申請内容を書き換え" })
        .where(eq(overtimeWorkRequests.id, request.id)),
      "overtime request details are immutable",
    );
    await client.db
      .update(overtimeWorkRequests)
      .set({
        reviewedAt: new Date(),
        reviewerUserId: first.reviewer.id,
        status: "approved",
        version: 1,
      })
      .where(eq(overtimeWorkRequests.id, request.id));
    await expectDatabaseFailure(
      client.db
        .update(overtimeWorkRequests)
        .set({ status: "rejected" })
        .where(eq(overtimeWorkRequests.id, request.id)),
      "overtime request is final",
    );
  });

  it("requires notification recipients and targets to stay in the same organization", async () => {
    const first = await createFixture("NOTICE");
    const second = await createFixture("TARGET");
    const [policy] = await client.db
      .insert(overtimeRequestPolicies)
      .values({
        activatedAt: new Date(),
        activatedByUserId: first.reviewer.id,
        effectiveFrom: "2026-08-01",
        organizationId: first.organization.id,
        status: "active",
      })
      .returning();
    const [request] = await client.db
      .insert(overtimeWorkRequests)
      .values({
        employeeId: first.employee.id,
        kind: "holiday_work",
        organizationId: first.organization.id,
        plannedEndAt: new Date("2026-08-09T03:00:00.000Z"),
        plannedMinutes: 180,
        plannedStartAt: new Date("2026-08-09T00:00:00.000Z"),
        policyId: policy.id,
        reason: "休日メンテナンス対応",
        requestedByUserId: first.employeeUser.id,
        workDate: "2026-08-09",
      })
      .returning();

    await expectDatabaseFailure(
      client.db.insert(notifications).values({
        entityId: request.id,
        entityType: "overtime_work_request",
        kind: "overtime_request_submitted",
        organizationId: first.organization.id,
        recipientUserId: second.reviewer.id,
        summary: "休日出勤申請が提出されました",
        title: "審査待ち申請",
      }),
      "notification recipient must belong",
    );
    await client.db.insert(notifications).values({
      entityId: request.id,
      entityType: "overtime_work_request",
      kind: "overtime_request_submitted",
      organizationId: first.organization.id,
      recipientUserId: first.reviewer.id,
      summary: "休日出勤申請が提出されました",
      title: "審査待ち申請",
    });
    await expectDatabaseFailure(
      client.db.insert(notifications).values({
        entityId: request.id,
        entityType: "arbitrary_url",
        kind: "overtime_request_submitted",
        organizationId: first.organization.id,
        recipientUserId: first.reviewer.id,
        summary: "不正な対象です",
        title: "不正な通知",
      }),
      "notification target must be an overtime request",
    );
  });
});
