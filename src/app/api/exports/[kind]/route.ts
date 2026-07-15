import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  attendanceDays,
  attendanceEvents,
  dailyAttendanceSummaries,
  departments,
  employeeDepartments,
  employees,
} from "@/lib/db/schema";
import { csv } from "@/lib/reporting";

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "reports:read");
    const { kind } = await context.params;
    const url = new URL(request.url);
    let content: string;
    let parameters: Record<string, unknown> = { kind };
    if (kind === "employees") {
      const rows = await database
        .select({
          contactEmail: employees.contactEmail,
          departmentName: departments.name,
          displayName: employees.displayName,
          employeeNumber: employees.employeeNumber,
          employmentType: employees.employmentType,
          joinedOn: employees.joinedOn,
          status: employees.status,
        })
        .from(employees)
        .innerJoin(employeeDepartments, eq(employeeDepartments.employeeId, employees.id))
        .innerJoin(departments, eq(departments.id, employeeDepartments.departmentId))
        .where(
          and(
            eq(employees.organizationId, actor.organizationId),
            eq(employeeDepartments.isPrimary, true),
            isNull(employeeDepartments.endedOn),
          ),
        )
        .orderBy(asc(employees.employeeNumber));
      content = csv([
        ["従業員番号", "表示名", "主所属", "連絡用メール", "雇用区分", "在籍状態", "入社日"],
        ...rows.map((row) => [
          row.employeeNumber,
          row.displayName,
          row.departmentName,
          row.contactEmail,
          row.employmentType,
          row.status,
          row.joinedOn,
        ]),
      ]);
    } else if (kind === "attendance") {
      const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month))
        return Response.json({ error: "対象月が正しくありません。" }, { status: 422 });
      const [year, monthNumber] = month.split("-").map(Number);
      const to = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
      const rows = await database
        .select({
          displayName: employees.displayName,
          employeeNumber: employees.employeeNumber,
          isCorrected: sql<boolean>`exists (
            select 1 from ${attendanceEvents}
            where ${attendanceEvents.attendanceDayId} = ${attendanceDays.id}
              and ${attendanceEvents.correctionRequestId} is not null
              and ${attendanceEvents.supersededByCorrectionRequestId} is null
          )`,
          overtimeMinutes: dailyAttendanceSummaries.overtimeMinutes,
          scheduledMinutes: attendanceDays.scheduledMinutes,
          status: attendanceDays.status,
          workDate: attendanceDays.workDate,
          workedMinutes: dailyAttendanceSummaries.workedMinutes,
        })
        .from(attendanceDays)
        .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
        .leftJoin(
          dailyAttendanceSummaries,
          eq(dailyAttendanceSummaries.attendanceDayId, attendanceDays.id),
        )
        .where(
          and(
            eq(attendanceDays.organizationId, actor.organizationId),
            gte(attendanceDays.workDate, `${month}-01`),
            lt(attendanceDays.workDate, to),
          ),
        )
        .orderBy(asc(attendanceDays.workDate), asc(employees.employeeNumber));
      content = csv([
        ["勤務日", "従業員番号", "表示名", "状態", "実労働分", "所定分", "残業分", "修正済み"],
        ...rows.map((row) => [
          row.workDate,
          row.employeeNumber,
          row.displayName,
          row.status,
          row.workedMinutes,
          row.scheduledMinutes,
          row.overtimeMinutes,
          row.isCorrected ? "はい" : "いいえ",
        ]),
      ]);
      parameters = { kind, month };
    } else return Response.json({ error: "出力種別が正しくありません。" }, { status: 404 });
    await recordAudit(database, {
      action: "csv_exported",
      actorUserId: actor.userId,
      entityType: kind,
      metadata: parameters,
      organizationId: actor.organizationId,
    });
    return new Response(content, {
      headers: {
        "content-disposition": `attachment; filename="kinmu-${kind}.csv"`,
        "content-type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    console.error("Could not export CSV.", error);
    return Response.json({ error: "CSVを出力できませんでした。" }, { status: 500 });
  }
}
