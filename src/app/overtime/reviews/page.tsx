"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  SelectField,
  Table,
  TextareaField,
  Toast,
} from "@/components/ui";

type Status = "approved" | "cancelled" | "pending" | "rejected";
type Kind = "holiday_work" | "overtime";
type Request = {
  id: string;
  kind: Kind;
  plannedBreakMinutes: number;
  plannedEndAt: string;
  plannedMinutes: number;
  plannedStartAt: string;
  reason: string;
  reviewComment: string | null;
  status: Status;
  version: number;
  workDate: string;
};
type ReviewRow = { displayName: string; employeeNumber: string; request: Request };
type Detail = {
  conflicts: Request[];
  punches: Array<{ occurredAt: string; type: string }>;
  request: Request;
  schedule: {
    calendarLabel: string;
    dayKind: string;
    scheduledEndTime: string | null;
    scheduledMinutes: number;
    scheduledStartTime: string | null;
  };
};

const statusLabels: Record<Status, string> = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
};
const kindLabels: Record<Kind, string> = { holiday_work: "休日出勤", overtime: "残業" };
const time = (value: string) =>
  new Date(value).toLocaleString("ja-JP", { hour: "2-digit", minute: "2-digit" });

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function OvertimeReviewsPage() {
  const approvalButtonRef = useRef<HTMLButtonElement>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [status, setStatus] = useState<Status>("pending");
  const [kind, setKind] = useState<Kind | "">("");
  const [detail, setDetail] = useState<Detail>();
  const [approval, setApproval] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const parameters = new URLSearchParams({ status });
    if (kind) parameters.set("kind", kind);
    const response = await fetch(`/api/overtime/reviews?${parameters}`);
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "残業申請を取得できませんでした。"));
      return;
    }
    setRows((result.requests as ReviewRow[]) ?? []);
    setError(undefined);
  }, [kind, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const requestId = new URLSearchParams(window.location.search).get("requestId");
    if (requestId) void selectRequest(requestId);
    // 通知の深いリンクだけを初回に反映する。
  }, []);

  async function selectRequest(requestId: string) {
    const response = await fetch(`/api/overtime/reviews/${requestId}`);
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "申請詳細を取得できませんでした。"));
      return;
    }
    setDetail(result.detail as Detail);
    setRejectComment("");
  }

  async function review(action: "approve" | "reject") {
    if (!detail) return;
    setSubmitting(true);
    const response = await fetch(`/api/overtime/reviews/${detail.request.id}`, {
      body: JSON.stringify({
        action,
        comment: rejectComment,
        expectedVersion: detail.request.version,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    setApproval(false);
    if (!response.ok) {
      setError(String(result.error ?? "申請を審査できませんでした。"));
      await selectRequest(detail.request.id);
      return;
    }
    setDetail(undefined);
    setRejectComment("");
    setSuccess(action === "approve" ? "申請を承認しました。" : "理由を添えて申請を却下しました。");
    await load();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader title="残業審査">
        勤務予定・カレンダー・打刻・重複を並べて、単段階で審査します。
      </PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <section aria-labelledby="overtime-review-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="overtime-review-heading">申請一覧</h2>
            <p>承認時に月次状態、在籍、ポリシー、重複を再検査します。</p>
          </div>
          <div className="inline-fields">
            <SelectField
              id="overtime-review-kind"
              label="区分"
              onChange={(event) => {
                setKind(event.target.value as Kind | "");
                setDetail(undefined);
              }}
              value={kind}
            >
              <option value="">すべて</option>
              <option value="overtime">残業</option>
              <option value="holiday_work">休日出勤</option>
            </SelectField>
            <SelectField
              id="overtime-review-status"
              label="状態"
              onChange={(event) => {
                setStatus(event.target.value as Status);
                setDetail(undefined);
              }}
              value={status}
            >
              <option value="pending">審査待ち</option>
              <option value="approved">承認済み</option>
              <option value="rejected">却下</option>
              <option value="cancelled">取消済み</option>
            </SelectField>
          </div>
        </div>
        <div className="review-layout">
          <div>
            {rows.length ? (
              <ul className="review-list">
                {rows.map((row) => (
                  <li key={row.request.id}>
                    <button
                      aria-pressed={detail?.request.id === row.request.id}
                      onClick={() => void selectRequest(row.request.id)}
                      type="button"
                    >
                      <span>
                        <strong>
                          {row.employeeNumber} {row.displayName}
                        </strong>
                        <small>{row.request.workDate}</small>
                      </span>
                      <span>
                        {kindLabels[row.request.kind]}
                        <small>
                          {row.request.plannedMinutes}分・{statusLabels[row.request.status]}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="対象の申請はありません">
                条件に一致する申請はありません。
              </EmptyState>
            )}
          </div>
          <div className="review-detail">
            {!detail ? (
              <EmptyState title="申請を選択してください">
                申請根拠と現在の勤務状況をここで確認します。
              </EmptyState>
            ) : (
              <>
                <header>
                  <div>
                    <h3>
                      {kindLabels[detail.request.kind]}・{detail.request.workDate}
                    </h3>
                    <p>{detail.request.reason}</p>
                  </div>
                  <span className={`status-pill status-pill--${detail.request.status}`}>
                    {statusLabels[detail.request.status]}
                  </span>
                </header>
                <dl className="review-facts">
                  <div>
                    <dt>予定時間</dt>
                    <dd>
                      {time(detail.request.plannedStartAt)}–{time(detail.request.plannedEndAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>申請分</dt>
                    <dd>{detail.request.plannedMinutes}分</dd>
                  </div>
                  <div>
                    <dt>予定休憩</dt>
                    <dd>{detail.request.plannedBreakMinutes}分</dd>
                  </div>
                  <div>
                    <dt>勤務予定</dt>
                    <dd>{detail.schedule.calendarLabel}</dd>
                  </div>
                </dl>
                <Table label="申請と勤務状況の比較">
                  <thead>
                    <tr>
                      <th>確認項目</th>
                      <th>現在値</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>所定時間</td>
                      <td>
                        {detail.schedule.scheduledStartTime && detail.schedule.scheduledEndTime
                          ? `${detail.schedule.scheduledStartTime}–${detail.schedule.scheduledEndTime}`
                          : "休日"}
                        （{detail.schedule.scheduledMinutes}分）
                      </td>
                    </tr>
                    <tr>
                      <td>現在の打刻</td>
                      <td>
                        {detail.punches.length
                          ? detail.punches
                              .map((punch) => `${punch.type} ${time(punch.occurredAt)}`)
                              .join(" / ")
                          : "なし"}
                      </td>
                    </tr>
                    <tr>
                      <td>同日の別申請</td>
                      <td>{detail.conflicts.length ? `${detail.conflicts.length}件` : "なし"}</td>
                    </tr>
                  </tbody>
                </Table>
                {detail.request.reviewComment ? (
                  <p className="report-note">審査理由: {detail.request.reviewComment}</p>
                ) : null}
                {detail.request.status === "pending" ? (
                  <div className="review-controls">
                    <TextareaField
                      id="overtime-reject-comment"
                      label="却下理由"
                      maxLength={500}
                      onChange={(event) => setRejectComment(event.target.value)}
                      placeholder="却下する場合は具体的な理由を入力"
                      required
                      rows={3}
                      value={rejectComment}
                    />
                    <div>
                      <Button
                        ref={approvalButtonRef}
                        disabled={submitting}
                        onClick={() => setApproval(true)}
                        type="button"
                      >
                        承認内容を確認
                      </Button>
                      <Button
                        disabled={submitting || !rejectComment.trim()}
                        onClick={() => void review("reject")}
                        type="button"
                        variant="danger"
                      >
                        理由を添えて却下
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>
      <p className="report-note">
        承認は申請内容の業務確認です。36協定、法定休日労働、割増賃金などの法令適合を自動判定・保証しません。
      </p>
      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="申請を承認"
        onCancel={() => setApproval(false)}
        onConfirm={() => void review("approve")}
        open={approval}
        returnFocusRef={approvalButtonRef}
        title="この申請を承認しますか"
      >
        予定分数は勤怠実績へ加算されません。勤務後の実績差異を別途確認してください。
      </ConfirmDialog>
    </main>
  );
}
