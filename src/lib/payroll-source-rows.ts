import { and, asc, eq } from "drizzle-orm";

import { requirePermission, type SessionActor } from "@/lib/authorization";
import type { PayrollSourceRow } from "@/lib/payroll-csv";
import type { AppDatabase } from "@/lib/db/client";
import { attendanceMonthDaySnapshots, attendanceMonthRevisions } from "@/lib/db/schema";
import type { PayrollEmployeeMappingSnapshot } from "@/lib/payroll-export-types";
import { PayrollResourceNotFoundError } from "@/lib/payroll-errors";

export class PayrollSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollSourceValidationError";
  }
}

const V04_FIELDS = ["leave_units", "leave_scheduled_minutes", "absence_days"] as const;
const V05_FIELDS = [
  "holiday_work_minutes",
  "overtime_requested_minutes",
  "overtime_actual_minutes",
  "overtime_difference_minutes",
  "overtime_reconciliation_status",
] as const;

function nullableSum(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

function reconciliationStatus(values: Array<string | null>) {
  const priority = [
    "unapproved_actual",
    "exceeded_request",
    "under_request",
    "no_actual",
    "within_request",
  ];
  return priority.find((status) => values.includes(status)) ?? null;
}

export async function buildPayrollSourceRows(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  input: Readonly<{
    mappings: PayrollEmployeeMappingSnapshot[];
    revisionId: string;
  }>,
) {
  requirePermission(actor, "payroll:manage");
  const [revision] = await db
    .select()
    .from(attendanceMonthRevisions)
    .where(
      and(
        eq(attendanceMonthRevisions.id, input.revisionId),
        eq(attendanceMonthRevisions.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!revision) throw new PayrollResourceNotFoundError();
  const days = await db
    .select()
    .from(attendanceMonthDaySnapshots)
    .where(
      and(
        eq(attendanceMonthDaySnapshots.revisionId, revision.id),
        eq(attendanceMonthDaySnapshots.organizationId, actor.organizationId),
      ),
    )
    .orderBy(
      asc(attendanceMonthDaySnapshots.employeeId),
      asc(attendanceMonthDaySnapshots.workDate),
    );
  const mappingByEmployee = new Map(input.mappings.map((mapping) => [mapping.employeeId, mapping]));
  const daysByEmployee = new Map<string, typeof days>();
  for (const day of days) {
    const employeeDays = daysByEmployee.get(day.employeeId) ?? [];
    employeeDays.push(day);
    daysByEmployee.set(day.employeeId, employeeDays);
  }

  return [...daysByEmployee.entries()].map(([employeeId, employeeDays]): PayrollSourceRow => {
    const first = employeeDays[0];
    const mapping = mappingByEmployee.get(employeeId);
    const hasV04Snapshot = employeeDays.some((day) => day.operationalStatus !== null);
    const hasV05Snapshot = employeeDays.some(
      (day) =>
        day.overtimePolicyId !== null ||
        day.overtimeRequestIds.length > 0 ||
        day.overtimeRequestKind !== null ||
        day.overtimeRequestedMinutes !== null ||
        day.overtimeActualMinutes !== null ||
        day.overtimeDifferenceMinutes !== null ||
        day.overtimeReconciliationStatus !== null,
    );
    const unavailableFields = [
      ...(!hasV04Snapshot ? V04_FIELDS : []),
      ...(!hasV05Snapshot ? V05_FIELDS : []),
    ];
    return {
      employeeId,
      externalEmployeeCode: mapping?.externalEmployeeCode ?? "",
      unavailableFields,
      values: {
        absence_days: hasV04Snapshot
          ? employeeDays.filter((day) => day.operationalStatus === "absence").length
          : null,
        attendance_revision: revision.revision,
        break_minutes: nullableSum(employeeDays.map((day) => day.breakMinutes)),
        department_code: first.departmentCode,
        department_name: first.departmentName,
        display_name: first.displayName,
        employee_id: employeeId,
        employee_number: first.employeeNumber,
        holiday_work_minutes: hasV05Snapshot
          ? nullableSum(
              employeeDays.map((day) =>
                day.overtimeRequestKind === "holiday_work" ? day.overtimeActualMinutes : null,
              ),
            )
          : null,
        leave_scheduled_minutes: hasV04Snapshot
          ? (nullableSum(employeeDays.map((day) => day.leaveScheduledMinutes)) ?? 0)
          : null,
        leave_units: hasV04Snapshot
          ? (nullableSum(employeeDays.map((day) => day.leaveUnits)) ?? 0)
          : null,
        overtime_actual_minutes: hasV05Snapshot
          ? nullableSum(employeeDays.map((day) => day.overtimeActualMinutes))
          : null,
        overtime_difference_minutes: hasV05Snapshot
          ? nullableSum(employeeDays.map((day) => day.overtimeDifferenceMinutes))
          : null,
        overtime_minutes: nullableSum(employeeDays.map((day) => day.overtimeMinutes)),
        overtime_reconciliation_status: hasV05Snapshot
          ? reconciliationStatus(employeeDays.map((day) => day.overtimeReconciliationStatus))
          : null,
        overtime_requested_minutes: hasV05Snapshot
          ? nullableSum(employeeDays.map((day) => day.overtimeRequestedMinutes))
          : null,
        scheduled_minutes: employeeDays.reduce((sum, day) => sum + day.scheduledMinutes, 0),
        target_month: revision.targetMonth,
        worked_minutes: nullableSum(employeeDays.map((day) => day.workedMinutes)),
      },
    };
  });
}
