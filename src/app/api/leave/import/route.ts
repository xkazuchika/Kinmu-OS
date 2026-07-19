import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { commitLeaveGrantCsv, previewLeaveGrantCsv } from "@/lib/leave-ledger";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      csv: string;
      fileName: string;
      mode: "commit" | "preview";
    }>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "leave:manage");
    if (body.mode === "commit") {
      return Response.json(
        await commitLeaveGrantCsv(database, actor, {
          csv: body.csv ?? "",
          fileName: body.fileName,
        }),
      );
    }
    return Response.json(
      await previewLeaveGrantCsv(database, {
        csv: body.csv ?? "",
        organizationId: actor.organizationId,
      }),
    );
  } catch (error) {
    return domainErrorResponse(error, "休暇付与CSVを処理できませんでした。");
  }
}
