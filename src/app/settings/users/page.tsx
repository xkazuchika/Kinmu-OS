"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useUnsavedChanges } from "@/components/form-state";
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Field,
  PageHeader,
  ResultSummary,
  SelectField,
  StatePanel,
  Table,
  TaskContext,
  Toast,
} from "@/components/ui";

type User = {
  displayName: string;
  email: string;
  id: string;
  role: "owner" | "hr_admin" | "approver" | "employee";
  status: "active" | "disabled" | "pending_setup";
};

const roleLabel: Record<User["role"], string> = {
  approver: "承認者",
  employee: "従業員",
  hr_admin: "労務管理者",
  owner: "所有者",
};

export default function UsersSettingsPage() {
  const [error, setError] = useState<string>();
  const [pendingAction, setPendingAction] = useState<{
    displayName: string;
    enabled: boolean;
    userId: string;
  }>();
  const [setupUrl, setSetupUrl] = useState<string>();
  const [users, setUsers] = useState<User[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useUnsavedChanges(dirty);

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users");
    const payload = (await response.json()) as { error?: string; users?: User[] };

    if (!response.ok || !payload.users) {
      setError(payload.error ?? "利用者一覧を取得できませんでした。");
      setLoaded(true);
      return;
    }

    setUsers(payload.users);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSetupUrl(undefined);
    setSubmitting(true);

    const response = await fetch("/api/users", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; setupUrl?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "利用者を作成できませんでした。");
      return;
    }

    event.currentTarget.reset();
    setDirty(false);
    setSetupUrl(payload.setupUrl);
    await loadUsers();
  }

  async function updateUser(userId: string, values: Record<string, unknown>) {
    const response = await fetch(`/api/users/${userId}`, {
      body: JSON.stringify(values),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "利用者を更新できませんでした。");
      return;
    }

    await loadUsers();
  }

  return (
    <main className="settings-page">
      <PageHeader
        actions={
          <Button onClick={() => void loadUsers()} type="button" variant="secondary">
            一覧を更新
          </Button>
        }
        status={loaded ? `${users.length}名` : "読み込み中"}
        title="利用者管理"
      >
        ログインできる人、役割、従業員台帳との紐付け前提を管理します。
      </PageHeader>
      <TaskContext
        completion="設定リンクを本人へ渡し、有効な利用者と正しい役割を確認します。"
        prerequisites={["従業員本人には、従業員台帳側で利用者を紐付けてください。"]}
      />

      <section aria-labelledby="create-user-heading">
        <h2 id="create-user-heading">利用者を追加</h2>
        <form onChange={() => setDirty(true)} onSubmit={createUser}>
          <Field fieldSize="medium" id="displayName" label="氏名" name="displayName" required />
          <Field
            description="設定リンクを渡す本人のメールアドレスです。"
            fieldSize="long"
            id="email"
            label="メールアドレス"
            name="email"
            required
            type="email"
          />
          <SelectField
            defaultValue="employee"
            description="承認者は割り当てられた申請だけを審査できます。所有者・労務管理者は管理機能へアクセスできます。"
            id="role"
            label="役割"
            name="role"
          >
            <option value="employee">従業員</option>
            <option value="approver">承認者</option>
            <option value="hr_admin">労務管理者</option>
            <option value="owner">所有者</option>
          </SelectField>
          <AsyncButton pending={submitting} pendingLabel="設定リンクを発行しています" type="submit">
            設定リンクを発行
          </AsyncButton>
        </form>
        {setupUrl ? (
          <ResultSummary title="設定リンクを発行しました">
            <p>本人へ安全な経路で渡してください。この画面を離れる前に控えます。</p>
            <a href={setupUrl}>{setupUrl}</a>
          </ResultSummary>
        ) : null}
      </section>

      <section aria-labelledby="users-heading">
        <div className="section-heading">
          <h2 id="users-heading">利用者一覧</h2>
        </div>
        <Toast tone="error">{error}</Toast>
        {users.length === 0 ? (
          <StatePanel
            action={
              <Button onClick={() => void loadUsers()} type="button" variant="secondary">
                利用者を読み込む
              </Button>
            }
            kind="noRecords"
            title={loaded ? "利用者が登録されていません" : "利用者を読み込んでいます"}
          >
            <p>
              {loaded
                ? "上のフォームから最初の利用者を追加してください。"
                : "役割と状態を確認しています。"}
            </p>
          </StatePanel>
        ) : (
          <Table label="利用者一覧" responsive>
            <thead>
              <tr>
                <th>氏名</th>
                <th>メールアドレス</th>
                <th>役割</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td data-label="氏名">{user.displayName}</td>
                  <td data-label="メールアドレス">{user.email}</td>
                  <td data-label="役割">
                    <select
                      aria-label={`${user.displayName}の役割`}
                      onChange={(event) => void updateUser(user.id, { role: event.target.value })}
                      value={user.role}
                    >
                      {Object.entries(roleLabel).map(([role, label]) => (
                        <option key={role} value={role}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="状態">
                    {user.status === "active"
                      ? "有効"
                      : user.status === "disabled"
                        ? "無効"
                        : "設定待ち"}
                  </td>
                  <td data-label="操作">
                    <Button
                      onClick={() => {
                        const enabling = user.status === "disabled";
                        setPendingAction({
                          displayName: user.displayName,
                          enabled: enabling,
                          userId: user.id,
                        });
                      }}
                      type="button"
                      variant="secondary"
                    >
                      {user.status === "disabled" ? "再有効化" : "無効化"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <ConfirmDialog
        confirmLabel={pendingAction?.enabled ? "再有効化" : "無効化"}
        onCancel={() => setPendingAction(undefined)}
        onConfirm={() => {
          if (pendingAction) {
            void updateUser(pendingAction.userId, { enabled: pendingAction.enabled });
          }
          setPendingAction(undefined);
        }}
        open={Boolean(pendingAction)}
        title={pendingAction?.enabled ? "利用者を再有効化" : "利用者を無効化"}
      >
        {pendingAction?.enabled
          ? `${pendingAction.displayName}が再びログインできるようになります。`
          : `${pendingAction?.displayName ?? "この利用者"}は直ちにログインできなくなります。過去の記録は保持されます。`}
      </ConfirmDialog>
    </main>
  );
}
