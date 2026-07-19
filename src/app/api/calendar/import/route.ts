import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { commitCalendarCsv, previewCalendarCsv } from "@/lib/work-calendar";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      csv: string;
      fileName: string;
      mode: "commit" | "preview";
    }>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "calendar:manage");
    if (body.mode === "commit") {
      return Response.json(
        await commitCalendarCsv(database, actor, {
          csv: body.csv ?? "",
          fileName: body.fileName,
        }),
      );
    }
    return Response.json(
      await previewCalendarCsv(database, {
        csv: body.csv ?? "",
        organizationId: actor.organizationId,
      }),
    );
  } catch (error) {
    return domainErrorResponse(error, "会社休日CSVを処理できませんでした。");
  }
}
