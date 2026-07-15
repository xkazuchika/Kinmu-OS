import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as usersGet } from "@/app/api/users/route";
import { recordAudit } from "@/lib/audit";
import { createDatabaseClient } from "@/lib/db/client";
import { auditLogs, organizations, users } from "@/lib/db/schema";

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
});
