import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { adjustLeaveBalance, grantLeave, LeaveLedgerValidationError } from "@/lib/leave-ledger";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const common = {
      employeeId: String(body.employeeId ?? ""),
      expectedVersion:
        body.expectedVersion === undefined ? undefined : Number(body.expectedVersion),
      leaveTypeId: String(body.leaveTypeId ?? ""),
      reason: String(body.reason ?? ""),
      units: Number(body.units),
    };
    if (body.action === "grant") {
      return Response.json(
        {
          result: await grantLeave(database, actor, {
            ...common,
            expiresOn: body.expiresOn ? String(body.expiresOn) : null,
            grantedOn: String(body.grantedOn ?? ""),
          }),
        },
        { status: 201 },
      );
    }
    if (body.action === "adjust") {
      return Response.json({
        result: await adjustLeaveBalance(database, actor, {
          ...common,
          effectiveOn: String(body.effectiveOn ?? ""),
        }),
      });
    }
    throw new LeaveLedgerValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "休暇残高を更新できませんでした。");
  }
}
