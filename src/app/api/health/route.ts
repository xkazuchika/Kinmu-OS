import { checkDatabaseHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const healthy = await checkDatabaseHealth();
  return Response.json(
    { status: healthy ? "ok" : "unavailable" },
    { headers: { "Cache-Control": "no-store" }, status: healthy ? 200 : 503 },
  );
}
