import { domainErrorResponse } from "@/lib/api-errors";
import {
  createApprovalDelegation,
  listApprovalDelegations,
  previewDelegationCases,
} from "@/lib/approval-delegations";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

function input(body: Record<string, unknown>) {
  return {
    delegateApproverUserId: String(body.delegateApproverUserId ?? ""),
    departmentId: String(body.departmentId ?? ""),
    endsAt: String(body.endsAt ?? ""),
    originalApproverUserId: String(body.originalApproverUserId ?? ""),
    reason: String(body.reason ?? ""),
    requestType: String(body.requestType ?? ""),
    startsAt: String(body.startsAt ?? ""),
  };
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({
      delegations: await listApprovalDelegations(database, actor),
    });
  } catch (error) {
    return domainErrorResponse(error, "承認引継ぎを取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    if (body.action === "preview") {
      return Response.json({
        preview: await previewDelegationCases(database, actor, input(body)),
      });
    }
    const result = await createApprovalDelegation(database, actor, {
      ...input(body),
      reassignCaseIds: Array.isArray(body.reassignCaseIds) ? body.reassignCaseIds.map(String) : [],
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error, "承認引継ぎを保存できませんでした。");
  }
}
