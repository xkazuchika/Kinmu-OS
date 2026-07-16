import { recordAudit } from "@/lib/audit";
import { AttendanceError, getAttendanceState, punchAttendance } from "@/lib/attendance";
import { AttendanceClosingConflictError } from "@/lib/attendance-closing";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { EmployeeManagementError } from "@/lib/employees";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "self:read");
    return Response.json({ attendance: await getAttendanceState(database, actor) });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof AttendanceClosingConflictError)
      return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof AttendanceError || error instanceof EmployeeManagementError)
      return Response.json({ error: error.message }, { status: 422 });
    console.error("Could not get attendance state.", error);
    return Response.json({ error: "勤怠状態を取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{ type: string }>;
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "self:write");
    const attendance = await punchAttendance(database, actor, { type: body.type ?? "" });
    await recordAudit(database, {
      action: "attendance_punched",
      actorUserId: actor.userId,
      entityId: attendance.employeeId,
      entityType: "attendance",
      metadata: { type: body.type, workDate: attendance.workDate },
      organizationId: actor.organizationId,
    });
    return Response.json({ attendance });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof AttendanceError || error instanceof EmployeeManagementError)
      return Response.json({ error: error.message }, { status: 422 });
    console.error("Could not punch attendance.", error);
    return Response.json({ error: "打刻を記録できませんでした。" }, { status: 500 });
  }
}
