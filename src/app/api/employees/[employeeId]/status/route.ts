import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { changeEmployeeStatus, EmployeeManagementError } from "@/lib/employees";

export async function POST(request: Request, context: { params: Promise<{ employeeId: string }> }) {
  const body = (await request.json()) as Partial<{
    effectiveOn: string;
    reason: string;
    status: string;
  }>;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    const { employeeId } = await context.params;
    const employee = await changeEmployeeStatus(database, {
      effectiveOn: body.effectiveOn ?? "",
      employeeId,
      organizationId: actor.organizationId,
      reason: body.reason ?? "",
      status: body.status ?? "",
    });

    await recordAudit(database, {
      action: "employee_status_changed",
      actorUserId: actor.userId,
      entityId: employee.id,
      entityType: "employee",
      metadata: { effectiveOn: body.effectiveOn, status: employee.status },
      organizationId: actor.organizationId,
    });

    return Response.json({ employee });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof EmployeeManagementError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("Could not change employee status.", error);
    return Response.json({ error: "在籍状態を変更できませんでした。" }, { status: 500 });
  }
}
