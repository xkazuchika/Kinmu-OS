import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  approveOvertimeWorkRequest,
  getOvertimeReviewDetail,
  OvertimeRequestValidationError,
  rejectOvertimeWorkRequest,
} from "@/lib/overtime-requests";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { requestId } = await context.params;
    return Response.json({ detail: await getOvertimeReviewDetail(database, actor, requestId) });
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請を取得できませんでした。");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion)) {
      throw new OvertimeRequestValidationError("期待バージョンが正しくありません。");
    }
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { requestId } = await context.params;
    if (body.action === "approve") {
      return Response.json({
        request: await approveOvertimeWorkRequest(database, actor, requestId, expectedVersion),
      });
    }
    if (body.action === "reject") {
      return Response.json({
        request: await rejectOvertimeWorkRequest(
          database,
          actor,
          requestId,
          expectedVersion,
          String(body.comment ?? ""),
        ),
      });
    }
    throw new OvertimeRequestValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請を審査できませんでした。");
  }
}
