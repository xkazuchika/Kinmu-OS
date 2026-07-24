"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { useUnsavedChanges } from "@/components/form-state";
import {
  AsyncButton,
  Button,
  Field,
  FormErrorSummary,
  PageHeader,
  ResultSummary,
  SelectField,
  StatePanel,
  Table,
  TaskContext,
  Toast,
} from "@/components/ui";
import { formErrorFromResponse, type FormErrorPresentation } from "@/lib/form-errors";

type Employee = { displayName: string; id: string };
type Rule = {
  dailyStandardMinutes: number;
  effectiveFrom: string;
  employeeId?: string;
  id: string;
  name: string;
  scheduledBreakMinutes: number;
  scheduledEndTime: string;
  scheduledStartTime: string;
};

export default function WorkRulesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [submitError, setSubmitError] = useState<FormErrorPresentation>();
  useUnsavedChanges(dirty);

  const load = useCallback(async () => {
    const [ruleResponse, employeeResponse] = await Promise.all([
      fetch("/api/work-rules"),
      fetch("/api/employees?status=all"),
    ]);
    const rulePayload = (await ruleResponse.json()) as { error?: string; rules?: Rule[] };
    const employeePayload = (await employeeResponse.json()) as { employees?: Employee[] };
    if (!ruleResponse.ok) {
      setError(rulePayload.error ?? "勤務ルールを取得できませんでした。");
      return;
    }
    setRules(rulePayload.rules ?? []);
    setEmployees(employeePayload.employees ?? []);
    setError(undefined);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSuccess(undefined);
    setSubmitError(undefined);
    const response = await fetch("/api/work-rules", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; fieldErrors?: unknown };
    setSubmitting(false);
    if (!response.ok) {
      setSubmitError(formErrorFromResponse(response.status, payload));
      return;
    }
    event.currentTarget.reset();
    setDirty(false);
    setSuccess("勤務ルールを追加しました。適用開始日以降の勤務予定に反映されます。");
    await load();
  }
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.displayName]));
  return (
    <main className="registry-page">
      <PageHeader
        actions={
          <Button onClick={() => void load()} type="button" variant="secondary">
            一覧を再読み込み
          </Button>
        }
        status={rules.length > 0 ? `${rules.length}件設定済み` : "未設定"}
        title="勤務ルール"
      >
        適用開始日付きの組織既定・従業員別ルールを管理します。
      </PageHeader>
      <TaskContext
        completion="対象と適用開始日を確認し、勤務ルールを保存します。"
        prerequisites={["従業員別ルールを使う場合は、先に従業員を登録してください。"]}
      />
      <Toast tone="error">{error}</Toast>
      {submitError ? (
        <>
          <FormErrorSummary errors={submitError.fieldErrors} title={submitError.message} />
          {submitError.fieldErrors.length === 0 ? (
            <StatePanel kind="error" title={submitError.message}>
              <p>{submitError.retry}</p>
            </StatePanel>
          ) : (
            <p className="ui-disabled-reason">{submitError.retry}</p>
          )}
        </>
      ) : null}
      {success ? (
        <ResultSummary
          action={<Link href="/attendance">勤怠一覧で確認</Link>}
          title="勤務ルールを保存しました"
        >
          {success}
        </ResultSummary>
      ) : null}
      <section className="registry-create work-rule-create">
        <h2>勤務ルールを追加</h2>
        <div className="work-rule-editor">
          <form className="work-rule-form" onChange={() => setDirty(true)} onSubmit={create}>
            <div className="work-rule-form__full">
              <Field
                description="一覧で識別しやすい名前を入力します。"
                example="正社員・標準勤務"
                fieldSize="long"
                id="rule-name"
                label="ルール名"
                name="name"
                required
              />
            </div>
            <div className="work-rule-form__full">
              <SelectField
                description="組織既定は、従業員別ルールがない人に適用されます。"
                fieldSize="long"
                id="rule-employee"
                label="適用対象"
                name="employeeId"
                optional
              >
                <option value="">組織既定</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.displayName}
                  </option>
                ))}
              </SelectField>
            </div>
            <Field
              fieldSize="short"
              id="rule-start"
              label="所定開始"
              name="scheduledStartTime"
              required
              type="time"
            />
            <Field
              fieldSize="short"
              id="rule-end"
              label="所定終了"
              name="scheduledEndTime"
              required
              type="time"
            />
            <Field
              constraint="0分以上で入力してください。"
              defaultValue="60"
              fieldSize="short"
              id="rule-break"
              label="所定休憩"
              min="0"
              name="scheduledBreakMinutes"
              required
              type="number"
              unit="分"
            />
            <Field
              constraint="休憩を除いた1日の基準時間です。"
              defaultValue="480"
              fieldSize="short"
              id="rule-daily"
              label="1日の所定労働"
              min="0"
              name="dailyStandardMinutes"
              required
              type="number"
              unit="分"
            />
            <div className="work-rule-form__full">
              <Field
                description="この日以降の勤務予定と勤怠集計に反映されます。"
                fieldSize="medium"
                id="rule-effective"
                impact="過去日を指定すると、対象期間の再確認が必要になる場合があります。"
                label="適用開始日"
                name="effectiveFrom"
                required
                type="date"
              />
            </div>
            <AsyncButton
              pending={submitting}
              pendingLabel="勤務ルールを保存しています"
              type="submit"
            >
              勤務ルールを保存
            </AsyncButton>
          </form>
          <aside aria-labelledby="work-rule-impact-heading" className="work-rule-impact">
            <h3 id="work-rule-impact-heading">保存すると変わること</h3>
            <div>
              <h4>変わること</h4>
              <p>適用開始日以降の勤務予定と勤怠集計に、このルールが反映されます。</p>
            </div>
            <div>
              <h4>変わらないこと</h4>
              <p>適用開始日より前の勤務予定と、確定済みの勤怠実績は変更されません。</p>
            </div>
            <Link href="/guide/admin-setup">勤務ルール設定の使い方</Link>
          </aside>
        </div>
      </section>
      <section>
        <h2>適用予定</h2>
        {rules.length === 0 ? (
          <StatePanel kind="notConfigured" title="勤務ルールがありません">
            <p>上のフォームで、まず組織既定の勤務ルールを追加してください。</p>
          </StatePanel>
        ) : (
          <Table label="勤務ルール一覧" responsive>
            <thead>
              <tr>
                <th>ルール名</th>
                <th>対象</th>
                <th>時間帯</th>
                <th>休憩</th>
                <th>所定</th>
                <th>適用開始</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td data-label="ルール名">{rule.name}</td>
                  <td data-label="対象">
                    {rule.employeeId
                      ? (employeeNames.get(rule.employeeId) ?? "従業員別")
                      : "組織既定"}
                  </td>
                  <td data-label="時間帯">
                    {rule.scheduledStartTime}–{rule.scheduledEndTime}
                  </td>
                  <td data-label="休憩">{rule.scheduledBreakMinutes}分</td>
                  <td data-label="所定">{rule.dailyStandardMinutes}分</td>
                  <td data-label="適用開始">{rule.effectiveFrom}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}
