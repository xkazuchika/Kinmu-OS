"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  PageHeader,
  SelectField,
  StatePanel,
  Table,
  TaskContext,
  Toast,
} from "@/components/ui";

type ApprovalItem = {
  ageDays: number;
  assignedApproverUserId: string | null;
  canReview: boolean;
  createdAt: string;
  departmentName: string | null;
  dueAt: string | null;
  employeeDisplayName: string;
  id: string;
  needsReassignment: boolean;
  overdue: boolean;
  requestType: "attendance_correction" | "holiday_work" | "leave" | "overtime";
  status: "approved" | "cancelled" | "pending" | "rejected" | "returned";
  submittedOnBehalf: boolean;
  targetDate: string;
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

export default function ApprovalInboxPage() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("status=pending");

  const load = useCallback(
    async (nextQuery = query) => {
      const response = await fetch(`/api/approvals/inbox?${nextQuery}`);
      const payload = (await response.json()) as {
        error?: string;
        items?: ApprovalItem[];
        total?: number;
      };
      setLoaded(true);
      if (!response.ok) {
        setError(payload.error ?? "承認受信箱を取得できませんでした。");
        return;
      }
      setItems(payload.items ?? []);
      setTotal(payload.total ?? 0);
      setError(undefined);
    },
    [query],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parameters = new URLSearchParams(
      Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
    );
    for (const [key, value] of parameters) {
      if (!value) parameters.delete(key);
    }
    const nextQuery = parameters.toString();
    setQuery(nextQuery);
    window.history.replaceState(null, "", nextQuery ? `?${nextQuery}` : "/approvals");
    await load(nextQuery);
  }

  return (
    <main className="registry-page feature-page approval-page">
      <PageHeader
        actions={
          <Button onClick={() => void load()} type="button" variant="secondary">
            最新の状態に更新
          </Button>
        }
        status={loaded ? `${total}件` : "読み込み中"}
        title="承認受信箱"
      >
        勤怠修正、休暇、残業・休日出勤を、対応期限の近い順にまとめて確認します。
      </PageHeader>
      <TaskContext
        completion="申請内容と前提を確認し、承認・差し戻し・却下のいずれかを記録します。"
        prerequisites={[
          "まず「対応可能」を確認します。未割当は所有者・労務管理者が担当を判断します。",
        ]}
      />
      <Toast tone="error">{error}</Toast>

      <section aria-labelledby="approval-filter-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-filter-heading">何を確認するか</h2>
            <p>状態と申請種別を選ぶと、下の一覧を50件ずつ絞り込みます。</p>
          </div>
        </div>
        <form className="approval-filter" onSubmit={filter}>
          <SelectField defaultValue="pending" id="status" label="状態" name="status">
            <option value="pending">審査待ち</option>
            <option value="returned">差し戻し中</option>
            <option value="approved">承認済み</option>
            <option value="rejected">却下</option>
            <option value="cancelled">取消済み</option>
            <option value="">すべて</option>
          </SelectField>
          <SelectField id="requestType" label="申請種別" name="requestType">
            <option value="">すべて</option>
            <option value="attendance_correction">勤怠修正</option>
            <option value="leave">休暇</option>
            <option value="overtime">残業</option>
            <option value="holiday_work">休日出勤</option>
          </SelectField>
          <SelectField id="assigned" label="担当" name="assigned">
            <option value="">自分の権限範囲すべて</option>
            <option value="mine">自分の担当</option>
            <option value="unassigned">未割当</option>
            <option value="assigned">担当あり</option>
          </SelectField>
          <SelectField id="due" label="期限" name="due">
            <option value="">すべて</option>
            <option value="overdue">期限超過</option>
            <option value="not_overdue">期限内・期限なし</option>
          </SelectField>
          <Button type="submit">この条件で表示</Button>
        </form>
      </section>

      <section aria-labelledby="approval-list-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-list-heading">申請一覧</h2>
            <p>上から順に確認すると、期限と提出順に処理できます。</p>
          </div>
          <span className="approval-result-count">
            表示 {items.length}件 / 全 {total}件
          </span>
        </div>
        {items.length === 0 ? (
          <StatePanel
            action={
              <Button onClick={() => void load()} type="button" variant="secondary">
                もう一度確認
              </Button>
            }
            kind="noRecords"
            title={loaded ? "この条件で対応する申請はありません" : "申請を読み込んでいます"}
          >
            <p>条件を変えるか、一覧を更新してください。</p>
          </StatePanel>
        ) : (
          <Table label="承認申請一覧" responsive>
            <thead>
              <tr>
                <th>申請</th>
                <th>対象者・部署</th>
                <th>対象日</th>
                <th>担当・期限</th>
                <th>状態</th>
                <th>次の操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="申請">
                    <strong>{requestTypeLabels[item.requestType]}</strong>
                    {item.submittedOnBehalf ? (
                      <span className="approval-flag">代理作成</span>
                    ) : null}
                    <small>提出から {item.ageDays}日</small>
                  </td>
                  <td data-label="対象者・部署">
                    {item.employeeDisplayName}
                    <small>{item.departmentName ?? "部署未設定"}</small>
                  </td>
                  <td data-label="対象日">{item.targetDate}</td>
                  <td data-label="担当・期限">
                    {item.needsReassignment
                      ? "要再割当"
                      : item.assignedApproverUserId
                        ? "担当あり"
                        : "未割当"}
                    <small>
                      {item.dueAt
                        ? `${item.overdue ? "期限超過: " : "期限: "}${new Date(item.dueAt).toLocaleDateString("ja-JP")}`
                        : "期限なし"}
                    </small>
                  </td>
                  <td data-label="状態">
                    {statusLabels[item.status]}
                    {item.overdue ? <span className="approval-alert">期限超過</span> : null}
                  </td>
                  <td data-label="次の操作">
                    <Link className="ui-button ui-button--secondary" href={`/approvals/${item.id}`}>
                      {item.canReview ? "内容を確認して審査" : "詳細を確認"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}
