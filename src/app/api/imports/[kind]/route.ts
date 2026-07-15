import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import {
  commitCsvImport,
  CsvImportValidationError,
  previewCsvImport,
  type ImportKind,
} from "@/lib/csv-imports";
import { getDatabase } from "@/lib/db/client";

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  const body = (await request.json()) as Partial<{ csv: string; mode: string }>;
  const { kind } = await context.params;

  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "employees:manage");
    if (!(["departments", "employees"] as string[]).includes(kind))
      return Response.json({ error: "取込種別が正しくありません。" }, { status: 404 });
    const input = {
      csv: body.csv ?? "",
      kind: kind as ImportKind,
      organizationId: actor.organizationId,
    };
    if (body.mode !== "commit") return Response.json(await previewCsvImport(database, input));
    const count = await commitCsvImport(database, input);
    await recordAudit(database, {
      action: "csv_imported",
      actorUserId: actor.userId,
      entityType: kind,
      metadata: { count, kind },
      organizationId: actor.organizationId,
    });
    return Response.json({ count });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof CsvImportValidationError)
      return Response.json({ error: error.message, errors: error.errors }, { status: 422 });
    console.error("Could not import CSV.", error);
    return Response.json({ error: "CSVを取り込めませんでした。" }, { status: 500 });
  }
}
