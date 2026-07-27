import { domainErrorResponse } from "@/lib/api-errors";
import { reassignApprovalCases } from "@/lib/approval-delegations";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const result = await reassignApprovalCases(database, actor, {
      caseIds: Array.isArray(body.caseIds) ? body.caseIds.map(String) : [],
      reason: String(body.reason ?? ""),
      toApproverUserId: String(body.toApproverUserId ?? ""),
    });
    return Response.json(result);
  } catch (error) {
    return domainErrorResponse(error, "承認申請を再割当できませんでした。");
  }
}
