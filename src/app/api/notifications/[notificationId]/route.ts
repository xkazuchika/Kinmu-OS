import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { markNotificationsRead, notificationTarget } from "@/lib/notifications";

type RouteContext = { params: Promise<{ notificationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    const { notificationId } = await context.params;
    const target = await notificationTarget(database, actor, notificationId);
    await markNotificationsRead(database, actor, [notificationId]);
    return Response.json({ target });
  } catch (error) {
    return domainErrorResponse(error, "通知の対象を開けませんでした。");
  }
}
