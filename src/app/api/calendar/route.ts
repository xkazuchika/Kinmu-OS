import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  activateWorkCalendar,
  createWorkCalendarDraft,
  deactivateCalendarException,
  getCalendarActivationPreview,
  listWorkCalendarSettings,
  saveCalendarException,
  WorkCalendarValidationError,
  type CalendarDayKind,
} from "@/lib/work-calendar";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json(await listWorkCalendarSettings(database, actor));
  } catch (error) {
    return domainErrorResponse(error, "勤務カレンダーを取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const action = String(body.action ?? "");
    if (action === "create_draft") {
      return Response.json(
        {
          pattern: await createWorkCalendarDraft(database, actor, {
            effectiveFrom: String(body.effectiveFrom ?? ""),
            fridayWorkday: Boolean(body.fridayWorkday),
            mondayWorkday: Boolean(body.mondayWorkday),
            saturdayWorkday: Boolean(body.saturdayWorkday),
            sundayWorkday: Boolean(body.sundayWorkday),
            thursdayWorkday: Boolean(body.thursdayWorkday),
            tuesdayWorkday: Boolean(body.tuesdayWorkday),
            wednesdayWorkday: Boolean(body.wednesdayWorkday),
          }),
        },
        { status: 201 },
      );
    }
    if (action === "preview_activation") {
      return Response.json({
        preview: await getCalendarActivationPreview(
          database,
          actor,
          String(body.patternId ?? ""),
          String(body.effectiveFrom ?? ""),
        ),
      });
    }
    if (action === "activate") {
      return Response.json({
        pattern: await activateWorkCalendar(database, actor, {
          effectiveFrom: String(body.effectiveFrom ?? ""),
          patternId: String(body.patternId ?? ""),
        }),
      });
    }
    if (action === "save_exception") {
      const dayKind = String(body.dayKind ?? "");
      if (dayKind !== "workday" && dayKind !== "non_workday") {
        throw new WorkCalendarValidationError("日区分が正しくありません。");
      }
      return Response.json({
        exception: await saveCalendarException(database, actor, {
          calendarDate: String(body.calendarDate ?? ""),
          dayKind: dayKind as CalendarDayKind,
          employeeId: body.employeeId ? String(body.employeeId) : null,
          exceptionId: body.exceptionId ? String(body.exceptionId) : undefined,
          name: String(body.name ?? ""),
          reason: String(body.reason ?? ""),
        }),
      });
    }
    if (action === "deactivate_exception") {
      return Response.json({
        exception: await deactivateCalendarException(
          database,
          actor,
          String(body.exceptionId ?? ""),
          String(body.reason ?? ""),
        ),
      });
    }
    throw new WorkCalendarValidationError("操作が正しくありません。");
  } catch (error) {
    return domainErrorResponse(error, "勤務カレンダーを更新できませんでした。");
  }
}
