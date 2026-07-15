import {
  createAttendanceCorrection,
  listOwnAttendanceCorrections,
} from "@/lib/attendance-corrections";
import { attendanceCorrectionErrorResponse } from "@/lib/attendance-correction-http";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({ requests: await listOwnAttendanceCorrections(database, actor) });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      entries?: Array<{ occurredAt?: string; originalEventId?: null | string; type?: string }>;
      reason?: string;
      workDate?: string;
    };
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const correction = await createAttendanceCorrection(database, actor, {
      entries: (body.entries ?? []).map((entry) => ({
        occurredAt: entry.occurredAt ?? "",
        originalEventId: entry.originalEventId,
        type: entry.type ?? "",
      })),
      reason: body.reason ?? "",
      workDate: body.workDate ?? "",
    });
    return Response.json({ correction }, { status: 201 });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を作成できませんでした。");
  }
}
