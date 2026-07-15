import { authenticateWithPassword, AuthenticationError, sessionCookie } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getDatabase } from "@/lib/db/client";
import { checkRateLimit, rateLimitKey, RateLimitError } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{ email: string; password: string }>;

  try {
    checkRateLimit(rateLimitKey(request, "login"));
    const database = getDatabase();
    const session = await authenticateWithPassword(database, body.email ?? "", body.password ?? "");

    await recordAudit(database, {
      action: "login_succeeded",
      actorUserId: session.userId,
      entityId: session.userId,
      entityType: "user",
      organizationId: session.organizationId,
    });
    const response = Response.json({ ok: true });

    response.headers.append("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: error.message },
        { headers: { "retry-after": String(error.retryAfterSeconds) }, status: 429 },
      );
    }

    console.error("Login failed.", error);
    return Response.json({ error: "ログインを完了できませんでした。" }, { status: 500 });
  }
}
