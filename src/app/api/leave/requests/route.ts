import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  createLeaveRequest,
  LeaveRequestValidationError,
  listLeaveRequests,
  previewLeaveRequest,
} from "@/lib/leave-requests";

const statuses = ["approved", "cancelled", "pending", "rejected"] as const;

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get("status");
    const status = statuses.find((candidate) => candidate === requestedStatus);
    if (requestedStatus && !status)
      throw new LeaveRequestValidationError("状態が正しくありません。");
    return Response.json({
      requests: await listLeaveRequests(database, actor, {
        employeeId: url.searchParams.get("employeeId") || undefined,
        status,
      }),
    });
  } catch (error) {
    return domainErrorResponse(error, "休暇申請を取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const unit = String(body.unit ?? "");
    if (unit !== "full_day" && unit !== "half_day") {
      throw new LeaveRequestValidationError("休暇単位が正しくありません。");
    }
    const input = {
      from: String(body.from ?? ""),
      leaveTypeId: String(body.leaveTypeId ?? ""),
      to: String(body.to ?? ""),
      unit,
    } as const;
    if (body.action === "preview") {
      return Response.json({ preview: await previewLeaveRequest(database, actor, input) });
    }
    if (body.action === "create") {
      return Response.json(
        {
          result: await createLeaveRequest(database, actor, {
            ...input,
            reason: String(body.reason ?? ""),
          }),
        },
        { status: 201 },
      );
    }
    throw new LeaveRequestValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "休暇申請を更新できませんでした。");
  }
}
