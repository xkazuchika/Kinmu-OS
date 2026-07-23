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
    const requestedKind = url.searchParams.get("overtimeRequestKind");
    const overtimeRequestKind =
      requestedKind === "overtime" || requestedKind === "holiday_work" ? requestedKind : undefined;
    const requestedResult = url.searchParams.get("validationResult");
    const validationResult =
      requestedResult === "passed" || requestedResult === "failed" ? requestedResult : undefined;
    const requestedRevision = url.searchParams.get("attendanceRevision");
    const attendanceRevision = requestedRevision ? Number(requestedRevision) : undefined;
    return Response.json({
      logs: await searchAuditLogs(database, {
        action: url.searchParams.get("action") || undefined,
        actorUserId: url.searchParams.get("actorUserId") || undefined,
        attendanceRevision:
          attendanceRevision && Number.isInteger(attendanceRevision)
            ? attendanceRevision
            : undefined,
        employeeId: url.searchParams.get("employeeId") || undefined,
        entityId: url.searchParams.get("entityId") || undefined,
        from: from ? new Date(`${from}T00:00:00Z`) : undefined,
        organizationId: actor.organizationId,
        overtimeRequestKind,
        payrollOnly: url.searchParams.get("payrollOnly") === "1",
        profileId: url.searchParams.get("profileId") || undefined,
        runId: url.searchParams.get("runId") || undefined,
        targetMonth: url.searchParams.get("targetMonth") || undefined,
        to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
        validationResult,
      }),
    });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    console.error("Could not search audit logs.", error);
    return Response.json({ error: "監査ログを取得できませんでした。" }, { status: 500 });
  }
}
