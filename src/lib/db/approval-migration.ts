import { sql } from "drizzle-orm";

import type { AppDatabase } from "@/lib/db/client";

export type ApprovalMigrationVerification = {
  approvalCaseCount: number;
  domainRequestCount: number;
  leaveReservationMismatchCount: number;
  missingCurrentRevisionCount: number;
  reviewDetailMismatchCount: number;
  statusMismatchCount: number;
};

export async function verifyApprovalMigration(
  db: AppDatabase,
): Promise<ApprovalMigrationVerification> {
  const [row] = (await db.execute(sql`
    SELECT
      (
        (SELECT count(*) FROM attendance_correction_requests)
        + (SELECT count(*) FROM leave_requests)
        + (SELECT count(*) FROM overtime_work_requests)
      )::integer AS "domainRequestCount",
      (SELECT count(*) FROM approval_cases)::integer AS "approvalCaseCount",
      (
        SELECT count(*)
        FROM approval_cases approval_case
        LEFT JOIN approval_case_revisions revision
          ON revision.approval_case_id = approval_case.id
         AND revision.revision = approval_case.current_revision
        WHERE revision.id IS NULL
      )::integer AS "missingCurrentRevisionCount",
      (
        SELECT count(*)
        FROM approval_cases approval_case
        JOIN approval_case_revisions revision
          ON revision.approval_case_id = approval_case.id
         AND revision.revision = approval_case.current_revision
        WHERE approval_case.request_type = 'leave'
          AND (
            (
              SELECT count(*)
              FROM leave_request_days request_day
              WHERE request_day.request_id = approval_case.leave_request_id
            ) <> jsonb_array_length(COALESCE(revision.snapshot->'days', '[]'::jsonb))
            OR COALESCE(
              (
                SELECT sum(request_day.units)
                FROM leave_request_days request_day
                WHERE request_day.request_id = approval_case.leave_request_id
              ),
              0
            ) <> COALESCE(
              (
                SELECT sum((snapshot_day->>'units')::integer)
                FROM jsonb_array_elements(
                  COALESCE(revision.snapshot->'days', '[]'::jsonb)
                ) snapshot_day
              ),
              0
            )
          )
      )::integer AS "leaveReservationMismatchCount",
      (
        SELECT count(*)
        FROM approval_cases approval_case
        LEFT JOIN attendance_correction_requests attendance_request
          ON attendance_request.id = approval_case.attendance_correction_request_id
        LEFT JOIN leave_requests leave_request
          ON leave_request.id = approval_case.leave_request_id
        LEFT JOIN overtime_work_requests overtime_request
          ON overtime_request.id = approval_case.overtime_work_request_id
        WHERE approval_case.status::text <> COALESCE(
          attendance_request.status::text,
          leave_request.status::text,
          overtime_request.status::text
        )
      )::integer AS "statusMismatchCount",
      (
        SELECT count(*)
        FROM approval_cases approval_case
        LEFT JOIN attendance_correction_requests attendance_request
          ON attendance_request.id = approval_case.attendance_correction_request_id
        LEFT JOIN leave_requests leave_request
          ON leave_request.id = approval_case.leave_request_id
        LEFT JOIN overtime_work_requests overtime_request
          ON overtime_request.id = approval_case.overtime_work_request_id
        WHERE approval_case.reviewer_user_id IS DISTINCT FROM COALESCE(
            attendance_request.reviewer_user_id,
            leave_request.reviewer_user_id,
            overtime_request.reviewer_user_id
          )
          OR approval_case.review_comment IS DISTINCT FROM COALESCE(
            attendance_request.review_comment,
            leave_request.review_comment,
            overtime_request.review_comment
          )
          OR approval_case.reviewed_at IS DISTINCT FROM COALESCE(
            attendance_request.reviewed_at,
            leave_request.reviewed_at,
            overtime_request.reviewed_at
          )
          OR approval_case.cancelled_at IS DISTINCT FROM COALESCE(
            attendance_request.cancelled_at,
            leave_request.cancelled_at,
            overtime_request.cancelled_at
          )
      )::integer AS "reviewDetailMismatchCount"
  `)) as unknown as ApprovalMigrationVerification[];

  if (!row) {
    throw new Error("承認移行の検証結果を取得できませんでした。");
  }

  if (
    row.domainRequestCount !== row.approvalCaseCount ||
    row.leaveReservationMismatchCount !== 0 ||
    row.missingCurrentRevisionCount !== 0 ||
    row.reviewDetailMismatchCount !== 0 ||
    row.statusMismatchCount !== 0
  ) {
    throw new Error(
      [
        "承認移行の整合性検証に失敗しました。",
        `申請=${row.domainRequestCount}`,
        `承認ケース=${row.approvalCaseCount}`,
        `現行履歴なし=${row.missingCurrentRevisionCount}`,
        `状態不一致=${row.statusMismatchCount}`,
        `審査情報不一致=${row.reviewDetailMismatchCount}`,
        `休暇予約不一致=${row.leaveReservationMismatchCount}`,
      ].join(" "),
    );
  }

  return row;
}
