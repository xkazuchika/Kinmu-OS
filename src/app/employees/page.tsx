"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import {
  Button,
  EmptyState,
  Field,
  FilterBar,
  PageHeader,
  SelectField,
  Table,
  Toast,
} from "@/components/ui";

type Department = { active: boolean; id: string; name: string };
type Employee = {
  departmentName: string;
  displayName: string;
  employeeNumber: string;
  employmentType: "contract" | "full_time" | "other" | "part_time";
  id: string;
  joinedOn: string;
  status: "active" | "on_leave" | "scheduled" | "terminated";
};

const employmentLabels = {
  contract: "契約社員",
  full_time: "正社員",
  other: "その他",
  part_time: "パート・アルバイト",
};
const statusLabels = {
  active: "在籍",
  on_leave: "休職",
  scheduled: "予定入社",
  terminated: "退職",
};

export default function EmployeesPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string>();

  async function loadDepartments() {
    const response = await fetch("/api/departments");
    const payload = (await response.json()) as { departments?: Department[]; error?: string };
    if (!response.ok || !payload.departments) {
      setError(payload.error ?? "部署一覧を取得できませんでした。");
      return;
    }
    setDepartments(payload.departments.filter((department) => department.active));
  }

  async function loadEmployees(parameters = new URLSearchParams()) {
    const response = await fetch(`/api/employees?${parameters}`);
    const payload = (await response.json()) as { employees?: Employee[]; error?: string };
    if (!response.ok || !payload.employees) {
      setError(payload.error ?? "従業員一覧を取得できませんでした。");
      return;
    }
    setError(undefined);
    setEmployees(payload.employees);
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/employees", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "従業員を作成できませんでした。");
      return;
    }
    event.currentTarget.reset();
    await loadEmployees();
  }

  function filterEmployees(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadEmployees(
      new URLSearchParams(
        Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
      ),
    );
  }

  return (
    <main className="registry-page">
      <PageHeader title="従業員">基本情報・雇用情報・主所属を管理します。</PageHeader>
      <div className="registry-actions">
        <Button
          onClick={() => {
            void loadDepartments();
            void loadEmployees();
          }}
          type="button"
          variant="secondary"
        >
          一覧を読み込む
        </Button>
        <Link href="/employees/departments">部署管理</Link>
        <Link href="/employees/import">CSV取込</Link>
      </div>
      <Toast tone="error">{error}</Toast>
      <section aria-labelledby="create-employee-heading" className="registry-create">
        <h2 id="create-employee-heading">従業員を追加</h2>
        {departments.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => void loadDepartments()} variant="secondary">
                部署を読み込む
              </Button>
            }
            title="有効な部署を読み込んでください"
          >
            従業員を登録する前に、主所属として使う部署が必要です。
          </EmptyState>
        ) : (
          <form onSubmit={createEmployee}>
            <Field id="employee-number" label="従業員番号" name="employeeNumber" required />
            <Field id="employee-family-name" label="姓" name="familyName" required />
            <Field id="employee-given-name" label="名" name="givenName" required />
            <Field id="employee-display-name" label="表示名" name="displayName" required />
            <Field id="employee-email" label="連絡用メール" name="contactEmail" type="email" />
            <SelectField id="employee-department" label="主所属" name="departmentId" required>
              <option value="">選択してください</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </SelectField>
            <Field id="employee-joined-on" label="入社日" name="joinedOn" required type="date" />
            <SelectField
              defaultValue="full_time"
              id="employee-type"
              label="雇用区分"
              name="employmentType"
            >
              <option value="full_time">正社員</option>
              <option value="part_time">パート・アルバイト</option>
              <option value="contract">契約社員</option>
              <option value="other">その他</option>
            </SelectField>
            <SelectField defaultValue="active" id="employee-status" label="在籍状態" name="status">
              <option value="scheduled">予定入社</option>
              <option value="active">在籍</option>
              <option value="on_leave">休職</option>
              <option value="terminated">退職</option>
            </SelectField>
            <Button type="submit">従業員を登録</Button>
          </form>
        )}
      </section>
      <section aria-labelledby="employee-list-heading">
        <h2 id="employee-list-heading">従業員一覧</h2>
        <form className="registry-filters" onSubmit={filterEmployees}>
          <FilterBar>
            <Field id="employee-query" label="氏名・従業員番号" name="query" type="search" />
            <SelectField id="employee-filter-department" label="部署" name="departmentId">
              <option value="">在籍者すべて</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </SelectField>
            <SelectField id="employee-filter-status" label="在籍状態" name="status">
              <option value="">すべて</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="all">退職者を含むすべて</option>
            </SelectField>
            <Button type="submit" variant="secondary">
              絞り込む
            </Button>
          </FilterBar>
        </form>
        {employees.length === 0 ? (
          <EmptyState title="従業員が表示されていません">
            一覧を読み込むか、条件を変えて検索してください。
          </EmptyState>
        ) : (
          <Table label="従業員一覧">
            <thead>
              <tr>
                <th>従業員番号</th>
                <th>表示名</th>
                <th>主所属</th>
                <th>雇用区分</th>
                <th>在籍状態</th>
                <th>入社日</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.employeeNumber}</td>
                  <td>
                    <Link href={`/employees/${employee.id}`}>{employee.displayName}</Link>
                  </td>
                  <td>{employee.departmentName}</td>
                  <td>{employmentLabels[employee.employmentType]}</td>
                  <td>{statusLabels[employee.status]}</td>
                  <td>{employee.joinedOn}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}
