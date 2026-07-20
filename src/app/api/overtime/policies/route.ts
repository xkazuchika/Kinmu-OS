import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  activateOvertimePolicy,
  listOvertimePolicies,
  OvertimePolicyValidationError,
  previewOvertimePolicyActivation,
  saveOvertimePolicyDraft,
} from "@/lib/overtime-policies";

function integer(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed))
    throw new OvertimePolicyValidationError(`${label}が正しくありません。`);
  return parsed;
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({ policies: await listOvertimePolicies(database, actor) });
  } catch (error) {
    return domainErrorResponse(error, "残業申請ポリシーを取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const action = String(body.action ?? "");
    if (action === "save") {
      const policy = await saveOvertimePolicyDraft(database, actor, {
        allowedDeviationMinutes: integer(body.allowedDeviationMinutes, "許容分数"),
        blockCloseOnUnresolvedDifference: body.blockCloseOnUnresolvedDifference === true,
        effectiveFrom: String(body.effectiveFrom ?? ""),
        expectedVersion:
          body.expectedVersion === undefined
            ? undefined
            : integer(body.expectedVersion, "期待バージョン"),
        minuteIncrement: integer(body.minuteIncrement, "入力単位"),
        policyId: body.policyId ? String(body.policyId) : undefined,
        requirePriorApproval: body.requirePriorApproval === true,
      });
      return Response.json({ policy }, { status: body.policyId ? 200 : 201 });
    }
    const policyId = String(body.policyId ?? "");
    if (!policyId) throw new OvertimePolicyValidationError("ポリシーを指定してください。");
    if (action === "preview_activation") {
      return Response.json({
        preview: await previewOvertimePolicyActivation(database, actor, policyId),
      });
    }
    if (action === "activate") {
      return Response.json({
        policy: await activateOvertimePolicy(
          database,
          actor,
          policyId,
          integer(body.expectedVersion, "期待バージョン"),
        ),
      });
    }
    throw new OvertimePolicyValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "残業申請ポリシーを更新できませんでした。");
  }
}
