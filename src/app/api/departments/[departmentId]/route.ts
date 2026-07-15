import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { DepartmentManagementError, updateDepartment } from "@/lib/departments";
import { getDatabase } from "@/lib/db/client";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ departmentId: string }> },
) {
  const body = (await request.json()) as Partial<{ active: boolean; code: string; name: string }>;
  const { departmentId } = await context.params;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    const department = await updateDepartment(database, {
      active: typeof body.active === "boolean" ? body.active : undefined,
      code: body.code,
      departmentId,
      name: body.name,
      organizationId: actor.organizationId,
    });

    await recordAudit(database, {
      action: "department_changed",
      actorUserId: actor.userId,
      entityId: department.id,
      entityType: "department",
      metadata: { active: department.active, change: "updated", code: department.code },
      organizationId: actor.organizationId,
    });

    return Response.json({ department });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof DepartmentManagementError) {
      return Response.json({ error: error.message }, { status: 422 });
    }

    console.error("Could not update department.", error);
    return Response.json({ error: "部署を更新できませんでした。" }, { status: 500 });
  }
}
