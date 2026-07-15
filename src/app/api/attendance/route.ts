import { AttendanceError, listManagedAttendance } from "@/lib/attendance";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "attendance:manage");
    const url = new URL(request.url);
    return Response.json({
      attendance: await listManagedAttendance(database, {
        departmentId: url.searchParams.get("departmentId") || undefined,
        employeeId: url.searchParams.get("employeeId") || undefined,
        month: url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7),
        openOnly: url.searchParams.get("status") === "open",
        organizationId: actor.organizationId,
      }),
    });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof AttendanceError)
      return Response.json({ error: error.message }, { status: 422 });
    console.error("Could not list managed attendance.", error);
    return Response.json({ error: "勤怠一覧を取得できませんでした。" }, { status: 500 });
  }
}
