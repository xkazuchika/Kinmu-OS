import { listManagedAttendanceCorrections } from "@/lib/attendance-corrections";
import { attendanceCorrectionErrorResponse } from "@/lib/attendance-correction-http";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    return Response.json({
      requests: await listManagedAttendanceCorrections(database, actor, {
        employeeId: url.searchParams.get("employeeId") || undefined,
        from: url.searchParams.get("from") || undefined,
        status: url.searchParams.get("status") || undefined,
        to: url.searchParams.get("to") || undefined,
      }),
    });
  } catch (error) {
    return attendanceCorrectionErrorResponse(error, "勤怠修正申請を取得できませんでした。");
  }
}
