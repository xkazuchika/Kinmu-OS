import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { createApprovalRoute, listApprovalRoutes } from "@/lib/approval-routing";
import { getDatabase } from "@/lib/db/client";

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return Number(value);
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({ routes: await listApprovalRoutes(database, actor) });
  } catch (error) {
    return domainErrorResponse(error, "承認経路を取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const route = await createApprovalRoute(database, actor, {
      approverUserId: String(body.approverUserId ?? ""),
      departmentId: String(body.departmentId ?? ""),
      dueDays: optionalInteger(body.dueDays),
      effectiveFrom: String(body.effectiveFrom ?? ""),
      effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null,
      requestType: String(body.requestType ?? ""),
    });
    return Response.json({ route }, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error, "承認経路を作成できませんでした。");
  }
}
