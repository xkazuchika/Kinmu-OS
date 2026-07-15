import {
  cookieValue,
  expiredSessionCookie,
  revokeSession,
  sessionForToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getDatabase } from "@/lib/db/client";

export async function POST(request: Request) {
  const database = getDatabase();
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const session = await sessionForToken(database, token);

  await revokeSession(database, token);

  if (session) {
    await recordAudit(database, {
      action: "logout",
      actorUserId: session.userId,
      entityId: session.userId,
      entityType: "user",
      organizationId: session.organizationId,
    });
  }

  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", expiredSessionCookie());
  return response;
}
