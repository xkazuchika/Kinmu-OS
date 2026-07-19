import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { confirmAbsence } from "@/lib/leave-requests";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = getDatabase();
    const actor = await requireActor(database, request);
    return Response.json(
      {
        absence: await confirmAbsence(database, actor, {
          employeeId: String(body.employeeId ?? ""),
          reason: String(body.reason ?? ""),
          workDate: String(body.workDate ?? ""),
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return domainErrorResponse(error, "欠勤を確定できませんでした。");
  }
}
