import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ClockIcon } from "@/components/icons";
import { AttendanceCorrectionPanel } from "@/components/attendance-correction-panel";
import { EmptyState, Field, PageHeader, SubjectContext } from "@/components/ui";
import { getMonthlyAttendance } from "@/lib/attendance";
import { listOwnAttendanceCorrections } from "@/lib/attendance-corrections";
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
  const [attendance, corrections] = await Promise.all([
    getMonthlyAttendance(database, actor, month),
    listOwnAttendanceCorrections(database, actor),
  ]);

  return (
    <main className="employee-record-page">
      <PageHeader
        context={`${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`}
        status={attendance.closure.status === "closed" ? "締め済み" : "編集中"}
        title="勤務実績"
      >
        月ごとの打刻、実労働、所定、残業を確認し、誤りがある日は修正を申請します。
      </PageHeader>
      <SubjectContext
        items={[
          { label: "対象月", value: month },
          { label: "タイムゾーン", value: attendance.timezone },
          {
            label: "状態",
            value: attendance.closure.status === "closed" ? "締め済み" : "編集中",
          },
        ]}
      />
      <form className="month-filter">
        <Field
          defaultValue={month}
          id="attendance-month"
          label="表示する月"
          name="month"
          type="month"
        />
        <button className="ui-button ui-button--secondary" type="submit">
          表示
        </button>
      </form>
      {attendance.closure.status === "closed" ? (
        <div className="ui-toast ui-toast--info" role="status">
          この月は締め済みです（リビジョン {attendance.closure.currentRevision}
          ）。修正には管理者による再開が必要です。
        </div>
      ) : null}
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
      <p className="report-note">
        実労働・残業には休暇の対応所定時間を加算していません。この表示は法令適合を自動判定するものではありません。
      </p>
      {attendance.days.length === 0 ? (
        <section className="home-section" aria-labelledby="daily-records-heading">
          <h2 id="daily-records-heading">
            <ClockIcon /> 日ごとの記録
          </h2>
          <EmptyState title="勤務実績はまだありません">
            出勤すると、その日の勤務時間がここに表示されます。
          </EmptyState>
        </section>
      ) : (
        <AttendanceCorrectionPanel
          closed={attendance.closure.status === "closed"}
          days={attendance.days}
          initialHistory={corrections}
          timezone={attendance.timezone}
        />
      )}
    </main>
  );
}
