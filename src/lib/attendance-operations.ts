import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import { attendanceMonthRange } from "@/lib/attendance-closing";
import type { AppDatabase } from "@/lib/db/client";
import {
  absenceRecords,
  attendanceDays,
  attendanceEvents,
  dailyAttendanceSummaries,
  employees,
  employeeStatusHistory,
  leaveRequestDays,
  leaveRequests,
  organizations,
  workCalendarDateExceptions,
  workCalendarPatterns,
  workRules,
} from "@/lib/db/schema";
import { overtimeReconciliationsForMonth } from "@/lib/overtime-reconciliation";

export type AttendanceOperationStatus =
  | "absence"
  | "conflict"
  | "leave_full"
  | "leave_half_worked"
  | "non_workday"
  | "open_punch"
  | "unresolved"
  | "worked";

export type OperationalAttendanceDay = Readonly<{
  absenceReason: string | null;
  attendanceDayId: string | null;
  attendanceStatus: "complete" | "open" | null;
  breakMinutes: number | null;
  calendarDayKind: "non_workday" | "workday";
  calendarLabel: string;
  calendarSource: string;
  displayName: string;
  employeeId: string;
  employeeNumber: string;
  leaveScheduledMinutes: number | null;
  leaveTypeCode: string | null;
  leaveTypeName: string | null;
  leaveUnits: number | null;
  operationalStatus: AttendanceOperationStatus;
  overtimeMinutes: number | null;
  overtimeActualMinutes: number | null;
  overtimeBlockClose: boolean;
  overtimeDifferenceMinutes: number | null;
  overtimePolicyId: string | null;
  overtimeReconciliationStatus:
    | "exceeded_request"
    | "no_actual"
    | "unapproved_actual"
    | "under_request"
    | "within_request"
    | null;
  overtimeRequestIds: string[];
  overtimeRequestKind: "holiday_work" | "overtime" | null;
  overtimeRequestedMinutes: number | null;
  scheduledMinutes: number;
  workedMinutes: number | null;
  workDate: string;
  workRuleId: string | null;
  workRuleName: string | null;
}>;

function dateList(from: string, to: string) {
  const dates: string[] = [];
  for (
    let cursor = new Date(`${from}T00:00:00.000Z`);
    cursor.toISOString().slice(0, 10) < to;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

const workdayKeyByDay = [
  "sundayWorkday",
  "mondayWorkday",
  "tuesdayWorkday",
  "wednesdayWorkday",
  "thursdayWorkday",
  "fridayWorkday",
  "saturdayWorkday",
] as const;

export async function projectOperationalAttendanceMonth(
  db: Pick<AppDatabase, "select">,
  input: { employeeIds?: string[]; month: string; organizationId: string },
) {
  const range = attendanceMonthRange(input.month);
  const employeeConditions = [eq(employees.organizationId, input.organizationId)];
  if (input.employeeIds?.length) employeeConditions.push(inArray(employees.id, input.employeeIds));
  const employeeRows = await db
    .select()
    .from(employees)
    .where(and(...employeeConditions))
    .orderBy(asc(employees.employeeNumber));
  if (!employeeRows.length) return [];
  const employeeIds = employeeRows.map((employee) => employee.id);

  const [
    organizationRows,
    histories,
    patterns,
    exceptions,
    rules,
    dayRows,
    eventCounts,
    leaveRows,
    absences,
  ] = await Promise.all([
    db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1),
    db
      .select()
      .from(employeeStatusHistory)
      .where(
        and(
          inArray(employeeStatusHistory.employeeId, employeeIds),
          lt(employeeStatusHistory.effectiveOn, range.to),
        ),
      )
      .orderBy(asc(employeeStatusHistory.effectiveOn), asc(employeeStatusHistory.createdAt)),
    db
      .select()
      .from(workCalendarPatterns)
      .where(
        and(
          eq(workCalendarPatterns.organizationId, input.organizationId),
          eq(workCalendarPatterns.status, "active"),
          lt(workCalendarPatterns.effectiveFrom, range.to),
        ),
      )
      .orderBy(asc(workCalendarPatterns.effectiveFrom), asc(workCalendarPatterns.createdAt)),
    db
      .select()
      .from(workCalendarDateExceptions)
      .where(
        and(
          eq(workCalendarDateExceptions.organizationId, input.organizationId),
          eq(workCalendarDateExceptions.active, true),
          gte(workCalendarDateExceptions.calendarDate, range.from),
          lt(workCalendarDateExceptions.calendarDate, range.to),
        ),
      ),
    db
      .select()
      .from(workRules)
      .where(
        and(
          eq(workRules.organizationId, input.organizationId),
          lt(workRules.effectiveFrom, range.to),
        ),
      )
      .orderBy(asc(workRules.effectiveFrom), asc(workRules.createdAt)),
    db
      .select({
        breakMinutes: dailyAttendanceSummaries.breakMinutes,
        employeeId: attendanceDays.employeeId,
        id: attendanceDays.id,
        overtimeMinutes: dailyAttendanceSummaries.overtimeMinutes,
        scheduledMinutes: attendanceDays.scheduledMinutes,
        status: attendanceDays.status,
        workDate: attendanceDays.workDate,
        workedMinutes: dailyAttendanceSummaries.workedMinutes,
        workRuleId: attendanceDays.workRuleId,
      })
      .from(attendanceDays)
      .leftJoin(
        dailyAttendanceSummaries,
        eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
      )
      .where(
        and(
          eq(attendanceDays.organizationId, input.organizationId),
          inArray(attendanceDays.employeeId, employeeIds),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
        ),
      ),
    db
      .select({
        attendanceDayId: attendanceEvents.attendanceDayId,
        value: sql<number>`count(*)::int`,
      })
      .from(attendanceEvents)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceEvents.attendanceDayId))
      .where(
        and(
          eq(attendanceEvents.organizationId, input.organizationId),
          inArray(attendanceEvents.employeeId, employeeIds),
          isNull(attendanceEvents.supersededByCorrectionRequestId),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
        ),
      )
      .groupBy(attendanceEvents.attendanceDayId),
    db
      .select({
        employeeId: leaveRequests.employeeId,
        leaveTypeCode: leaveRequests.leaveTypeCode,
        leaveTypeName: leaveRequests.leaveTypeName,
        scheduledMinutes: leaveRequestDays.scheduledMinutes,
        units: leaveRequestDays.units,
        workDate: leaveRequestDays.workDate,
      })
      .from(leaveRequestDays)
      .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
      .where(
        and(
          eq(leaveRequests.organizationId, input.organizationId),
          inArray(leaveRequests.employeeId, employeeIds),
          eq(leaveRequests.status, "approved"),
          gte(leaveRequestDays.workDate, range.from),
          lt(leaveRequestDays.workDate, range.to),
        ),
      ),
    db
      .select()
      .from(absenceRecords)
      .where(
        and(
          eq(absenceRecords.organizationId, input.organizationId),
          inArray(absenceRecords.employeeId, employeeIds),
          isNull(absenceRecords.revokedAt),
          gte(absenceRecords.workDate, range.from),
          lt(absenceRecords.workDate, range.to),
        ),
      ),
  ]);
  if (!organizationRows[0]) return [];

  const historiesByEmployee = new Map<string, typeof histories>();
  for (const history of histories) {
    const rows = historiesByEmployee.get(history.employeeId) ?? [];
    rows.push(history);
    historiesByEmployee.set(history.employeeId, rows);
  }
  const exceptionsByKey = new Map(
    exceptions.map((exception) => [
      `${exception.employeeId ?? "company"}:${exception.calendarDate}`,
      exception,
    ]),
  );
  const dayByKey = new Map(dayRows.map((day) => [`${day.employeeId}:${day.workDate}`, day]));
  const eventCountByDay = new Map(eventCounts.map((row) => [row.attendanceDayId, row.value]));
  const leaveByKey = new Map(leaveRows.map((row) => [`${row.employeeId}:${row.workDate}`, row]));
  const absenceByKey = new Map(absences.map((row) => [`${row.employeeId}:${row.workDate}`, row]));
  const dates = dateList(range.from, range.to);
  const projected: OperationalAttendanceDay[] = [];

  for (const employee of employeeRows) {
    for (const workDate of dates) {
      const pattern = patterns.filter((candidate) => candidate.effectiveFrom <= workDate).at(-1);
      const attendance = dayByKey.get(`${employee.id}:${workDate}`);
      const leave = leaveByKey.get(`${employee.id}:${workDate}`);
      const absence = absenceByKey.get(`${employee.id}:${workDate}`);
      const latestHistory = (historiesByEmployee.get(employee.id) ?? [])
        .filter((history) => history.effectiveOn <= workDate)
        .at(-1);
      const status = latestHistory?.status ?? employee.status;
      const employed =
        status === "active" &&
        (!employee.joinedOn || employee.joinedOn <= workDate) &&
        (!employee.leftOn || employee.leftOn >= workDate);
      if (!employed && (pattern || (!attendance && !leave && !absence))) continue;
      const employeeException = exceptionsByKey.get(`${employee.id}:${workDate}`);
      const companyException = exceptionsByKey.get(`company:${workDate}`);
      const exception = employeeException ?? companyException;
      const weekday = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
      const weeklyWorkday = pattern ? pattern[workdayKeyByDay[weekday]] : false;
      const workday = exception ? exception.dayKind === "workday" : weeklyWorkday;
      const calendarSource = employeeException
        ? "employee_exception"
        : companyException
          ? "company_exception"
          : pattern
            ? "weekly_pattern"
            : "inactive_calendar";
      const calendarLabel =
        exception?.name ??
        (pattern
          ? weeklyWorkday
            ? "曜日パターン（勤務日）"
            : "曜日パターン（休日）"
          : "勤務カレンダー未有効");
      const matchingRules = rules.filter(
        (rule) =>
          rule.effectiveFrom <= workDate &&
          (rule.employeeId === employee.id || rule.employeeId === null),
      );
      const workRule =
        matchingRules.filter((rule) => rule.employeeId === employee.id).at(-1) ??
        matchingRules.filter((rule) => rule.employeeId === null).at(-1);
      const eventCount = attendance ? (eventCountByDay.get(attendance.id) ?? 0) : 0;
      if (!pattern && !attendance && !leave && !absence) continue;

      const completed = attendance?.status === "complete";
      const openPunch = Boolean(attendance && attendance.status === "open" && eventCount > 0);
      let operationalStatus: AttendanceOperationStatus;
      if (
        (leave?.units === 2 && eventCount > 0) ||
        (absence && (eventCount > 0 || leave)) ||
        (leave && !workday)
      ) {
        operationalStatus = "conflict";
      } else if (leave?.units === 2) {
        operationalStatus = "leave_full";
      } else if (leave?.units === 1 && completed) {
        operationalStatus = "leave_half_worked";
      } else if (leave?.units === 1) {
        operationalStatus = openPunch ? "open_punch" : "unresolved";
      } else if (absence) {
        operationalStatus = "absence";
      } else if (completed) {
        operationalStatus = "worked";
      } else if (openPunch) {
        operationalStatus = "open_punch";
      } else if (workday) {
        operationalStatus = "unresolved";
      } else {
        operationalStatus = eventCount > 0 ? "open_punch" : "non_workday";
      }

      projected.push({
        absenceReason: absence?.reason ?? null,
        attendanceDayId: attendance?.id ?? null,
        attendanceStatus: attendance?.status ?? null,
        breakMinutes: attendance?.breakMinutes ?? null,
        calendarDayKind: workday ? "workday" : "non_workday",
        calendarLabel,
        calendarSource,
        displayName: employee.displayName,
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        leaveScheduledMinutes: leave?.scheduledMinutes ?? null,
        leaveTypeCode: leave?.leaveTypeCode ?? null,
        leaveTypeName: leave?.leaveTypeName ?? null,
        leaveUnits: leave?.units ?? null,
        operationalStatus,
        overtimeMinutes: attendance?.overtimeMinutes ?? null,
        overtimeActualMinutes: null,
        overtimeBlockClose: false,
        overtimeDifferenceMinutes: null,
        overtimePolicyId: null,
        overtimeReconciliationStatus: null,
        overtimeRequestIds: [],
        overtimeRequestKind: null,
        overtimeRequestedMinutes: null,
        scheduledMinutes:
          calendarSource === "inactive_calendar"
            ? (attendance?.scheduledMinutes ?? 0)
            : workday
              ? (workRule?.dailyStandardMinutes ?? attendance?.scheduledMinutes ?? 0)
              : 0,
        workedMinutes: attendance?.workedMinutes ?? null,
        workDate,
        workRuleId: workRule?.id ?? attendance?.workRuleId ?? null,
        workRuleName: workRule?.name ?? null,
      });
    }
  }
  const reconciliations = await overtimeReconciliationsForMonth(db, {
    days: projected,
    month: input.month,
    organizationId: input.organizationId,
  });
  return projected.map((day) => {
    const reconciliation = reconciliations.get(`${day.employeeId}:${day.workDate}`);
    return reconciliation
      ? {
          ...day,
          overtimeActualMinutes: reconciliation.actualMinutes,
          overtimeBlockClose: reconciliation.blockClose,
          overtimeDifferenceMinutes: reconciliation.differenceMinutes,
          overtimePolicyId: reconciliation.policyId,
          overtimeReconciliationStatus: reconciliation.status,
          overtimeRequestIds: reconciliation.requestIds,
          overtimeRequestKind: reconciliation.kind,
          overtimeRequestedMinutes: reconciliation.requestedMinutes,
        }
      : day;
  });
}

export async function projectOperationalAttendanceDay(
  db: Pick<AppDatabase, "select">,
  input: { employeeId: string; organizationId: string; workDate: string },
) {
  const rows = await projectOperationalAttendanceMonth(db, {
    employeeIds: [input.employeeId],
    month: input.workDate.slice(0, 7),
    organizationId: input.organizationId,
  });
  return rows.find((row) => row.workDate === input.workDate) ?? null;
}
