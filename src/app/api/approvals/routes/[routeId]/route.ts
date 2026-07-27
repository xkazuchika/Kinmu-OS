import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { deleteApprovalRoute, updateApprovalRoute } from "@/lib/approval-routing";
import { getDatabase } from "@/lib/db/client";

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return Number(value);
}

export async function PATCH(request: Request, context: { params: Promise<{ routeId: string }> }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { routeId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const route = await updateApprovalRoute(database, actor, routeId, {
      approverUserId: String(body.approverUserId ?? ""),
      departmentId: String(body.departmentId ?? ""),
      dueDays: optionalInteger(body.dueDays),
      effectiveFrom: String(body.effectiveFrom ?? ""),
      effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null,
      requestType: String(body.requestType ?? ""),
      version: Number(body.version),
    });
    return Response.json({ route });
  } catch (error) {
    return domainErrorResponse(error, "承認経路を更新できませんでした。");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ routeId: string }> }) {
  try {
    const { routeId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    const route = await deleteApprovalRoute(
      database,
      actor,
      routeId,
      Number(url.searchParams.get("version")),
    );
    return Response.json({ route });
  } catch (error) {
    return domainErrorResponse(error, "承認経路を削除できませんでした。");
  }
}
