import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveReviewDetail,
  LeaveRequestValidationError,
  rejectLeaveRequest,
} from "@/lib/leave-requests";

type Context = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { requestId } = await context.params;
    return Response.json({ detail: await getLeaveReviewDetail(database, actor, requestId) });
  } catch (error) {
    return domainErrorResponse(error, "休暇申請の詳細を取得できませんでした。");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { requestId } = await context.params;
    if (body.action === "cancel") {
      return Response.json({ request: await cancelLeaveRequest(database, actor, requestId) });
    }
    if (body.action === "approve") {
      return Response.json({ request: await approveLeaveRequest(database, actor, requestId) });
    }
    if (body.action === "reject") {
      return Response.json({
        request: await rejectLeaveRequest(database, actor, requestId, String(body.comment ?? "")),
      });
    }
    throw new LeaveRequestValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "休暇申請を審査できませんでした。");
  }
}
