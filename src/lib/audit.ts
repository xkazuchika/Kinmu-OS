import type { AppDatabase } from "@/lib/db/client";
import { auditLogs, type auditAction } from "@/lib/db/schema";

export async function recordAudit(
  db: Pick<AppDatabase, "insert">,
  input: Readonly<{
    action: (typeof auditAction.enumValues)[number];
    actorUserId?: string;
    entityId?: string;
    entityType: string;
    metadata?: Record<string, unknown>;
    organizationId: string;
  }>,
) {
  await db.insert(auditLogs).values({
    action: input.action,
    actorUserId: input.actorUserId,
    entityId: input.entityId,
    entityType: input.entityType,
    metadata: input.metadata ?? {},
    organizationId: input.organizationId,
  });
}
