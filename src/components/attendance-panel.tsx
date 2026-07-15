"use client";

import { useState } from "react";

import { Button, Toast } from "@/components/ui";
import type { PunchType } from "@/lib/attendance";

type AttendanceState = { actions: PunchType[]; stateLabel: string; workDate: string };
const actionLabels: Record<PunchType, string> = {
  break_end: "休憩を終了",
  break_start: "休憩を開始",
  clock_in: "出勤する",
  clock_out: "退勤する",
};

export function AttendancePanel({ initialState }: { initialState: AttendanceState }) {
  const [attendance, setAttendance] = useState(initialState);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function punch(type: PunchType) {
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/attendance/me", {
      body: JSON.stringify({ type }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { attendance?: AttendanceState; error?: string };
    setSubmitting(false);
    if (!response.ok || !payload.attendance) {
      setError(payload.error ?? "打刻できませんでした。");
      return;
    }
    setAttendance(payload.attendance);
  }

  return (
    <section className="attendance-action" aria-labelledby="attendance-state">
      <p>現在の出勤状況</p>
      <h2 id="attendance-state">{attendance.stateLabel}</h2>
      <div className="attendance-buttons">
        {attendance.actions.map((action) => (
          <Button
            disabled={submitting}
            key={action}
            onClick={() => void punch(action)}
            type="button"
            variant={action === "clock_out" ? "secondary" : "primary"}
          >
            {submitting ? "記録中…" : actionLabels[action]}
          </Button>
        ))}
      </div>
      <Toast tone="error">{error}</Toast>
    </section>
  );
}
