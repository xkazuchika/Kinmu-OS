"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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

type Employee = { displayName: string; employeeNumber: string; id: string };
type RequestStatus = "approved" | "cancelled" | "pending" | "rejected";
type LeaveRequest = {
  createdAt: string;
  employeeId: string;
  id: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  reason: string;
  status: RequestStatus;
};
type ReviewDetail = {
  balance: {
    availableUnits: number;
    ledgerUnits: number;
    pendingUnits: number;
    version: number;
  } | null;
  days: Array<{ scheduledMinutes: number; units: number; workDate: string }>;
  existingLeave: { requestId: string; workDate: string } | null;
  lots: Array<{ expiresOn: string | null; grantedOn: string; grantedUnits: number; id: string }>;
  punches: Array<{ eventId: string; type: string; workDate: string }>;
  request: LeaveRequest;
  schedules: Array<{
    calendarLabel: string;
    dayKind: string;
    scheduledMinutes: number;
    workDate: string;
  }>;
};

const statusLabels: Record<RequestStatus, string> = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
};
const today = () => new Date().toISOString().slice(0, 10);
const employeeLabel = (employees: Employee[], employeeId: string) => {
  const employee = employees.find((item) => item.id === employeeId);
  return employee ? `${employee.employeeNumber} ${employee.displayName}` : "従業員";
};

async function result(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function LeaveReviewPage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [status, setStatus] = useState<RequestStatus>("pending");
  const [detail, setDetail] = useState<ReviewDetail>();
  const [approval, setApproval] = useState<ReviewDetail>();
  const [rejectComment, setRejectComment] = useState("");
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [requestResponse, employeeResponse] = await Promise.all([
      fetch(`/api/leave/requests?status=${status}`),
      fetch("/api/employees?status=all"),
    ]);
    const [requestPayload, employeePayload] = await Promise.all([
      result(requestResponse),
      result(employeeResponse),
    ]);
    if (!requestResponse.ok) {
      setError(String(requestPayload.error ?? "休暇申請を取得できませんでした。"));
      return;
    }
    setRequests((requestPayload.requests as LeaveRequest[]) ?? []);
    setEmployees((employeePayload.employees as Employee[]) ?? []);
    setError(undefined);
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function selectRequest(requestId: string) {
    setError(undefined);
    const response = await fetch(`/api/leave/requests/${requestId}`);
    const payload = await result(response);
    if (!response.ok) {
      setError(String(payload.error ?? "休暇申請の詳細を取得できませんでした。"));
      return;
    }
    setDetail(payload.detail as ReviewDetail);
    setRejectComment("");
  }

  async function review(action: "approve" | "reject") {
    const selected = approval ?? detail;
    if (!selected) return;
    setSubmitting(true);
    setError(undefined);
    const response = await fetch(`/api/leave/requests/${selected.request.id}`, {
      body: JSON.stringify({ action, comment: rejectComment }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await result(response);
    setSubmitting(false);
    setApproval(undefined);
    if (!response.ok) {
      setError(String(payload.error ?? "休暇申請を審査できませんでした。"));
      await selectRequest(selected.request.id);
      return;
    }
    setDetail(undefined);
    setRejectComment("");
    setSuccess(action === "approve" ? "休暇申請を承認しました。" : "休暇申請を却下しました。");
    await load();
  }

  async function confirmAbsence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/leave/absences", {
      body: JSON.stringify({
        employeeId: data.get("employeeId"),
        reason: data.get("reason"),
        workDate: data.get("workDate"),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await result(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(payload.error ?? "欠勤を確定できませんでした。"));
      return;
    }
    setSuccess("未解決の勤務日を欠勤として確定しました。");
    event.currentTarget.reset();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader title="休暇審査">勤務予定・打刻・残高を確認して単段階で審査します。</PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section className="feature-section" aria-labelledby="leave-review-heading">
        <div className="section-heading">
          <div>
            <h2 id="leave-review-heading">休暇申請</h2>
            <p>承認時に締め、打刻、重複と残高をもう一度検査します。</p>
          </div>
          <SelectField
            id="review-status"
            label="状態"
            onChange={(event) => {
              setStatus(event.target.value as RequestStatus);
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
        <div className="review-layout">
          <div>
            {requests.length === 0 ? (
              <EmptyState title="対象の申請はありません">
                条件に一致する休暇申請はありません。
              </EmptyState>
            ) : (
              <ul className="review-list">
                {requests.map((request) => (
                  <li key={request.id}>
                    <button
                      aria-pressed={detail?.request.id === request.id}
                      onClick={() => void selectRequest(request.id)}
                      type="button"
                    >
                      <span>
                        <strong>{employeeLabel(employees, request.employeeId)}</strong>
                        <small>{new Date(request.createdAt).toLocaleString("ja-JP")}</small>
                      </span>
                      <span>
                        {request.leaveTypeName}
                        <small>{statusLabels[request.status]}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="review-detail">
            {!detail ? (
              <EmptyState title="申請を選択してください">
                勤務予定、打刻、残高と競合をここで確認します。
              </EmptyState>
            ) : (
              <>
                <header>
                  <div>
                    <h3>{detail.request.leaveTypeName}</h3>
                    <p>
                      {employeeLabel(employees, detail.request.employeeId)}・{detail.request.reason}
                    </p>
                  </div>
                  <span className={`status-pill status-pill--${detail.request.status}`}>
                    {statusLabels[detail.request.status]}
                  </span>
                </header>
                <Table label="休暇申請の対象日">
                  <thead>
                    <tr>
                      <th>対象日</th>
                      <th>単位</th>
                      <th>勤務予定</th>
                      <th>打刻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((day) => {
                      const schedule = detail.schedules.find(
                        (item) => item.workDate === day.workDate,
                      );
                      const punches = detail.punches.filter(
                        (item) => item.workDate === day.workDate,
                      );
                      return (
                        <tr key={day.workDate}>
                          <td>{day.workDate}</td>
                          <td>{day.units === 2 ? "全日" : "半日"}</td>
                          <td>
                            {schedule?.calendarLabel ?? "—"}
                            <br />
                            <small>{schedule?.scheduledMinutes ?? day.scheduledMinutes}分</small>
                          </td>
                          <td>
                            {punches.length
                              ? punches.map((punch) => punch.type).join("、")
                              : "なし"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                <dl className="review-facts">
                  <div>
                    <dt>台帳残高</dt>
                    <dd>
                      {detail.balance ? `${detail.balance.ledgerUnits / 2}日` : "残高管理なし"}
                    </dd>
                  </div>
                  <div>
                    <dt>審査待ち予約</dt>
                    <dd>{detail.balance ? `${detail.balance.pendingUnits / 2}日` : "—"}</dd>
                  </div>
                  <div>
                    <dt>承認後の利用可能</dt>
                    <dd>{detail.balance ? `${detail.balance.availableUnits / 2}日` : "—"}</dd>
                  </div>
                  <div>
                    <dt>付与ロット</dt>
                    <dd>{detail.lots.length}件</dd>
                  </div>
                </dl>
                {detail.existingLeave ? (
                  <Toast tone="error">
                    {detail.existingLeave.workDate}に別の休暇申請があります。
                  </Toast>
                ) : null}
                {detail.request.status === "pending" ? (
                  <div className="review-controls">
                    <TextareaField
                      id="reject-comment"
                      label="却下理由"
                      onChange={(event) => setRejectComment(event.target.value)}
                      placeholder="却下する場合は理由を入力"
                      rows={3}
                      value={rejectComment}
                    />
                    <div>
                      <Button
                        disabled={submitting}
                        onClick={() => setApproval(detail)}
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

      <section className="feature-section" aria-labelledby="absence-heading">
        <div>
          <h2 id="absence-heading">未解決日を欠勤へ確定</h2>
          <p>
            過去の未締め所定勤務日で、打刻・承認済み休暇がない場合だけ確定できます。残高は消費しません。
          </p>
        </div>
        <form className="feature-form" onSubmit={confirmAbsence}>
          <SelectField id="absence-employee" label="従業員" name="employeeId" required>
            <option value="">選択してください</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeNumber} {employee.displayName}
              </option>
            ))}
          </SelectField>
          <Field
            id="absence-date"
            label="対象日"
            max={today()}
            name="workDate"
            required
            type="date"
          />
          <TextareaField id="absence-reason" label="欠勤理由" name="reason" required rows={2} />
          <Button disabled={submitting} type="submit">
            欠勤として確定
          </Button>
        </form>
      </section>

      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="休暇を承認"
        onCancel={() => setApproval(undefined)}
        onConfirm={() => void review("approve")}
        open={Boolean(approval)}
        title="休暇申請を承認しますか？"
      >
        <p>
          {approval
            ? `${employeeLabel(employees, approval.request.employeeId)}の${approval.request.leaveTypeName}（${approval.days.reduce((sum, day) => sum + day.units, 0) / 2}日）を承認し、残高を消化します。`
            : ""}
        </p>
      </ConfirmDialog>
    </main>
  );
}
