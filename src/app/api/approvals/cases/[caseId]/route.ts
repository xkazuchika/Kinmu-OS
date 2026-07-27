import { domainErrorResponse } from "@/lib/api-errors";
import { getApprovalCaseDetail } from "@/lib/approval-cases";
import { reviewApprovalCase } from "@/lib/approval-review";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({
      approvalCase: await getApprovalCaseDetail(database, actor, caseId),
    });
  } catch (error) {
    return domainErrorResponse(error, "承認申請を取得できませんでした。");
  }
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { caseId } = await context.params;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const result = await reviewApprovalCase(database, actor, caseId, {
      action: String(body.action ?? "") as "approve" | "reject" | "return",
      comment: body.comment === undefined ? undefined : String(body.comment),
      expectedVersion: Number(body.expectedVersion),
    });
    return Response.json({ result });
  } catch (error) {
    return domainErrorResponse(error, "承認申請を審査できませんでした。");
  }
}
