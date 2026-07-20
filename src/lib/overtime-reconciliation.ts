import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";

import type { OperationalAttendanceDay } from "@/lib/attendance-operations";
import type { AppDatabase } from "@/lib/db/client";
import { overtimeRequestPolicies, overtimeWorkRequests } from "@/lib/db/schema";

export type OvertimeReconciliationStatus =
  "exceeded_request" | "no_actual" | "unapproved_actual" | "under_request" | "within_request";

export type OvertimeReconciliation = Readonly<{
  actualMinutes: number;
  blockClose: boolean;
  differenceMinutes: number;
  kind: "holiday_work" | "overtime" | null;
  policyId: string;
  requestIds: string[];
  requestedMinutes: number;
  status: OvertimeReconciliationStatus | null;
}>;

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10),
  };
}

export function reconcileOvertimeMinutes(
  input: Readonly<{
    actualMinutes: number;
    allowedDeviationMinutes: number;
    hasApprovedRequest: boolean;
    requestedMinutes: number;
  }>,
): OvertimeReconciliationStatus | null {
  if (input.actualMinutes <= 0 && !input.hasApprovedRequest) return null;
  if (input.actualMinutes > 0 && !input.hasApprovedRequest) return "unapproved_actual";
  if (input.hasApprovedRequest && input.actualMinutes <= 0) return "no_actual";
  const difference = input.actualMinutes - input.requestedMinutes;
  if (difference > input.allowedDeviationMinutes) return "exceeded_request";
  if (difference < -input.allowedDeviationMinutes) return "under_request";
  return "within_request";
}

export async function overtimeReconciliationsForMonth(
  db: Pick<AppDatabase, "select">,
  input: Readonly<{
    days: readonly OperationalAttendanceDay[];
    month: string;
    organizationId: string;
  }>,
) {
  if (!input.days.length) return new Map<string, OvertimeReconciliation>();
  const range = monthRange(input.month);
  const employeeIds = [...new Set(input.days.map((day) => day.employeeId))];
  const [policies, requests] = await Promise.all([
    db
      .select()
      .from(overtimeRequestPolicies)
      .where(
        and(
          eq(overtimeRequestPolicies.organizationId, input.organizationId),
          eq(overtimeRequestPolicies.status, "active"),
          lt(overtimeRequestPolicies.effectiveFrom, range.to),
        ),
      )
      .orderBy(asc(overtimeRequestPolicies.effectiveFrom), asc(overtimeRequestPolicies.createdAt)),
    db
      .select()
      .from(overtimeWorkRequests)
      .where(
        and(
          eq(overtimeWorkRequests.organizationId, input.organizationId),
          eq(overtimeWorkRequests.status, "approved"),
          inArray(overtimeWorkRequests.employeeId, employeeIds),
          gte(overtimeWorkRequests.workDate, range.from),
          lt(overtimeWorkRequests.workDate, range.to),
        ),
      )
      .orderBy(asc(overtimeWorkRequests.workDate), asc(overtimeWorkRequests.plannedStartAt)),
  ]);
  const requestsByKey = new Map<string, typeof requests>();
  for (const request of requests) {
    const key = `${request.employeeId}:${request.workDate}`;
    const rows = requestsByKey.get(key) ?? [];
    rows.push(request);
    requestsByKey.set(key, rows);
  }
  const result = new Map<string, OvertimeReconciliation>();
  for (const day of input.days) {
    const policy = policies.filter((candidate) => candidate.effectiveFrom <= day.workDate).at(-1);
    if (!policy) continue;
    const approved = requestsByKey.get(`${day.employeeId}:${day.workDate}`) ?? [];
    const requestedMinutes = approved.reduce((sum, request) => sum + request.plannedMinutes, 0);
    const actualMinutes =
      day.calendarDayKind === "workday" ? (day.overtimeMinutes ?? 0) : (day.workedMinutes ?? 0);
    const status = reconcileOvertimeMinutes({
      actualMinutes,
      allowedDeviationMinutes: policy.allowedDeviationMinutes,
      hasApprovedRequest: approved.length > 0,
      requestedMinutes,
    });
    result.set(`${day.employeeId}:${day.workDate}`, {
      actualMinutes,
      blockClose: policy.blockCloseOnUnresolvedDifference,
      differenceMinutes: actualMinutes - requestedMinutes,
      kind:
        approved[0]?.kind ??
        (actualMinutes > 0
          ? day.calendarDayKind === "workday"
            ? "overtime"
            : "holiday_work"
          : null),
      policyId: policy.id,
      requestIds: approved.map((request) => request.id),
      requestedMinutes,
      status,
    });
  }
  return result;
}
