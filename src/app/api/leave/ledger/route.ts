import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  getEmployeeLeaveLedger,
  getOwnLeaveLedger,
  listManagedLeaveLedger,
} from "@/lib/leave-ledger";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    const asOf = url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
    const employeeId = url.searchParams.get("employeeId") || undefined;
    if (actor.role === "employee") {
      return Response.json(await getOwnLeaveLedger(database, actor, asOf));
    }
    if (employeeId && url.searchParams.get("scope") === "employee") {
      return Response.json(await getEmployeeLeaveLedger(database, actor, { asOf, employeeId }));
    }
    return Response.json({
      transactions: await listManagedLeaveLedger(database, actor, {
        departmentId: url.searchParams.get("departmentId") || undefined,
        employeeId,
        from: url.searchParams.get("from") || undefined,
        leaveTypeId: url.searchParams.get("leaveTypeId") || undefined,
        to: url.searchParams.get("to") || undefined,
      }),
    });
  } catch (error) {
    return domainErrorResponse(error, "休暇台帳を取得できませんでした。");
  }
}
