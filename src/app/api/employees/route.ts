import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { DepartmentManagementError } from "@/lib/departments";
import { getDatabase } from "@/lib/db/client";
import { createEmployee, EmployeeManagementError, listEmployees } from "@/lib/employees";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    const url = new URL(request.url);

    return Response.json({
      employees: await listEmployees(database, {
        departmentId: url.searchParams.get("departmentId") ?? undefined,
        organizationId: actor.organizationId,
        query: url.searchParams.get("query") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      }),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    console.error("Could not list employees.", error);
    return Response.json({ error: "従業員一覧を取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");

    if (["individualNumber", "bankAccount", "healthInformation"].some((key) => key in body)) {
      throw new EmployeeManagementError("個人番号・銀行口座・健康情報はv0.1の保存対象外です。");
    }

    const employee = await createEmployee(database, {
      contactEmail: String(body.contactEmail ?? ""),
      departmentId: String(body.departmentId ?? ""),
      displayName: String(body.displayName ?? ""),
      employeeNumber: String(body.employeeNumber ?? ""),
      employmentType: String(body.employmentType ?? ""),
      familyName: String(body.familyName ?? ""),
      givenName: String(body.givenName ?? ""),
      joinedOn: String(body.joinedOn ?? ""),
      organizationId: actor.organizationId,
      status: String(body.status ?? ""),
    });

    await recordAudit(database, {
      action: "employee_created",
      actorUserId: actor.userId,
      entityId: employee.id,
      entityType: "employee",
      metadata: { employeeNumber: employee.employeeNumber },
      organizationId: actor.organizationId,
    });

    return Response.json({ employee }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof EmployeeManagementError || error instanceof DepartmentManagementError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("Could not create employee.", error);
    return Response.json({ error: "従業員を作成できませんでした。" }, { status: 500 });
  }
}
