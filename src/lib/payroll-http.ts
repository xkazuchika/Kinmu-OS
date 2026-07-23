import { domainErrorResponse } from "@/lib/api-errors";
import { requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";

export async function payrollRequestContext(request: Request) {
  const database = getDatabase();
  const actor = await requireActor(database, request);
  requirePermission(actor, "payroll:manage");
  return { actor, database };
}

export function payrollErrorResponse(error: unknown, fallback: string) {
  return domainErrorResponse(error, fallback);
}
