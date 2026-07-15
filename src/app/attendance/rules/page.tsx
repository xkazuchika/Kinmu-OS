"use client";

import { FormEvent, useState } from "react";
import { Button, EmptyState, Field, PageHeader, SelectField, Table, Toast } from "@/components/ui";

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
  async function load() {
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
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/work-rules", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "勤務ルールを作成できませんでした。");
      return;
    }
    event.currentTarget.reset();
    await load();
  }
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.displayName]));
  return (
    <main className="registry-page">
      <PageHeader title="勤務ルール">
        適用開始日付きの組織既定・従業員別ルールを管理します。
      </PageHeader>
      <Button onClick={() => void load()} type="button" variant="secondary">
        一覧を読み込む
      </Button>
      <Toast tone="error">{error}</Toast>
      <section className="registry-create">
        <h2>勤務ルールを追加</h2>
        <form onSubmit={create}>
          <Field id="rule-name" label="ルール名" name="name" required />
          <SelectField id="rule-employee" label="対象" name="employeeId">
            <option value="">組織既定</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
          </SelectField>
          <Field id="rule-start" label="所定開始" name="scheduledStartTime" required type="time" />
          <Field id="rule-end" label="所定終了" name="scheduledEndTime" required type="time" />
          <Field
            defaultValue="60"
            id="rule-break"
            label="所定休憩（分）"
            min="0"
            name="scheduledBreakMinutes"
            required
            type="number"
          />
          <Field
            defaultValue="480"
            id="rule-daily"
            label="1日の所定労働（分）"
            min="0"
            name="dailyStandardMinutes"
            required
            type="number"
          />
          <Field id="rule-effective" label="適用開始日" name="effectiveFrom" required type="date" />
          <Button type="submit">ルールを追加</Button>
        </form>
      </section>
      <section>
        <h2>適用予定</h2>
        {rules.length === 0 ? (
          <EmptyState title="勤務ルールがありません">
            組織既定の勤務ルールを追加してください。
          </EmptyState>
        ) : (
          <Table label="勤務ルール一覧">
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
                  <td>{rule.name}</td>
                  <td>
                    {rule.employeeId
                      ? (employeeNames.get(rule.employeeId) ?? "従業員別")
                      : "組織既定"}
                  </td>
                  <td>
                    {rule.scheduledStartTime}–{rule.scheduledEndTime}
                  </td>
                  <td>{rule.scheduledBreakMinutes}分</td>
                  <td>{rule.dailyStandardMinutes}分</td>
                  <td>{rule.effectiveFrom}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}
