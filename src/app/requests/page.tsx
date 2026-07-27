"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, PageHeader, StatePanel, Table, TaskContext, Toast } from "@/components/ui";

type RequestCase = {
  createdAt: string;
  currentRevision: number;
  id: string;
  requestType: "attendance_correction" | "holiday_work" | "leave" | "overtime";
  reviewComment: string | null;
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
  returned: "差し戻し・修正待ち",
} as const;

export default function OwnRequestsPage() {
  const [items, setItems] = useState<RequestCase[]>([]);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/requests");
    const payload = (await response.json()) as {
      cases?: RequestCase[];
      error?: string;
    };
    setLoaded(true);
    if (!response.ok) {
      setError(payload.error ?? "申請履歴を取得できませんでした。");
      return;
    }
    setItems(payload.cases ?? []);
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <main className="registry-page feature-page approval-page">
      <PageHeader
        actions={
          <Button onClick={() => void load()} type="button" variant="secondary">
            最新の状態に更新
          </Button>
        }
        status={loaded ? `${items.length}件` : "読み込み中"}
        title="申請履歴"
      >
        自分が対象の申請と、管理者が自分のために代理作成した申請をまとめて確認します。
      </PageHeader>
      <TaskContext
        completion="審査結果を確認し、差し戻し中なら内容を修正して再申請します。"
        prerequisites={[
          "「差し戻し・修正待ち」は、詳細に理由と次の操作があります。",
          "代理作成された申請も本人から取消・再申請できます。",
        ]}
      />
      <Toast tone="error">{error}</Toast>

      <section aria-labelledby="own-request-list-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="own-request-list-heading">これまでの申請</h2>
            <p>新しい申請から順に表示しています。</p>
          </div>
        </div>
        {!items.length ? (
          <StatePanel
            action={
              <Button onClick={() => void load()} type="button" variant="secondary">
                もう一度確認
              </Button>
            }
            kind="noRecords"
            title={loaded ? "申請履歴はありません" : "申請を読み込んでいます"}
          >
            <p>勤怠修正、休暇、残業・休日出勤の申請を行うと、ここに表示されます。</p>
          </StatePanel>
        ) : (
          <Table label="自分の申請履歴" responsive>
            <thead>
              <tr>
                <th>申請</th>
                <th>対象日</th>
                <th>状態</th>
                <th>改訂</th>
                <th>次の操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="申請">
                    <strong>{requestTypeLabels[item.requestType]}</strong>
                    {item.submittedOnBehalf ? (
                      <span className="approval-flag">管理者による代理作成</span>
                    ) : null}
                  </td>
                  <td data-label="対象日">{item.targetDate}</td>
                  <td data-label="状態">
                    {statusLabels[item.status]}
                    {item.status === "returned" && item.reviewComment ? (
                      <small>修正が必要です</small>
                    ) : null}
                  </td>
                  <td data-label="改訂">第{item.currentRevision}版</td>
                  <td data-label="次の操作">
                    <Link className="ui-button ui-button--secondary" href={`/requests/${item.id}`}>
                      {item.status === "returned" ? "理由を確認して修正" : "詳細を確認"}
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
