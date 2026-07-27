"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  Field,
  PageHeader,
  SelectField,
  TaskContext,
  TextareaField,
  Toast,
} from "@/components/ui";

type Employee = { displayName: string; employeeNumber: string; id: string };
type LeaveType = { active: boolean; id: string; name: string; requestable: boolean };
type ProxyKind = "attendance" | "leave" | "overtime";

async function payload(response: Response) {
  return (await response.json()) as { error?: string };
}

export default function ProxyRequestPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [kind, setKind] = useState<ProxyKind>("attendance");
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [employeeResponse, leaveTypeResponse] = await Promise.all([
      fetch("/api/employees?status=active"),
      fetch("/api/leave/types"),
    ]);
    const employeePayload = (await employeeResponse.json()) as { employees?: Employee[] };
    const leaveTypePayload = (await leaveTypeResponse.json()) as { leaveTypes?: LeaveType[] };
    setEmployees(employeePayload.employees ?? []);
    setLeaveTypes(
      (leaveTypePayload.leaveTypes ?? []).filter((item) => item.active && item.requestable),
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setSuccess(undefined);
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    let response: Response;
    if (kind === "attendance") {
      const entries = [
        values.clockIn
          ? { occurredAt: new Date(values.clockIn).toISOString(), type: "clock_in" }
          : null,
        values.clockOut
          ? { occurredAt: new Date(values.clockOut).toISOString(), type: "clock_out" }
          : null,
      ].filter(Boolean);
      response = await fetch("/api/attendance/corrections", {
        body: JSON.stringify({ ...values, entries }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } else if (kind === "leave") {
      response = await fetch("/api/leave/requests", {
        body: JSON.stringify({ ...values, action: "create" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } else {
      response = await fetch("/api/overtime/requests", {
        body: JSON.stringify({ ...values, action: "create" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    }
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error ?? "代理申請を作成できませんでした。");
      return;
    }
    setSuccess("対象者、実際の作成者、代理理由を分けて申請を作成しました。");
    event.currentTarget.reset();
  }

  return (
    <main className="registry-page feature-page approval-page">
      <PageHeader title="代理申請">
        本人から連絡を受けた場合などに、管理者が実際の作成者として申請を記録します。
      </PageHeader>
      <TaskContext
        completion="対象従業員と代理理由が明記され、通常の承認経路へ申請が届きます。"
        prerequisites={[
          "この操作は本人としてログインし直すものではありません。",
          "締め済み月、残高不足、重複、時刻矛盾などは本人申請と同じく拒否されます。",
        ]}
      />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      <section aria-labelledby="proxy-kind-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="proxy-kind-heading">何を代理申請するか</h2>
            <p>申請種別を選ぶと、必要な入力欄だけを表示します。</p>
          </div>
        </div>
        <div className="approval-kind-switch" role="group" aria-label="代理申請種別">
          <Button
            onClick={() => setKind("attendance")}
            type="button"
            variant={kind === "attendance" ? "primary" : "secondary"}
          >
            勤怠修正
          </Button>
          <Button
            onClick={() => setKind("leave")}
            type="button"
            variant={kind === "leave" ? "primary" : "secondary"}
          >
            休暇
          </Button>
          <Button
            onClick={() => setKind("overtime")}
            type="button"
            variant={kind === "overtime" ? "primary" : "secondary"}
          >
            残業・休日出勤
          </Button>
        </div>
      </section>

      <section aria-labelledby="proxy-form-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="proxy-form-heading">対象者と申請内容</h2>
            <p>保存前に、対象者と代理理由をもう一度確認してください。</p>
          </div>
        </div>
        <form key={kind} className="approval-proxy-form" onSubmit={submit}>
          <SelectField id="employeeId" label="対象従業員" name="employeeId" required>
            <option value="">選択してください</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeNumber} {employee.displayName}
              </option>
            ))}
          </SelectField>
          <TextareaField
            constraint="具体的な事情を1,000文字以内"
            description="本人からの依頼経路や、管理者が入力する必要がある事情を記録します。"
            id="proxyReason"
            label="代理作成理由"
            name="proxyReason"
            required
            rows={3}
          />

          {kind === "attendance" ? (
            <>
              <Field id="workDate" label="勤務日" name="workDate" required type="date" />
              <Field id="clockIn" label="出勤時刻" name="clockIn" optional type="datetime-local" />
              <Field
                id="clockOut"
                label="退勤時刻"
                name="clockOut"
                optional
                type="datetime-local"
              />
            </>
          ) : null}
          {kind === "leave" ? (
            <>
              <SelectField id="leaveTypeId" label="休暇種別" name="leaveTypeId" required>
                <option value="">選択してください</option>
                {leaveTypes.map((leaveType) => (
                  <option key={leaveType.id} value={leaveType.id}>
                    {leaveType.name}
                  </option>
                ))}
              </SelectField>
              <Field id="from" label="開始日" name="from" required type="date" />
              <Field id="to" label="終了日" name="to" required type="date" />
              <SelectField defaultValue="full_day" id="unit" label="休暇単位" name="unit">
                <option value="full_day">全日</option>
                <option value="half_day">半日</option>
              </SelectField>
            </>
          ) : null}
          {kind === "overtime" ? (
            <>
              <SelectField defaultValue="overtime" id="kind" label="区分" name="kind">
                <option value="overtime">残業</option>
                <option value="holiday_work">休日出勤</option>
              </SelectField>
              <Field id="workDate" label="勤務日" name="workDate" required type="date" />
              <Field id="startTime" label="予定開始" name="startTime" required type="time" />
              <Field id="endTime" label="予定終了" name="endTime" required type="time" />
              <Field
                defaultValue={0}
                id="plannedBreakMinutes"
                label="予定休憩"
                min={0}
                name="plannedBreakMinutes"
                required
                type="number"
                unit="分"
              />
            </>
          ) : null}
          <TextareaField
            constraint="申請対象者の業務上の理由を入力"
            id="reason"
            label="申請理由"
            name="reason"
            required
            rows={4}
          />
          <Button disabled={submitting} type="submit">
            {submitting ? "検証して作成しています" : "通常の検証を行って代理申請"}
          </Button>
        </form>
      </section>
    </main>
  );
}
