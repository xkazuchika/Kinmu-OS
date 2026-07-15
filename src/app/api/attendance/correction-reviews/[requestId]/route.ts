import {
  getManagedAttendanceCorrection,
  reviewAttendanceCorrection,
} from "@/lib/attendance-corrections";
import { attendanceCorrectionErrorResponse } from "@/lib/attendance-correction-http";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({
      correction: await getManagedAttendanceCorrection(database, actor, requestId),
    });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を取得できませんでした。");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const body = (await request.json()) as { comment?: string; decision?: string };
    if (body.decision !== "approve" && body.decision !== "reject") {
      return Response.json({ error: "審査結果が正しくありません。" }, { status: 422 });
    }
    const { requestId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({
      correction: await reviewAttendanceCorrection(database, actor, requestId, {
        comment: body.comment,
        decision: body.decision,
      }),
    });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を審査できませんでした。");
  }
}
