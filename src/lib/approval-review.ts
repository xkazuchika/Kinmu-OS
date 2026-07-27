import {
  assertApprovalReviewAccess,
  ApprovalCaseValidationError,
  returnApprovalCase,
} from "@/lib/approval-cases";
import { reviewAttendanceCorrection } from "@/lib/attendance-corrections";
import type { SessionActor } from "@/lib/authorization";
import type { AppDatabase } from "@/lib/db/client";
import { approveLeaveRequest, rejectLeaveRequest } from "@/lib/leave-requests";
import { approveOvertimeWorkRequest, rejectOvertimeWorkRequest } from "@/lib/overtime-requests";

export async function reviewApprovalCase(
  db: AppDatabase,
  actor: SessionActor,
  caseId: string,
  input: Readonly<{
    action: "approve" | "reject" | "return";
    comment?: string;
    expectedVersion: number;
  }>,
) {
  if (!(["approve", "reject", "return"] as string[]).includes(input.action)) {
    throw new ApprovalCaseValidationError("審査操作が正しくありません。");
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new ApprovalCaseValidationError("申請versionが正しくありません。");
  }
  const context = await assertApprovalReviewAccess(db, actor, caseId, input.expectedVersion);

  if (input.action === "return") {
    return returnApprovalCase(db, actor, caseId, {
      comment: input.comment ?? "",
      expectedVersion: input.expectedVersion,
    });
  }
  if (input.action === "reject" && !input.comment?.trim()) {
    throw new ApprovalCaseValidationError("却下理由を入力してください。");
  }

  if (context.case.attendanceCorrectionRequestId) {
    return reviewAttendanceCorrection(db, actor, context.case.attendanceCorrectionRequestId, {
      approvalCaseVersion: input.expectedVersion,
      comment: input.comment,
      decision: input.action,
    });
  }
  if (context.case.leaveRequestId) {
    return input.action === "approve"
      ? approveLeaveRequest(db, actor, context.case.leaveRequestId, {
          approvalCaseVersion: input.expectedVersion,
        })
      : rejectLeaveRequest(db, actor, context.case.leaveRequestId, input.comment ?? "", {
          approvalCaseVersion: input.expectedVersion,
        });
  }
  if (context.case.overtimeWorkRequestId) {
    const request = context.case.overtimeWorkRequestId;
    const detail = await db.query.overtimeWorkRequests.findFirst({
      columns: { version: true },
      where: (table, { and, eq }) =>
        and(eq(table.id, request), eq(table.organizationId, actor.organizationId)),
    });
    if (!detail) throw new ApprovalCaseValidationError("申請を確認できませんでした。");
    return input.action === "approve"
      ? approveOvertimeWorkRequest(db, actor, request, detail.version, input.expectedVersion)
      : rejectOvertimeWorkRequest(
          db,
          actor,
          request,
          detail.version,
          input.comment ?? "",
          input.expectedVersion,
        );
  }

  throw new ApprovalCaseValidationError("申請種別を確認できませんでした。");
}
