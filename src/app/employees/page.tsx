"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { useUnsavedChanges } from "@/components/form-state";
import {
  AsyncButton,
  Button,
  Field,
  FilterBar,
  ListHeader,
  PageHeader,
  ResultSummary,
  SelectField,
  StatePanel,
  Table,
  TaskContext,
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
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  useUnsavedChanges(dirty);

  const loadDepartments = useCallback(async () => {
    const response = await fetch("/api/departments");
    const payload = (await response.json()) as { departments?: Department[]; error?: string };
    if (!response.ok || !payload.departments) {
      setError(payload.error ?? "部署一覧を取得できませんでした。");
      return;
    }
    setDepartments(payload.departments.filter((department) => department.active));
  }, []);

  const loadEmployees = useCallback(async (parameters = new URLSearchParams()) => {
    const response = await fetch(`/api/employees?${parameters}`);
    const payload = (await response.json()) as { employees?: Employee[]; error?: string };
    if (!response.ok || !payload.employees) {
      setError(payload.error ?? "従業員一覧を取得できませんでした。");
      setLoaded(true);
      return;
    }
    setError(undefined);
    setEmployees(payload.employees);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadDepartments(), loadEmployees()]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDepartments, loadEmployees]);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSuccess(undefined);
    const response = await fetch("/api/employees", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "従業員を作成できませんでした。");
      return;
    }
    event.currentTarget.reset();
    setDirty(false);
    setSuccess("従業員を登録しました。次に利用者を紐付けると本人がログインできます。");
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
      <PageHeader
        actions={
          <Link className="ui-button ui-button--primary" href="/employees/import">
            CSVでまとめて登録
          </Link>
        }
        status={loaded ? `${employees.length}名を表示` : "読み込み中"}
        title="従業員"
      >
        在籍する人の基本情報・雇用情報・主所属を登録し、台帳として管理します。
      </PageHeader>
      <TaskContext
        completion="従業員を登録し、必要に応じてログイン利用者と勤務ルールを設定します。"
        prerequisites={["主所属として使う部署を先に登録してください。"]}
      />
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
      {success ? (
        <ResultSummary
          action={<Link href="/settings/users">利用者を設定</Link>}
          title="従業員を登録しました"
        >
          {success}
        </ResultSummary>
      ) : null}
      <section aria-labelledby="create-employee-heading" className="registry-create">
        <h2 id="create-employee-heading">従業員を追加</h2>
        {departments.length === 0 ? (
          <StatePanel
            action={
              <Button onClick={() => void loadDepartments()} variant="secondary">
                部署を読み込む
              </Button>
            }
            kind="notConfigured"
            title="有効な部署を読み込んでください"
          >
            <p>従業員を登録する前に、主所属として使う部署が必要です。</p>
          </StatePanel>
        ) : (
          <form onChange={() => setDirty(true)} onSubmit={createEmployee}>
            <Field
              constraint="組織内で重複しない番号を入力してください。"
              example="A001"
              fieldSize="short"
              id="employee-number"
              label="従業員番号"
              name="employeeNumber"
              required
            />
            <Field
              fieldSize="medium"
              id="employee-family-name"
              label="姓"
              name="familyName"
              required
            />
            <Field
              fieldSize="medium"
              id="employee-given-name"
              label="名"
              name="givenName"
              required
            />
            <Field
              description="一覧や申請画面に表示する氏名です。"
              example="山田 太郎"
              fieldSize="medium"
              id="employee-display-name"
              label="表示名"
              name="displayName"
              required
            />
            <Field
              fieldSize="long"
              id="employee-email"
              label="連絡用メール"
              name="contactEmail"
              optional
              type="email"
            />
            <SelectField
              fieldSize="long"
              id="employee-department"
              label="主所属"
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
            <Field
              fieldSize="medium"
              id="employee-joined-on"
              label="入社日"
              name="joinedOn"
              required
              type="date"
            />
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
            <AsyncButton pending={submitting} pendingLabel="従業員を登録しています" type="submit">
              従業員を登録
            </AsyncButton>
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
        <ListHeader filteredCount={employees.length} totalCount={employees.length} />
        {employees.length === 0 ? (
          <StatePanel
            kind={loaded ? "noSearchResults" : "noRecords"}
            title={loaded ? "条件に一致する従業員はいません" : "従業員を読み込んでいます"}
          >
            <p>
              {loaded
                ? "条件を変えて検索するか、上のフォームから従業員を登録してください。"
                : "在籍状況と所属を確認しています。"}
            </p>
          </StatePanel>
        ) : (
          <Table label="従業員一覧" responsive>
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
                  <td data-label="従業員番号">{employee.employeeNumber}</td>
                  <td data-label="表示名">
                    <Link href={`/employees/${employee.id}`}>{employee.displayName}</Link>
                  </td>
                  <td data-label="主所属">{employee.departmentName}</td>
                  <td data-label="雇用区分">{employmentLabels[employee.employmentType]}</td>
                  <td data-label="在籍状態">{statusLabels[employee.status]}</td>
                  <td data-label="入社日">{employee.joinedOn}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}
