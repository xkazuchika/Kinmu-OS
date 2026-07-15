"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button, Field, PageHeader, SelectField, Table, Toast } from "@/components/ui";

type Department = { id: string; name: string };
type EmployeeState = "active" | "on_leave" | "scheduled" | "terminated";

export type EditableEmployee = {
  contactEmail: string | null;
  displayName: string;
  employeeNumber: string;
  employmentType: "contract" | "full_time" | "other" | "part_time";
  familyName: string;
  givenName: string;
  phoneNumber: string | null;
  primaryDepartment?: { departmentId: string; departmentName: string; startedOn: string };
  status: EmployeeState;
  statusHistory: Array<{
    effectiveOn: string;
    id: string;
    reason: string | null;
    status: EmployeeState;
  }>;
  userId: string | null;
};

const statusLabels = {
  active: "在籍",
  on_leave: "休職",
  scheduled: "予定入社",
  terminated: "退職",
};

export function EmployeeEditor({
  departments,
  employee,
  employeeId,
  employeeUsers,
}: {
  departments: Department[];
  employee: EditableEmployee;
  employeeId: string;
  employeeUsers: Array<{ displayName: string; email: string; id: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/employees/${employeeId}`, {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "従業員を更新できませんでした。");
      return;
    }

    setError(undefined);
    router.refresh();
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/employees/${employeeId}/status`, {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "在籍状態を変更できませんでした。");
      return;
    }

    setError(undefined);
    router.refresh();
  }

  return (
    <main className="registry-page">
      <PageHeader title={employee.displayName}>従業員番号 {employee.employeeNumber}</PageHeader>
      <Link href="/employees">従業員一覧へ戻る</Link>
      <Toast tone="error">{error}</Toast>
      <section className="registry-create" aria-labelledby="employee-edit-heading">
        <h2 id="employee-edit-heading">基本・雇用情報</h2>
        <form onSubmit={save}>
          <Field
            defaultValue={employee.familyName}
            id="detail-family-name"
            label="姓"
            name="familyName"
            required
          />
          <Field
            defaultValue={employee.givenName}
            id="detail-given-name"
            label="名"
            name="givenName"
            required
          />
          <Field
            defaultValue={employee.displayName}
            id="detail-display-name"
            label="表示名"
            name="displayName"
            required
          />
          <Field
            defaultValue={employee.contactEmail ?? ""}
            id="detail-email"
            label="連絡用メール"
            name="contactEmail"
            type="email"
          />
          <Field
            defaultValue={employee.phoneNumber ?? ""}
            id="detail-phone"
            label="電話番号"
            name="phoneNumber"
            type="tel"
          />
          <SelectField
            defaultValue={employee.employmentType}
            id="detail-employment-type"
            label="雇用区分"
            name="employmentType"
          >
            <option value="full_time">正社員</option>
            <option value="part_time">パート・アルバイト</option>
            <option value="contract">契約社員</option>
            <option value="other">その他</option>
          </SelectField>
          <SelectField
            defaultValue={employee.userId ?? ""}
            id="detail-user"
            label="ログイン利用者"
            name="userId"
          >
            <option value="">紐付けなし</option>
            {employeeUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}（{user.email}）
              </option>
            ))}
          </SelectField>
          <SelectField
            defaultValue={employee.primaryDepartment?.departmentId}
            id="detail-department"
            label="主所属"
            name="departmentId"
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </SelectField>
          <Field
            id="detail-department-date"
            label="所属変更の適用日（変更時のみ）"
            name="departmentEffectiveOn"
            type="date"
          />
          <Button type="submit">変更を保存</Button>
        </form>
      </section>
      <section className="registry-create" aria-labelledby="employee-status-heading">
        <h2 id="employee-status-heading">在籍状態を変更</h2>
        {employee.status === "terminated" ? (
          <p>退職済みです。過去の在籍・勤怠記録は保持されます。</p>
        ) : (
          <form onSubmit={changeStatus}>
            <SelectField id="next-employee-status" label="変更後の状態" name="status">
              {employee.status !== "active" ? <option value="active">在籍</option> : null}
              {employee.status === "active" ? <option value="on_leave">休職</option> : null}
              <option value="terminated">退職</option>
            </SelectField>
            <Field
              id="employee-status-date"
              label="適用日"
              name="effectiveOn"
              required
              type="date"
            />
            <Field id="employee-status-reason" label="変更理由" name="reason" required />
            <Button type="submit" variant="secondary">
              状態を変更
            </Button>
          </form>
        )}
      </section>
      <section aria-labelledby="status-history-heading">
        <h2 id="status-history-heading">在籍履歴</h2>
        <Table label="在籍履歴">
          <thead>
            <tr>
              <th>適用日</th>
              <th>状態</th>
              <th>理由</th>
            </tr>
          </thead>
          <tbody>
            {employee.statusHistory.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.effectiveOn}</td>
                <td>{statusLabels[entry.status]}</td>
                <td>{entry.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </main>
  );
}
