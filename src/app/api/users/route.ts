import { asc, eq } from "drizzle-orm";

import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { recordAudit } from "@/lib/audit";
import { getDatabase } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createUserWithSetupLink, UserManagementError } from "@/lib/users";

function canAssignRole(actorRole: "owner" | "hr_admin" | "employee", role: string) {
  return (
    ["owner", "hr_admin", "employee"].includes(role) &&
    !(actorRole === "hr_admin" && role === "owner")
  );
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);

    requirePermission(actor, "users:manage");

    const result = await database
      .select({
        displayName: users.displayName,
        email: users.email,
        id: users.id,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(eq(users.organizationId, actor.organizationId))
      .orderBy(asc(users.displayName));

    return Response.json({ users: result });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    console.error("Could not list users.", error);
    return Response.json({ error: "利用者一覧を取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{
    displayName: string;
    email: string;
    role: string;
  }>;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);

    requirePermission(actor, "users:manage");

    if (!canAssignRole(actor.role, body.role ?? "")) {
      throw new AuthorizationError();
    }

    const result = await createUserWithSetupLink(database, {
      displayName: body.displayName ?? "",
      email: body.email ?? "",
      organizationId: actor.organizationId,
      role: body.role as "owner" | "hr_admin" | "employee",
    });

    await recordAudit(database, {
      action: "user_created",
      actorUserId: actor.userId,
      entityId: result.user.id,
      entityType: "user",
      metadata: { role: result.user.role },
      organizationId: actor.organizationId,
    });

    return Response.json(
      {
        setupUrl: `/activate/${result.setupToken}`,
        user: result.user,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof UserManagementError) {
      return Response.json({ error: error.message }, { status: 422 });
    }

    console.error("Could not create user.", error);
    return Response.json({ error: "利用者を作成できませんでした。" }, { status: 500 });
  }
}
