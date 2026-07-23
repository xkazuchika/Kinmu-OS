import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as usersGet } from "@/app/api/users/route";
import { recordAudit } from "@/lib/audit";
import { createDatabaseClient } from "@/lib/db/client";
import { auditLogs, organizations, users } from "@/lib/db/schema";
import { searchAuditLogs } from "@/lib/reporting";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("audit and server authorization", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
  });

  afterAll(async () => {
    await client.close();
  });

  it("records an important user operation with actor and target", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "監査対象組織" })
      .returning();
    const [actor] = await client.db
      .insert(users)
      .values({
        displayName: "所有者",
        email: "owner@example.com",
        organizationId: organization.id,
        role: "owner",
        status: "active",
      })
      .returning();
    const [target] = await client.db
      .insert(users)
      .values({
        displayName: "対象者",
        email: "target@example.com",
        organizationId: organization.id,
        status: "disabled",
      })
      .returning();

    await recordAudit(client.db, {
      action: "user_disabled",
      actorUserId: actor.id,
      entityId: target.id,
      entityType: "user",
      metadata: { enabled: false },
      organizationId: organization.id,
    });

    const [auditLog] = await client.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, target.id))
      .orderBy(desc(auditLogs.occurredAt));

    expect(auditLog).toMatchObject({
      action: "user_disabled",
      actorUserId: actor.id,
      entityId: target.id,
      metadata: { enabled: false },
    });
  });

  it("rejects an unauthenticated user-management request", async () => {
    const response = await usersGet(new Request("http://kinmu.test/api/users"));

    expect(response.status).toBe(403);
  });

  it("filters payroll audits by profile, month, revision, run and result", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "給与監査組織" })
      .returning();
    const profileId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    await client.db.insert(auditLogs).values([
      {
        action: "payroll_export_validated",
        entityId: profileId,
        entityType: "payroll_export_validation",
        metadata: {
          attendanceRevision: 3,
          errorCount: 0,
          profileId,
          result: "passed",
          targetMonth: "2026-07",
        },
        organizationId: organization.id,
      },
      {
        action: "payroll_export_generated",
        entityId: runId,
        entityType: "payroll_export_run",
        metadata: { attendanceRevision: 3, profileId, targetMonth: "2026-07" },
        organizationId: organization.id,
      },
      {
        action: "csv_exported",
        entityType: "csv",
        metadata: { targetMonth: "2026-07" },
        organizationId: organization.id,
      },
    ]);

    const validation = await searchAuditLogs(client.db, {
      attendanceRevision: 3,
      organizationId: organization.id,
      payrollOnly: true,
      profileId,
      targetMonth: "2026-07",
      validationResult: "passed",
    });
    expect(validation).toHaveLength(1);
    expect(validation[0].action).toBe("payroll_export_validated");

    const run = await searchAuditLogs(client.db, {
      organizationId: organization.id,
      runId,
    });
    expect(run).toHaveLength(1);
    expect(run[0].action).toBe("payroll_export_generated");
  });
});
