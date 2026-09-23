import { actionFiltersSchema, listActionItems } from "@/lib/attendance-action-center";
import { requireActor } from "@/lib/authorization";
import { domainErrorResponse } from "@/lib/api-errors";
import { getDatabase } from "@/lib/db/client";

export async function GET(request: Request) {
  let response: Response;
  try {
    const db = getDatabase();
    const actor = await requireActor(db, request);
    const query = new URL(request.url).searchParams;
    response = Response.json(
      await listActionItems(
        db,
        actor,
        actionFiltersSchema.parse({
          month: query.get("month") || undefined,
          kind: query.get("kind") || undefined,
          employeeId: query.get("employeeId") || undefined,
          departmentId: query.get("departmentId") || undefined,
          page: query.get("page") || 1,
        }),
        new Date(),
        query.get("summary") === "true",
      ),
    );
  } catch (error) {
    response = domainErrorResponse(error, "要対応一覧を取得できませんでした。");
  }
  response.headers.set("cache-control", "no-store");
  return response;
}
