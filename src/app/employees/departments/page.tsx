"use client";

import { FormEvent, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Table,
  Toast,
} from "@/components/ui";

type Department = { active: boolean; code: string; id: string; name: string };

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { code: string; name: string }>>({});
  const [error, setError] = useState<string>();
  const [pendingDepartment, setPendingDepartment] = useState<Department>();

  async function loadDepartments() {
    const response = await fetch("/api/departments");
    const payload = (await response.json()) as { departments?: Department[]; error?: string };

    if (!response.ok || !payload.departments) {
      setError(payload.error ?? "部署一覧を取得できませんでした。");
      return;
    }

    setError(undefined);
    setDepartments(payload.departments);
    setDrafts(
      Object.fromEntries(
        payload.departments.map((department) => [
          department.id,
          { code: department.code, name: department.name },
        ]),
      ),
    );
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/departments", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "部署を作成できませんでした。");
      return;
    }

    event.currentTarget.reset();
    await loadDepartments();
  }

  async function updateDepartment(departmentId: string, values: Record<string, unknown>) {
    const response = await fetch(`/api/departments/${departmentId}`, {
      body: JSON.stringify(values),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "部署を更新できませんでした。");
      return;
    }

    await loadDepartments();
  }

  return (
    <main className="settings-page">
      <PageHeader title="部署管理">
        従業員の主所属として利用する部署・チームを管理します。
      </PageHeader>
      <section aria-labelledby="create-department-heading">
        <h2 id="create-department-heading">部署を追加</h2>
        <form onSubmit={createDepartment}>
          <Field id="department-code" label="部署コード" name="code" required />
          <Field id="department-name" label="部署名" name="name" required />
          <Button type="submit">部署を追加</Button>
        </form>
      </section>
      <section aria-labelledby="departments-heading">
        <div className="section-heading">
          <h2 id="departments-heading">部署一覧</h2>
          <Button onClick={() => void loadDepartments()} type="button" variant="secondary">
            一覧を更新
          </Button>
        </div>
        <Toast tone="error">{error}</Toast>
        {departments.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => void loadDepartments()} variant="secondary">
                部署を読み込む
              </Button>
            }
            title="部署が表示されていません"
          >
            一覧を読み込むか、上のフォームから部署を追加してください。
          </EmptyState>
        ) : (
          <Table label="部署一覧">
            <thead>
              <tr>
                <th>コード</th>
                <th>部署名</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id}>
                  <td>
                    <input
                      aria-label={`${department.name}の部署コード`}
                      disabled={!department.active}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [department.id]: {
                            code: event.target.value,
                            name: current[department.id]?.name ?? department.name,
                          },
                        }))
                      }
                      value={drafts[department.id]?.code ?? department.code}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${department.code}の部署名`}
                      disabled={!department.active}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [department.id]: {
                            code: current[department.id]?.code ?? department.code,
                            name: event.target.value,
                          },
                        }))
                      }
                      value={drafts[department.id]?.name ?? department.name}
                    />
                  </td>
                  <td>{department.active ? "有効" : "無効"}</td>
                  <td>
                    {department.active ? (
                      <Button
                        onClick={() =>
                          void updateDepartment(
                            department.id,
                            drafts[department.id] ?? {
                              code: department.code,
                              name: department.name,
                            },
                          )
                        }
                        type="button"
                        variant="text"
                      >
                        保存
                      </Button>
                    ) : null}
                    <Button
                      onClick={() =>
                        department.active
                          ? setPendingDepartment(department)
                          : void updateDepartment(department.id, { active: true })
                      }
                      type="button"
                      variant="secondary"
                    >
                      {department.active ? "無効化" : "再有効化"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <ConfirmDialog
        confirmLabel="無効化"
        onCancel={() => setPendingDepartment(undefined)}
        onConfirm={() => {
          if (pendingDepartment) void updateDepartment(pendingDepartment.id, { active: false });
          setPendingDepartment(undefined);
        }}
        open={Boolean(pendingDepartment)}
        title="部署を無効化"
      >
        {pendingDepartment?.name ?? "この部署"}
        を新しい主所属として選択できなくなります。既存の所属履歴は保持されます。
      </ConfirmDialog>
    </main>
  );
}
