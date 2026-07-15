"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterBar,
  PageHeader,
  SelectField,
  TextareaField,
  Toast,
} from "@/components/ui";

type Status = "approved" | "cancelled" | "pending" | "rejected";
type RequestRow = {
  createdAt: string;
  displayName: string;
  employeeId: string;
  id: string;
  reason: string;
  status: Status;
  workDate: string;
};
type Entry = {
  id: string;
  kind: "original" | "requested";
  occurredAt: string;
  originalEventId: null | string;
  type: "break_end" | "break_start" | "clock_in" | "clock_out";
};
type Detail = {
  employeeName: string;
  entries: Entry[];
  request: RequestRow & { reviewComment: null | string; reviewedAt: null | string };
  requesterName: string;
  reviewerName: null | string;
};
type Employee = { displayName: string; id: string };

const statusLabels: Record<Status, string> = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
};
const eventLabels: Record<Entry["type"], string> = {
  break_end: "休憩終了",
  break_start: "休憩開始",
  clock_in: "出勤",
  clock_out: "退勤",
};

function eventText(entry: Entry) {
  return `${eventLabels[entry.type]} ${new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
}

function EventSequence({ entries, title }: { entries: Entry[]; title: string }) {
  return (
    <div className="review-sequence">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p>打刻なし</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>{eventText(entry)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AttendanceCorrectionReview({
  initialRequests,
  initialEmployees,
  initialStatus,
}: {
  initialRequests: RequestRow[];
  initialEmployees: Employee[];
  initialStatus: string;
}) {
  const [requests, setRequests] = useState<RequestRow[]>(initialRequests);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  const [filterStatus, setFilterStatus] = useState(initialStatus);

  const load = useCallback(async (parameters = new URLSearchParams({ status: "pending" })) => {
    const [requestResponse, employeeResponse] = await Promise.all([
      fetch(`/api/attendance/correction-reviews?${parameters}`),
      fetch("/api/employees?status=all"),
    ]);
    const payload = (await requestResponse.json()) as { error?: string; requests?: RequestRow[] };
    if (!requestResponse.ok) {
      setError(payload.error ?? "勤怠申請を取得できませんでした。");
      return;
    }
    setRequests(payload.requests ?? []);
    setFilterStatus(parameters.get("status") ?? "");
    const employeePayload = (await employeeResponse.json()) as { employees?: Employee[] };
    setEmployees(employeePayload.employees ?? []);
    setError(undefined);
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parameters = new URLSearchParams(
      Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
    );
    window.history.replaceState(null, "", `?${parameters}`);
    setDetail(undefined);
    await load(parameters);
  }

  async function openDetail(requestId: string) {
    setError(undefined);
    const response = await fetch(`/api/attendance/correction-reviews/${requestId}`);
    const payload = (await response.json()) as { correction?: Detail; error?: string };
    if (!response.ok) {
      setError(payload.error ?? "申請詳細を取得できませんでした。");
      return;
    }
    setDetail(payload.correction);
    setComment("");
  }

  async function review(decision: "approve" | "reject") {
    if (!detail) return;
    setSubmitting(true);
    setError(undefined);
    setConfirmingApproval(false);
    const response = await fetch(`/api/attendance/correction-reviews/${detail.request.id}`, {
      body: JSON.stringify({ comment, decision }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { correction?: Detail; error?: string };
    setSubmitting(false);
    if (!response.ok) {
      const message = payload.error ?? "申請を審査できませんでした。";
      setError(
        response.status === 409 ? `${message} 一覧と詳細を再読み込みしてください。` : message,
      );
      return;
    }
    setDetail(payload.correction);
    setSuccess(
      decision === "approve"
        ? "勤怠修正を承認し、集計へ反映しました。"
        : "勤怠修正を却下しました。",
    );
    await load(new URLSearchParams(window.location.search));
  }

  const differences = useMemo(() => {
    if (!detail) return [];
    const original = detail.entries.filter((entry) => entry.kind === "original");
    const requested = detail.entries.filter((entry) => entry.kind === "requested");
    const byOriginal = new Map(
      requested.flatMap((entry) =>
        entry.originalEventId ? [[entry.originalEventId, entry] as const] : [],
      ),
    );
    const result: Array<{ label: string; text: string }> = [];
    for (const before of original) {
      const after = before.originalEventId ? byOriginal.get(before.originalEventId) : undefined;
      if (!after) result.push({ label: "削除", text: eventText(before) });
      else if (before.type !== after.type || before.occurredAt !== after.occurredAt) {
        result.push({ label: "変更", text: `${eventText(before)} → ${eventText(after)}` });
      }
    }
    for (const entry of requested) {
      if (!entry.originalEventId) result.push({ label: "追加", text: eventText(entry) });
    }
    return result;
  }, [detail]);

  return (
    <main className="registry-page correction-review-page">
      <PageHeader title="勤怠申請">
        従業員から届いた打刻修正を確認し、承認または却下します。
      </PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <form onSubmit={filter}>
        <FilterBar>
          <SelectField
            id="correction-filter-status"
            label="状態"
            name="status"
            onChange={(event) => setFilterStatus(event.target.value)}
            value={filterStatus}
          >
            <option value="">すべて</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <Field id="correction-filter-from" label="開始日" name="from" type="date" />
          <Field id="correction-filter-to" label="終了日（未満）" name="to" type="date" />
          <SelectField id="correction-filter-employee" label="従業員" name="employeeId">
            <option value="">すべて</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary">
            絞り込む
          </Button>
        </FilterBar>
      </form>
      <div className="correction-review-layout">
        <section aria-labelledby="correction-list-heading">
          <h2 id="correction-list-heading">申請一覧</h2>
          {requests.length === 0 ? (
            <EmptyState title="該当する勤怠申請はありません">
              条件を変えて確認してください。
            </EmptyState>
          ) : (
            <ul className="correction-request-list">
              {requests.map((request) => (
                <li key={request.id}>
                  <button
                    aria-current={detail?.request.id === request.id ? "true" : undefined}
                    onClick={() => void openDetail(request.id)}
                    type="button"
                  >
                    <span>
                      <strong>{request.displayName}</strong>
                      <time>{request.workDate}</time>
                    </span>
                    <span className={`status-pill status-pill--${request.status}`}>
                      {statusLabels[request.status]}
                    </span>
                    <small>{request.reason}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="correction-review-detail" aria-labelledby="correction-detail-heading">
          <h2 id="correction-detail-heading">申請詳細</h2>
          {!detail ? (
            <EmptyState title="申請を選択してください">
              打刻の差分と申請理由をここで確認できます。
            </EmptyState>
          ) : (
            <div className="review-detail-body">
              <header>
                <div>
                  <span>申請者</span>
                  <strong>{detail.employeeName}</strong>
                </div>
                <div>
                  <span>勤務日</span>
                  <strong>{detail.request.workDate}</strong>
                </div>
                <span className={`status-pill status-pill--${detail.request.status}`}>
                  {statusLabels[detail.request.status]}
                </span>
              </header>
              <div className="review-reason">
                <span>申請理由</span>
                <p>{detail.request.reason}</p>
              </div>
              <div className="review-sequences">
                <EventSequence
                  entries={detail.entries.filter((entry) => entry.kind === "original")}
                  title="修正前"
                />
                <EventSequence
                  entries={detail.entries.filter((entry) => entry.kind === "requested")}
                  title="申請後"
                />
              </div>
              <div className="correction-diff">
                <h3>差分</h3>
                <ul>
                  {differences.map((difference, index) => (
                    <li key={`${difference.label}-${index}`}>
                      <strong>{difference.label}</strong>
                      <span>{difference.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {detail.request.reviewComment ? (
                <div className="review-reason">
                  <span>審査コメント</span>
                  <p>{detail.request.reviewComment}</p>
                </div>
              ) : null}
              {detail.request.status === "pending" ? (
                <div className="review-controls">
                  <TextareaField
                    id="review-comment"
                    label="審査コメント（却下時は必須）"
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    value={comment}
                  />
                  <div>
                    <Button
                      disabled={submitting || !comment.trim()}
                      onClick={() => void review("reject")}
                      type="button"
                      variant="danger"
                    >
                      却下する
                    </Button>
                    <Button
                      disabled={submitting}
                      onClick={() => setConfirmingApproval(true)}
                      type="button"
                    >
                      承認する
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        confirmLabel="承認して反映"
        onCancel={() => setConfirmingApproval(false)}
        onConfirm={() => void review("approve")}
        open={confirmingApproval}
        title="勤怠修正を承認しますか？"
      >
        承認すると有効な打刻と勤務時間・残業の集計が更新されます。
      </ConfirmDialog>
    </main>
  );
}
