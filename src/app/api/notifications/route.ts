import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import {
  listNotifications,
  markNotificationsRead,
  NotificationValidationError,
} from "@/lib/notifications";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const url = new URL(request.url);
    const beforeValue = url.searchParams.get("before");
    const limitValue = url.searchParams.get("limit");
    return Response.json({
      notifications: await listNotifications(database, actor, {
        before: beforeValue ? new Date(beforeValue) : undefined,
        limit: limitValue ? Number(limitValue) : undefined,
      }),
    });
  } catch (error) {
    return domainErrorResponse(error, "通知を取得できませんでした。");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!Array.isArray(body.notificationIds)) {
      throw new NotificationValidationError("既読にする通知を指定してください。");
    }
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json({
      result: await markNotificationsRead(
        database,
        actor,
        body.notificationIds.map((value) => String(value)),
      ),
    });
  } catch (error) {
    return domainErrorResponse(error, "通知を既読にできませんでした。");
  }
}
