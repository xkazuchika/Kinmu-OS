"use client";

import { FormEvent, useState } from "react";

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

type User = {
  displayName: string;
  email: string;
  id: string;
  role: "owner" | "hr_admin" | "employee";
  status: "active" | "disabled" | "pending_setup";
};

const roleLabel: Record<User["role"], string> = {
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

  async function loadUsers() {
    const response = await fetch("/api/users");
    const payload = (await response.json()) as { error?: string; users?: User[] };

    if (!response.ok || !payload.users) {
      setError(payload.error ?? "利用者一覧を取得できませんでした。");
      return;
    }

    setUsers(payload.users);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSetupUrl(undefined);

    const response = await fetch("/api/users", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; setupUrl?: string };

    if (!response.ok) {
      setError(payload.error ?? "利用者を作成できませんでした。");
      return;
    }

    event.currentTarget.reset();
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
      <PageHeader title="利用者管理">ログインできる利用者と役割を管理します。</PageHeader>

      <section aria-labelledby="create-user-heading">
        <h2 id="create-user-heading">利用者を追加</h2>
        <form onSubmit={createUser}>
          <Field id="displayName" label="氏名" name="displayName" required />
          <Field id="email" label="メールアドレス" name="email" required type="email" />
          <SelectField defaultValue="employee" id="role" label="役割" name="role">
            <option value="employee">従業員</option>
            <option value="hr_admin">労務管理者</option>
            <option value="owner">所有者</option>
          </SelectField>
          <Button type="submit">設定リンクを発行</Button>
        </form>
        {setupUrl ? (
          <Toast tone="success">
            発行した設定リンク: <a href={setupUrl}>{setupUrl}</a>
          </Toast>
        ) : null}
      </section>

      <section aria-labelledby="users-heading">
        <div className="section-heading">
          <h2 id="users-heading">利用者一覧</h2>
          <Button onClick={() => void loadUsers()} type="button" variant="secondary">
            一覧を更新
          </Button>
        </div>
        <Toast tone="error">{error}</Toast>
        {users.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => void loadUsers()} type="button" variant="secondary">
                利用者を読み込む
              </Button>
            }
            title="利用者が表示されていません"
          >
            一覧を読み込むか、上のフォームから最初の利用者を追加してください。
          </EmptyState>
        ) : (
          <Table label="利用者一覧">
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
                  <td>{user.displayName}</td>
                  <td>{user.email}</td>
                  <td>
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
                  <td>
                    {user.status === "active"
                      ? "有効"
                      : user.status === "disabled"
                        ? "無効"
                        : "設定待ち"}
                  </td>
                  <td>
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
