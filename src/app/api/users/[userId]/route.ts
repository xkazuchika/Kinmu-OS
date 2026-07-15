import { and, eq } from "drizzle-orm";

import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { recordAudit } from "@/lib/audit";
import { getDatabase } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { setUserEnabled, setUserRole, UserManagementError } from "@/lib/users";

function canAssignRole(actorRole: "owner" | "hr_admin" | "employee", role: string) {
  return (
    ["owner", "hr_admin", "employee"].includes(role) &&
    !(actorRole === "hr_admin" && role === "owner")
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const body = (await request.json()) as Partial<{ enabled: boolean; role: string }>;
  const { userId } = await context.params;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);

    requirePermission(actor, "users:manage");

    const [target] = await database
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)))
      .limit(1);

    if (!target || (actor.role === "hr_admin" && target.role === "owner")) {
      throw new AuthorizationError();
    }

    if (typeof body.enabled === "boolean") {
      const user = await setUserEnabled(database, {
        enabled: body.enabled,
        organizationId: actor.organizationId,
        userId,
      });

      await recordAudit(database, {
        action: body.enabled ? "user_enabled" : "user_disabled",
        actorUserId: actor.userId,
        entityId: user.id,
        entityType: "user",
        metadata: { enabled: body.enabled },
        organizationId: actor.organizationId,
      });

      return Response.json({ user });
    }

    if (body.role && canAssignRole(actor.role, body.role)) {
      const user = await setUserRole(database, {
        organizationId: actor.organizationId,
        role: body.role as "owner" | "hr_admin" | "employee",
        userId,
      });

      await recordAudit(database, {
        action: "role_changed",
        actorUserId: actor.userId,
        entityId: user.id,
        entityType: "user",
        metadata: { role: user.role },
        organizationId: actor.organizationId,
      });

      return Response.json({ user });
    }

    throw new AuthorizationError();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof UserManagementError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("Could not update user.", error);
    return Response.json({ error: "利用者を更新できませんでした。" }, { status: 500 });
  }
}
