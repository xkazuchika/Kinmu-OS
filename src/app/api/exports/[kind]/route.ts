import { and, asc, eq, isNull } from "drizzle-orm";

import { recordAudit } from "@/lib/audit";
import { listManagedAttendance } from "@/lib/attendance";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { departments, employeeDepartments, employees } from "@/lib/db/schema";
import { csv } from "@/lib/reporting";
import { listClosedAttendanceSnapshots } from "@/lib/attendance-closing";
import { listManagedLeaveLedger } from "@/lib/leave-ledger";

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
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        return Response.json({ error: "対象月が正しくありません。" }, { status: 422 });
      const closed = await listClosedAttendanceSnapshots(database, actor.organizationId, month);
      const rows = await listManagedAttendance(database, {
        month,
        organizationId: actor.organizationId,
      });
      content = csv([
        [
          "勤務日",
          "従業員番号",
          "表示名",
          "状態",
          "実労働分",
          "所定分",
          "残業分",
          "修正済み",
          "業務状態",
          "カレンダー根拠",
          "カレンダー表示",
          "休暇コード",
          "休暇名",
          "休暇単位",
          "休暇対応所定分",
          "欠勤理由",
          "月次状態",
          "締め日時",
          "締めリビジョン",
        ],
        ...rows.map((row) => [
          row.workDate,
          row.employeeNumber,
          row.displayName,
          row.status,
          row.workedMinutes,
          row.scheduledMinutes,
          row.overtimeMinutes,
          row.isCorrected ? "はい" : "いいえ",
          row.operationalStatus ?? "",
          row.calendarSource ?? "",
          row.calendarLabel ?? "",
          row.leaveTypeCode ?? "",
          row.leaveTypeName ?? "",
          row.leaveUnits ?? "",
          row.leaveScheduledMinutes ?? "",
          row.absenceReason ?? "",
          closed ? "締め済み" : "編集中",
          closed?.revision.closedAt.toISOString() ?? "",
          closed?.revision.revision ?? "",
        ]),
      ]);
      parameters = { kind, month, revision: closed?.revision.revision ?? null };
    } else if (kind === "leave-ledger") {
      const from = url.searchParams.get("from") ?? undefined;
      const to = url.searchParams.get("to") ?? undefined;
      const employeeId = url.searchParams.get("employeeId") ?? undefined;
      const leaveTypeId = url.searchParams.get("leaveTypeId") ?? undefined;
      const ledger = await listManagedLeaveLedger(database, actor, {
        employeeId,
        from,
        leaveTypeId,
        to,
      });
      const balances = new Map<string, number>();
      const rows = ledger
        .slice()
        .reverse()
        .map((row) => {
          const key = `${row.employeeId}:${row.leaveTypeId}`;
          const balance = (balances.get(key) ?? 0) + row.units;
          balances.set(key, balance);
          return { ...row, balance };
        });
      content = csv([
        [
          "基準日",
          "従業員番号",
          "部署",
          "休暇コード",
          "休暇名",
          "取引区分",
          "単位",
          "残高",
          "理由",
        ],
        ...rows.map((row) => [
          row.effectiveOn,
          row.employeeNumber,
          row.departmentName ?? "",
          row.leaveTypeCode,
          row.leaveTypeName,
          row.kind,
          row.units,
          row.balance,
          row.reason,
        ]),
      ]);
      parameters = { employeeId, from, kind, leaveTypeId, to };
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
