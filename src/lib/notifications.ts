import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";

import { AuthorizationError, can, type SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import { notifications, overtimeWorkRequests, users } from "@/lib/db/schema";

type NotificationDatabase = Pick<AppDatabase, "insert" | "select" | "update">;
type OvertimeRequest = typeof overtimeWorkRequests.$inferSelect;

export class NotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

export async function createOvertimeRequestNotifications(
  db: Pick<AppDatabase, "insert" | "select">,
  input: Readonly<{
    event: "approved" | "cancelled" | "rejected" | "submitted";
    request: OvertimeRequest;
    reviewComment?: string | null;
  }>,
) {
  const request = input.request;
  const recipients =
    input.event === "approved" || input.event === "rejected"
      ? [request.requestedByUserId]
      : (
          await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.organizationId, request.organizationId),
                eq(users.status, "active"),
                inArray(users.role, ["owner", "hr_admin"]),
              ),
            )
        ).map((recipient) => recipient.id);
  if (!recipients.length) return [];

  const kind = `overtime_request_${input.event}` as const;
  const label = request.kind === "holiday_work" ? "休日出勤" : "残業";
  const content = {
    approved: {
      summary: `${request.workDate}の${label}申請が承認されました。`,
      title: `${label}申請が承認されました`,
    },
    cancelled: {
      summary: `${request.workDate}の${label}申請が取り消されました。`,
      title: `${label}申請が取り消されました`,
    },
    rejected: {
      summary: `${request.workDate}の${label}申請が却下されました。理由: ${input.reviewComment?.trim() ?? "未入力"}`,
      title: `${label}申請が却下されました`,
    },
    submitted: {
      summary: `${request.workDate}の${label}申請が提出されました。`,
      title: `審査待ちの${label}申請`,
    },
  }[input.event];

  return db
    .insert(notifications)
    .values(
      recipients.map((recipientUserId) => ({
        entityId: request.id,
        entityType: "overtime_work_request",
        kind,
        organizationId: request.organizationId,
        recipientUserId,
        summary: content.summary,
        title: content.title,
      })),
    )
    .returning();
}

export async function listNotifications(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  input: Readonly<{ before?: Date; limit?: number }> = {},
) {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 30)));
  const conditions = [
    eq(notifications.organizationId, actor.organizationId),
    eq(notifications.recipientUserId, actor.userId),
  ];
  if (input.before) {
    if (Number.isNaN(input.before.getTime())) {
      throw new NotificationValidationError("通知カーソルが正しくありません。");
    }
    conditions.push(lt(notifications.createdAt, input.before));
  }
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1),
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, actor.organizationId),
          eq(notifications.recipientUserId, actor.userId),
          isNull(notifications.readAt),
        ),
      ),
  ]);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page,
    nextCursor: hasMore ? page.at(-1)!.createdAt.toISOString() : null,
    unreadCount: unread.value,
  };
}

export async function markNotificationsRead(
  db: NotificationDatabase,
  actor: SessionActor,
  notificationIds: readonly string[],
) {
  const ids = [...new Set(notificationIds.filter(Boolean))];
  if (!ids.length || ids.length > 100) {
    throw new NotificationValidationError("既読にする通知を1〜100件で指定してください。");
  }
  const owned = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, actor.organizationId),
        eq(notifications.recipientUserId, actor.userId),
        inArray(notifications.id, ids),
      ),
    );
  if (owned.length !== ids.length) throw new AuthorizationError();
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, actor.organizationId),
        eq(notifications.recipientUserId, actor.userId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return { updatedCount: updated.length };
}

export async function notificationTarget(
  db: Pick<AppDatabase, "select">,
  actor: SessionActor,
  notificationId: string,
) {
  const [notification] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.organizationId, actor.organizationId),
        eq(notifications.recipientUserId, actor.userId),
      ),
    )
    .limit(1);
  if (!notification) throw new AuthorizationError();
  if (notification.entityType !== "overtime_work_request") {
    return { available: false, href: "/notifications", message: "対象を開けません。" } as const;
  }
  const [request] = await db
    .select({
      id: overtimeWorkRequests.id,
      requestedByUserId: overtimeWorkRequests.requestedByUserId,
    })
    .from(overtimeWorkRequests)
    .where(
      and(
        eq(overtimeWorkRequests.id, notification.entityId),
        eq(overtimeWorkRequests.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!request) {
    return { available: false, href: "/notifications", message: "対象を確認できません。" } as const;
  }
  if (can(actor, "attendance:manage")) {
    return {
      available: true,
      href: `/overtime/reviews?requestId=${encodeURIComponent(request.id)}`,
      message: null,
    } as const;
  }
  if (request.requestedByUserId === actor.userId) {
    return {
      available: true,
      href: `/overtime?requestId=${encodeURIComponent(request.id)}`,
      message: null,
    } as const;
  }
  return {
    available: false,
    href: "/notifications",
    message: "現在の権限では対象を開けません。",
  } as const;
}
