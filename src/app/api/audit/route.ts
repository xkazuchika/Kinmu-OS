import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { searchAuditLogs } from "@/lib/reporting";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "audit:read");
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    return Response.json({
      logs: await searchAuditLogs(database, {
        action: url.searchParams.get("action") || undefined,
        actorUserId: url.searchParams.get("actorUserId") || undefined,
        entityId: url.searchParams.get("entityId") || undefined,
        from: from ? new Date(`${from}T00:00:00Z`) : undefined,
        organizationId: actor.organizationId,
        to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
      }),
    });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    console.error("Could not search audit logs.", error);
    return Response.json({ error: "監査ログを取得できませんでした。" }, { status: 500 });
  }
}
