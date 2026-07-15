import { recordAudit } from "@/lib/audit";
import { AuthorizationError, requireActor, requirePermission } from "@/lib/authorization";
import { getDatabase } from "@/lib/db/client";
import { createWorkRule, listWorkRules, WorkRuleManagementError } from "@/lib/work-rule-management";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "attendance:manage");
    return Response.json({ rules: await listWorkRules(database, actor.organizationId) });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    console.error("Could not list work rules.", error);
    return Response.json({ error: "勤務ルールを取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  try {
    const database = getDatabase();
    const actor = await requireActor(database, request);
    requirePermission(actor, "attendance:manage");
    const rule = await createWorkRule(database, {
      dailyStandardMinutes: Number(body.dailyStandardMinutes),
      effectiveFrom: String(body.effectiveFrom ?? ""),
      employeeId: String(body.employeeId ?? "") || undefined,
      name: String(body.name ?? ""),
      organizationId: actor.organizationId,
      scheduledBreakMinutes: Number(body.scheduledBreakMinutes),
      scheduledEndTime: String(body.scheduledEndTime ?? ""),
      scheduledStartTime: String(body.scheduledStartTime ?? ""),
    });
    await recordAudit(database, {
      action: "work_rule_changed",
      actorUserId: actor.userId,
      entityId: rule.id,
      entityType: "work_rule",
      metadata: { effectiveFrom: rule.effectiveFrom, employeeId: rule.employeeId },
      organizationId: actor.organizationId,
    });
    return Response.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof WorkRuleManagementError)
      return Response.json({ error: error.message }, { status: 422 });
    console.error("Could not create work rule.", error);
    return Response.json({ error: "勤務ルールを作成できませんでした。" }, { status: 500 });
  }
}
