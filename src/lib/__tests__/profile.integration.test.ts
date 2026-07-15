import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { PATCH as profilePatch } from "@/app/api/profile/route";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import { auditLogs, departments, employees, organizations, users } from "@/lib/db/schema";
import { createEmployee, getSelfProfile, updateEmployeeRecord } from "@/lib/employees";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("employee self profile", () => {
  const client = createDatabaseClient(
    databaseUrl ?? "postgresql://kinmu:kinmu@127.0.0.1:5432/kinmu_test",
  );

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE organizations CASCADE`);
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
    await client.close();
  });

  async function prepareProfile() {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "本人プロフィール組織" })
      .returning();
    const [user] = await client.db
      .insert(users)
      .values({
        displayName: "本人 花子",
        email: "self@example.com",
        organizationId: organization.id,
        role: "employee",
        status: "active",
      })
      .returning();
    const [department] = await client.db
      .insert(departments)
      .values({ code: "SELF", name: "本人所属", organizationId: organization.id })
      .returning();
    const employee = await createEmployee(client.db, {
      departmentId: department.id,
      displayName: "本人 花子",
      employeeNumber: "SELF001",
      employmentType: "full_time",
      familyName: "本人",
      givenName: "花子",
      joinedOn: "2026-04-01",
      organizationId: organization.id,
      status: "active",
    });
    await updateEmployeeRecord(client.db, {
      employeeId: employee.id,
      organizationId: organization.id,
      userId: user.id,
    });
    const session = await createSession(client.db, user.id);

    return { employee, organization, session, user };
  }

  it("updates allowed contact fields and records a self-service audit", async () => {
    const { employee, session, user } = await prepareProfile();
    const response = await profilePatch(
      new Request("http://kinmu.test/api/profile", {
        body: JSON.stringify({ contactEmail: "new@example.com", phoneNumber: "090-1234-5678" }),
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
        },
        method: "PATCH",
      }),
    );
    const [audit] = await client.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, employee.id));

    expect(response.status).toBe(200);
    await expect(
      getSelfProfile(client.db, { organizationId: user.organizationId, userId: user.id }),
    ).resolves.toMatchObject({ contactEmail: "new@example.com", phoneNumber: "090-1234-5678" });
    expect(audit).toMatchObject({ action: "employee_updated", actorUserId: user.id });
  });

  it("rejects an employee attempt to change employment information", async () => {
    const { employee, session } = await prepareProfile();
    const response = await profilePatch(
      new Request("http://kinmu.test/api/profile", {
        body: JSON.stringify({ employmentType: "contract" }),
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
        },
        method: "PATCH",
      }),
    );
    const [stored] = await client.db
      .select({ employmentType: employees.employmentType })
      .from(employees)
      .where(eq(employees.id, employee.id));

    expect(response.status).toBe(403);
    expect(stored.employmentType).toBe("full_time");
  });
});
