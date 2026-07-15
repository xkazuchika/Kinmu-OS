import { and, count, desc, eq, gte, lt, ne, sql } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { countPendingAttendanceCorrections } from "@/lib/attendance-corrections";
import { attendanceDays, auditLogs, dailyAttendanceSummaries, employees } from "@/lib/db/schema";

function rangeForMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month");
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10),
  };
}

export async function managementDashboard(db: AppDatabase, organizationId: string, month: string) {
  const range = rangeForMonth(month);
  const [[headcount], [openDays], overtime, pendingCorrections] = await Promise.all([
    db
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.organizationId, organizationId), ne(employees.status, "terminated"))),
    db
      .select({ value: count() })
      .from(attendanceDays)
      .where(
        and(eq(attendanceDays.organizationId, organizationId), eq(attendanceDays.status, "open")),
      ),
    db
      .select({
        displayName: employees.displayName,
        employeeId: employees.id,
        overtimeMinutes: sql<number>`coalesce(sum(${dailyAttendanceSummaries.overtimeMinutes}), 0)::int`,
      })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .innerJoin(
        dailyAttendanceSummaries,
        eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
      )
      .where(
        and(
          eq(attendanceDays.organizationId, organizationId),
          gte(attendanceDays.workDate, range.from),
          lt(attendanceDays.workDate, range.to),
        ),
      )
      .groupBy(employees.id, employees.displayName)
      .orderBy(desc(sql`sum(${dailyAttendanceSummaries.overtimeMinutes})`)),
    countPendingAttendanceCorrections(db, organizationId),
  ]);
  return {
    activeEmployees: headcount.value,
    openDays: openDays.value,
    overtime,
    pendingCorrections,
  };
}

export function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

export function searchAuditLogs(
  db: AppDatabase,
  input: {
    action?: string;
    actorUserId?: string;
    entityId?: string;
    from?: Date;
    organizationId: string;
    to?: Date;
  },
) {
  const conditions = [eq(auditLogs.organizationId, input.organizationId)];
  if (input.actorUserId) conditions.push(eq(auditLogs.actorUserId, input.actorUserId));
  if (input.entityId) conditions.push(eq(auditLogs.entityId, input.entityId));
  if (input.action)
    conditions.push(eq(auditLogs.action, input.action as typeof auditLogs.$inferSelect.action));
  if (input.from) conditions.push(gte(auditLogs.occurredAt, input.from));
  if (input.to) conditions.push(lt(auditLogs.occurredAt, input.to));
  return db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.occurredAt))
    .limit(500);
}
