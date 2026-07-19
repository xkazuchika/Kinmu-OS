"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, SelectField, TextareaField, Toast } from "@/components/ui";
import { ClockIcon } from "@/components/icons";

type PunchType = "break_end" | "break_start" | "clock_in" | "clock_out";
type EventEntry = { id: string; occurredAt: string; type: PunchType };
type EditableEntry = {
  occurredAt: string;
  originalEventId: string | null;
  originalOccurredAt?: string;
  type: PunchType;
};
type CorrectionStatus = "approved" | "cancelled" | "pending" | "rejected";
type HistoryItem = {
  createdAt: Date | string;
  id: string;
  reason: string;
  reviewComment: null | string;
  status: CorrectionStatus;
  workDate: string;
};

export type CorrectionDay = {
  absenceReason?: string | null;
  calendarLabel?: string;
  correction: { id: string; status: CorrectionStatus } | null;
  events: EventEntry[];
  id: string;
  isCorrected: boolean;
  leaveScheduledMinutes?: number | null;
  leaveTypeName?: string | null;
  leaveUnits?: number | null;
  operationalStatus?:
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

const operationalStatusLabels: Record<NonNullable<CorrectionDay["operationalStatus"]>, string> = {
  absence: "欠勤",
  conflict: "要確認",
  leave_full: "全日休暇",
  leave_half_worked: "半日休暇・勤務",
  non_workday: "休日",
  open_punch: "未退勤",
  unresolved: "未解決",
  worked: "勤務済み",
};

const eventLabels: Record<PunchType, string> = {
  break_end: "休憩終了",
  break_start: "休憩開始",
  clock_in: "出勤",
  clock_out: "退勤",
};

const statusLabels: Record<CorrectionStatus, string> = {
  approved: "承認済み",
  cancelled: "取消済み",
  pending: "審査待ち",
  rejected: "却下",
};

function dateTimeInZone(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function zonedDateTimeToIso(value: string, timezone: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = dateTimeInZone(new Date(guess).toISOString(), timezone);
    const [localDate, localTime] = local.split("T");
    const [localYear, localMonth, localDay] = localDate.split("-").map(Number);
    const [localHour, localMinute] = localTime.split(":").map(Number);
    const represented = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute);
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}

function displayTime(value: string) {
  return value.slice(11, 16);
}

function hours(minutes: number | null) {
  if (minutes === null) return "—";
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, "0")}分`;
}

function requestedEntries(day: CorrectionDay, timezone: string): EditableEntry[] {
  return day.events.map((event) => ({
    occurredAt: dateTimeInZone(event.occurredAt, timezone),
    originalEventId: event.id,
    originalOccurredAt: event.occurredAt,
    type: event.type,
  }));
}

export function AttendanceCorrectionPanel({
  closed = false,
  days,
  initialHistory,
  timezone,
}: {
  closed?: boolean;
  days: CorrectionDay[];
  initialHistory: HistoryItem[];
  timezone: string;
}) {
  const router = useRouter();
  const [editingDay, setEditingDay] = useState<CorrectionDay>();
  const [entries, setEntries] = useState<EditableEntry[]>([]);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const changes = useMemo(() => {
    if (!editingDay) return [];
    const originals = new Map(editingDay.events.map((event) => [event.id, event]));
    const currentIds = new Set(
      entries.flatMap((entry) => (entry.originalEventId ? [entry.originalEventId] : [])),
    );
    const result: Array<{ detail: string; kind: "added" | "changed" | "deleted" }> = [];
    for (const event of editingDay.events) {
      if (!currentIds.has(event.id)) {
        result.push({
          detail: `${eventLabels[event.type]} ${displayTime(dateTimeInZone(event.occurredAt, timezone))}`,
          kind: "deleted",
        });
      }
    }
    for (const entry of entries) {
      if (!entry.originalEventId) {
        result.push({
          detail: `${eventLabels[entry.type]} ${displayTime(entry.occurredAt)}`,
          kind: "added",
        });
        continue;
      }
      const original = originals.get(entry.originalEventId);
      if (!original) continue;
      const originalLocal = dateTimeInZone(original.occurredAt, timezone);
      if (original.type !== entry.type || originalLocal !== entry.occurredAt) {
        result.push({
          detail: `${eventLabels[original.type]} ${displayTime(originalLocal)} → ${eventLabels[entry.type]} ${displayTime(entry.occurredAt)}`,
          kind: "changed",
        });
      }
    }
    return result;
  }, [editingDay, entries, timezone]);

  function begin(day: CorrectionDay) {
    setEditingDay(day);
    setEntries(requestedEntries(day, timezone));
    setReason("");
    setError(undefined);
    setSuccess(undefined);
  }

  async function refreshHistory() {
    const response = await fetch("/api/attendance/corrections");
    if (!response.ok) return;
    const payload = (await response.json()) as { requests?: HistoryItem[] };
    setHistory(payload.requests ?? []);
  }

  async function submit() {
    if (!editingDay) return;
    setSubmitting(true);
    setError(undefined);
    const response = await fetch("/api/attendance/corrections", {
      body: JSON.stringify({
        entries: entries.map((entry) => ({
          ...entry,
          occurredAt:
            entry.originalOccurredAt &&
            entry.occurredAt === dateTimeInZone(entry.originalOccurredAt, timezone)
              ? entry.originalOccurredAt
              : zonedDateTimeToIso(entry.occurredAt, timezone),
        })),
        reason,
        workDate: editingDay.workDate,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "修正申請を送信できませんでした。");
      return;
    }
    setSuccess("勤怠修正を申請しました。");
    setEditingDay(undefined);
    await refreshHistory();
    router.refresh();
  }

  async function cancel(requestId: string) {
    setSubmitting(true);
    setError(undefined);
    const response = await fetch(`/api/attendance/corrections/${requestId}`, {
      body: JSON.stringify({ action: "cancel" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "申請を取り消せませんでした。");
      return;
    }
    setSuccess("申請を取り消しました。");
    await refreshHistory();
    router.refresh();
  }

  return (
    <>
      <section className="home-section" aria-labelledby="daily-records-heading">
        <h2 id="daily-records-heading">
          <ClockIcon /> 日ごとの記録
        </h2>
        <div className="attendance-day-list">
          {days.map((day) => (
            <article key={day.id}>
              <div className="attendance-day-heading">
                <div>
                  <strong>{day.workDate}</strong>
                  <span>
                    {day.operationalStatus
                      ? operationalStatusLabels[day.operationalStatus]
                      : day.status === "open"
                        ? "未退勤"
                        : "退勤済み"}
                  </span>
                  {day.isCorrected ? (
                    <span className="status-pill status-pill--approved">修正済み</span>
                  ) : null}
                  {day.correction ? (
                    <span className={`status-pill status-pill--${day.correction.status}`}>
                      {statusLabels[day.correction.status]}
                    </span>
                  ) : null}
                </div>
                <Button
                  disabled={
                    closed ||
                    day.correction?.status === "pending" ||
                    day.operationalStatus === "leave_full" ||
                    day.operationalStatus === "absence" ||
                    day.operationalStatus === "non_workday"
                  }
                  onClick={() => begin(day)}
                  type="button"
                  variant="secondary"
                >
                  {closed
                    ? "締め済み"
                    : day.correction?.status === "pending"
                      ? "審査待ち"
                      : "修正を申請"}
                </Button>
              </div>
              {day.calendarLabel || day.leaveTypeName || day.absenceReason ? (
                <div className="attendance-day-context">
                  {day.calendarLabel ? <span>勤務予定: {day.calendarLabel}</span> : null}
                  {day.leaveTypeName ? (
                    <span>
                      休暇: {day.leaveTypeName} {(day.leaveUnits ?? 0) / 2}日（対応所定{" "}
                      {day.leaveScheduledMinutes ?? 0}分）
                    </span>
                  ) : null}
                  {day.absenceReason ? <span>欠勤理由: {day.absenceReason}</span> : null}
                  {day.operationalStatus === "unresolved" ? (
                    <span>打刻を確認し、必要なら下の修正申請を送信してください。</span>
                  ) : null}
                  {day.operationalStatus === "conflict" ? (
                    <Link href="/leave">休暇申請を確認</Link>
                  ) : null}
                </div>
              ) : null}
              <ol className="attendance-event-list" aria-label={`${day.workDate}の有効打刻`}>
                {day.events.map((event) => (
                  <li key={event.id}>
                    <span>{eventLabels[event.type]}</span>
                    <time dateTime={event.occurredAt}>
                      {displayTime(dateTimeInZone(event.occurredAt, timezone))}
                    </time>
                  </li>
                ))}
              </ol>
              <dl>
                <div>
                  <dt>実労働</dt>
                  <dd>{hours(day.workedMinutes)}</dd>
                </div>
                <div>
                  <dt>所定</dt>
                  <dd>{hours(day.scheduledMinutes)}</dd>
                </div>
                <div>
                  <dt>残業</dt>
                  <dd>{hours(day.overtimeMinutes)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <section className="home-section" aria-labelledby="correction-history-heading">
        <h2 id="correction-history-heading">修正申請</h2>
        {editingDay ? (
          <div className="correction-editor">
            <header>
              <div>
                <span className="correction-eyebrow">{editingDay.workDate}</span>
                <h3>希望する打刻を編集</h3>
              </div>
              <Button onClick={() => setEditingDay(undefined)} type="button" variant="text">
                閉じる
              </Button>
            </header>
            <ol className="correction-entry-list">
              {entries.map((entry, index) => (
                <li key={entry.originalEventId ?? `new-${index}`}>
                  <SelectField
                    id={`correction-type-${index}`}
                    label={`${index + 1}件目の種別`}
                    onChange={(event) =>
                      setEntries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, type: event.target.value as PunchType }
                            : item,
                        ),
                      )
                    }
                    value={entry.type}
                  >
                    {Object.entries(eventLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                  <label className="ui-field" htmlFor={`correction-time-${index}`}>
                    <span>{index + 1}件目の時刻</span>
                    <input
                      id={`correction-time-${index}`}
                      onChange={(event) =>
                        setEntries((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, occurredAt: event.target.value }
                              : item,
                          ),
                        )
                      }
                      type="datetime-local"
                      value={entry.occurredAt}
                    />
                  </label>
                  <Button
                    aria-label={`${index + 1}件目を削除`}
                    onClick={() =>
                      setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                    type="button"
                    variant="danger"
                  >
                    削除
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              onClick={() =>
                setEntries((current) => [
                  ...current,
                  {
                    occurredAt: `${editingDay.workDate}T12:00`,
                    originalEventId: null,
                    type: "break_start",
                  },
                ])
              }
              type="button"
              variant="secondary"
            >
              打刻を追加
            </Button>
            <div className="correction-diff" aria-live="polite">
              <h4>変更内容</h4>
              {changes.length === 0 ? (
                <p>元の打刻から変更はありません。</p>
              ) : (
                <ul>
                  {changes.map((change, index) => (
                    <li
                      className={`correction-diff--${change.kind}`}
                      key={`${change.kind}-${index}`}
                    >
                      <strong>
                        {change.kind === "added"
                          ? "追加"
                          : change.kind === "deleted"
                            ? "削除"
                            : "変更"}
                      </strong>
                      <span>{change.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="correction-note">
                勤務時間と残業の集計は、管理者の承認後に更新されます。
              </p>
            </div>
            <TextareaField
              error={!reason.trim() && error ? "修正理由を入力してください。" : undefined}
              id="correction-reason"
              label="修正理由"
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例：退勤ボタンを押し忘れたため"
              rows={3}
              value={reason}
            />
            <div className="correction-actions">
              <Button
                disabled={submitting || changes.length === 0}
                onClick={() => void submit()}
                type="button"
              >
                {submitting ? "送信中…" : "この内容で申請"}
              </Button>
            </div>
          </div>
        ) : null}
        {history.length === 0 ? (
          <p className="correction-empty">申請履歴はありません。</p>
        ) : (
          <ul className="correction-history">
            {history.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>{request.workDate}</strong>
                  <span className={`status-pill status-pill--${request.status}`}>
                    {statusLabels[request.status]}
                  </span>
                </div>
                <p>{request.reason}</p>
                {request.reviewComment ? (
                  <p>
                    <strong>審査コメント：</strong>
                    {request.reviewComment}
                  </p>
                ) : null}
                {request.status === "pending" ? (
                  <Button
                    disabled={submitting}
                    onClick={() => void cancel(request.id)}
                    type="button"
                    variant="danger"
                  >
                    申請を取り消す
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
