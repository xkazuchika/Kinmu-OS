import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { EmployeeManagementError, getSelfProfile, updateSelfContact } from "@/lib/employees";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "self:read");
    const profile = await getSelfProfile(database, actor);

    if (!profile) {
      return Response.json({ error: "従業員情報が紐付いていません。" }, { status: 404 });
    }
    return Response.json({ profile });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    console.error("Could not load self profile.", error);
    return Response.json({ error: "プロフィールを取得できませんでした。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "self:write");

    if (["employmentType", "status", "departmentId"].some((key) => key in body)) {
      throw new AuthorizationError("雇用情報は変更できません。労務管理者へ問い合わせてください。");
    }
    const profile = await getSelfProfile(database, actor);
    if (!profile) throw new EmployeeManagementError("従業員情報が紐付いていません。");
    const employee = await updateSelfContact(database, {
      contactEmail: String(body.contactEmail ?? ""),
      employeeId: profile.id,
      phoneNumber: String(body.phoneNumber ?? ""),
    });

    await recordAudit(database, {
      action: "employee_updated",
      actorUserId: actor.userId,
      entityId: employee.id,
      entityType: "employee",
      metadata: { changedFields: ["contactEmail", "phoneNumber"], source: "self_service" },
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
    console.error("Could not update self profile.", error);
    return Response.json({ error: "プロフィールを更新できませんでした。" }, { status: 500 });
  }
}
