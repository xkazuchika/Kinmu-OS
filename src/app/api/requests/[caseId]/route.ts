import { domainErrorResponse } from "@/lib/api-errors";
import { getOwnApprovalCaseDetail } from "@/lib/approval-cases";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { caseId } = await context.params;
    return Response.json({
      detail: await getOwnApprovalCaseDetail(database, actor, caseId),
    });
  } catch (error) {
    return domainErrorResponse(error, "申請詳細を取得できませんでした。");
  }
}
