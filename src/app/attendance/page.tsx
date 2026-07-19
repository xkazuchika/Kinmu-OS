"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Field,
  FilterBar,
  PageHeader,
  SelectField,
  Table,
  Toast,
  ConfirmDialog,
} from "@/components/ui";

type Department = { active: boolean; id: string; name: string };
type Employee = { displayName: string; id: string };
type Attendance = {
  absenceReason: string | null;
  calendarLabel: string;
  calendarSource: string;
  departmentName: string;
  displayName: string;
  employeeId: string;
  leaveScheduledMinutes: number | null;
  leaveTypeName: string | null;
  leaveUnits: number | null;
  operationalStatus:
    | "absence"
    | "conflict"
    | "leave_full"
    | "leave_half_worked"
    | "non_workday"
    | "open_punch"
    | "unresolved"
    | "worked";
  overtimeMinutes: number | null;
  scheduledMinutes: number;
  status: "complete" | "open";
  workDate: string;
  workedMinutes: number | null;
};
type Closing = {
  blockers: {
    conflictingDays: number;
    invalidDays: number;
    openDays: number;
    pendingCorrections: number;
    pendingLeaveRequests: number;
    unresolvedDays: number;
  };
  canClose: boolean;
  ended: boolean;
  month: string;
  period: {
    closedAt: string | null;
    closedBy: string | null;
    currentRevision: number | null;
    status: "closed" | "open";
    version: number;
  };
  summary: {
    dayCount: number;
    employeeCount: number;
    absenceDays: number;
    leaveDays: number;
    overtimeMinutes: number;
    scheduledMinutes: number;
    workedMinutes: number;
  };
};
const minutes = (value: number | null) =>
  value === null ? "—" : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;

const operationalStatusLabels: Record<Attendance["operationalStatus"], string> = {
  absence: "欠勤",
  conflict: "要確認",
  leave_full: "全日休暇",
  leave_half_worked: "半日休暇・勤務",
  non_workday: "休日",
  open_punch: "未退勤",
  unresolved: "未解決",
  worked: "勤務済み",
};

export default function AttendanceManagementPage() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [closing, setClosing] = useState<Closing>();
  const [dialog, setDialog] = useState<"close" | "reopen">();
  const [reopenReason, setReopenReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedStatus, setSelectedStatus] = useState("");
  async function load(
    event?: FormEvent<HTMLFormElement>,
    month = selectedMonth,
    status = selectedStatus,
  ) {
    event?.preventDefault();
    const parameters = event
      ? new URLSearchParams(
          Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
        )
      : new URLSearchParams({ month, ...(status ? { status } : {}) });
    setSelectedMonth(parameters.get("month") ?? currentMonth);
    setSelectedStatus(parameters.get("status") ?? "");
    const [attendanceResponse, departmentResponse, employeeResponse, closingResponse] =
      await Promise.all([
        fetch(`/api/attendance?${parameters}`),
        fetch("/api/departments"),
        fetch("/api/employees?status=all"),
        fetch(`/api/attendance/closing?month=${parameters.get("month")}`),
      ]);
    const payload = (await attendanceResponse.json()) as {
      attendance?: Attendance[];
      error?: string;
    };
    if (!attendanceResponse.ok) {
      setError(payload.error ?? "勤怠一覧を取得できませんでした。");
      return;
    }
    setAttendance(payload.attendance ?? []);
    setDepartments(
      ((await departmentResponse.json()) as { departments?: Department[] }).departments ?? [],
    );
    setEmployees(((await employeeResponse.json()) as { employees?: Employee[] }).employees ?? []);
    const closingPayload = (await closingResponse.json()) as { closing?: Closing; error?: string };
    if (closingResponse.ok) setClosing(closingPayload.closing);
    setError(undefined);
  }
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const month = parameters.get("month") ?? currentMonth;
    const status = parameters.get("status") ?? "";
    const timer = window.setTimeout(() => void load(undefined, month, status), 0);
    return () => window.clearTimeout(timer);
    // URLの初期条件だけを初回表示時に反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function updateClosing() {
    if (!closing || !dialog) return;
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/attendance/closing", {
      body: JSON.stringify({
        action: dialog,
        expectedVersion: closing.period.version,
        month: closing.month,
        reason: reopenReason,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "月次勤怠を更新できませんでした。");
      setDialog(undefined);
      return;
    }
    setSuccess(dialog === "close" ? "月次勤怠を締めました。" : "月次勤怠を再開しました。");
    setDialog(undefined);
    setReopenReason("");
    await load(undefined, closing.month);
  }
  return (
    <main className="registry-page">
      <PageHeader title="勤怠一覧">月・部署・従業員・未退勤で勤務実績を確認します。</PageHeader>
      <div className="registry-actions">
        <Link href="/attendance/rules">勤務ルール</Link>
      </div>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <form onSubmit={load}>
        <FilterBar>
          <Field
            id="attendance-filter-month"
            label="対象月"
            name="month"
            onChange={(event) => setSelectedMonth(event.target.value)}
            type="month"
            value={selectedMonth}
          />
          <SelectField id="attendance-filter-department" label="部署" name="departmentId">
            <option value="">すべて</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </SelectField>
          <SelectField id="attendance-filter-employee" label="従業員" name="employeeId">
            <option value="">すべて</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="attendance-filter-status"
            label="状態"
            name="status"
            onChange={(event) => setSelectedStatus(event.target.value)}
            value={selectedStatus}
          >
            <option value="">すべて</option>
            <option value="open">未退勤のみ</option>
            <option value="unresolved">未解決のみ</option>
            <option value="leave">休暇のみ</option>
            <option value="absence">欠勤のみ</option>
            <option value="conflict">日区分の競合のみ</option>
          </SelectField>
          <Button type="submit" variant="secondary">
            表示
          </Button>
        </FilterBar>
      </form>
      {closing ? (
        <section aria-labelledby="attendance-closing-title" className="attendance-closing">
          <div className="attendance-closing__heading">
            <div>
              <p className="attendance-closing__label">{closing.month} 月次勤怠</p>
              <h2 id="attendance-closing-title">
                {closing.period.status === "closed" ? "締め済み" : "編集中"}
              </h2>
            </div>
            {closing.period.status === "closed" ? (
              <Button onClick={() => setDialog("reopen")} variant="secondary">
                締めを再開
              </Button>
            ) : (
              <Button
                disabled={!closing.canClose || !closing.ended}
                onClick={() => setDialog("close")}
              >
                この月を締める
              </Button>
            )}
          </div>
          {closing.period.status === "closed" ? (
            <p>
              リビジョン {closing.period.currentRevision} ・ {closing.period.closedBy} ・{" "}
              {closing.period.closedAt
                ? new Date(closing.period.closedAt).toLocaleString("ja-JP")
                : ""}
            </p>
          ) : (
            <>
              <dl className="attendance-closing__summary">
                <div>
                  <dt>従業員</dt>
                  <dd>{closing.summary.employeeCount}名</dd>
                </div>
                <div>
                  <dt>勤務日</dt>
                  <dd>{closing.summary.dayCount}日</dd>
                </div>
                <div>
                  <dt>休暇</dt>
                  <dd>{closing.summary.leaveDays}日</dd>
                </div>
                <div>
                  <dt>欠勤</dt>
                  <dd>{closing.summary.absenceDays}日</dd>
                </div>
                <div>
                  <dt>未退勤</dt>
                  <dd>{closing.blockers.openDays}件</dd>
                </div>
                <div>
                  <dt>審査待ち</dt>
                  <dd>{closing.blockers.pendingCorrections}件</dd>
                </div>
                <div>
                  <dt>審査待ち休暇</dt>
                  <dd>{closing.blockers.pendingLeaveRequests}件</dd>
                </div>
                <div>
                  <dt>未解決</dt>
                  <dd>{closing.blockers.unresolvedDays}件</dd>
                </div>
                <div>
                  <dt>日区分の競合</dt>
                  <dd>{closing.blockers.conflictingDays}件</dd>
                </div>
                <div>
                  <dt>集計未作成</dt>
                  <dd>{closing.blockers.invalidDays}件</dd>
                </div>
              </dl>
              {!closing.ended ? <p>対象月の終了後に締められます。</p> : null}
              {closing.blockers.openDays ? (
                <Link href={`/attendance?month=${closing.month}&status=open`}>未退勤を確認</Link>
              ) : null}
              {closing.blockers.pendingCorrections ? (
                <Link href="/attendance/corrections?status=pending">審査待ち申請を確認</Link>
              ) : null}
              {closing.blockers.pendingLeaveRequests ? (
                <Link href="/leave/reviews?status=pending">審査待ち休暇を確認</Link>
              ) : null}
              {closing.blockers.unresolvedDays ? (
                <Link href={`/attendance?month=${closing.month}&status=unresolved`}>
                  未解決の勤務日を確認
                </Link>
              ) : null}
              {closing.blockers.conflictingDays ? (
                <Link href={`/attendance?month=${closing.month}&status=conflict`}>
                  日区分の競合を確認
                </Link>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      {attendance.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={() => void load()} variant="secondary">
              選択月を読み込む
            </Button>
          }
          title="勤怠が表示されていません"
        >
          条件を指定して一覧を表示してください。
        </EmptyState>
      ) : (
        <Table label="勤怠一覧">
          <thead>
            <tr>
              <th>勤務日</th>
              <th>従業員</th>
              <th>部署</th>
              <th>状態</th>
              <th>勤務予定の根拠</th>
              <th>休暇・欠勤</th>
              <th>実労働</th>
              <th>所定</th>
              <th>残業</th>
              <th>確認</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((day) => (
              <tr key={`${day.employeeId}-${day.workDate}`}>
                <td>{day.workDate}</td>
                <td>{day.displayName}</td>
                <td>{day.departmentName}</td>
                <td>{operationalStatusLabels[day.operationalStatus]}</td>
                <td>{day.calendarLabel}</td>
                <td>
                  {day.leaveTypeName
                    ? `${day.leaveTypeName} ${(day.leaveUnits ?? 0) / 2}日（${minutes(day.leaveScheduledMinutes)}）`
                    : day.absenceReason
                      ? `欠勤：${day.absenceReason}`
                      : "—"}
                </td>
                <td>{minutes(day.workedMinutes)}</td>
                <td>{minutes(day.scheduledMinutes)}</td>
                <td>{minutes(day.overtimeMinutes)}</td>
                <td>
                  {day.operationalStatus === "unresolved" ||
                  day.operationalStatus === "open_punch" ? (
                    <Link href="/attendance/corrections">勤怠申請を確認</Link>
                  ) : day.operationalStatus === "conflict" ? (
                    <Link href="/leave/reviews">休暇審査を確認</Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        confirmDisabled={submitting || (dialog === "reopen" && reopenReason.trim().length < 5)}
        confirmLabel={dialog === "close" ? "締めて確定" : "再開する"}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => void updateClosing()}
        open={Boolean(dialog)}
        title={
          dialog === "close" ? `${closing?.month ?? ""}を締めますか？` : "月次勤怠を再開しますか？"
        }
      >
        {dialog === "close" ? (
          <p>締め後は勤怠を修正できません。従業員と勤務日の集計を確定します。</p>
        ) : (
          <>
            <p>修正操作を再び許可します。修正と審査が終わったら再締めしてください。</p>
            <label className="ui-field" htmlFor="attendance-reopen-reason">
              <span>再開理由（5文字以上）</span>
              <textarea
                id="attendance-reopen-reason"
                maxLength={1000}
                onChange={(event) => setReopenReason(event.target.value)}
                rows={4}
                value={reopenReason}
              />
            </label>
          </>
        )}
      </ConfirmDialog>
    </main>
  );
}
