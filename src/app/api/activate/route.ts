import { activateSetupLink, AuthenticationError, sessionCookie } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";
import { checkRateLimit, rateLimitKey, RateLimitError } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{ password: string; token: string }>;

  try {
    checkRateLimit(rateLimitKey(request, "activate"));
    const session = await activateSetupLink(getDatabase(), body.token ?? "", body.password ?? "");
    const response = Response.json({ ok: true });

    response.headers.append("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: error.message },
        { headers: { "retry-after": String(error.retryAfterSeconds) }, status: 429 },
      );
    }

    console.error("Account activation failed.", error);
    return Response.json({ error: "パスワード設定を完了できませんでした。" }, { status: 500 });
  }
}
