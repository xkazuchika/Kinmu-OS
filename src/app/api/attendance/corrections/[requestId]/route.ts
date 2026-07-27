import {
  cancelAttendanceCorrection,
  getOwnAttendanceCorrection,
  resubmitAttendanceCorrection,
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
      correction: await getOwnAttendanceCorrection(database, actor, requestId),
    });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を取得できませんでした。");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action !== "cancel" && body.action !== "resubmit") {
      return Response.json({ error: "操作が正しくありません。" }, { status: 422 });
    }
    const { requestId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    if (body.action === "resubmit") {
      const entries = Array.isArray(body.entries)
        ? (body.entries as Array<Record<string, unknown>>)
        : [];
      return Response.json({
        correction: await resubmitAttendanceCorrection(database, actor, requestId, {
          entries: entries.map((entry) => ({
            occurredAt: String(entry.occurredAt ?? ""),
            originalEventId: entry.originalEventId ? String(entry.originalEventId) : null,
            type: String(entry.type ?? ""),
          })),
          expectedCaseVersion: Number(body.expectedCaseVersion),
          reason: String(body.reason ?? ""),
          workDate: String(body.workDate ?? ""),
        }),
      });
    }
    return Response.json({
      correction: await cancelAttendanceCorrection(database, actor, requestId),
    });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を取り消せませんでした。");
  }
}
