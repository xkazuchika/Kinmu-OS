import { AttendanceError, listManagedAttendance } from "@/lib/attendance";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  AttendanceClosingValidationError,
  getAttendanceMonthStatus,
} from "@/lib/attendance-closing";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "attendance:manage");
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const status = url.searchParams.get("status");
    const operationalStatuses =
      status === "leave"
        ? (["leave_full", "leave_half_worked"] as const)
        : status === "absence" || status === "conflict" || status === "unresolved"
          ? ([status] as const)
          : undefined;
    const [attendance, closing] = await Promise.all([
      listManagedAttendance(database, {
        departmentId: url.searchParams.get("departmentId") || undefined,
        employeeId: url.searchParams.get("employeeId") || undefined,
        month,
        openOnly: url.searchParams.get("status") === "open",
        operationalStatuses: operationalStatuses ? [...operationalStatuses] : undefined,
        organizationId: actor.organizationId,
      }),
      getAttendanceMonthStatus(database, actor.organizationId, month),
    ]);
    return Response.json({
      attendance,
      closing,
    });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof AttendanceError || error instanceof AttendanceClosingValidationError)
      return Response.json({ error: error.message }, { status: 422 });
    console.error("Could not list managed attendance.", error);
    return Response.json({ error: "勤怠一覧を取得できませんでした。" }, { status: 500 });
  }
}
