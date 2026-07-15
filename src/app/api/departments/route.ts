import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { createDepartment, DepartmentManagementError, listDepartments } from "@/lib/departments";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");

    return Response.json({ departments: await listDepartments(database, actor.organizationId) });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    console.error("Could not list departments.", error);
    return Response.json({ error: "部署一覧を取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{ code: string; name: string }>;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    const department = await createDepartment(database, {
      code: body.code ?? "",
      name: body.name ?? "",
      organizationId: actor.organizationId,
    });

    await recordAudit(database, {
      action: "department_changed",
      actorUserId: actor.userId,
      entityId: department.id,
      entityType: "department",
      metadata: { active: true, change: "created", code: department.code },
      organizationId: actor.organizationId,
    });

    return Response.json({ department }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof DepartmentManagementError) {
      return Response.json({ error: error.message }, { status: 422 });
    }

    console.error("Could not create department.", error);
    return Response.json({ error: "部署を作成できませんでした。" }, { status: 500 });
  }
}
