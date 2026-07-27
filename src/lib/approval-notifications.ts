import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";
import { approvalCases, employees, notifications, users } from "@/lib/db/schema";

type ApprovalCase = typeof approvalCases.$inferSelect;
type NotificationDatabase = Pick<AppDatabase, "insert" | "select">;

type ApprovalEvent =
  "approved" | "cancelled" | "rejected" | "resubmitted" | "returned" | "submitted";

const requestTypeLabels = {
  attendance_correction: "勤怠修正",
  holiday_work: "休日出勤",
  leave: "休暇",
  overtime: "残業",
} as const;

function caseLabel(approvalCase: ApprovalCase) {
  return requestTypeLabels[approvalCase.requestType];
}

async function adminPoolRecipients(
  db: NotificationDatabase,
  organizationId: string,
  excludedUserIds: readonly string[] = [],
) {
  return (
    await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "hr_admin"]),
        ),
      )
  )
    .map((user) => user.id)
    .filter((userId) => !excludedUserIds.includes(userId));
}

async function resultRecipients(db: NotificationDatabase, approvalCase: ApprovalCase) {
  const [target] = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(
      and(
        eq(employees.id, approvalCase.targetEmployeeId),
        eq(employees.organizationId, approvalCase.organizationId),
      ),
    )
    .limit(1);
  const recipients = target?.userId ? [target.userId] : [];
  if (approvalCase.submittedOnBehalf) {
    const [proxyCreator] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, approvalCase.submittedByUserId),
          eq(users.organizationId, approvalCase.organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "hr_admin"]),
        ),
      )
      .limit(1);
    if (proxyCreator) recipients.push(proxyCreator.id);
  }
  return [...new Set(recipients)];
}

async function pendingRecipients(db: NotificationDatabase, approvalCase: ApprovalCase) {
  if (approvalCase.assignedApproverUserId) {
    return [approvalCase.assignedApproverUserId];
  }
  const [target] = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(eq(employees.id, approvalCase.targetEmployeeId))
    .limit(1);
  return adminPoolRecipients(db, approvalCase.organizationId, [
    approvalCase.submittedByUserId,
    target?.userId ?? "",
  ]);
}

function eventContent(approvalCase: ApprovalCase, event: ApprovalEvent) {
  const label = caseLabel(approvalCase);
  const proxy = approvalCase.submittedOnBehalf ? "（代理作成）" : "";
  const contents = {
    approved: {
      summary: `${approvalCase.targetDate}の${label}申請${proxy}が承認されました。`,
      title: `${label}申請が承認されました`,
    },
    cancelled: {
      summary: `${approvalCase.targetDate}の${label}申請${proxy}が取り消されました。`,
      title: `${label}申請が取り消されました`,
    },
    rejected: {
      summary: `${approvalCase.targetDate}の${label}申請${proxy}が却下されました。`,
      title: `${label}申請が却下されました`,
    },
    resubmitted: {
      summary: `${approvalCase.targetDate}の${label}申請（改訂${approvalCase.currentRevision}）が再申請されました。`,
      title: `再申請された${label}申請`,
    },
    returned: {
      summary: `${approvalCase.targetDate}の${label}申請${proxy}が差し戻されました。申請詳細で理由を確認してください。`,
      title: `${label}申請が差し戻されました`,
    },
    submitted: {
      summary: `${approvalCase.targetDate}の${label}申請${proxy}が提出されました。`,
      title: `審査待ちの${label}申請`,
    },
  } as const;
  return contents[event];
}

export async function createApprovalEventNotifications(
  db: NotificationDatabase,
  approvalCase: ApprovalCase,
  event: ApprovalEvent,
) {
  const recipients =
    event === "submitted" || event === "resubmitted" || event === "cancelled"
      ? await pendingRecipients(db, approvalCase)
      : await resultRecipients(db, approvalCase);
  if (!recipients.length) return [];

  const content = eventContent(approvalCase, event);
  return db
    .insert(notifications)
    .values(
      recipients.map((recipientUserId) => ({
        entityId: approvalCase.id,
        entityType: "approval_case",
        eventKey: `${approvalCase.id}:${approvalCase.version}:${event}:${recipientUserId}`,
        kind: `approval_${event}` as const,
        organizationId: approvalCase.organizationId,
        recipientUserId,
        summary: content.summary,
        title: content.title,
      })),
    )
    .onConflictDoNothing({ target: notifications.eventKey })
    .returning();
}

export async function createApprovalReassignmentNotifications(
  db: NotificationDatabase,
  approvalCase: ApprovalCase,
  input: Readonly<{
    fromApproverUserId: string | null;
    toApproverUserId: string;
  }>,
) {
  const values = [
    input.fromApproverUserId && input.fromApproverUserId !== input.toApproverUserId
      ? {
          entityId: approvalCase.id,
          entityType: "approval_case",
          eventKey: `${approvalCase.id}:${approvalCase.version}:unassigned:${input.fromApproverUserId}`,
          kind: "approval_unassigned" as const,
          organizationId: approvalCase.organizationId,
          recipientUserId: input.fromApproverUserId,
          summary: "承認担当が変更され、担当から外れました。",
          title: "承認担当から外れました",
        }
      : null,
    {
      entityId: approvalCase.id,
      entityType: "approval_case",
      eventKey: `${approvalCase.id}:${approvalCase.version}:assigned:${input.toApproverUserId}`,
      kind: "approval_assigned" as const,
      organizationId: approvalCase.organizationId,
      recipientUserId: input.toApproverUserId,
      summary: `${approvalCase.targetDate}の${caseLabel(approvalCase)}申請が割り当てられました。`,
      title: "承認申請が割り当てられました",
    },
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  return db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing({ target: notifications.eventKey })
    .returning();
}
