"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useUnsavedChanges } from "@/components/form-state";
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  ResultSummary,
  SelectField,
  StatePanel,
  Table,
  TaskContext,
  TextareaField,
  Toast,
} from "@/components/ui";

type LeaveType = {
  code: string;
  consumesBalance: boolean;
  id: string;
  name: string;
  paid: boolean;
};
type Balance = {
  availableUnits: number;
  leaveType: LeaveType;
  ledgerUnits: number;
  nextExpiry: string | null;
  pendingUnits: number;
};
type LeaveRequest = {
  createdAt: string;
  id: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  reason: string;
  reviewComment: string | null;
  status: "approved" | "cancelled" | "pending" | "rejected";
};
type Transaction = {
  effectiveOn: string;
  id: string;
  kind: string;
  leaveTypeId: string;
  reason: string;
  units: number;
};
type RequestPreview = {
  afterAvailableUnits: number | null;
  excluded: Array<{ calendarLabel: string; workDate: string }>;
  included: Array<{
    calendarLabel: string;
    scheduledMinutes: number;
    units: number;
    workDate: string;
  }>;
  leaveType: LeaveType;
  requiredUnits: number;
};
type Draft = {
  from: string;
  leaveTypeId: string;
  reason: string;
  to: string;
  unit: "full_day" | "half_day";
};

const statusLabels: Record<LeaveRequest["status"], string> = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
};
const days = (units: number) => `${units / 2}日`;
const today = () => new Date().toISOString().slice(0, 10);

async function responsePayload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function MyLeavePage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [preview, setPreview] = useState<RequestPreview>();
  const [draft, setDraft] = useState<Draft>();
  const [cancelRequest, setCancelRequest] = useState<LeaveRequest>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  const load = useCallback(async () => {
    const [typeResponse, ledgerResponse] = await Promise.all([
      fetch("/api/leave/types"),
      fetch(`/api/leave/ledger?asOf=${today()}`),
    ]);
    const [typePayload, ledgerPayload] = await Promise.all([
      responsePayload(typeResponse),
      responsePayload(ledgerResponse),
    ]);
    if (!typeResponse.ok || !ledgerResponse.ok) {
      setError(
        String(typePayload.error ?? ledgerPayload.error ?? "休暇情報を取得できませんでした。"),
      );
      return;
    }
    setLeaveTypes((typePayload.leaveTypes as LeaveType[]) ?? []);
    setBalances((ledgerPayload.balances as Balance[]) ?? []);
    setRequests((ledgerPayload.requests as LeaveRequest[]) ?? []);
    setTransactions((ledgerPayload.transactions as Transaction[]) ?? []);
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function previewRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextDraft = {
      from: String(data.get("from") ?? ""),
      leaveTypeId: String(data.get("leaveTypeId") ?? ""),
      reason: String(data.get("reason") ?? ""),
      to: String(data.get("to") ?? ""),
      unit: String(data.get("unit")) as Draft["unit"],
    };
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/leave/requests", {
      body: JSON.stringify({ ...nextDraft, action: "preview" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await responsePayload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "休暇申請を確認できませんでした。"));
      return;
    }
    setDraft(nextDraft);
    setPreview(result.preview as RequestPreview);
  }

  async function submitRequest() {
    if (!draft) return;
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/leave/requests", {
      body: JSON.stringify({ ...draft, action: "create" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await responsePayload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "休暇申請を送信できませんでした。"));
      setPreview(undefined);
      return;
    }
    setPreview(undefined);
    setDraft(undefined);
    setDirty(false);
    setSuccess("休暇を申請しました。残高は審査待ち分を予約済みです。");
    await load();
  }

  async function cancel() {
    if (!cancelRequest) return;
    setSubmitting(true);
    setError(undefined);
    const response = await fetch(`/api/leave/requests/${cancelRequest.id}`, {
      body: JSON.stringify({ action: "cancel" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await responsePayload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "休暇申請を取り消せませんでした。"));
      setCancelRequest(undefined);
      return;
    }
    setCancelRequest(undefined);
    setSuccess("審査待ちの休暇申請を取り消しました。");
    await load();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader
        status={balances.length > 0 ? `${balances.length}種類の残高` : "残高未付与"}
        title="休暇"
      >
        利用可能な残高と対象勤務日を確認して、全日・半日の休暇を申請します。
      </PageHeader>
      <TaskContext
        completion="対象勤務日と申請後の残高を確認し、休暇申請を審査へ提出します。"
        prerequisites={["休暇種別と利用可能残高を確認してください。"]}
      />
      <Toast tone="error">{error}</Toast>
      {success ? (
        <ResultSummary
          action={<a href="#leave-history-heading">申請履歴で確認</a>}
          title="休暇申請を提出しました"
        >
          {success} 審査待ちの申請として保存されました。
        </ResultSummary>
      ) : null}

      <section className="feature-section" aria-labelledby="my-leave-balance-heading">
        <div>
          <h2 id="my-leave-balance-heading">利用可能な休暇</h2>
          <p>利用可能残高には、審査待ち申請の予約分が反映されています。</p>
        </div>
        {balances.length === 0 ? (
          <StatePanel kind="notConfigured" title="休暇残高がありません">
            <p>管理者が休暇を付与すると、利用可能な日数がここに表示されます。</p>
          </StatePanel>
        ) : (
          <dl className="balance-grid">
            {balances.map((balance) => (
              <div key={balance.leaveType.id}>
                <dt>{balance.leaveType.name}</dt>
                <dd>
                  {balance.leaveType.consumesBalance
                    ? days(balance.availableUnits)
                    : "残高管理なし"}
                </dd>
                <small>
                  審査待ち {days(balance.pendingUnits)}
                  {balance.nextExpiry ? `・次回失効 ${balance.nextExpiry}` : ""}
                </small>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="feature-section" aria-labelledby="leave-request-heading">
        <div>
          <h2 id="leave-request-heading">休暇を申請</h2>
          <p>休日は自動で除外され、送信前に対象勤務日と申請後残高を確認できます。</p>
        </div>
        <form className="feature-form" onChange={() => setDirty(true)} onSubmit={previewRequest}>
          <SelectField
            description="有給・無給と、残高を消費する種別かを確認してください。"
            id="request-leave-type"
            label="休暇種別"
            name="leaveTypeId"
            required
          >
            <option value="">選択してください</option>
            {leaveTypes.map((leaveType) => (
              <option key={leaveType.id} value={leaveType.id}>
                {leaveType.name}（{leaveType.paid ? "有給" : "無給"}）
              </option>
            ))}
          </SelectField>
          <SelectField
            description="半日は0.5日として残高から差し引かれます。"
            id="request-unit"
            label="申請単位"
            name="unit"
            required
          >
            <option value="full_day">全日</option>
            <option value="half_day">半日</option>
          </SelectField>
          <Field
            defaultValue={today()}
            description="休日は送信前の確認で自動的に除外されます。"
            id="request-from"
            label="開始日"
            name="from"
            required
            type="date"
          />
          <Field
            defaultValue={today()}
            id="request-to"
            label="終了日"
            name="to"
            required
            type="date"
          />
          <TextareaField
            constraint="500文字以内で入力してください。"
            example="私用のため"
            id="request-reason"
            label="申請理由"
            maxLength={500}
            name="reason"
            required
            rows={3}
          />
          <AsyncButton
            pending={submitting}
            pendingLabel="対象日と残高を確認しています"
            type="submit"
          >
            対象日と残高を確認
          </AsyncButton>
        </form>
      </section>

      <section className="feature-section" aria-labelledby="leave-history-heading">
        <div>
          <h2 id="leave-history-heading">申請履歴</h2>
          <p>審査待ちの申請だけを自分で取り消せます。</p>
        </div>
        {requests.length === 0 ? (
          <EmptyState title="申請履歴はありません">
            休暇申請を送信するとここに表示されます。
          </EmptyState>
        ) : (
          <Table label="休暇申請履歴" responsive>
            <thead>
              <tr>
                <th>申請日</th>
                <th>休暇</th>
                <th>理由</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td data-label="申請日">
                    {new Date(request.createdAt).toLocaleDateString("ja-JP")}
                  </td>
                  <td data-label="休暇">
                    {request.leaveTypeName}
                    <br />
                    <small>{request.leaveTypeCode}</small>
                  </td>
                  <td data-label="理由">
                    {request.reason}
                    {request.reviewComment ? (
                      <>
                        <br />
                        <small>審査コメント: {request.reviewComment}</small>
                      </>
                    ) : null}
                  </td>
                  <td data-label="状態">
                    <span className={`status-pill status-pill--${request.status}`}>
                      {statusLabels[request.status]}
                    </span>
                  </td>
                  <td data-label="操作">
                    {request.status === "pending" ? (
                      <Button
                        disabled={submitting}
                        onClick={() => setCancelRequest(request)}
                        type="button"
                        variant="danger"
                      >
                        取り消す
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="feature-section" aria-labelledby="my-leave-ledger-heading">
        <div>
          <h2 id="my-leave-ledger-heading">残高の履歴</h2>
          <p>付与、調整、消化、戻し、失効を時系列で確認できます。</p>
        </div>
        {transactions.length ? (
          <Table label="自分の休暇台帳">
            <thead>
              <tr>
                <th>日付</th>
                <th>休暇</th>
                <th>取引</th>
                <th>単位</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.effectiveOn}</td>
                  <td>
                    {leaveTypes.find((item) => item.id === transaction.leaveTypeId)?.name ?? "休暇"}
                  </td>
                  <td>{transaction.kind}</td>
                  <td>
                    {transaction.units > 0 ? "+" : ""}
                    {transaction.units}
                  </td>
                  <td>{transaction.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="残高履歴はありません">
            休暇が付与されると履歴を確認できます。
          </EmptyState>
        )}
      </section>

      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="この内容で申請"
        onCancel={() => {
          setPreview(undefined);
          setDraft(undefined);
        }}
        onConfirm={() => void submitRequest()}
        open={Boolean(preview)}
        title="休暇申請を送信しますか？"
      >
        {preview ? (
          <div className="request-preview">
            <p>
              <strong>{preview.leaveType.name}</strong>を{days(preview.requiredUnits)}申請します。
            </p>
            <ul>
              {preview.included.map((day) => (
                <li key={day.workDate}>
                  {day.workDate}・{day.units === 2 ? "全日" : "半日"}・{day.calendarLabel}
                </li>
              ))}
            </ul>
            {preview.excluded.length ? (
              <p>休日として除外: {preview.excluded.map((day) => day.workDate).join("、")}</p>
            ) : null}
            <p>
              申請後の利用可能残高:{" "}
              {preview.afterAvailableUnits === null
                ? "残高管理なし"
                : days(preview.afterAvailableUnits)}
            </p>
          </div>
        ) : (
          <p />
        )}
      </ConfirmDialog>
      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="申請を取り消す"
        onCancel={() => setCancelRequest(undefined)}
        onConfirm={() => void cancel()}
        open={Boolean(cancelRequest)}
        title="審査待ち申請を取り消しますか？"
      >
        <p>{cancelRequest?.leaveTypeName}の予約残高が解放されます。</p>
      </ConfirmDialog>
    </main>
  );
}
