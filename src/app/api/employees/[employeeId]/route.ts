import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { DepartmentManagementError } from "@/lib/departments";
import { getDatabase } from "@/lib/db/client";
import { EmployeeManagementError, getEmployeeDetails, updateEmployeeRecord } from "@/lib/employees";

export async function GET(request: Request, context: { params: Promise<{ employeeId: string }> }) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    const { employeeId } = await context.params;

    return Response.json({
      employee: await getEmployeeDetails(database, {
        employeeId,
        organizationId: actor.organizationId,
      }),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof EmployeeManagementError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    console.error("Could not load employee.", error);
    return Response.json({ error: "従業員を取得できませんでした。" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  const body = (await request.json()) as Record<string, unknown>;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    const { employeeId } = await context.params;
    const employee = await updateEmployeeRecord(database, {
      contactEmail: String(body.contactEmail ?? ""),
      departmentEffectiveOn: String(body.departmentEffectiveOn ?? ""),
      departmentId: String(body.departmentId ?? "") || undefined,
      displayName: String(body.displayName ?? ""),
      employeeId,
      employmentType: String(body.employmentType ?? ""),
      familyName: String(body.familyName ?? ""),
      givenName: String(body.givenName ?? ""),
      organizationId: actor.organizationId,
      phoneNumber: String(body.phoneNumber ?? ""),
      userId: String(body.userId ?? "") || null,
    });

    await recordAudit(database, {
      action: "employee_updated",
      actorUserId: actor.userId,
      entityId: employee.id,
      entityType: "employee",
      metadata: {
        changedFields: [
          "familyName",
          "givenName",
          "displayName",
          "contactEmail",
          "phoneNumber",
          "employmentType",
          "departmentId",
          "userId",
        ].filter((field) => field in body),
      },
      organizationId: actor.organizationId,
    });

    return Response.json({ employee });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof EmployeeManagementError || error instanceof DepartmentManagementError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("Could not update employee.", error);
    return Response.json({ error: "従業員を更新できませんでした。" }, { status: 500 });
  }
}
