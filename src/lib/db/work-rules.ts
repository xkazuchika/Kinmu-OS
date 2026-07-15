import { and, desc, eq, isNull, lte, or } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { workRules } from "@/lib/db/schema";
import type { WorkDate } from "@/lib/time";

export async function findEffectiveWorkRule(
  db: Pick<AppDatabase, "select">,
  input: Readonly<{
    employeeId: string;
    organizationId: string;
    workDate: WorkDate;
  }>,
) {
  const candidates = await db
    .select()
    .from(workRules)
    .where(
      and(
        eq(workRules.organizationId, input.organizationId),
        lte(workRules.effectiveFrom, input.workDate),
        or(eq(workRules.employeeId, input.employeeId), isNull(workRules.employeeId)),
      ),
    )
    .orderBy(desc(workRules.effectiveFrom));

  return (
    candidates.find((rule) => rule.employeeId === input.employeeId) ??
    candidates.find((rule) => rule.employeeId === null)
  );
}
