import type { ActionActor } from "@/lib/action-item-types";

export function isSelfReview(
  userId: string,
  submittedByUserId: string,
  targetUserId: string | null,
) {
  return userId === submittedByUserId || userId === targetUserId;
}

export function canReviewCase(
  actor: ActionActor,
  item: {
    organizationId: string;
    status: string;
    assignedApproverUserId: string | null;
    submittedByUserId: string;
  },
  targetUserId: string | null,
) {
  return (
    actor.organizationId === item.organizationId &&
    item.status === "pending" &&
    !isSelfReview(actor.userId, item.submittedByUserId, targetUserId) &&
    (actor.role === "owner" ||
      actor.role === "hr_admin" ||
      (actor.role === "approver" && item.assignedApproverUserId === actor.userId))
  );
}
