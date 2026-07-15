import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, sql } from "drizzle-orm";

import { POST as departmentPost } from "@/app/api/departments/route";
import { GET as managedAttendanceGet } from "@/app/api/attendance/route";
import { GET as auditGet } from "@/app/api/audit/route";
import { POST as statusPost } from "@/app/api/employees/[employeeId]/status/route";
import { GET as employeesGet, POST as employeePost } from "@/app/api/employees/route";
import { GET as exportGet } from "@/app/api/exports/[kind]/route";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { closeDatabase, createDatabaseClient } from "@/lib/db/client";
import { auditLogs, organizations, users } from "@/lib/db/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("employee records authorization and audit", () => {
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

  it("audits manager changes and rejects an employee management request", async () => {
    const [organization] = await client.db
      .insert(organizations)
      .values({ name: "台帳監査組織" })
      .returning();
    const [owner, employeeUser] = await client.db
      .insert(users)
      .values([
        {
          displayName: "所有者",
          email: "records-owner@example.com",
          organizationId: organization.id,
          role: "owner",
          status: "active",
        },
        {
          displayName: "従業員",
          email: "records-employee@example.com",
          organizationId: organization.id,
          role: "employee",
          status: "active",
        },
      ])
      .returning();
    const ownerSession = await createSession(client.db, owner.id);
    const employeeSession = await createSession(client.db, employeeUser.id);
    const ownerHeaders = {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${ownerSession.token}`,
    };
    const departmentResponse = await departmentPost(
      new Request("http://kinmu.test/api/departments", {
        body: JSON.stringify({ code: "AUDIT", name: "監査部" }),
        headers: ownerHeaders,
        method: "POST",
      }),
    );
    const { department } = (await departmentResponse.json()) as { department: { id: string } };
    const sensitiveResponse = await employeePost(
      new Request("http://kinmu.test/api/employees", {
        body: JSON.stringify({ individualNumber: "123456789012" }),
        headers: ownerHeaders,
        method: "POST",
      }),
    );
    const employeeResponse = await employeePost(
      new Request("http://kinmu.test/api/employees", {
        body: JSON.stringify({
          departmentId: department.id,
          displayName: "監査 花子",
          employeeNumber: "A001",
          employmentType: "full_time",
          familyName: "監査",
          givenName: "花子",
          joinedOn: "2026-04-01",
          status: "active",
        }),
        headers: ownerHeaders,
        method: "POST",
      }),
    );
    const { employee } = (await employeeResponse.json()) as { employee: { id: string } };
    const statusResponse = await statusPost(
      new Request(`http://kinmu.test/api/employees/${employee.id}/status`, {
        body: JSON.stringify({ effectiveOn: "2026-07-01", reason: "休職", status: "on_leave" }),
        headers: ownerHeaders,
        method: "POST",
      }),
      { params: Promise.resolve({ employeeId: employee.id }) },
    );
    const forbiddenResponse = await employeesGet(
      new Request("http://kinmu.test/api/employees", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}` },
      }),
    );
    const forbiddenAttendance = await managedAttendanceGet(
      new Request("http://kinmu.test/api/attendance?month=2026-07", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}` },
      }),
    );
    const exportResponse = await exportGet(
      new Request("http://kinmu.test/api/exports/employees", { headers: ownerHeaders }),
      { params: Promise.resolve({ kind: "employees" }) },
    );
    const forbiddenExport = await exportGet(
      new Request("http://kinmu.test/api/exports/employees", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}` },
      }),
      { params: Promise.resolve({ kind: "employees" }) },
    );
    const forbiddenAudit = await auditGet(
      new Request("http://kinmu.test/api/audit", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${employeeSession.token}` },
      }),
    );
    const audits = await client.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.occurredAt));

    expect(departmentResponse.status).toBe(201);
    expect(sensitiveResponse.status).toBe(422);
    expect(employeeResponse.status).toBe(201);
    expect(statusResponse.status).toBe(200);
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenAttendance.status).toBe(403);
    expect(exportResponse.status).toBe(200);
    const exported = await exportResponse.text();
    expect(exported).toContain("A001");
    expect(exported).not.toMatch(/個人番号|銀行|健康|123456789012/);
    expect(forbiddenExport.status).toBe(403);
    expect(forbiddenAudit.status).toBe(403);
    expect(audits.map((audit) => audit.action)).toEqual([
      "department_changed",
      "employee_created",
      "employee_status_changed",
      "csv_exported",
    ]);
  });
});
