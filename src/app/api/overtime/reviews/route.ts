import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  listOvertimeReviewRequests,
  OvertimeRequestValidationError,
} from "@/lib/overtime-requests";

const kinds = ["holiday_work", "overtime"] as const;
const statuses = ["approved", "cancelled", "pending", "rejected"] as const;

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    const requestedKind = url.searchParams.get("kind");
    const requestedStatus = url.searchParams.get("status");
    const kind = requestedKind ? kinds.find((candidate) => candidate === requestedKind) : undefined;
    const status = requestedStatus
      ? statuses.find((candidate) => candidate === requestedStatus)
      : undefined;
    if (requestedKind && !kind)
      throw new OvertimeRequestValidationError("申請区分が正しくありません。");
    if (requestedStatus && !status)
      throw new OvertimeRequestValidationError("状態が正しくありません。");
    return Response.json({
      requests: await listOvertimeReviewRequests(database, actor, {
        employeeId: url.searchParams.get("employeeId") || undefined,
        from: url.searchParams.get("from") || undefined,
        kind,
        status,
        to: url.searchParams.get("to") || undefined,
      }),
    });
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請の審査一覧を取得できませんでした。");
  }
}
