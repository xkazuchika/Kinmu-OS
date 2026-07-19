"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterBar,
  PageHeader,
  SelectField,
  Table,
  TextareaField,
  Toast,
} from "@/components/ui";

type LeaveType = {
  active: boolean;
  code: string;
  consumesBalance: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  id: string;
  name: string;
  paid: boolean;
  requestable: boolean;
};
type Employee = { displayName: string; employeeNumber: string; id: string };
type LedgerRow = {
  departmentName: string | null;
  effectiveOn: string;
  employeeId: string;
  employeeNumber: string;
  kind: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  reason: string;
  units: number;
};
type Balance = {
  availableUnits: number;
  leaveType: LeaveType;
  ledgerUnits: number;
  nextExpiry: string | null;
  pendingUnits: number;
  version: number;
};
type CsvPreview = {
  errors: Array<{ line: number; message: string }>;
  preview: Array<Record<string, unknown>>;
  summary: { employeeCount: number; rowCount: number; totalUnits: number };
};

const today = () => new Date().toISOString().slice(0, 10);
const days = (units: number) => `${units / 2}日`;

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function LeaveManagementPage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [transactions, setTransactions] = useState<LedgerRow[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [deactivating, setDeactivating] = useState<LeaveType>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [csv, setCsv] = useState("employeeNumber,leaveTypeCode,units,grantedOn,expiresOn,reason\n");
  const [csvFileName, setCsvFileName] = useState("leave-grants.csv");
  const [csvPreview, setCsvPreview] = useState<CsvPreview>();

  const load = useCallback(async () => {
    const [typeResponse, employeeResponse, ledgerResponse] = await Promise.all([
      fetch("/api/leave/types"),
      fetch("/api/employees?status=all"),
      fetch("/api/leave/ledger"),
    ]);
    const [typePayload, employeePayload, ledgerPayload] = await Promise.all([
      payload(typeResponse),
      payload(employeeResponse),
      payload(ledgerResponse),
    ]);
    if (!typeResponse.ok || !ledgerResponse.ok) {
      setError(
        String(typePayload.error ?? ledgerPayload.error ?? "休暇管理情報を取得できませんでした。"),
      );
      return;
    }
    setLeaveTypes((typePayload.leaveTypes as LeaveType[]) ?? []);
    setEmployees((employeePayload.employees as Employee[]) ?? []);
    setTransactions((ledgerPayload.transactions as LedgerRow[]) ?? []);
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(url: string, body: Record<string, unknown>) {
    setSubmitting(true);
    setError(undefined);
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "休暇情報を更新できませんでした。"));
      return undefined;
    }
    return result;
  }

  async function createType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await post("/api/leave/types", {
      action: "create",
      code: data.get("code"),
      consumesBalance: data.get("consumesBalance") === "on",
      effectiveFrom: data.get("effectiveFrom"),
      effectiveTo: data.get("effectiveTo"),
      name: data.get("name"),
      paid: data.get("paid") === "on",
      requestable: data.get("requestable") === "on",
    });
    if (!result) return;
    setSuccess("休暇種別を作成しました。");
    event.currentTarget.reset();
    await load();
  }

  async function deactivateType() {
    if (!deactivating) return;
    const result = await post("/api/leave/types", {
      action: "deactivate",
      leaveTypeId: deactivating.id,
    });
    if (!result) return;
    setSuccess(`${deactivating.name}を無効化しました。過去の履歴は保持されます。`);
    setDeactivating(undefined);
    await load();
  }

  async function changeBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const action = String(data.get("action"));
    const result = await post("/api/leave/grants", {
      action,
      effectiveOn: data.get("effectiveOn"),
      employeeId: data.get("employeeId"),
      expiresOn: data.get("expiresOn"),
      grantedOn: data.get("effectiveOn"),
      leaveTypeId: data.get("leaveTypeId"),
      reason: data.get("reason"),
      units: Number(data.get("units")),
    });
    if (!result) return;
    setSuccess(action === "grant" ? "休暇を付与しました。" : "休暇残高を調整しました。");
    await load();
    if (selectedEmployeeId) await loadBalances(selectedEmployeeId);
  }

  async function loadBalances(employeeId: string) {
    setSelectedEmployeeId(employeeId);
    if (!employeeId) {
      setBalances([]);
      return;
    }
    const response = await fetch(
      `/api/leave/ledger?scope=employee&employeeId=${encodeURIComponent(employeeId)}&asOf=${today()}`,
    );
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "休暇残高を取得できませんでした。"));
      return;
    }
    setBalances((result.balances as Balance[]) ?? []);
  }

  async function searchLedger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parameters = new URLSearchParams(
      Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
    );
    const response = await fetch(`/api/leave/ledger?${parameters}`);
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "休暇台帳を取得できませんでした。"));
      return;
    }
    setTransactions((result.transactions as LedgerRow[]) ?? []);
  }

  async function processCsv(mode: "commit" | "preview") {
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/leave/import", {
      body: JSON.stringify({ csv, fileName: csvFileName, mode }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "休暇付与CSVを処理できませんでした。"));
      setCsvPreview(result as unknown as CsvPreview);
      return;
    }
    if (mode === "preview") {
      setCsvPreview(result as unknown as CsvPreview);
      return;
    }
    setSuccess("休暇付与CSVを取り込みました。");
    setCsvPreview(undefined);
    await load();
  }

  return (
    <main className="registry-page feature-page">
      <PageHeader title="休暇管理">休暇種別、付与・調整、残高と追記型台帳を管理します。</PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section className="feature-section" aria-labelledby="leave-types-heading">
        <div>
          <h2 id="leave-types-heading">休暇種別</h2>
          <p>利用開始後のコード・有給区分・残高消費区分は変更せず、新種別として追加します。</p>
        </div>
        <form className="feature-form" onSubmit={createType}>
          <Field
            id="leave-code"
            label="コード"
            maxLength={32}
            name="code"
            placeholder="PAID"
            required
          />
          <Field
            id="leave-name"
            label="表示名"
            maxLength={100}
            name="name"
            placeholder="年次有給休暇"
            required
          />
          <Field
            defaultValue={today()}
            id="leave-effective-from"
            label="有効開始日"
            name="effectiveFrom"
            required
            type="date"
          />
          <Field
            id="leave-effective-to"
            label="有効終了日（任意）"
            name="effectiveTo"
            type="date"
          />
          <fieldset className="check-options">
            <legend>属性</legend>
            <label>
              <input defaultChecked name="paid" type="checkbox" /> 有給
            </label>
            <label>
              <input defaultChecked name="consumesBalance" type="checkbox" /> 残高を消費
            </label>
            <label>
              <input defaultChecked name="requestable" type="checkbox" /> 従業員が申請可能
            </label>
          </fieldset>
          <Button disabled={submitting} type="submit">
            種別を追加
          </Button>
        </form>
        <Table label="休暇種別">
          <thead>
            <tr>
              <th>コード・名称</th>
              <th>属性</th>
              <th>有効期間</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {leaveTypes.map((leaveType) => (
              <tr key={leaveType.id}>
                <td>
                  <strong>{leaveType.code}</strong>
                  <br />
                  {leaveType.name}
                </td>
                <td>
                  {leaveType.paid ? "有給" : "無給"}・
                  {leaveType.consumesBalance ? "残高消費" : "残高なし"}・
                  {leaveType.requestable ? "申請可" : "申請不可"}
                </td>
                <td>
                  {leaveType.effectiveFrom}〜{leaveType.effectiveTo ?? "期限なし"}
                </td>
                <td>{leaveType.active ? "有効" : "無効"}</td>
                <td>
                  {leaveType.active ? (
                    <Button
                      onClick={() => setDeactivating(leaveType)}
                      type="button"
                      variant="danger"
                    >
                      無効化
                    </Button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="feature-section" aria-labelledby="leave-balance-heading">
        <div>
          <h2 id="leave-balance-heading">手動付与・残高調整</h2>
          <p>1単位は半日です。すべての変更は元の履歴を上書きせず台帳へ追記されます。</p>
        </div>
        <form className="feature-form" onSubmit={changeBalance}>
          <SelectField id="balance-action" label="処理" name="action">
            <option value="grant">付与</option>
            <option value="adjust">調整（増減）</option>
          </SelectField>
          <SelectField id="balance-employee" label="従業員" name="employeeId" required>
            <option value="">選択してください</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeNumber} {employee.displayName}
              </option>
            ))}
          </SelectField>
          <SelectField id="balance-type" label="休暇種別" name="leaveTypeId" required>
            <option value="">選択してください</option>
            {leaveTypes
              .filter((item) => item.active && item.consumesBalance)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} {item.name}
                </option>
              ))}
          </SelectField>
          <Field
            defaultValue={today()}
            id="balance-date"
            label="付与・調整日"
            name="effectiveOn"
            required
            type="date"
          />
          <Field id="balance-expires" label="有効期限（付与時）" name="expiresOn" type="date" />
          <Field
            id="balance-units"
            label="単位（半日=1）"
            name="units"
            required
            step="1"
            type="number"
          />
          <TextareaField id="balance-reason" label="理由" name="reason" required rows={2} />
          <Button disabled={submitting} type="submit">
            台帳へ記録
          </Button>
        </form>
        <SelectField
          id="balance-inspect-employee"
          label="残高を確認する従業員"
          onChange={(event) => void loadBalances(event.target.value)}
          value={selectedEmployeeId}
        >
          <option value="">選択してください</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.employeeNumber} {employee.displayName}
            </option>
          ))}
        </SelectField>
        {balances.length ? (
          <dl className="balance-grid">
            {balances.map((balance) => (
              <div key={balance.leaveType.id}>
                <dt>{balance.leaveType.name}</dt>
                <dd>{days(balance.availableUnits)}</dd>
                <small>
                  審査待ち {days(balance.pendingUnits)}
                  {balance.nextExpiry ? `・次回失効 ${balance.nextExpiry}` : ""}
                </small>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section className="feature-section" aria-labelledby="leave-import-heading">
        <div>
          <h2 id="leave-import-heading">休暇付与CSV</h2>
          <p>従業員番号と休暇コードを検証し、全行を一つの処理として取り込みます。</p>
        </div>
        <label className="ui-field" htmlFor="leave-csv-file">
          <span>UTF-8 CSVファイル</span>
          <input
            accept=".csv,text/csv"
            id="leave-csv-file"
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
          id="leave-csv"
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
            disabled={submitting || !csvPreview || csvPreview.errors.length > 0}
            onClick={() => void processCsv("commit")}
            type="button"
          >
            確定して取り込む
          </Button>
        </div>
        {csvPreview ? (
          <div aria-live="polite" className="import-preview">
            <strong>
              {csvPreview.summary?.rowCount ?? 0}行・{csvPreview.summary?.employeeCount ?? 0}
              名・合計{days(csvPreview.summary?.totalUnits ?? 0)}
            </strong>
            {csvPreview.errors?.length ? (
              <ul className="import-errors">
                {csvPreview.errors.map((item) => (
                  <li key={`${item.line}-${item.message}`}>
                    {item.line}行目: {item.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>検証に成功しました。</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="feature-section" aria-labelledby="leave-ledger-heading">
        <div className="section-heading">
          <div>
            <h2 id="leave-ledger-heading">休暇台帳</h2>
            <p>従業員・種別・期間で追跡できます。</p>
          </div>
          <a className="ui-button ui-button--secondary" download href="/api/exports/leave-ledger">
            CSVを出力
          </a>
        </div>
        <form onSubmit={searchLedger}>
          <FilterBar>
            <SelectField id="ledger-employee" label="従業員" name="employeeId">
              <option value="">すべて</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.displayName}
                </option>
              ))}
            </SelectField>
            <SelectField id="ledger-type" label="休暇種別" name="leaveTypeId">
              <option value="">すべて</option>
              {leaveTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
            <Field id="ledger-from" label="開始日" name="from" type="date" />
            <Field id="ledger-to" label="終了日" name="to" type="date" />
            <Button type="submit" variant="secondary">
              検索
            </Button>
          </FilterBar>
        </form>
        {transactions.length === 0 ? (
          <EmptyState title="台帳取引がありません">
            付与・調整・承認・失効の履歴がここに表示されます。
          </EmptyState>
        ) : (
          <Table label="休暇台帳">
            <thead>
              <tr>
                <th>日付</th>
                <th>従業員</th>
                <th>休暇</th>
                <th>取引</th>
                <th>単位</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((row, index) => (
                <tr key={`${row.employeeId}-${row.effectiveOn}-${index}`}>
                  <td>{row.effectiveOn}</td>
                  <td>
                    {row.employeeNumber}
                    <br />
                    <small>{row.departmentName ?? "—"}</small>
                  </td>
                  <td>
                    {row.leaveTypeCode}
                    <br />
                    <small>{row.leaveTypeName}</small>
                  </td>
                  <td>{row.kind}</td>
                  <td>
                    {row.units > 0 ? "+" : ""}
                    {row.units}（{days(Math.abs(row.units))}）
                  </td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="無効化する"
        onCancel={() => setDeactivating(undefined)}
        onConfirm={() => void deactivateType()}
        open={Boolean(deactivating)}
        title="休暇種別を無効化しますか？"
      >
        <p>{deactivating?.name}は新しい申請で選べなくなります。過去の申請・台帳は保持されます。</p>
      </ConfirmDialog>
    </main>
  );
}
