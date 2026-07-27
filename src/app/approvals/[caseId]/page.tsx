"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  ConfirmDialog,
  PageHeader,
  SelectField,
  StatePanel,
  TaskContext,
  TextareaField,
  Toast,
} from "@/components/ui";

type ApprovalDetail = {
  assignedApproverName: string | null;
  canManage: boolean;
  canReview: boolean;
  case: {
    assignedApproverUserId: string | null;
    createdAt: string;
    currentRevision: number;
    dueAt: string | null;
    id: string;
    proxyReason: string | null;
    requestType: "attendance_correction" | "holiday_work" | "leave" | "overtime";
    reviewComment: string | null;
    routeReason: string;
    status: "approved" | "cancelled" | "pending" | "rejected" | "returned";
    submittedOnBehalf: boolean;
    targetDate: string;
    version: number;
  };
  departmentName: string | null;
  domain: { request?: Record<string, unknown>; [key: string]: unknown };
  employeeDisplayName: string;
  originalApproverName: string | null;
  revisions: Array<{
    createdAt: string;
    revision: number;
    revisionReason: string | null;
    snapshot: Record<string, unknown>;
  }>;
  submitterName: string;
};
type EligibleUser = {
  displayName: string;
  id: string;
  role: "approver" | "employee" | "hr_admin" | "owner";
  status: "active" | "disabled" | "pending_setup";
};

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
  returned: "差し戻し中",
} as const;
const routeLabels: Record<string, string> = {
  delegated: "引継ぎ先へ割当",
  department_route: "部署別の承認経路",
  legacy_admin_pool: "管理者共通プール",
  manual_reassignment: "管理者による再割当",
};

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export default function ApprovalCasePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [detail, setDetail] = useState<ApprovalDetail>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [comment, setComment] = useState("");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "return">();
  const [submitting, setSubmitting] = useState(false);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/approvals/cases/${caseId}`);
    const payload = (await response.json()) as {
      approvalCase?: ApprovalDetail;
      error?: string;
    };
    if (!response.ok || !payload.approvalCase) {
      setError(payload.error ?? "承認申請を取得できませんでした。");
      return;
    }
    setDetail(payload.approvalCase);
    if (payload.approvalCase.canManage) {
      const usersResponse = await fetch("/api/users");
      if (usersResponse.ok) {
        const usersPayload = (await usersResponse.json()) as {
          users?: EligibleUser[];
        };
        setEligibleUsers(
          (usersPayload.users ?? []).filter(
            (user) =>
              user.status === "active" &&
              (user.role === "owner" || user.role === "hr_admin" || user.role === "approver"),
          ),
        );
      }
    }
    setError(undefined);
  }, [caseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function review(action: "approve" | "reject" | "return") {
    if (!detail) return;
    setSubmitting(true);
    const response = await fetch(`/api/approvals/cases/${caseId}`, {
      body: JSON.stringify({
        action,
        comment,
        expectedVersion: detail.case.version,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    setConfirmAction(undefined);
    if (!response.ok) {
      setError(payload.error ?? "審査結果を保存できませんでした。");
      await load();
      return;
    }
    setComment("");
    setSuccess(
      action === "approve"
        ? "申請を承認しました。"
        : action === "return"
          ? "理由を添えて差し戻しました。"
          : "理由を添えて却下しました。",
    );
    await load();
  }

  async function reassign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setSubmitting(true);
    setError(undefined);
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const response = await fetch("/api/approvals/reassign", {
      body: JSON.stringify({
        caseIds: [detail.case.id],
        reason: values.reason,
        toApproverUserId: values.toApproverUserId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "担当を再割当できませんでした。");
      await load();
      return;
    }
    setSuccess("承認担当者を再割当し、新旧担当者へ通知しました。");
    event.currentTarget.reset();
    await load();
  }

  if (!detail) {
    return (
      <main className="registry-page feature-page">
        <PageHeader title="承認申請の詳細">申請内容と現在の権限を確認しています。</PageHeader>
        <Toast tone="error">{error}</Toast>
        <StatePanel kind="noRecords" title="申請を読み込んでいます">
          <p>一覧へ戻る場合は下のリンクを使用してください。</p>
          <Link href="/approvals">承認受信箱へ戻る</Link>
        </StatePanel>
      </main>
    );
  }

  const currentSnapshot = detail.revisions.find(
    (revision) => revision.revision === detail.case.currentRevision,
  )?.snapshot;
  const needsComment = confirmAction === "reject" || confirmAction === "return";

  return (
    <main className="registry-page feature-page approval-page">
      <PageHeader
        actions={
          <Link className="ui-button ui-button--secondary" href="/approvals">
            受信箱へ戻る
          </Link>
        }
        status={statusLabels[detail.case.status]}
        title={`${requestTypeLabels[detail.case.requestType]}の確認`}
      >
        対象者、申請内容、経路根拠、現在版を上から確認して審査します。
      </PageHeader>
      <TaskContext
        completion="内容に問題がなければ承認し、修正可能なら差し戻し、成立しない場合は却下します。"
        prerequisites={["対象日と本人、申請理由、勤務・残高などの前提を確認してください。"]}
      />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section aria-labelledby="approval-summary-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-summary-heading">誰の、いつの申請か</h2>
            <p>代理作成の場合は、対象本人と実際の作成者を分けて表示します。</p>
          </div>
        </div>
        <dl className="approval-facts">
          <div>
            <dt>対象者</dt>
            <dd>{detail.employeeDisplayName}</dd>
          </div>
          <div>
            <dt>対象日</dt>
            <dd>{detail.case.targetDate}</dd>
          </div>
          <div>
            <dt>申請時部署</dt>
            <dd>{detail.departmentName ?? "部署未設定"}</dd>
          </div>
          <div>
            <dt>提出者</dt>
            <dd>{detail.submitterName}</dd>
          </div>
          <div>
            <dt>作成方法</dt>
            <dd>{detail.case.submittedOnBehalf ? "管理者による代理作成" : "本人申請"}</dd>
          </div>
          <div>
            <dt>現在版</dt>
            <dd>第{detail.case.currentRevision}版</dd>
          </div>
        </dl>
        {detail.case.proxyReason ? (
          <div className="approval-notice">
            <strong>代理作成理由</strong>
            <p>{detail.case.proxyReason}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="approval-content-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-content-heading">申請内容</h2>
            <p>審査対象として固定された第{detail.case.currentRevision}版の内容です。</p>
          </div>
        </div>
        <dl className="approval-snapshot">
          {Object.entries(currentSnapshot ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <pre>{valueText(value)}</pre>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="approval-route-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-route-heading">誰が対応する申請か</h2>
            <p>提出後に所属や設定が変わっても、この根拠は暗黙に変わりません。</p>
          </div>
        </div>
        <dl className="approval-facts">
          <div>
            <dt>経路</dt>
            <dd>{routeLabels[detail.case.routeReason] ?? detail.case.routeReason}</dd>
          </div>
          <div>
            <dt>元担当者</dt>
            <dd>{detail.originalApproverName ?? "未設定"}</dd>
          </div>
          <div>
            <dt>実担当者</dt>
            <dd>{detail.assignedApproverName ?? "未割当"}</dd>
          </div>
          <div>
            <dt>対応期限</dt>
            <dd>
              {detail.case.dueAt ? new Date(detail.case.dueAt).toLocaleString("ja-JP") : "期限なし"}
            </dd>
          </div>
        </dl>
      </section>

      {detail.case.status === "pending" && detail.canReview ? (
        <section
          aria-labelledby="approval-action-heading"
          className="feature-section approval-actions"
        >
          <div className="section-heading">
            <div>
              <h2 id="approval-action-heading">審査結果を記録</h2>
              <p>差し戻しは修正・再申請を求める場合、却下は申請を終了する場合に使います。</p>
            </div>
          </div>
          <TextareaField
            constraint="差し戻し・却下では必須、1,000文字以内"
            description="本人が次に何を直せばよいか、具体的に記載してください。"
            id="approval-comment"
            label="審査コメント"
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            value={comment}
          />
          <div className="approval-action-row">
            <Button onClick={() => setConfirmAction("approve")} type="button">
              承認する
            </Button>
            <Button onClick={() => setConfirmAction("return")} type="button" variant="secondary">
              修正を依頼して差し戻す
            </Button>
            <Button onClick={() => setConfirmAction("reject")} type="button" variant="danger">
              却下する
            </Button>
          </div>
        </section>
      ) : detail.case.status !== "pending" ? (
        <section aria-labelledby="approval-result-heading" className="feature-section">
          <h2 id="approval-result-heading">審査結果</h2>
          <p>{detail.case.reviewComment ?? "審査コメントはありません。"}</p>
        </section>
      ) : (
        <section aria-labelledby="approval-self-review-heading" className="feature-section">
          <h2 id="approval-self-review-heading">この申請は自分では審査できません</h2>
          <p>対象本人または代理作成者と同じ利用者による自己審査を防止しています。</p>
        </section>
      )}

      {detail.case.status === "pending" && detail.canManage ? (
        <section aria-labelledby="approval-reassign-heading" className="feature-section">
          <div className="section-heading">
            <div>
              <h2 id="approval-reassign-heading">担当者を明示的に再割当</h2>
              <p>自己審査、担当無効化、引継ぎ終了などで対応できない場合に使用します。</p>
            </div>
          </div>
          <form className="approval-route-form" onSubmit={reassign}>
            <SelectField
              defaultValue={detail.case.assignedApproverUserId ?? ""}
              id="toApproverUserId"
              label="新しい担当者"
              name="toApproverUserId"
              required
            >
              <option value="">選択してください</option>
              {eligibleUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </SelectField>
            <TextareaField
              constraint="具体的な理由を1,000文字以内"
              id="reassign-reason"
              label="再割当理由"
              name="reason"
              required
              rows={3}
            />
            <Button disabled={submitting} type="submit" variant="secondary">
              担当を再割当
            </Button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="approval-history-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-history-heading">改訂履歴</h2>
            <p>過去版は上書きされず、提出された時点の内容を確認できます。</p>
          </div>
        </div>
        <ol className="approval-history">
          {detail.revisions.map((revision) => (
            <li key={revision.revision}>
              <strong>第{revision.revision}版</strong>
              <span>{new Date(revision.createdAt).toLocaleString("ja-JP")}</span>
              <p>{revision.revisionReason ?? "申請内容を更新"}</p>
            </li>
          ))}
        </ol>
      </section>

      <ConfirmDialog
        confirmDisabled={submitting || (needsComment && !comment.trim())}
        confirmLabel={
          confirmAction === "approve"
            ? "承認を確定"
            : confirmAction === "return"
              ? "差し戻しを確定"
              : "却下を確定"
        }
        onCancel={() => setConfirmAction(undefined)}
        onConfirm={() => {
          if (confirmAction && (!needsComment || comment.trim())) void review(confirmAction);
        }}
        open={Boolean(confirmAction)}
        title="この審査結果でよいですか？"
      >
        <p>
          {needsComment && !comment.trim()
            ? "差し戻し・却下には具体的な理由が必要です。いったん戻って入力してください。"
            : `第${detail.case.currentRevision}版に対する審査結果を保存します。`}
        </p>
      </ConfirmDialog>
    </main>
  );
}
