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
type Employee = { displayName: string; id: string };
type Attendance = {
  departmentName: string;
  displayName: string;
  employeeId: string;
  overtimeMinutes: number | null;
  scheduledMinutes: number;
  status: "complete" | "open";
  workDate: string;
  workedMinutes: number | null;
};
const minutes = (value: number | null) =>
  value === null ? "—" : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;

export default function AttendanceManagementPage() {
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string>();
  async function load(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const parameters = event
      ? new URLSearchParams(
          Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>,
        )
      : new URLSearchParams({ month: new Date().toISOString().slice(0, 7) });
    const [attendanceResponse, departmentResponse, employeeResponse] = await Promise.all([
      fetch(`/api/attendance?${parameters}`),
      fetch("/api/departments"),
      fetch("/api/employees?status=all"),
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
    setError(undefined);
  }
  return (
    <main className="registry-page">
      <PageHeader title="勤怠一覧">月・部署・従業員・未退勤で勤務実績を確認します。</PageHeader>
      <div className="registry-actions">
        <Link href="/attendance/rules">勤務ルール</Link>
      </div>
      <Toast tone="error">{error}</Toast>
      <form onSubmit={load}>
        <FilterBar>
          <Field
            defaultValue={new Date().toISOString().slice(0, 7)}
            id="attendance-filter-month"
            label="対象月"
            name="month"
            type="month"
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
          <SelectField id="attendance-filter-status" label="状態" name="status">
            <option value="">すべて</option>
            <option value="open">未退勤のみ</option>
          </SelectField>
          <Button type="submit" variant="secondary">
            表示
          </Button>
        </FilterBar>
      </form>
      {attendance.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={() => void load()} variant="secondary">
              今月を読み込む
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
              <th>実労働</th>
              <th>所定</th>
              <th>残業</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((day) => (
              <tr key={`${day.employeeId}-${day.workDate}`}>
                <td>{day.workDate}</td>
                <td>{day.displayName}</td>
                <td>{day.departmentName}</td>
                <td>{day.status === "open" ? "未退勤" : "退勤済み"}</td>
                <td>{minutes(day.workedMinutes)}</td>
                <td>{minutes(day.scheduledMinutes)}</td>
                <td>{minutes(day.overtimeMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </main>
  );
}
