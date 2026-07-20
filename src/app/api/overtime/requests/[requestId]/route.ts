import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  cancelOvertimeWorkRequest,
  getOwnOvertimeWorkRequest,
  OvertimeRequestValidationError,
} from "@/lib/overtime-requests";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { requestId } = await context.params;
    return Response.json({ request: await getOwnOvertimeWorkRequest(database, actor, requestId) });
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請を取得できませんでした。");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action !== "cancel")
      throw new OvertimeRequestValidationError("操作が正しくありません。");
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion)) {
      throw new OvertimeRequestValidationError("期待バージョンが正しくありません。");
    }
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { requestId } = await context.params;
    return Response.json({
      request: await cancelOvertimeWorkRequest(database, actor, requestId, expectedVersion),
    });
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請を取り消せませんでした。");
  }
}
