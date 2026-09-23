import { sql } from "drizzle-orm";
import { actionItemsFor, loadActionFacts } from "@/lib/attendance-action-center";
import { reminderClock } from "@/lib/action-item-types";
import type { AppDatabase } from "@/lib/db/client";
import { notifications, organizations } from "@/lib/db/schema";

export async function runActionReminders(db: AppDatabase, now = new Date()) {
  const result = { organizations: 0, created: 0, failed: 0 };
  const orgs = await db
    .select({ id: organizations.id, timezone: organizations.timezone })
    .from(organizations);
  for (const organization of orgs) {
    if (!reminderClock(now, organization.timezone).eligible) continue;
    try {
      result.created += await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtext('action-reminders'), hashtext(${organization.id})) AS acquired`,
        );
        if (!lock.acquired) return 0;
        const facts = await loadActionFacts(tx, organization.id, now);
        const clock = reminderClock(now, facts.organization.timezone);
        if (!clock.eligible) return 0;
        let created = 0;
        for (const member of facts.members) {
          if (member.status !== "active") continue;
          const items = actionItemsFor(
            facts,
            { organizationId: organization.id, userId: member.id, role: member.role },
            true,
          );
          if (!items.length) continue;
          const rows = await tx
            .insert(notifications)
            .values({
              organizationId: organization.id,
              recipientUserId: member.id,
              entityType: "action_center",
              entityId: member.id,
              kind: "action_items_reminder",
              eventKey: `action-reminder:${organization.id}:${member.id}:${clock.date}`,
              title: `${clock.date}の要対応確認`,
              summary:
                "対応が必要な勤怠・申請があります。要対応一覧で現在の状況を確認してください。",
            })
            .onConflictDoNothing({ target: notifications.eventKey })
            .returning({ id: notifications.id });
          created += rows.length;
        }
        return created;
      });
      result.organizations++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
