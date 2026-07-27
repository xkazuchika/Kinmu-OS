"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  Field,
  PageHeader,
  SelectField,
  StatePanel,
  Table,
  TaskContext,
  TextareaField,
  Toast,
} from "@/components/ui";

type Department = { active: boolean; id: string; name: string };
type User = {
  displayName: string;
  id: string;
  role: "approver" | "employee" | "hr_admin" | "owner";
  status: "active" | "disabled" | "pending_setup";
};
type Delegation = {
  delegateApproverUserId: string;
  departmentName: string;
  endsAt: string;
  id: string;
  originalApproverUserId: string;
  reason: string;
  requestType: "attendance_correction" | "holiday_work" | "leave" | "overtime";
  startsAt: string;
};
type PreviewCase = {
  createdAt: string;
  id: string;
  targetDate: string;
};

const requestTypeLabels = {
  attendance_correction: "勤怠修正",
  holiday_work: "休日出勤",
  leave: "休暇",
  overtime: "残業",
} as const;

export default function ApprovalDelegationsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [preview, setPreview] = useState<PreviewCase[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const load = useCallback(async () => {
    const [delegationResponse, departmentResponse, userResponse] = await Promise.all([
      fetch("/api/approvals/delegations"),
      fetch("/api/departments"),
      fetch("/api/users"),
    ]);
    const delegationPayload = (await delegationResponse.json()) as {
      delegations?: Delegation[];
      error?: string;
    };
    const departmentPayload = (await departmentResponse.json()) as {
      departments?: Department[];
    };
    const userPayload = (await userResponse.json()) as { users?: User[] };
    if (!delegationResponse.ok) {
      setError(delegationPayload.error ?? "承認引継ぎを取得できませんでした。");
      return;
    }
    setDelegations(delegationPayload.delegations ?? []);
    setDepartments((departmentPayload.departments ?? []).filter((item) => item.active));
    setUsers(
      (userPayload.users ?? []).filter(
        (item) =>
          item.status === "active" &&
          (item.role === "owner" || item.role === "hr_admin" || item.role === "approver"),
      ),
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function previewCases(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const response = await fetch("/api/approvals/delegations", {
      body: JSON.stringify({ ...values, action: "preview" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as {
      error?: string;
      preview?: { cases: PreviewCase[] };
    };
    if (!response.ok) {
      setError(payload.error ?? "引継ぎ対象を確認できませんでした。");
      return;
    }
    setDraft(values);
    setPreview(payload.preview?.cases ?? []);
    setSelected([]);
    setError(undefined);
  }

  async function save() {
    if (!draft) return;
    const response = await fetch("/api/approvals/delegations", {
      body: JSON.stringify({ ...draft, reassignCaseIds: selected }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; reassignedCount?: number };
    if (!response.ok) {
      setError(payload.error ?? "承認引継ぎを保存できませんでした。");
      return;
    }
    setDraft(undefined);
    setPreview([]);
    setSelected([]);
    setSuccess(`引継ぎを保存し、既存${payload.reassignedCount ?? 0}件を再割当しました。`);
    await load();
  }

  const userName = (id: string) => users.find((user) => user.id === id)?.displayName ?? "利用者";

  return (
    <main className="settings-page feature-page approval-page">
      <PageHeader status={`${delegations.length}件`} title="承認引継ぎ">
        休暇や出張などの不在期間だけ、新しく届く申請を代理担当者へ割り当てます。
      </PageHeader>
      <TaskContext
        completion="期間中の新規申請と、選択した既存申請だけが代理担当者へ届く状態にします。"
        prerequisites={[
          "引継ぎ終了後も、すでに代理担当へ移した申請は自動では元に戻りません。",
          "既存申請はプレビュー後に選択したものだけを移動します。",
        ]}
      />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section aria-labelledby="delegation-form-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="delegation-form-heading">引継ぎ期間と対象を指定</h2>
            <p>まず対象件数を確認します。この段階ではまだ保存されません。</p>
          </div>
        </div>
        <form className="approval-route-form" onSubmit={previewCases}>
          <SelectField id="departmentId" label="対象部署" name="departmentId" required>
            <option value="">選択してください</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </SelectField>
          <SelectField id="requestType" label="申請種別" name="requestType" required>
            <option value="">選択してください</option>
            {Object.entries(requestTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="originalApproverUserId"
            label="元担当者"
            name="originalApproverUserId"
            required
          >
            <option value="">選択してください</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="delegateApproverUserId"
            label="代理担当者"
            name="delegateApproverUserId"
            required
          >
            <option value="">選択してください</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </SelectField>
          <Field id="startsAt" label="開始日時" name="startsAt" required type="datetime-local" />
          <Field id="endsAt" label="終了日時" name="endsAt" required type="datetime-local" />
          <TextareaField
            constraint="具体的な理由を1,000文字以内"
            id="reason"
            label="引継ぎ理由"
            name="reason"
            required
            rows={3}
          />
          <Button type="submit">対象件数を確認</Button>
        </form>
      </section>

      {draft ? (
        <section aria-labelledby="delegation-preview-heading" className="feature-section">
          <div className="section-heading">
            <div>
              <h2 id="delegation-preview-heading">既存の審査待ちを選択</h2>
              <p>新規申請は期間中に自動で引き継がれます。下は既存申請だけの選択です。</p>
            </div>
          </div>
          {preview.length === 0 ? (
            <StatePanel kind="noRecords" title="移動できる既存申請はありません">
              <p>引継ぎ設定だけを保存できます。</p>
            </StatePanel>
          ) : (
            <div className="approval-selection-list">
              {preview.map((item) => (
                <label key={item.id}>
                  <input
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                    type="checkbox"
                  />
                  対象日 {item.targetDate}（提出 {new Date(item.createdAt).toLocaleString("ja-JP")}
                  ）
                </label>
              ))}
            </div>
          )}
          <div className="approval-action-row">
            <Button onClick={() => void save()} type="button">
              引継ぎを保存
            </Button>
            <Button onClick={() => setDraft(undefined)} type="button" variant="text">
              やめる
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="delegation-list-heading" className="feature-section">
        <h2 id="delegation-list-heading">登録済みの引継ぎ</h2>
        {delegations.length === 0 ? (
          <StatePanel kind="noRecords" title="引継ぎは登録されていません">
            <p>通常の部署別経路がそのまま使用されます。</p>
          </StatePanel>
        ) : (
          <Table label="承認引継ぎ一覧" responsive>
            <thead>
              <tr>
                <th>部署・申請</th>
                <th>元担当</th>
                <th>代理担当</th>
                <th>期間</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {delegations.map((item) => (
                <tr key={item.id}>
                  <td data-label="部署・申請">
                    {item.departmentName}
                    <small>{requestTypeLabels[item.requestType]}</small>
                  </td>
                  <td data-label="元担当">{userName(item.originalApproverUserId)}</td>
                  <td data-label="代理担当">{userName(item.delegateApproverUserId)}</td>
                  <td data-label="期間">
                    {new Date(item.startsAt).toLocaleString("ja-JP")} 〜{" "}
                    {new Date(item.endsAt).toLocaleString("ja-JP")}
                  </td>
                  <td data-label="理由">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}
