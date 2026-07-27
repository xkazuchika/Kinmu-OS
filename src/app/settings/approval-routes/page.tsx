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
  Toast,
} from "@/components/ui";

type Department = { active: boolean; id: string; name: string };
type User = {
  displayName: string;
  id: string;
  role: "approver" | "employee" | "hr_admin" | "owner";
  status: "active" | "disabled" | "pending_setup";
};
type Route = {
  approverDisplayName: string;
  approverUserId: string;
  departmentId: string;
  departmentName: string;
  dueDays: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  id: string;
  requestType: "attendance_correction" | "holiday_work" | "leave" | "overtime";
  version: number;
};

const requestTypeLabels = {
  attendance_correction: "勤怠修正",
  holiday_work: "休日出勤",
  leave: "休暇",
  overtime: "残業",
} as const;

export default function ApprovalRoutesPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [editing, setEditing] = useState<Route>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [routeResponse, departmentResponse, userResponse] = await Promise.all([
      fetch("/api/approvals/routes"),
      fetch("/api/departments"),
      fetch("/api/users"),
    ]);
    const [routePayload, departmentPayload, userPayload] = (await Promise.all([
      routeResponse.json(),
      departmentResponse.json(),
      userResponse.json(),
    ])) as [
      { error?: string; routes?: Route[] },
      { departments?: Department[] },
      { users?: User[] },
    ];
    setLoaded(true);
    if (!routeResponse.ok) {
      setError(routePayload.error ?? "承認経路を取得できませんでした。");
      return;
    }
    setRoutes(routePayload.routes ?? []);
    setDepartments((departmentPayload.departments ?? []).filter((item) => item.active));
    setUsers(
      (userPayload.users ?? []).filter(
        (item) =>
          item.status === "active" &&
          (item.role === "owner" || item.role === "hr_admin" || item.role === "approver"),
      ),
    );
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(
      editing ? `/api/approvals/routes/${editing.id}` : "/api/approvals/routes",
      {
        body: JSON.stringify({ ...values, version: editing?.version }),
        headers: { "content-type": "application/json" },
        method: editing ? "PATCH" : "POST",
      },
    );
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "承認経路を保存できませんでした。");
      return;
    }
    setEditing(undefined);
    event.currentTarget.reset();
    setSuccess(editing ? "承認経路を更新しました。" : "承認経路を追加しました。");
    await load();
  }

  async function remove(route: Route) {
    const response = await fetch(`/api/approvals/routes/${route.id}?version=${route.version}`, {
      method: "DELETE",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "承認経路を削除できませんでした。");
      return;
    }
    setSuccess("承認経路を削除しました。既存の申請担当は変わりません。");
    await load();
  }

  return (
    <main className="settings-page feature-page approval-page">
      <PageHeader
        actions={
          <Button onClick={() => void load()} type="button" variant="secondary">
            一覧を更新
          </Button>
        }
        status={loaded ? `${routes.length}経路` : "読み込み中"}
        title="承認経路"
      >
        部署と申請種別ごとに、一人の主担当者と適用期間を設定します。
      </PageHeader>
      <TaskContext
        completion="期間が重ならないことを確認し、今後提出される申請の担当を保存します。"
        prerequisites={[
          "部署と承認担当者の利用者を先に登録してください。",
          "変更しても、すでに審査待ちの申請担当は自動では変わりません。",
        ]}
      />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section aria-labelledby="approval-route-form-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-route-form-heading">
              {editing ? "承認経路を編集" : "承認経路を追加"}
            </h2>
            <p>同じ部署・申請種別で期間が重なる経路は保存できません。</p>
          </div>
          {editing ? (
            <Button onClick={() => setEditing(undefined)} type="button" variant="text">
              編集をやめる
            </Button>
          ) : null}
        </div>
        <form key={editing?.id ?? "new"} className="approval-route-form" onSubmit={save}>
          <SelectField
            defaultValue={editing?.departmentId}
            id="departmentId"
            label="対象部署"
            name="departmentId"
            required
          >
            <option value="">選択してください</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            defaultValue={editing?.requestType}
            id="requestType"
            label="申請種別"
            name="requestType"
            required
          >
            <option value="">選択してください</option>
            {Object.entries(requestTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField
            defaultValue={editing?.approverUserId}
            description="有効な所有者・労務管理者・承認者から一人を選びます。"
            id="approverUserId"
            label="主担当者"
            name="approverUserId"
            required
          >
            <option value="">選択してください</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </SelectField>
          <Field
            defaultValue={editing?.effectiveFrom}
            id="effectiveFrom"
            label="適用開始日"
            name="effectiveFrom"
            required
            type="date"
          />
          <Field
            defaultValue={editing?.effectiveTo ?? ""}
            description="空欄なら終了日なしで適用します。"
            id="effectiveTo"
            label="適用終了日"
            name="effectiveTo"
            optional
            type="date"
          />
          <Field
            defaultValue={editing?.dueDays ?? ""}
            description="提出日時から何日後を対応期限とするか。"
            id="dueDays"
            label="対応期限"
            max={365}
            min={1}
            name="dueDays"
            optional
            type="number"
            unit="日"
          />
          <Button type="submit">{editing ? "変更を保存" : "経路を追加"}</Button>
        </form>
      </section>

      <section aria-labelledby="approval-route-list-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="approval-route-list-heading">現在の設定</h2>
            <p>適用開始日の古い順に表示します。削除前に既存申請への影響を確認してください。</p>
          </div>
        </div>
        {routes.length === 0 ? (
          <StatePanel kind="noRecords" title="承認経路がまだありません">
            <p>経路がない申請は、所有者・労務管理者の共通受信箱へ入ります。</p>
          </StatePanel>
        ) : (
          <Table label="承認経路一覧" responsive>
            <thead>
              <tr>
                <th>部署</th>
                <th>申請種別</th>
                <th>担当者</th>
                <th>適用期間</th>
                <th>期限</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id}>
                  <td data-label="部署">{route.departmentName}</td>
                  <td data-label="申請種別">{requestTypeLabels[route.requestType]}</td>
                  <td data-label="担当者">{route.approverDisplayName}</td>
                  <td data-label="適用期間">
                    {route.effectiveFrom} 〜 {route.effectiveTo ?? "終了日なし"}
                  </td>
                  <td data-label="期限">{route.dueDays ? `${route.dueDays}日` : "期限なし"}</td>
                  <td data-label="操作">
                    <div className="approval-inline-actions">
                      <Button onClick={() => setEditing(route)} type="button" variant="secondary">
                        編集
                      </Button>
                      <Button onClick={() => void remove(route)} type="button" variant="text">
                        削除
                      </Button>
                    </div>
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
