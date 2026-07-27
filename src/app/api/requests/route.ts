import { domainErrorResponse } from "@/lib/api-errors";
import { listOwnApprovalCases } from "@/lib/approval-cases";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({ cases: await listOwnApprovalCases(database, actor) });
  } catch (error) {
    return domainErrorResponse(error, "自分の申請履歴を取得できませんでした。");
  }
}
