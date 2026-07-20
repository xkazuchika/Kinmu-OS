import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  createOvertimeWorkRequest,
  listOwnOvertimeWorkRequests,
  OvertimeRequestValidationError,
  previewOvertimeWorkRequest,
} from "@/lib/overtime-requests";
import { effectiveOvertimePolicy } from "@/lib/overtime-policies";

const kinds = ["holiday_work", "overtime"] as const;
const statuses = ["approved", "cancelled", "pending", "rejected"] as const;

function kind(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const match = kinds.find((candidate) => candidate === value);
  if (!match) throw new OvertimeRequestValidationError("申請区分が正しくありません。");
  return match;
}

function breakMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed))
    throw new OvertimeRequestValidationError("予定休憩が正しくありません。");
  return parsed;
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get("status");
    const status = requestedStatus
      ? statuses.find((candidate) => candidate === requestedStatus)
      : undefined;
    if (requestedStatus && !status)
      throw new OvertimeRequestValidationError("状態が正しくありません。");
    const policyDate = url.searchParams.get("policyDate") ?? new Date().toISOString().slice(0, 10);
    const [requests, policy] = await Promise.all([
      listOwnOvertimeWorkRequests(database, actor, {
        from: url.searchParams.get("from") || undefined,
        kind: kind(url.searchParams.get("kind")),
        status,
        to: url.searchParams.get("to") || undefined,
      }),
      effectiveOvertimePolicy(database, actor.organizationId, policyDate),
    ]);
    return Response.json({ policy, requests });
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請を取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const input = {
      endTime: String(body.endTime ?? ""),
      kind: kind(body.kind),
      plannedBreakMinutes: breakMinutes(body.plannedBreakMinutes),
      startTime: String(body.startTime ?? ""),
      workDate: String(body.workDate ?? ""),
    };
    if (body.action === "preview") {
      return Response.json({ preview: await previewOvertimeWorkRequest(database, actor, input) });
    }
    if (body.action === "create") {
      return Response.json(
        {
          result: await createOvertimeWorkRequest(database, actor, {
            ...input,
            reason: String(body.reason ?? ""),
          }),
        },
        { status: 201 },
      );
    }
    throw new OvertimeRequestValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "残業・休日出勤申請を更新できませんでした。");
  }
}
