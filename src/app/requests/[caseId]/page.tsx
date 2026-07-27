"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import {
  Button,
  Field,
  PageHeader,
  SelectField,
  StatePanel,
  TaskContext,
  TextareaField,
  Toast,
} from "@/components/ui";

type RequestType = "attendance_correction" | "holiday_work" | "leave" | "overtime";
type RequestStatus = "approved" | "cancelled" | "pending" | "rejected" | "returned";
type AttendanceEntry = {
  kind: "original" | "requested";
  occurredAt: string;
  originalEventId: string | null;
  position: number;
  type: string;
};
type Revision = {
  createdAt: string;
  id: string;
  revisedByUserId: string;
  revision: number;
  revisionReason: string | null;
  snapshot: Record<string, unknown>;
};
type Domain = {
  days?: Array<{ units: number; workDate: string }>;
  entries?: AttendanceEntry[];
  request?: Record<string, unknown>;
};
type Detail = {
  case: {
    attendanceCorrectionRequestId: string | null;
    currentRevision: number;
    id: string;
    leaveRequestId: string | null;
    overtimeWorkRequestId: string | null;
    proxyReason: string | null;
    requestType: RequestType;
    reviewComment: string | null;
    status: RequestStatus;
    submittedOnBehalf: boolean;
    targetDate: string;
    version: number;
  };
  domain: Domain;
  revisions: Revision[];
  submitterName: string;
};
type LeaveType = { active: boolean; id: string; name: string; requestable: boolean };
type EditableEntry = { occurredAt: string; originalEventId: string | null; type: string };

const requestTypeLabels = {
  attendance_correction: "勤怠修正",
  holiday_work: "休日出勤",
  leave: "休暇",
  overtime: "残業",
} as const;
const statusLabels = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
  returned: "差し戻し・修正待ち",
} as const;
const punchLabels: Record<string, string> = {
  break_end: "休憩終了",
  break_start: "休憩開始",
  clock_in: "出勤",
  clock_out: "退勤",
};

function dateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localTime(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });
}

function RevisionSummary({ revision }: { revision: Revision }) {
  const snapshot = revision.snapshot;
  const requestType = snapshot.requestType as RequestType | undefined;
  return (
    <article className="approval-revision-card">
      <header>
        <strong>第{revision.revision}版</strong>
        <span>{new Date(revision.createdAt).toLocaleString("ja-JP")}</span>
      </header>
      <p>{revision.revisionReason ?? "申請内容を保存"}</p>
      <dl className="approval-summary-list">
        <div>
          <dt>申請理由</dt>
          <dd>{String(snapshot.reason ?? "記録なし")}</dd>
        </div>
        {requestType === "attendance_correction" ? (
          <div>
            <dt>希望打刻</dt>
            <dd>
              {(Array.isArray(snapshot.entries) ? snapshot.entries : [])
                .filter(
                  (entry): entry is AttendanceEntry =>
                    typeof entry === "object" &&
                    entry !== null &&
                    (entry as AttendanceEntry).kind === "requested",
                )
                .map(
                  (entry) =>
                    `${punchLabels[entry.type] ?? entry.type} ${new Date(entry.occurredAt).toLocaleString("ja-JP")}`,
                )
                .join(" / ") || "記録なし"}
            </dd>
          </div>
        ) : null}
        {requestType === "leave" ? (
          <div>
            <dt>対象日</dt>
            <dd>
              {(Array.isArray(snapshot.days) ? snapshot.days : [])
                .map((day) => String((day as { workDate?: string }).workDate ?? ""))
                .filter(Boolean)
                .join("、")}
            </dd>
          </div>
        ) : null}
        {requestType === "overtime" || requestType === "holiday_work" ? (
          <div>
            <dt>予定時間</dt>
            <dd>
              {localTime(snapshot.plannedStartAt)}〜{localTime(snapshot.plannedEndAt)}
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export default function OwnRequestDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [detail, setDetail] = useState<Detail>();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [entries, setEntries] = useState<EditableEntry[]>([]);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [detailResponse, leaveTypeResponse] = await Promise.all([
      fetch(`/api/requests/${encodeURIComponent(caseId)}`),
      fetch("/api/leave/types"),
    ]);
    const payload = (await detailResponse.json()) as { detail?: Detail; error?: string };
    if (!detailResponse.ok || !payload.detail) {
      setError(payload.error ?? "申請詳細を取得できませんでした。");
      return;
    }
    setDetail(payload.detail);
    setEntries(
      (payload.detail.domain.entries ?? [])
        .filter((entry) => entry.kind === "requested")
        .map((entry) => ({
          occurredAt: dateTimeLocal(entry.occurredAt),
          originalEventId: entry.originalEventId,
          type: entry.type,
        })),
    );
    if (leaveTypeResponse.ok) {
      const leavePayload = (await leaveTypeResponse.json()) as { leaveTypes?: LeaveType[] };
      setLeaveTypes(
        (leavePayload.leaveTypes ?? []).filter((item) => item.active && item.requestable),
      );
    }
    setError(undefined);
  }, [caseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const request = detail?.domain.request ?? {};
  const leaveDates = useMemo(
    () => (detail?.domain.days ?? []).map((day) => day.workDate).sort(),
    [detail],
  );

  async function submit(action: "cancel" | "resubmit", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!detail) return;
    setSubmitting(true);
    setError(undefined);
    setSuccess(undefined);
    const values = event
      ? (Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>)
      : {};
    let response: Response;
    if (detail.case.requestType === "attendance_correction") {
      response = await fetch(
        `/api/attendance/corrections/${detail.case.attendanceCorrectionRequestId}`,
        {
          body: JSON.stringify({
            action,
            entries:
              action === "resubmit"
                ? entries.map((entry) => ({
                    ...entry,
                    occurredAt: new Date(entry.occurredAt).toISOString(),
                  }))
                : undefined,
            expectedCaseVersion: detail.case.version,
            reason: values.reason,
            workDate: values.workDate,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
    } else if (detail.case.requestType === "leave") {
      response = await fetch(`/api/leave/requests/${detail.case.leaveRequestId}`, {
        body: JSON.stringify({
          ...values,
          action,
          expectedCaseVersion: detail.case.version,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } else {
      response = await fetch(`/api/overtime/requests/${detail.case.overtimeWorkRequestId}`, {
        body: JSON.stringify({
          ...values,
          action,
          expectedCaseVersion: detail.case.version,
          expectedVersion: Number(request.version ?? 0),
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
    }
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "申請を更新できませんでした。");
      return;
    }
    setSuccess(action === "cancel" ? "申請を取り消しました。" : "修正内容を再申請しました。");
    await load();
  }

  if (!detail) {
    return (
      <main className="registry-page feature-page approval-page">
        <PageHeader title="申請詳細">差し戻し理由と申請内容を読み込んでいます。</PageHeader>
        <Toast tone="error">{error}</Toast>
        <StatePanel kind="noRecords" title="申請を確認しています">
          <p>画面を閉じずにお待ちください。</p>
        </StatePanel>
      </main>
    );
  }

  const returned = detail.case.status === "returned";
  const cancellable = detail.case.status === "pending" || returned;
  return (
    <main className="registry-page feature-page approval-page">
      <PageHeader
        actions={
          <Link className="ui-button ui-button--secondary" href="/requests">
            申請履歴へ戻る
          </Link>
        }
        status={statusLabels[detail.case.status]}
        title={`${requestTypeLabels[detail.case.requestType]}申請`}
      >
        対象日 {detail.case.targetDate}・第{detail.case.currentRevision}版
      </PageHeader>
      <TaskContext
        completion={
          returned
            ? "差し戻し理由を解消した内容で再申請します。"
            : "現在の状態と、保存された各版の内容を確認します。"
        }
        prerequisites={[
          "過去の版は上書きされず、その時点の申請内容として残ります。",
          "再申請時は締め状態、残高、重複、勤務予定などを改めて検証します。",
        ]}
      />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section aria-labelledby="request-result-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="request-result-heading">いま何をするか</h2>
            <p>
              {returned
                ? "下の理由を確認し、申請内容を修正してください。"
                : detail.case.status === "pending"
                  ? "現在は審査待ちです。修正が不要ならそのままお待ちください。"
                  : "審査結果と申請時点の内容を確認できます。"}
            </p>
          </div>
        </div>
        {detail.case.reviewComment ? (
          <div className="approval-review-notice" role="status">
            <strong>{returned ? "差し戻し理由" : "審査コメント"}</strong>
            <p>{detail.case.reviewComment}</p>
          </div>
        ) : null}
        {detail.case.submittedOnBehalf ? (
          <div className="approval-proxy-notice">
            <strong>管理者による代理作成</strong>
            <p>作成者: {detail.submitterName}</p>
            <p>代理理由: {detail.case.proxyReason}</p>
          </div>
        ) : null}
      </section>

      {returned ? (
        <section aria-labelledby="resubmit-heading" className="feature-section">
          <div className="section-heading">
            <div>
              <h2 id="resubmit-heading">内容を修正して再申請</h2>
              <p>入力後、最新の業務ルールでもう一度検証します。</p>
            </div>
          </div>
          <form
            className="approval-proxy-form"
            onSubmit={(event) => void submit("resubmit", event)}
          >
            {detail.case.requestType === "attendance_correction" ? (
              <>
                <Field
                  defaultValue={String(request.workDate ?? detail.case.targetDate)}
                  id="workDate"
                  label="勤務日"
                  name="workDate"
                  required
                  type="date"
                />
                <div className="approval-entry-editor">
                  <strong>希望する打刻列</strong>
                  {entries.map((entry, index) => (
                    <div className="approval-entry-row" key={`${entry.type}-${index}`}>
                      <SelectField
                        id={`entry-type-${index}`}
                        label={`打刻 ${index + 1}`}
                        onChange={(event) =>
                          setEntries((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, type: event.target.value } : item,
                            ),
                          )
                        }
                        value={entry.type}
                      >
                        <option value="clock_in">出勤</option>
                        <option value="break_start">休憩開始</option>
                        <option value="break_end">休憩終了</option>
                        <option value="clock_out">退勤</option>
                      </SelectField>
                      <Field
                        id={`entry-time-${index}`}
                        label="時刻"
                        onChange={(event) =>
                          setEntries((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, occurredAt: event.target.value }
                                : item,
                            ),
                          )
                        }
                        required
                        type="datetime-local"
                        value={entry.occurredAt}
                      />
                      <Button
                        onClick={() =>
                          setEntries((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                        type="button"
                        variant="text"
                      >
                        この打刻を削除
                      </Button>
                    </div>
                  ))}
                  <Button
                    onClick={() =>
                      setEntries((current) => [
                        ...current,
                        { occurredAt: "", originalEventId: null, type: "clock_out" },
                      ])
                    }
                    type="button"
                    variant="secondary"
                  >
                    打刻を追加
                  </Button>
                </div>
              </>
            ) : null}
            {detail.case.requestType === "leave" ? (
              <>
                <SelectField
                  defaultValue={String(request.leaveTypeId ?? "")}
                  id="leaveTypeId"
                  label="休暇種別"
                  name="leaveTypeId"
                  required
                >
                  <option value="">選択してください</option>
                  {leaveTypes.map((leaveType) => (
                    <option key={leaveType.id} value={leaveType.id}>
                      {leaveType.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  defaultValue={leaveDates[0]}
                  id="from"
                  label="開始日"
                  name="from"
                  required
                  type="date"
                />
                <Field
                  defaultValue={leaveDates.at(-1)}
                  id="to"
                  label="終了日"
                  name="to"
                  required
                  type="date"
                />
                <SelectField
                  defaultValue={
                    (detail.domain.days?.[0]?.units ?? 2) === 1 ? "half_day" : "full_day"
                  }
                  id="unit"
                  label="休暇単位"
                  name="unit"
                >
                  <option value="full_day">全日</option>
                  <option value="half_day">半日</option>
                </SelectField>
              </>
            ) : null}
            {detail.case.requestType === "overtime" ||
            detail.case.requestType === "holiday_work" ? (
              <>
                <SelectField
                  defaultValue={detail.case.requestType}
                  id="kind"
                  label="区分"
                  name="kind"
                >
                  <option value="overtime">残業</option>
                  <option value="holiday_work">休日出勤</option>
                </SelectField>
                <Field
                  defaultValue={String(request.workDate ?? detail.case.targetDate)}
                  id="workDate"
                  label="勤務日"
                  name="workDate"
                  required
                  type="date"
                />
                <Field
                  defaultValue={localTime(request.plannedStartAt)}
                  id="startTime"
                  label="予定開始"
                  name="startTime"
                  required
                  type="time"
                />
                <Field
                  defaultValue={localTime(request.plannedEndAt)}
                  id="endTime"
                  label="予定終了"
                  name="endTime"
                  required
                  type="time"
                />
                <Field
                  defaultValue={Number(request.plannedBreakMinutes ?? 0)}
                  id="plannedBreakMinutes"
                  label="予定休憩"
                  min={0}
                  name="plannedBreakMinutes"
                  required
                  type="number"
                  unit="分"
                />
              </>
            ) : null}
            <TextareaField
              defaultValue={String(request.reason ?? "")}
              id="reason"
              label="申請理由"
              name="reason"
              required
              rows={4}
            />
            <Button disabled={submitting} type="submit">
              {submitting ? "検証しています" : "修正内容を再申請"}
            </Button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="revision-history-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="revision-history-heading">申請の改訂履歴</h2>
            <p>各版は提出時の内容を保持しています。</p>
          </div>
        </div>
        <div className="approval-revision-list">
          {detail.revisions.map((revision) => (
            <RevisionSummary key={revision.id} revision={revision} />
          ))}
        </div>
      </section>

      {cancellable ? (
        <section aria-labelledby="cancel-request-heading" className="feature-section">
          <div className="section-heading">
            <div>
              <h2 id="cancel-request-heading">申請を取り消す</h2>
              <p>取消後は再申請できません。必要なら新しい申請を作成してください。</p>
            </div>
          </div>
          <Button
            disabled={submitting}
            onClick={() => void submit("cancel")}
            type="button"
            variant="danger"
          >
            この申請を取り消す
          </Button>
        </section>
      ) : null}
    </main>
  );
}
