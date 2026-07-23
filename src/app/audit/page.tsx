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
  "overtime_policy_created",
  "overtime_policy_activated",
  "overtime_policy_changed",
  "overtime_request_submitted",
  "overtime_request_cancelled",
  "overtime_request_approved",
  "overtime_request_rejected",
  "payroll_profile_created",
  "payroll_profile_changed",
  "payroll_profile_published",
  "payroll_profile_archived",
  "payroll_profile_imported",
  "payroll_profile_exported",
  "payroll_employee_mapping_changed",
  "payroll_employee_mappings_imported",
  "payroll_export_validated",
  "payroll_export_generated",
  "payroll_export_regenerated",
  "payroll_export_downloaded",
  "payroll_export_integrity_failed",
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
          <Field id="audit-employee" label="対象従業員ID" name="employeeId" />
          <Field id="audit-month" label="対象月" name="targetMonth" type="month" />
          <Field id="audit-payroll-profile" label="給与プロファイルID" name="profileId" />
          <Field
            id="audit-attendance-revision"
            label="締めリビジョン"
            min="1"
            name="attendanceRevision"
            type="number"
          />
          <Field id="audit-payroll-run" label="給与run ID" name="runId" />
          <SelectField id="audit-validation-result" label="給与検査結果" name="validationResult">
            <option value="">すべて</option>
            <option value="passed">成功</option>
            <option value="failed">要修正</option>
          </SelectField>
          <SelectField id="audit-payroll-only" label="給与連携操作" name="payrollOnly">
            <option value="">すべての操作</option>
            <option value="1">給与連携のみ</option>
          </SelectField>
          <SelectField id="audit-overtime-kind" label="残業申請区分" name="overtimeRequestKind">
            <option value="">すべて</option>
            <option value="overtime">残業</option>
            <option value="holiday_work">休日出勤</option>
          </SelectField>
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
