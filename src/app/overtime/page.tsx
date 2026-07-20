"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Table,
  TextareaField,
  Toast,
} from "@/components/ui";

type RequestStatus = "approved" | "cancelled" | "pending" | "rejected";
type RequestKind = "holiday_work" | "overtime";
type Policy = {
  allowedDeviationMinutes: number;
  blockCloseOnUnresolvedDifference: boolean;
  effectiveFrom: string;
  id: string;
  minuteIncrement: number;
  requirePriorApproval: boolean;
};
type OvertimeRequest = {
  id: string;
  kind: RequestKind;
  plannedBreakMinutes: number;
  plannedEndAt: string;
  plannedMinutes: number;
  plannedStartAt: string;
  reason: string;
  reviewComment: string | null;
  status: RequestStatus;
  version: number;
  workDate: string;
};
type Preview = {
  kind: RequestKind;
  policy: Policy;
  range: {
    plannedEndAt: string;
    plannedMinutes: number;
    plannedStartAt: string;
  };
  schedule: {
    calendarLabel: string;
    dayKind: "non_workday" | "workday";
    scheduledEndTime: string | null;
    scheduledMinutes: number;
    scheduledStartTime: string | null;
  };
  timezone: string;
};
type Draft = {
  endTime: string;
  kind?: RequestKind;
  plannedBreakMinutes: number;
  reason: string;
  startTime: string;
  workDate: string;
};

const statusLabels: Record<RequestStatus, string> = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
};
const kindLabels: Record<RequestKind, string> = {
  holiday_work: "休日出勤",
  overtime: "残業",
};
const today = () => new Date().toISOString().slice(0, 10);

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function OvertimePage() {
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const [requests, setRequests] = useState<OvertimeRequest[]>([]);
  const [policy, setPolicy] = useState<Policy | null>();
  const [preview, setPreview] = useState<Preview>();
  const [draft, setDraft] = useState<Draft>();
  const [cancelTarget, setCancelTarget] = useState<OvertimeRequest>();
  const [status, setStatus] = useState<RequestStatus | "">("");
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const parameters = new URLSearchParams({ policyDate: today() });
    if (status) parameters.set("status", status);
    const response = await fetch(`/api/overtime/requests?${parameters}`);
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "残業・休日出勤申請を取得できませんでした。"));
      return;
    }
    setRequests((result.requests as OvertimeRequest[]) ?? []);
    setPolicy((result.policy as Policy | null) ?? null);
    setError(undefined);
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function loadPolicy(policyDate: string) {
    const response = await fetch(
      `/api/overtime/requests?${new URLSearchParams({ policyDate, status })}`,
    );
    const result = await payload(response);
    if (response.ok) setPolicy((result.policy as Policy | null) ?? null);
  }

  async function previewRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedKind = String(data.get("kind") ?? "");
    const nextDraft: Draft = {
      endTime: String(data.get("endTime") ?? ""),
      kind: selectedKind ? (selectedKind as RequestKind) : undefined,
      plannedBreakMinutes: Number(data.get("plannedBreakMinutes")),
      reason: String(data.get("reason") ?? ""),
      startTime: String(data.get("startTime") ?? ""),
      workDate: String(data.get("workDate") ?? ""),
    };
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/overtime/requests", {
      body: JSON.stringify({ ...nextDraft, action: "preview" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "申請内容を確認できませんでした。"));
      return;
    }
    setDraft(nextDraft);
    setPreview(result.preview as Preview);
  }

  async function submitRequest() {
    if (!draft) return;
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/overtime/requests", {
      body: JSON.stringify({ ...draft, action: "create" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "申請を送信できませんでした。"));
      setPreview(undefined);
      return;
    }
    setDraft(undefined);
    setPreview(undefined);
    setSuccess("残業・休日出勤申請を送信しました。");
    await load();
  }

  async function cancelRequest() {
    if (!cancelTarget) return;
    setSubmitting(true);
    const response = await fetch(`/api/overtime/requests/${cancelTarget.id}`, {
      body: JSON.stringify({ action: "cancel", expectedVersion: cancelTarget.version }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const result = await payload(response);
    setSubmitting(false);
    setCancelTarget(undefined);
    if (!response.ok) {
      setError(String(result.error ?? "申請を取り消せませんでした。"));
      return;
    }
    setSuccess("審査待ちの申請を取り消しました。");
    await load();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader title="残業・休日出勤">
        勤務予定を確認して、所定時間外の勤務を申請します。
      </PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section aria-labelledby="overtime-policy-heading" className="feature-section">
        <div>
          <h2 id="overtime-policy-heading">現在の申請ルール</h2>
          <p>予定分数は実績へ加算されません。勤務後は勤務実績との差異を確認してください。</p>
        </div>
        {policy ? (
          <dl className="review-facts">
            <div>
              <dt>入力単位</dt>
              <dd>{policy.minuteIncrement}分</dd>
            </div>
            <div>
              <dt>申請時期</dt>
              <dd>{policy.requirePriorApproval ? "事前申請のみ" : "事後申請可"}</dd>
            </div>
            <div>
              <dt>差異の許容</dt>
              <dd>±{policy.allowedDeviationMinutes}分</dd>
            </div>
            <div>
              <dt>適用開始</dt>
              <dd>{policy.effectiveFrom}</dd>
            </div>
          </dl>
        ) : (
          <EmptyState title="申請ルールがまだ有効ではありません">
            労務管理者が残業申請ルールを有効化すると申請できます。
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="overtime-request-heading" className="feature-section">
        <div>
          <h2 id="overtime-request-heading">新しい申請</h2>
          <p>翌日までの時間帯に対応します。休日区分は勤務カレンダーから自動判定されます。</p>
        </div>
        <form className="feature-form" onSubmit={previewRequest}>
          <Field
            defaultValue={today()}
            id="overtime-date"
            label="勤務日"
            name="workDate"
            onChange={(event) => void loadPolicy(event.target.value)}
            required
            type="date"
          />
          <SelectField id="overtime-kind" label="申請区分" name="kind">
            <option value="">カレンダーから自動判定</option>
            <option value="overtime">残業</option>
            <option value="holiday_work">休日出勤</option>
          </SelectField>
          <Field id="overtime-start" label="予定開始" name="startTime" required type="time" />
          <Field id="overtime-end" label="予定終了（翌日可）" name="endTime" required type="time" />
          <Field
            defaultValue="0"
            id="overtime-break"
            label="予定休憩（分）"
            min="0"
            name="plannedBreakMinutes"
            required
            step={policy?.minuteIncrement ?? 1}
            type="number"
          />
          <TextareaField
            id="overtime-reason"
            label="申請理由"
            maxLength={500}
            name="reason"
            required
            rows={3}
          />
          <Button ref={previewButtonRef} disabled={submitting || !policy} type="submit">
            勤務予定と申請分数を確認
          </Button>
        </form>
      </section>

      <section aria-labelledby="overtime-history-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="overtime-history-heading">申請履歴</h2>
            <p>審査待ちの申請だけ取り消せます。実績差異は勤務実績で確認できます。</p>
          </div>
          <SelectField
            id="overtime-history-status"
            label="状態"
            onChange={(event) => setStatus(event.target.value as RequestStatus | "")}
            value={status}
          >
            <option value="">すべて</option>
            <option value="pending">審査待ち</option>
            <option value="approved">承認済み</option>
            <option value="rejected">却下</option>
            <option value="cancelled">取消済み</option>
          </SelectField>
        </div>
        {requests.length === 0 ? (
          <EmptyState title="申請履歴はありません">条件に一致する申請はありません。</EmptyState>
        ) : (
          <Table label="残業・休日出勤申請履歴">
            <thead>
              <tr>
                <th>勤務日</th>
                <th>区分・時間</th>
                <th>理由</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{request.workDate}</td>
                  <td>
                    {kindLabels[request.kind]}
                    <br />
                    <small>
                      {request.plannedMinutes}分（休憩 {request.plannedBreakMinutes}分）
                    </small>
                  </td>
                  <td>
                    {request.reason}
                    {request.reviewComment ? (
                      <>
                        <br />
                        <small>審査理由: {request.reviewComment}</small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`status-pill status-pill--${request.status}`}>
                      {statusLabels[request.status]}
                    </span>
                  </td>
                  <td>
                    {request.status === "pending" ? (
                      <Button
                        disabled={submitting}
                        onClick={() => setCancelTarget(request)}
                        type="button"
                        variant="danger"
                      >
                        取り消す
                      </Button>
                    ) : (
                      <Link href={`/attendance/me?month=${request.workDate.slice(0, 7)}`}>
                        実績差異
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <p className="report-note">
        申請・承認は、36協定、法定休日労働、割増賃金などの法令適合を自動判定・保証するものではありません。
      </p>

      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="この内容で申請"
        onCancel={() => {
          setPreview(undefined);
          setDraft(undefined);
        }}
        onConfirm={() => void submitRequest()}
        open={Boolean(preview)}
        returnFocusRef={previewButtonRef}
        title="申請内容を確認"
      >
        {preview ? (
          <dl className="review-facts">
            <div>
              <dt>区分</dt>
              <dd>{kindLabels[preview.kind]}</dd>
            </div>
            <div>
              <dt>勤務予定</dt>
              <dd>{preview.schedule.calendarLabel}</dd>
            </div>
            <div>
              <dt>予定分数</dt>
              <dd>{preview.range.plannedMinutes}分</dd>
            </div>
            <div>
              <dt>入力単位</dt>
              <dd>{preview.policy.minuteIncrement}分</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="申請を取り消す"
        onCancel={() => setCancelTarget(undefined)}
        onConfirm={() => void cancelRequest()}
        open={Boolean(cancelTarget)}
        title="審査待ち申請を取り消しますか"
      >
        取り消した申請は元に戻せません。必要な場合は新しく申請してください。
      </ConfirmDialog>
    </main>
  );
}
