"use client";

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

type Log = {
  action: string;
  actorUserId: string | null;
  entityId: string | null;
  entityType: string;
  id: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};
const actions = [
  "login_succeeded",
  "logout",
  "user_created",
  "user_disabled",
  "role_changed",
  "department_changed",
  "employee_created",
  "employee_updated",
  "employee_status_changed",
  "work_rule_changed",
  "work_calendar_changed",
  "work_calendar_activated",
  "leave_type_changed",
  "leave_balance_changed",
  "leave_requested",
  "leave_request_cancelled",
  "leave_request_approved",
  "leave_request_rejected",
  "absence_changed",
  "attendance_punched",
  "attendance_correction_requested",
  "attendance_correction_cancelled",
  "attendance_correction_approved",
  "attendance_correction_rejected",
  "attendance_correction_applied",
  "attendance_month_closed",
  "attendance_month_reopened",
  "attendance_month_reclosed",
  "csv_imported",
  "csv_exported",
];
export default function AuditPage() {
  const [error, setError] = useState<string>();
  const [logs, setLogs] = useState<Log[]>([]);
  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const parameters = event
      ? new URLSearchParams(
          Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
        )
      : new URLSearchParams();
    const response = await fetch(`/api/audit?${parameters}`);
    const payload = (await response.json()) as { error?: string; logs?: Log[] };
    if (!response.ok) {
      setError(payload.error ?? "監査ログを取得できませんでした。");
      return;
    }
    setLogs(payload.logs ?? []);
    setError(undefined);
  }
  return (
    <main className="registry-page">
      <PageHeader title="監査ログ">重要な操作を読み取り専用で確認します。</PageHeader>
      <Toast tone="error">{error}</Toast>
      <form onSubmit={search}>
        <FilterBar>
          <Field id="audit-from" label="開始日" name="from" type="date" />
          <Field id="audit-to" label="終了日" name="to" type="date" />
          <SelectField id="audit-action" label="操作" name="action">
            <option value="">すべて</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </SelectField>
          <Field id="audit-actor" label="操作者ID" name="actorUserId" />
          <Field id="audit-entity" label="対象従業員・対象ID" name="entityId" />
          <Button type="submit" variant="secondary">
            検索
          </Button>
        </FilterBar>
      </form>
      {logs.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={() => void search()} variant="secondary">
              最新ログを表示
            </Button>
          }
          title="監査ログが表示されていません"
        >
          条件を指定して検索してください。
        </EmptyState>
      ) : (
        <Table label="監査ログ">
          <thead>
            <tr>
              <th>日時</th>
              <th>操作</th>
              <th>操作者</th>
              <th>対象</th>
              <th>詳細</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.occurredAt).toLocaleString("ja-JP")}</td>
                <td>{log.action}</td>
                <td>{log.actorUserId ?? "システム"}</td>
                <td>
                  {log.entityType}:{log.entityId ?? "—"}
                </td>
                <td>
                  <code>{JSON.stringify(log.metadata)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </main>
  );
}
