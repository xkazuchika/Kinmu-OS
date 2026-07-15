import { getDatabase } from "@/lib/db/client";
import { InitialSetupError, initializeOrganization } from "@/lib/setup";
import { checkRateLimit, rateLimitKey, RateLimitError } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{
    organizationName: string;
    ownerEmail: string;
    ownerName: string;
    timezone: string;
  }>;

  try {
    checkRateLimit(rateLimitKey(request, "setup"), { limit: 5, windowMs: 60_000 });
    const result = await initializeOrganization(getDatabase(), {
      organizationName: body.organizationName ?? "",
      ownerEmail: body.ownerEmail ?? "",
      ownerName: body.ownerName ?? "",
      timezone: body.timezone ?? "",
    });

    return Response.json({ setupUrl: `/activate/${result.setupToken}` }, { status: 201 });
  } catch (error) {
    if (error instanceof InitialSetupError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: error.message },
        { headers: { "retry-after": String(error.retryAfterSeconds) }, status: 429 },
      );
    }

    console.error("Initial setup failed.", error);
    return Response.json({ error: "初期設定を完了できませんでした。" }, { status: 500 });
  }
}
