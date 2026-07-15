import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ClockIcon } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";
import { getMonthlyAttendance } from "@/lib/attendance";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";

function hours(minutes: number | null) {
  if (minutes === null) return "—";
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, "0")}分`;
}

export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const database = getDatabase();
  const cookieStore = await cookies();
  const actor = await sessionForToken(database, cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) redirect("/login");
  const requestedMonth = (await searchParams).month;
  const month = /^\d{4}-\d{2}$/.test(requestedMonth ?? "")
    ? requestedMonth!
    : new Date().toISOString().slice(0, 7);
  const attendance = await getMonthlyAttendance(database, actor, month);

  return (
    <main className="employee-record-page">
      <PageHeader title="勤務実績">月ごとの実労働・所定・残業を確認できます。</PageHeader>
      <form className="month-filter">
        <label className="ui-field" htmlFor="attendance-month">
          <span>表示する月</span>
          <input defaultValue={month} id="attendance-month" name="month" type="month" />
        </label>
        <button className="ui-button ui-button--secondary" type="submit">
          表示
        </button>
      </form>
      <dl className="work-summary work-summary--prominent">
        <div>
          <dt>実労働</dt>
          <dd>{hours(attendance.totals.workedMinutes)}</dd>
        </div>
        <div>
          <dt>所定</dt>
          <dd>{hours(attendance.totals.scheduledMinutes)}</dd>
        </div>
        <div>
          <dt>残業</dt>
          <dd>{hours(attendance.totals.overtimeMinutes)}</dd>
        </div>
      </dl>
      <section className="home-section" aria-labelledby="daily-records-heading">
        <h2 id="daily-records-heading">
          <ClockIcon /> 日ごとの記録
        </h2>
        {attendance.days.length === 0 ? (
          <EmptyState title="勤務実績はまだありません">
            出勤すると、その日の勤務時間がここに表示されます。
          </EmptyState>
        ) : (
          <div className="attendance-day-list">
            {attendance.days.map((day) => (
              <article key={day.id}>
                <div>
                  <strong>{day.workDate}</strong>
                  <span>{day.status === "open" ? "未退勤" : "退勤済み"}</span>
                </div>
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
        )}
      </section>
    </main>
  );
}
