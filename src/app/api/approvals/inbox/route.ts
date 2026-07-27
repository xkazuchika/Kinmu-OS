import { domainErrorResponse } from "@/lib/api-errors";
import { listApprovalInbox } from "@/lib/approval-cases";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

function dateTime(value: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const parameters = new URL(request.url).searchParams;
    const proxy = parameters.get("proxy");
    const result = await listApprovalInbox(database, actor, {
      assigned:
        (parameters.get("assigned") as "assigned" | "mine" | "unassigned" | null) ?? undefined,
      departmentId: parameters.get("departmentId") || undefined,
      due: (parameters.get("due") as "all" | "not_overdue" | "overdue" | null) ?? undefined,
      employeeId: parameters.get("employeeId") || undefined,
      from: parameters.get("from") || undefined,
      page: Number(parameters.get("page") || 1),
      proxy: proxy === null ? undefined : proxy === "true",
      requestType: parameters.get("requestType") || undefined,
      status: parameters.get("status") || undefined,
      submittedFrom: dateTime(parameters.get("submittedFrom")),
      submittedTo: dateTime(parameters.get("submittedTo")),
      to: parameters.get("to") || undefined,
    });
    return Response.json(result);
  } catch (error) {
    return domainErrorResponse(error, "承認受信箱を取得できませんでした。");
  }
}
