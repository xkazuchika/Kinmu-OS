import {
  AttendanceClosingConflictError,
  AttendanceClosingValidationError,
  closeAttendanceMonth,
  currentMonthInTimezone,
  getAttendanceMonthStatus,
  inspectAttendanceMonth,
  isEndedAttendanceMonth,
  reopenAttendanceMonth,
  validateTargetMonth,
} from "@/lib/attendance-closing";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function context(request: Request) {
  const database = getDatabase();
  const actor = await requireActor(database, request);
  requirePermission(actor, "attendance:manage");
  return { actor, database };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError)
    return Response.json({ error: error.message }, { status: 403 });
  if (error instanceof AttendanceClosingConflictError)
    return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof AttendanceClosingValidationError)
    return Response.json({ error: error.message }, { status: 422 });
  console.error("Could not manage attendance closing.", error);
  return Response.json({ error: "月次勤怠の締め状態を更新できませんでした。" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { actor, database } = await context(request);
    const month = validateTargetMonth(
      new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7),
    );
    const [organization] = await database
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    const [period, inspection] = await Promise.all([
      getAttendanceMonthStatus(database, actor.organizationId, month),
      inspectAttendanceMonth(database, actor.organizationId, month),
    ]);
    return Response.json({
      closing: {
        ...inspection,
        currentMonth: currentMonthInTimezone(organization.timezone),
        ended: isEndedAttendanceMonth(month, organization.timezone),
        month,
        period,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      action: "close" | "reopen";
      expectedVersion: number;
      month: string;
      reason: string;
    }>;
    const { actor, database } = await context(request);
    if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion ?? -1) < 0) {
      throw new AttendanceClosingValidationError("期間バージョンが正しくありません。");
    }
    if (body.action === "close") {
      return Response.json({
        period: await closeAttendanceMonth(database, actor, {
          expectedVersion: body.expectedVersion!,
          month: body.month ?? "",
        }),
      });
    }
    if (body.action === "reopen") {
      return Response.json({
        period: await reopenAttendanceMonth(database, actor, {
          expectedVersion: body.expectedVersion!,
          month: body.month ?? "",
          reason: body.reason ?? "",
        }),
      });
    }
    throw new AttendanceClosingValidationError("操作が正しくありません。");
  } catch (error) {
    return errorResponse(error);
  }
}
