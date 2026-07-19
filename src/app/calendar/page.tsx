"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Table,
  TextareaField,
  Toast,
} from "@/components/ui";

type Employee = { displayName: string; employeeNumber: string; id: string };
type Pattern = {
  effectiveFrom: string;
  fridayWorkday: boolean;
  id: string;
  mondayWorkday: boolean;
  saturdayWorkday: boolean;
  status: "active" | "draft" | "inactive";
  sundayWorkday: boolean;
  thursdayWorkday: boolean;
  tuesdayWorkday: boolean;
  wednesdayWorkday: boolean;
};
type CalendarException = {
  active: boolean;
  calendarDate: string;
  dayKind: "non_workday" | "workday";
  employeeId: string | null;
  id: string;
  name: string;
  reason: string;
};
type ImportPreview = {
  errors: Array<{ line: number; message: string }>;
  preview: Array<{
    action: "add" | "update";
    calendarDate: string;
    dayKind: "non_workday" | "workday";
    line: number;
    name: string;
    reason: string;
  }>;
  summary: { added: number; rejected: number; updated: number };
};

const week = [
  ["mondayWorkday", "月"],
  ["tuesdayWorkday", "火"],
  ["wednesdayWorkday", "水"],
  ["thursdayWorkday", "木"],
  ["fridayWorkday", "金"],
  ["saturdayWorkday", "土"],
  ["sundayWorkday", "日"],
] as const;

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function WorkCalendarPage() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [activation, setActivation] = useState<{
    effectiveFrom: string;
    employeeCount: number;
    pattern: Pattern;
  }>();
  const [csv, setCsv] = useState("date,kind,name,reason\n");
  const [csvFileName, setCsvFileName] = useState("company-holidays.csv");
  const [importPreview, setImportPreview] = useState<ImportPreview>();
  const [deactivationReasons, setDeactivationReasons] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [calendarResponse, employeeResponse] = await Promise.all([
      fetch("/api/calendar"),
      fetch("/api/employees?status=all"),
    ]);
    const calendarPayload = await json(calendarResponse);
    const employeePayload = await json(employeeResponse);
    if (!calendarResponse.ok) {
      setError(String(calendarPayload.error ?? "勤務カレンダーを取得できませんでした。"));
      return;
    }
    setPatterns((calendarPayload.patterns as Pattern[]) ?? []);
    setExceptions((calendarPayload.exceptions as CalendarException[]) ?? []);
    setEmployees((employeePayload.employees as Employee[]) ?? []);
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/calendar", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await json(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(payload.error ?? "勤務カレンダーを更新できませんでした。"));
      return undefined;
    }
    return payload;
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await post({
      action: "create_draft",
      effectiveFrom: data.get("effectiveFrom"),
      ...Object.fromEntries(week.map(([name]) => [name, data.get(name) === "on"])),
    });
    if (!payload) return;
    setSuccess("勤務カレンダーのドラフトを作成しました。");
    event.currentTarget.reset();
    await load();
  }

  async function previewActivation(pattern: Pattern) {
    const payload = await post({
      action: "preview_activation",
      effectiveFrom: pattern.effectiveFrom,
      patternId: pattern.id,
    });
    if (payload?.preview) setActivation(payload.preview as typeof activation);
  }

  async function activate() {
    if (!activation) return;
    const payload = await post({
      action: "activate",
      effectiveFrom: activation.effectiveFrom,
      patternId: activation.pattern.id,
    });
    if (!payload) return;
    setActivation(undefined);
    setSuccess(`${activation.effectiveFrom}から勤務カレンダーを有効化しました。`);
    await load();
  }

  async function saveException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = await post({
      action: "save_exception",
      calendarDate: data.get("calendarDate"),
      dayKind: data.get("dayKind"),
      employeeId: data.get("employeeId"),
      name: data.get("name"),
      reason: data.get("reason"),
    });
    if (!payload) return;
    setSuccess("日付例外を保存しました。");
    event.currentTarget.reset();
    await load();
  }

  async function deactivate(exceptionId: string) {
    const payload = await post({
      action: "deactivate_exception",
      exceptionId,
      reason: deactivationReasons[exceptionId] ?? "",
    });
    if (!payload) return;
    setSuccess("日付例外を無効化しました。");
    await load();
  }

  async function processCsv(mode: "commit" | "preview") {
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/calendar/import", {
      body: JSON.stringify({ csv, fileName: csvFileName, mode }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await json(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(payload.error ?? "会社休日CSVを処理できませんでした。"));
      setImportPreview(payload as unknown as ImportPreview);
      return;
    }
    if (mode === "preview") {
      setImportPreview(payload as unknown as ImportPreview);
      return;
    }
    setSuccess("会社休日CSVを取り込みました。");
    setImportPreview(undefined);
    await load();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader title="勤務カレンダー">
        曜日パターンと日付例外から、勤務日・休日を一貫して判定します。
      </PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section className="feature-section" aria-labelledby="calendar-pattern-heading">
        <div className="section-heading">
          <div>
            <h2 id="calendar-pattern-heading">曜日パターン</h2>
            <p>ドラフトを確認してから適用開始日以降へ有効化します。</p>
          </div>
        </div>
        <form className="feature-form" onSubmit={createDraft}>
          <Field
            id="calendar-effective-from"
            label="適用開始日"
            name="effectiveFrom"
            required
            type="date"
          />
          <fieldset className="weekday-selector">
            <legend>勤務曜日</legend>
            {week.map(([name, label], index) => (
              <label key={name}>
                <input defaultChecked={index < 5} name={name} type="checkbox" />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Button disabled={submitting} type="submit">
            ドラフトを作成
          </Button>
        </form>
        {patterns.length === 0 ? (
          <EmptyState title="曜日パターンがありません">
            最初の勤務曜日を登録してください。
          </EmptyState>
        ) : (
          <Table label="勤務カレンダーの曜日パターン">
            <thead>
              <tr>
                <th>適用開始日</th>
                <th>状態</th>
                <th>勤務曜日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((pattern) => (
                <tr key={pattern.id}>
                  <td>{pattern.effectiveFrom}</td>
                  <td>
                    {pattern.status === "active"
                      ? "有効"
                      : pattern.status === "draft"
                        ? "ドラフト"
                        : "無効"}
                  </td>
                  <td>
                    {week
                      .filter(([name]) => pattern[name])
                      .map(([, label]) => label)
                      .join("・")}
                  </td>
                  <td>
                    {pattern.status === "draft" ? (
                      <Button
                        disabled={submitting}
                        onClick={() => void previewActivation(pattern)}
                        type="button"
                        variant="secondary"
                      >
                        影響を確認
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="feature-section" aria-labelledby="calendar-exception-heading">
        <div>
          <h2 id="calendar-exception-heading">会社・従業員の日付例外</h2>
          <p>従業員別例外は会社例外より優先されます。変更理由を必ず残します。</p>
        </div>
        <form className="feature-form" onSubmit={saveException}>
          <Field id="exception-date" label="対象日" name="calendarDate" required type="date" />
          <SelectField id="exception-kind" label="日区分" name="dayKind" required>
            <option value="non_workday">休日</option>
            <option value="workday">臨時勤務日</option>
          </SelectField>
          <SelectField id="exception-employee" label="対象" name="employeeId">
            <option value="">会社全体</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeNumber} {employee.displayName}
              </option>
            ))}
          </SelectField>
          <Field id="exception-name" label="名称" name="name" required />
          <TextareaField id="exception-reason" label="理由" name="reason" required rows={2} />
          <Button disabled={submitting} type="submit">
            例外を保存
          </Button>
        </form>
        <Table label="日付例外">
          <thead>
            <tr>
              <th>日付</th>
              <th>対象</th>
              <th>区分</th>
              <th>名称・理由</th>
              <th>無効化</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((exception) => (
              <tr key={exception.id}>
                <td>{exception.calendarDate}</td>
                <td>
                  {exception.employeeId
                    ? (employees.find((employee) => employee.id === exception.employeeId)
                        ?.displayName ?? "従業員")
                    : "会社全体"}
                </td>
                <td>
                  {exception.dayKind === "workday" ? "勤務日" : "休日"}
                  {exception.active ? "" : "（無効）"}
                </td>
                <td>
                  <strong>{exception.name}</strong>
                  <br />
                  <small>{exception.reason}</small>
                </td>
                <td>
                  {exception.active ? (
                    <div className="inline-action">
                      <label className="sr-only" htmlFor={`deactivate-${exception.id}`}>
                        無効化理由
                      </label>
                      <input
                        id={`deactivate-${exception.id}`}
                        onChange={(event) =>
                          setDeactivationReasons((current) => ({
                            ...current,
                            [exception.id]: event.target.value,
                          }))
                        }
                        placeholder="無効化理由"
                        value={deactivationReasons[exception.id] ?? ""}
                      />
                      <Button
                        disabled={submitting || !(deactivationReasons[exception.id] ?? "").trim()}
                        onClick={() => void deactivate(exception.id)}
                        type="button"
                        variant="danger"
                      >
                        無効化
                      </Button>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="feature-section" aria-labelledby="calendar-csv-heading">
        <div>
          <h2 id="calendar-csv-heading">会社休日CSV</h2>
          <p>ヘッダーは date,kind,name,reason。検証結果を確認してから一括反映します。</p>
        </div>
        <label className="ui-field" htmlFor="calendar-csv-file">
          <span>UTF-8 CSVファイル</span>
          <input
            accept=".csv,text/csv"
            id="calendar-csv-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setCsvFileName(file.name);
              void file.text().then(setCsv);
            }}
            type="file"
          />
        </label>
        <TextareaField
          id="calendar-csv"
          label="CSV内容"
          onChange={(event) => setCsv(event.target.value)}
          rows={7}
          value={csv}
        />
        <div className="form-actions">
          <Button
            disabled={submitting}
            onClick={() => void processCsv("preview")}
            type="button"
            variant="secondary"
          >
            検証する
          </Button>
          <Button
            disabled={submitting || !importPreview || importPreview.errors.length > 0}
            onClick={() => void processCsv("commit")}
            type="button"
          >
            確定して取り込む
          </Button>
        </div>
        {importPreview ? (
          <div aria-live="polite" className="import-preview">
            <strong>
              追加 {importPreview.summary?.added ?? 0}件・変更 {importPreview.summary?.updated ?? 0}
              件・拒否 {importPreview.summary?.rejected ?? importPreview.errors?.length ?? 0}件
            </strong>
            {importPreview.errors?.length ? (
              <ul className="import-errors">
                {importPreview.errors.map((item) => (
                  <li key={`${item.line}-${item.message}`}>
                    {item.line}行目: {item.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>検証に成功しました。内容を確認して取り込めます。</p>
            )}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="この内容で有効化"
        onCancel={() => setActivation(undefined)}
        onConfirm={() => void activate()}
        open={Boolean(activation)}
        title="勤務カレンダーを有効化しますか？"
      >
        <p>
          {activation?.effectiveFrom}から在籍従業員{activation?.employeeCount}
          名へ適用します。過去へは遡りません。
        </p>
      </ConfirmDialog>
    </main>
  );
}
