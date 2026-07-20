"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Table,
  Toast,
} from "@/components/ui";

type Policy = {
  activatedAt: string | null;
  allowedDeviationMinutes: number;
  blockCloseOnUnresolvedDifference: boolean;
  effectiveFrom: string;
  id: string;
  minuteIncrement: number;
  requirePriorApproval: boolean;
  status: "active" | "draft" | "inactive";
  version: number;
};
type ActivationPreview = {
  closedMonths: string[];
  employeesAffected: number;
  policy: Policy;
  requestsAffected: number;
};

const statusLabels = { active: "有効", draft: "ドラフト", inactive: "過去設定" } as const;
const defaultDate = () => new Date().toISOString().slice(0, 10);
const nextDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function OvertimeSettingsPage() {
  const activationButtonRef = useRef<HTMLButtonElement>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [editing, setEditing] = useState<Policy>();
  const [activation, setActivation] = useState<ActivationPreview>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const template = editing ?? policies.find((policy) => policy.status === "active");
  const suggestedEffectiveFrom =
    editing?.effectiveFrom ?? (template ? nextDate(template.effectiveFrom) : defaultDate());

  const load = useCallback(async () => {
    const response = await fetch("/api/overtime/policies");
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "残業申請設定を取得できませんでした。"));
      setLoaded(true);
      return;
    }
    const next = (result.policies as Policy[]) ?? [];
    setPolicies(next);
    setEditing(next.find((policy) => policy.status === "draft"));
    setLoaded(true);
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    const response = await fetch("/api/overtime/policies", {
      body: JSON.stringify({
        action: "save",
        allowedDeviationMinutes: Number(data.get("allowedDeviationMinutes")),
        blockCloseOnUnresolvedDifference: data.get("blockCloseOnUnresolvedDifference") === "on",
        effectiveFrom: data.get("effectiveFrom"),
        expectedVersion: editing?.version,
        minuteIncrement: Number(data.get("minuteIncrement")),
        policyId: editing?.id,
        requirePriorApproval: data.get("requirePriorApproval") === "on",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "設定を保存できませんでした。"));
      return;
    }
    setSuccess("残業申請設定をドラフト保存しました。");
    await load();
  }

  async function previewActivation(policy: Policy) {
    setSubmitting(true);
    const response = await fetch("/api/overtime/policies", {
      body: JSON.stringify({ action: "preview_activation", policyId: policy.id }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "有効化の影響を確認できませんでした。"));
      return;
    }
    setActivation(result.preview as ActivationPreview);
  }

  async function activate() {
    if (!activation) return;
    setSubmitting(true);
    const response = await fetch("/api/overtime/policies", {
      body: JSON.stringify({
        action: "activate",
        expectedVersion: activation.policy.version,
        policyId: activation.policy.id,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    setActivation(undefined);
    if (!response.ok) {
      setError(String(result.error ?? "設定を有効化できませんでした。"));
      return;
    }
    setSuccess("残業申請設定を有効化しました。");
    await load();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader title="残業申請設定">
        申請単位・事前申請・実績差異と月次締めの扱いを適用日付きで管理します。
      </PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <section aria-labelledby="overtime-policy-edit-heading" className="feature-section">
        <div>
          <h2 id="overtime-policy-edit-heading">設定ドラフト</h2>
          <p>保存だけでは従業員に適用されません。影響範囲を確認してから有効化します。</p>
        </div>
        {!loaded ? (
          <EmptyState title="設定を読み込んでいます">しばらくお待ちください。</EmptyState>
        ) : (
          <form
            className="feature-form"
            key={editing ? `${editing.id}:${editing.version}` : `new:${template?.id ?? "default"}`}
            onSubmit={save}
          >
            <Field
              defaultValue={suggestedEffectiveFrom}
              id="policy-effective"
              label="適用開始日"
              name="effectiveFrom"
              required
              type="date"
            />
            <SelectField
              defaultValue={String(template?.minuteIncrement ?? 15)}
              id="policy-increment"
              label="時刻の入力単位"
              name="minuteIncrement"
              required
            >
              <option value="1">1分</option>
              <option value="5">5分</option>
              <option value="10">10分</option>
              <option value="15">15分</option>
              <option value="30">30分</option>
            </SelectField>
            <Field
              defaultValue={template?.allowedDeviationMinutes ?? 15}
              id="policy-deviation"
              label="実績差異の許容（分）"
              max="1440"
              min="0"
              name="allowedDeviationMinutes"
              required
              type="number"
            />
            <label className="feature-check">
              <input
                defaultChecked={template?.requirePriorApproval ?? false}
                name="requirePriorApproval"
                type="checkbox"
              />
              <span>
                <strong>事前申請を必須にする</strong>
                <small>予定開始を過ぎた申請を受け付けません。</small>
              </span>
            </label>
            <label className="feature-check">
              <input
                defaultChecked={template?.blockCloseOnUnresolvedDifference ?? false}
                name="blockCloseOnUnresolvedDifference"
                type="checkbox"
              />
              <span>
                <strong>未解決差異がある月を締めない</strong>
                <small>超過・実績なし・未申請実績を締め前の阻害要因にします。</small>
              </span>
            </label>
            <div className="form-actions">
              <Button disabled={submitting} type="submit">
                ドラフトを保存
              </Button>
              <Button
                ref={activationButtonRef}
                disabled={submitting || !editing}
                onClick={() => editing && void previewActivation(editing)}
                type="button"
                variant="secondary"
              >
                {editing ? "影響を確認して有効化" : "先にドラフトを保存"}
              </Button>
            </div>
          </form>
        )}
      </section>
      <section aria-labelledby="overtime-policy-history-heading" className="feature-section">
        <div>
          <h2 id="overtime-policy-history-heading">適用履歴</h2>
          <p>勤務日には、その日に有効な最新設定が使われます。</p>
        </div>
        {policies.length ? (
          <Table label="残業申請ポリシー履歴">
            <thead>
              <tr>
                <th>状態</th>
                <th>適用開始</th>
                <th>入力単位</th>
                <th>事前申請</th>
                <th>許容差異</th>
                <th>締め阻害</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id}>
                  <td>
                    <span
                      className={`status-pill status-pill--${policy.status === "active" ? "approved" : "pending"}`}
                    >
                      {statusLabels[policy.status]}
                    </span>
                  </td>
                  <td>{policy.effectiveFrom}</td>
                  <td>{policy.minuteIncrement}分</td>
                  <td>{policy.requirePriorApproval ? "必須" : "事後可"}</td>
                  <td>±{policy.allowedDeviationMinutes}分</td>
                  <td>{policy.blockCloseOnUnresolvedDifference ? "有効" : "無効"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </section>
      <p className="report-note">
        この設定と申請承認は、36協定、法定休日労働、割増賃金などの法令適合を自動判定・保証しません。
      </p>
      <ConfirmDialog
        confirmDisabled={submitting || Boolean(activation?.closedMonths.length)}
        confirmLabel="この設定を有効化"
        onCancel={() => setActivation(undefined)}
        onConfirm={() => void activate()}
        open={Boolean(activation)}
        returnFocusRef={activationButtonRef}
        title="設定の影響を確認"
      >
        {activation ? (
          <>
            <dl className="review-facts">
              <div>
                <dt>適用開始</dt>
                <dd>{activation.policy.effectiveFrom}</dd>
              </div>
              <div>
                <dt>対象従業員</dt>
                <dd>{activation.employeesAffected}名</dd>
              </div>
              <div>
                <dt>既存申請</dt>
                <dd>{activation.requestsAffected}件</dd>
              </div>
              <div>
                <dt>締め済み月</dt>
                <dd>
                  {activation.closedMonths.length ? activation.closedMonths.join("、") : "なし"}
                </dd>
              </div>
            </dl>
            {activation.closedMonths.length ? (
              <Toast tone="error">
                対象期間に締め済み月があります。先に月次勤怠を再開してください。
              </Toast>
            ) : null}
          </>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
