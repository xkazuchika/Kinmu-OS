import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  createLeaveType,
  deactivateLeaveType,
  listLeaveTypes,
  updateLeaveType,
  LeaveLedgerValidationError,
} from "@/lib/leave-ledger";

function leaveTypeInput(body: Record<string, unknown>) {
  return {
    active: body.active === undefined ? true : Boolean(body.active),
    code: String(body.code ?? ""),
    consumesBalance: Boolean(body.consumesBalance),
    effectiveFrom: String(body.effectiveFrom ?? ""),
    effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null,
    name: String(body.name ?? ""),
    paid: Boolean(body.paid),
    requestable: Boolean(body.requestable),
  };
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({ leaveTypes: await listLeaveTypes(database, actor) });
  } catch (error) {
    return domainErrorResponse(error, "休暇種別を取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const action = String(body.action ?? "create");
    if (action === "create") {
      return Response.json(
        { leaveType: await createLeaveType(database, actor, leaveTypeInput(body)) },
        { status: 201 },
      );
    }
    if (action === "update") {
      return Response.json({
        leaveType: await updateLeaveType(
          database,
          actor,
          String(body.leaveTypeId ?? ""),
          leaveTypeInput(body),
        ),
      });
    }
    if (action === "deactivate") {
      return Response.json({
        leaveType: await deactivateLeaveType(database, actor, String(body.leaveTypeId ?? "")),
      });
    }
    throw new LeaveLedgerValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "休暇種別を更新できませんでした。");
  }
}
